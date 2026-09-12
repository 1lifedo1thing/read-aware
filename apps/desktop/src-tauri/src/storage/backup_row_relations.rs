//! Required references from the actual schema/runtime. Soft provenance links
//! that may outlive books/events deliberately do not become blanket failures.
use super::RowPlan;
use crate::error::CommandError;
use rusqlite::{Connection, OptionalExtension};

type Emit<'a> = dyn FnMut(&str, &str, Option<i64>, Option<&str>) -> Result<(), CommandError> + 'a;
fn missing(
    plan: &RowPlan,
    conn: &Connection,
    table: &str,
    kind: &str,
    related: &str,
    sql: &str,
    check: &mut impl FnMut() -> Result<(), CommandError>,
    emit: &mut Emit<'_>,
) -> Result<(), CommandError> {
    let mut query = conn.prepare(sql)?;
    let mut rows = query.query([])?;
    while let Some(row) = rows.next()? {
        check()?;
        emit(
            kind,
            table,
            plan.candidate_entry(conn, table, row.get(0)?)?,
            Some(related),
        )?;
    }
    Ok(())
}
pub(super) fn validate(
    plan: &RowPlan,
    conn: &Connection,
    check: &mut impl FnMut() -> Result<(), CommandError>,
    emit: &mut Emit<'_>,
) -> Result<(), CommandError> {
    let mut query = conn.prepare("PRAGMA foreign_key_check")?;
    let mut rows = query.query([])?;
    while let Some(row) = rows.next()? {
        check()?;
        let table: String = row.get(0)?;
        let rowid: Option<i64> = row.get(1)?;
        let parent: String = row.get(2)?;
        let entry = rowid
            .map(|id| plan.candidate_entry(conn, &table, id))
            .transpose()?
            .flatten();
        emit("foreignKey", &table, entry, Some(&parent))?;
    }
    missing(plan,conn,"ai_messages","conversation","ai_conversations","SELECT rowid FROM ai_messages m WHERE NOT EXISTS(SELECT 1 FROM ai_conversations c WHERE c.id=m.conversation_id)",check,emit)?;
    // Entity lookup follows exactly one redirect. A cross-side chain/cycle
    // would silently resolve to the wrong root even though each side is flat.
    missing(plan,conn,"entity_redirects","entityRedirect","entity_redirects","SELECT r.rowid FROM entity_redirects r WHERE EXISTS(SELECT 1 FROM entity_redirects next WHERE next.merged_id=r.keep_id)",check,emit)?;
    missing(plan, conn, "book_aliases", "bookAlias", "book_aliases", "SELECT r.rowid FROM book_aliases r WHERE EXISTS(SELECT 1 FROM book_aliases next WHERE next.merged_id=r.keep_id)", check, emit)?;
    virtual_books(plan, conn, check, emit)
}
fn virtual_books(
    plan: &RowPlan,
    conn: &Connection,
    check: &mut impl FnMut() -> Result<(), CommandError>,
    emit: &mut Emit<'_>,
) -> Result<(), CommandError> {
    conn.execute_batch("CREATE TEMP TABLE reviewed_virtual_bindings(id TEXT PRIMARY KEY);")?;
    let registry: Option<(i64,bool)> = conn.query_row("SELECT rowid,CASE WHEN json_valid(value_json) THEN json_type(value_json)='object' ELSE 0 END FROM app_kv WHERE key='read-aware-virtual-books'",[],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
    if let Some((rowid, valid)) = registry {
        let entry = plan.candidate_entry(conn, "app_kv", rowid)?;
        if !valid {
            emit("virtualBinding", "app_kv", entry, Some("books"))?;
        } else {
            let mut query = conn.prepare("SELECT j.key, CASE WHEN j.type='object' THEN CASE WHEN json_type(j.value,'$.pluginId')='text' THEN json_extract(j.value,'$.pluginId') END END, CASE WHEN j.type='object' THEN CASE WHEN json_type(j.value,'$.providerId')='text' THEN json_extract(j.value,'$.providerId') END END, CASE WHEN j.type='object' THEN json_type(j.value,'$.key') END FROM app_kv, json_each(value_json) j WHERE app_kv.key='read-aware-virtual-books'")?;
            let mut rows = query.query([])?;
            let mut invalid_binding_reported = false;
            while let Some(row) = rows.next()? {
                check()?;
                let id: String = row.get(0)?;
                let plugin: Option<String> = row.get(1)?;
                let provider: Option<String> = row.get(2)?;
                let key_type: Option<String> = row.get(3)?;
                if !plugin
                    .as_deref()
                    .is_some_and(crate::plugins::valid_plugin_id)
                    || !provider.as_deref().is_some_and(|s| {
                        !s.trim().is_empty() && s.len() <= 4096 && !s.contains('\0')
                    })
                    || key_type.as_deref() != Some("text")
                {
                    if !invalid_binding_reported {
                        emit("virtualBinding", "app_kv", entry, Some("books"))?;
                        invalid_binding_reported = true;
                    }
                } else {
                    conn.execute(
                        "INSERT OR IGNORE INTO reviewed_virtual_bindings VALUES (?1)",
                        [id],
                    )?;
                }
            }
        }
    }
    missing(plan,conn,"books","virtualBinding","app_kv","SELECT rowid FROM books b WHERE b.format='virtual' AND NOT EXISTS(SELECT 1 FROM reviewed_virtual_bindings v WHERE v.id=b.id)",check,emit)
}
