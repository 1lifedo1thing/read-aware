//! A logical, typed full-database revision. Rowids matter for existing FTS and
//! are included; raw values, schema, private/local tables and internal stats all
//! participate. No table catalog is silently omitted and no data is materialized
//! as one giant JSON object or mixed across database snapshots.
use crate::error::CommandError;
use rusqlite::{types::ValueRef, Transaction};
use sha2::{Digest, Sha256};

pub(super) fn bytes(
    hash: &mut Sha256,
    value: &[u8],
    check: &mut impl FnMut() -> Result<(), CommandError>,
) -> Result<(), CommandError> {
    hash.update((value.len() as u64).to_le_bytes());
    for chunk in value.chunks(1024 * 1024) {
        check()?;
        hash.update(chunk);
    }
    Ok(())
}
pub(super) fn scalar(
    hash: &mut Sha256,
    value: ValueRef<'_>,
    check: &mut impl FnMut() -> Result<(), CommandError>,
) -> Result<(), CommandError> {
    match value {
        ValueRef::Null => hash.update([0]),
        ValueRef::Integer(value) => {
            hash.update([1]);
            hash.update(value.to_le_bytes());
        }
        ValueRef::Real(value) => {
            hash.update([2]);
            hash.update(value.to_bits().to_le_bytes());
        }
        ValueRef::Text(value) => {
            hash.update([3]);
            bytes(hash, value, check)?;
        }
        ValueRef::Blob(value) => {
            hash.update([4]);
            bytes(hash, value, check)?;
        }
    }
    Ok(())
}
fn quoted(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

pub(super) fn database(
    tx: &Transaction<'_>,
    check: &mut impl FnMut() -> Result<(), CommandError>,
) -> Result<String, CommandError> {
    check()?;
    let mut hash = Sha256::new();
    hash.update(b"readaware.backup.target-database.v1\0");
    let mut schema =
        tx.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name")?;
    let mut rows = schema.query([])?;
    while let Some(row) = rows.next()? {
        check()?;
        hash.update([10]);
        for column in 0..4 {
            scalar(&mut hash, row.get_ref(column)?, check)?;
        }
    }
    // Query only the host's existing database. Names are quoted; no source DDL
    // or user-provided SQL is ever executed against the target.
    let mut tables = tx.prepare("SELECT name,wr FROM pragma_table_list WHERE schema='main' AND name!='sqlite_schema' AND type IN ('table','virtual','shadow') ORDER BY name")?;
    let mut tables = tables.query([])?;
    while let Some(table) = tables.next()? {
        check()?;
        let name: String = table.get(0)?;
        let without_rowid: bool = table.get(1)?;
        hash.update([11]);
        bytes(&mut hash, name.as_bytes(), check)?;
        let mut metadata = tx.prepare(&format!("PRAGMA table_xinfo({})", quoted(&name)))?;
        let columns = metadata
            .query_map([], |row| {
                Ok((row.get::<_, String>(1)?, row.get::<_, i64>(5)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let (select, order) = if without_rowid {
            let mut keys: Vec<_> = columns.iter().filter(|(_, rank)| *rank > 0).collect();
            keys.sort_by_key(|(_, rank)| *rank);
            if keys.is_empty() {
                return Err(CommandError::new(
                    "db/error",
                    "target table has no stable key",
                ));
            }
            (
                "*".to_owned(),
                keys.iter()
                    .map(|(name, _)| quoted(name))
                    .collect::<Vec<_>>()
                    .join(","),
            )
        } else {
            let rowid = ["rowid", "_rowid_", "oid"]
                .into_iter()
                .find(|alias| {
                    !columns
                        .iter()
                        .any(|(name, _)| name.eq_ignore_ascii_case(alias))
                })
                .ok_or_else(|| {
                    CommandError::new("db/error", "target table shadows all rowid aliases")
                })?;
            (format!("{rowid},*"), rowid.to_owned())
        };
        let mut statement = tx.prepare(&format!(
            "SELECT {select} FROM {} ORDER BY {order}",
            quoted(&name)
        ))?;
        let columns = statement.column_count();
        hash.update((columns as u64).to_le_bytes());
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            check()?;
            hash.update([12]);
            for column in 0..columns {
                scalar(&mut hash, row.get_ref(column)?, check)?;
            }
        }
        hash.update([13]);
    }
    check()?;
    Ok(format!("{:x}", hash.finalize()))
}
