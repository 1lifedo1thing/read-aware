//! Durable restore publication. Event append/apply and obligation removal share
//! one transaction; a failed/lost response is safely retried from pending slots.
use super::{credential_crypto as crypto, local_event_guard, DataDir, Db, EventRow};
use crate::error::CommandError;
use rusqlite::{Connection, Transaction, TransactionBehavior};
use std::{collections::BTreeSet, path::Path};
use tauri::Manager;

fn valid(slot: &str) -> bool {
    slot.starts_with("ai-api-key") && slot.len() <= 4096 && !slot.contains('\0')
}
fn invalid() -> CommandError {
    CommandError::new(
        "backup/incomplete",
        "invalid restored credential publication",
    )
}
pub(crate) fn enqueue(tx: &Transaction<'_>, slot: &str) -> Result<(), CommandError> {
    if !valid(slot) {
        return Err(invalid());
    }
    tx.execute("INSERT INTO restored_credential_publications(slot,created_at) VALUES (?1,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(slot) DO NOTHING", [slot])?;
    Ok(())
}
pub(crate) fn contains(conn: &Connection, slot: &str) -> Result<bool, CommandError> {
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM restored_credential_publications WHERE slot=?1)",
        [slot],
        |row| row.get(0),
    )?)
}
pub(crate) fn pending(conn: &Connection) -> Result<Vec<String>, CommandError> {
    let mut query =
        conn.prepare("SELECT slot FROM restored_credential_publications ORDER BY slot LIMIT 100")?;
    let rows = query
        .query_map([], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PublicationReport {
    pub events: Vec<EventRow>,
    pub awaiting_connection: bool,
}
pub(crate) fn publish(
    conn: &mut Connection,
    root: &Path,
    mut events: Vec<EventRow>,
) -> Result<PublicationReport, CommandError> {
    if events.len() > 100 {
        return Err(invalid());
    }
    let mut slots = BTreeSet::new();
    for event in &events {
        let key = event
            .payload
            .get("key")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(invalid)?;
        let slot = key
            .strip_prefix("secret:")
            .filter(|slot| valid(slot))
            .ok_or_else(invalid)?;
        if event.event_type != "preference.changed"
            || event.origin.as_deref() != Some("system")
            || event.aggregate_type.as_deref() != Some("preference")
            || event.aggregate_id.as_deref() != Some(key)
            || !slots.insert(slot.to_owned())
        {
            return Err(invalid());
        }
    }
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let Some(master) = crypto::master(&tx, root)? else {
        return Ok(PublicationReport {
            events: vec![],
            awaiting_connection: true,
        });
    };
    let mut published = Vec::new();
    let mut plaintext_bytes = 0usize;
    for event in &mut events {
        let key = event.aggregate_id.as_ref().unwrap();
        let slot = key.strip_prefix("secret:").unwrap();
        let exists: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM restored_credential_publications WHERE slot=?1)",
            [slot],
            |row| row.get(0),
        )?;
        if !exists {
            continue;
        } // Another drain already committed this slot.
        local_event_guard::validate_new_event(&tx, event).map_err(|error| {
            match error.code.as_str() {
                "memory/conflict" => CommandError::new(
                    "backup/changed",
                    "credential publication clock must follow the current log and checkpoint",
                ),
                "memory/invalid-input" => invalid(),
                _ => error,
            }
        })?;
        let local = crypto::local(&tx, root, slot)?;
        let size = local.as_ref().map_or(0, |value| value.len());
        // Keep the returned ciphertext batch bounded too, not just each value.
        // One oversized-but-valid value runs alone; remaining markers stay for
        // the next host iteration instead of being skipped or acknowledged.
        if !published.is_empty() && plaintext_bytes + size > 16 * 1024 * 1024 {
            break;
        }
        plaintext_bytes += size;
        let value = match local {
            Some(value) if !value.is_empty() => {
                serde_json::json!({"sealed":crypto::seal(&master, slot, &value)?})
            }
            _ => serde_json::Value::Null,
        };
        // Never accept caller-provided secret contents. Read the latest durable
        // local value and current master key under the same native DB mutex.
        event.payload = serde_json::json!({"key":key,"value":value});
        super::commit_events_in_transaction(&tx, std::slice::from_ref(event))?;
        tx.execute(
            "DELETE FROM restored_credential_publications WHERE slot=?1",
            [slot],
        )?;
        published.push(event.clone());
    }
    tx.commit()?;
    Ok(PublicationReport {
        events: published,
        awaiting_connection: false,
    })
}
#[tauri::command]
pub async fn restored_credentials_pending(
    app: tauri::AppHandle,
) -> Result<Vec<String>, CommandError> {
    super::blocking("restored_credentials_pending", move || {
        let db = app.state::<Db>();
        let conn = db.0.lock()?;
        pending(&conn)
    })
    .await
}
#[tauri::command]
pub async fn restored_credentials_publish(
    app: tauri::AppHandle,
    events: Vec<EventRow>,
) -> Result<PublicationReport, CommandError> {
    super::blocking("restored_credentials_publish", move || {
        let db = app.state::<Db>();
        let root = app.state::<DataDir>();
        let mut conn = db.0.lock()?;
        publish(&mut conn, &root.0, events)
    })
    .await
}
#[cfg(test)]
#[path = "restored_credentials_tests.rs"]
mod tests;
