use super::{policy, revision, RowPolicy};
use crate::error::CommandError;
use rusqlite::{params, types::ValueRef, Connection, Transaction};
use sha2::{Digest, Sha256};

#[derive(Debug, PartialEq, Eq)]
pub(super) struct Column {
    name: String,
    kind: String,
    primary: i64,
}
pub(super) fn quoted(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}
pub(super) fn columns(conn: &Connection, table: &str) -> Result<Vec<Column>, CommandError> {
    let mut query = conn.prepare(&format!("PRAGMA table_info({})", quoted(table)))?;
    let columns = query
        .query_map([], |row| {
            Ok(Column {
                name: row.get(1)?,
                kind: row.get(2)?,
                primary: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(columns)
}
fn key_cell(key: &mut Vec<u8>, value: ValueRef<'_>) -> Result<(), CommandError> {
    match value {
        ValueRef::Null => {
            return Err(CommandError::new(
                "db/error",
                "backup row has a null primary identity",
            ))
        }
        ValueRef::Integer(value) => {
            key.push(1);
            key.extend_from_slice(&value.to_le_bytes());
        }
        ValueRef::Real(value) => {
            key.push(2);
            key.extend_from_slice(&value.to_bits().to_le_bytes());
        }
        ValueRef::Text(bytes) | ValueRef::Blob(bytes) => {
            key.push(if matches!(value, ValueRef::Text(_)) {
                3
            } else {
                4
            });
            key.extend_from_slice(&(bytes.len() as u64).to_le_bytes());
            key.extend_from_slice(bytes);
        }
    }
    Ok(())
}
pub(super) fn rows(
    conn: &Connection,
    plan: &Transaction<'_>,
    table: &str,
    policy: RowPolicy,
    columns: &[Column],
    source: bool,
    check: &mut impl FnMut() -> Result<(), CommandError>,
) -> Result<(), CommandError> {
    let mut keys: Vec<_> = columns
        .iter()
        .enumerate()
        .filter(|(_, column)| column.primary > 0)
        .collect();
    keys.sort_by_key(|(_, column)| column.primary);
    if keys.is_empty() {
        return Err(CommandError::new(
            "backup/incomplete",
            "restorable table has no primary identity",
        ));
    }
    let order = keys
        .iter()
        .map(|(_, column)| quoted(&column.name))
        .collect::<Vec<_>>()
        .join(",");
    let mut statement =
        conn.prepare(&format!("SELECT * FROM {} ORDER BY {order}", quoted(table)))?;
    if statement.column_count() != columns.len() {
        return Err(CommandError::new(
            "backup/incomplete",
            "unexpected backup row shape",
        ));
    }
    let mut rows = statement.query([])?;
    let sql = if source {
        "INSERT INTO row_matches(table_name,row_key,policy,source_digest,source_full_digest) VALUES (?1,?2,?3,?4,?5)"
    } else {
        "INSERT INTO row_matches(table_name,row_key,policy,target_digest,target_full_digest) VALUES (?1,?2,?3,?4,?5)
         ON CONFLICT(table_name,row_key) DO UPDATE SET target_digest=excluded.target_digest,target_full_digest=excluded.target_full_digest
         WHERE row_matches.target_digest IS NULL AND row_matches.policy=excluded.policy"
    };
    let mut insert = plan.prepare(sql)?;
    while let Some(row) = rows.next()? {
        check()?;
        let mut key = Vec::new();
        key.extend_from_slice(&(keys.len() as u64).to_le_bytes());
        for (index, _) in &keys {
            key_cell(&mut key, row.get_ref(*index)?)?;
        }
        let row_policy = if matches!(table, "app_kv" | "synced_preferences") {
            let index = columns
                .iter()
                .position(|column| column.name == "key")
                .ok_or_else(|| CommandError::internal("missing preference identity"))?;
            policy::keyed(table, &row.get::<_, String>(index)?)
        } else {
            policy
        };
        let mut full = Sha256::new();
        let mut content = Sha256::new();
        full.update(b"readaware.backup.stored-row.v1\0");
        content.update(b"readaware.backup.row-content.v1\0");
        revision::bytes(&mut full, table.as_bytes(), check)?;
        revision::bytes(&mut content, table.as_bytes(), check)?;
        for (index, column) in columns.iter().enumerate() {
            check()?;
            revision::bytes(&mut full, column.name.as_bytes(), check)?;
            revision::scalar(&mut full, row.get_ref(index)?, check)?;
            if table != "plugin_documents" || column.name != "revision" {
                revision::bytes(&mut content, column.name.as_bytes(), check)?;
                revision::scalar(&mut content, row.get_ref(index)?, check)?;
            }
        }
        if insert.execute(params![
            table,
            key,
            row_policy.name(),
            format!("{:x}", content.finalize()),
            format!("{:x}", full.finalize())
        ])? != 1
        {
            return Err(CommandError::new(
                "db/error",
                "duplicate or incompatible backup row identity",
            ));
        }
    }
    Ok(())
}
