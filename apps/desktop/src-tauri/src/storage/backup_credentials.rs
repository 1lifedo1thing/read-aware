//! Explicit credential choices become sealed, unapplied operations. No secret
//! plaintext/key is serialized or inserted into a queryable staging database.
use super::FilePlan;
use crate::error::CommandError;
use rusqlite::{Connection, Transaction};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};
use zeroize::Zeroizing;
#[path = "backup_credential_crypto.rs"]
mod crypto;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CredentialChoice {
    SourceLocal,
    SourceRoaming,
    TargetLocal,
    TargetRoaming,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RoamingState {
    Absent,
    Value,
    Deleted,
    Locked,
}
#[derive(Debug)]
pub(crate) struct CredentialFacts {
    pub slot: String,
    pub source_local: bool,
    pub target_local: bool,
    pub local_equal: Option<bool>,
    pub source_roaming: RoamingState,
    pub target_roaming: RoamingState,
    /// Explicitly expose disagreement within one device instead of guessing
    /// whether a local write or a not-yet-overlaid roaming value is newer.
    pub source_local_matches_roaming: Option<bool>,
    pub target_local_matches_roaming: Option<bool>,
}
#[derive(Debug)]
pub(crate) enum RoamingPublication {
    NotRoaming,
    /// A NEW preference.changed payload. Never edits a historical envelope.
    EventPayload(serde_json::Value),
    /// Persist this obligation in the eventual restore decision and republish
    /// after connecting. Especially important for deletions absent from local KV.
    PendingConnection,
}
pub(crate) struct PreparedCredential {
    pub slot: String,
    /// None deletes this local slot. Some is AES-GCM under the prepared key.
    pub local_sealed: Option<String>,
    pub roaming: RoamingPublication,
}
impl std::fmt::Debug for PreparedCredential {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PreparedCredential")
            .field("has_value", &self.local_sealed.is_some())
            .finish_non_exhaustive()
    }
}
pub(crate) struct PreparedCredentials {
    pub plan: FilePlan,
    pub operations: Vec<PreparedCredential>,
    /// Only present for a fresh target that needs a key. Install atomically with
    /// the DB decision; never invoke normal first-use key creation while planning.
    pub new_key: Option<Zeroizing<Vec<u8>>>,
}
impl std::fmt::Debug for PreparedCredentials {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PreparedCredentials")
            .field("operations", &self.operations.len())
            .field("needs_key_install", &self.new_key.is_some())
            .finish()
    }
}
fn invalid(message: &str) -> CommandError {
    CommandError::new("backup/incomplete", message)
}
fn roaming_slot(slot: &str) -> bool {
    slot.starts_with("ai-api-key")
}
fn slots(
    source: &Connection,
    target: &Connection,
    check: &mut impl FnMut() -> Result<(), CommandError>,
) -> Result<BTreeSet<String>, CommandError> {
    let mut result = BTreeSet::new();
    let mut total = 0;
    for conn in [source, target] {
        for (table, prefix) in [
            ("app_kv", "read-aware-secret:"),
            ("synced_preferences", "secret:"),
        ] {
            let mut statement = conn.prepare(&format!(
                "SELECT key FROM {table} WHERE substr(key,1,?1)=?2 ORDER BY key"
            ))?;
            let mut rows = statement.query(rusqlite::params![prefix.len(), prefix])?;
            while let Some(row) = rows.next()? {
                check()?;
                let key: String = row.get(0)?;
                let slot = key
                    .strip_prefix(prefix)
                    .ok_or_else(|| invalid("invalid credential prefix"))?;
                if slot.starts_with("sync.") {
                    if table == "synced_preferences" {
                        return Err(invalid("sync identities cannot be roaming credentials"));
                    }
                    continue;
                }
                if slot.is_empty() || slot.len() > 4096 || slot.contains('\0') {
                    return Err(invalid("invalid credential slot"));
                }
                if table == "synced_preferences" && !roaming_slot(slot) {
                    return Err(invalid("unsupported roaming credential contract"));
                }
                if result.insert(slot.to_owned()) {
                    total += slot.len();
                }
                if result.len() > 100_000 || total > 16 * 1024 * 1024 {
                    return Err(invalid("credential catalog exceeds limit"));
                }
            }
        }
    }
    Ok(result)
}
struct Roamed {
    state: RoamingState,
    value: Option<Zeroizing<String>>,
}
fn roamed(conn: &Connection, master: Option<&[u8]>, slot: &str) -> Result<Roamed, CommandError> {
    let Some(raw) = crypto::value(conn, "synced_preferences", &format!("secret:{slot}"))? else {
        return Ok(Roamed {
            state: RoamingState::Absent,
            value: None,
        });
    };
    let value: serde_json::Value =
        serde_json::from_str(&raw).map_err(|_| invalid("invalid roaming credential JSON"))?;
    if value.is_null() {
        return Ok(Roamed {
            state: RoamingState::Deleted,
            value: None,
        });
    }
    let packed = value
        .get("sealed")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| invalid("invalid roaming credential envelope"))?;
    let Some(master) = master else {
        return Ok(Roamed {
            state: RoamingState::Locked,
            value: None,
        });
    };
    // Unavailable historical keys do not prevent selection of a valid local
    // credential. Selecting this locked candidate remains an explicit failure.
    match crypto::open(master, slot, packed) {
        Ok(value) => Ok(Roamed {
            state: RoamingState::Value,
            value: Some(value),
        }),
        Err(_) => Ok(Roamed {
            state: RoamingState::Locked,
            value: None,
        }),
    }
}
fn equality(local: &Option<Zeroizing<String>>, roaming: &Roamed) -> Option<bool> {
    match roaming.state {
        RoamingState::Value | RoamingState::Deleted => Some(local == &roaming.value),
        _ => None,
    }
}
pub(super) fn inspect(
    plan: &FilePlan,
    tx: &Transaction<'_>,
    root: &Path,
    mut check: impl FnMut() -> Result<(), CommandError>,
) -> Result<Vec<CredentialFacts>, CommandError> {
    plan.verify_target(tx, root, &mut check)?;
    plan.verify_source(&mut check)?;
    let archive = plan.rows().events().source().archive();
    let source = plan.rows().events().source().connection();
    let a_master = crypto::master(source, archive.directory())?;
    let b_master = crypto::master(tx, root)?;
    let mut facts = Vec::new();
    for slot in slots(source, tx, &mut check)? {
        check()?;
        let a = crypto::local(source, archive.directory(), &slot)?;
        let b = crypto::local(tx, root, &slot)?;
        let ar = roamed(source, a_master.as_deref().map(Vec::as_slice), &slot)?;
        let br = roamed(tx, b_master.as_deref().map(Vec::as_slice), &slot)?;
        facts.push(CredentialFacts {
            slot,
            source_local: a.is_some(),
            target_local: b.is_some(),
            local_equal: a.as_ref().zip(b.as_ref()).map(|(a, b)| a == b),
            source_local_matches_roaming: equality(&a, &ar),
            target_local_matches_roaming: equality(&b, &br),
            source_roaming: ar.state,
            target_roaming: br.state,
        });
    }
    plan.verify_target(tx, root, &mut check)?;
    plan.verify_source(&mut check)?;
    Ok(facts)
}
pub(super) fn prepare(
    plan: FilePlan,
    tx: &Transaction<'_>,
    root: &Path,
    choices: &BTreeMap<String, CredentialChoice>,
    mut check: impl FnMut() -> Result<(), CommandError>,
) -> Result<PreparedCredentials, CommandError> {
    plan.verify_target(tx, root, &mut check)?;
    plan.verify_source(&mut check)?;
    let archive = plan.rows().events().source().archive();
    let source = plan.rows().events().source().connection();
    let slots = slots(source, tx, &mut check)?;
    if !slots.iter().eq(choices.keys()) {
        return Err(invalid(
            "credential choices must cover the exact inspected catalog",
        ));
    }
    let source_master = crypto::master(source, archive.directory())?;
    let target_master = crypto::master(tx, root)?;
    let existing_key = crypto::read_key(root)?;
    let mut new_key = None;
    let mut operations = Vec::new();
    for (slot, choice) in choices {
        check()?;
        let plaintext = match choice {
            CredentialChoice::SourceLocal => Some(
                crypto::local(source, archive.directory(), slot)?
                    .ok_or_else(|| invalid("source local credential is absent"))?,
            ),
            // Explicit selection of target absence is a deletion/keep-absent
            // decision; missing source data alone never implies deletion.
            CredentialChoice::TargetLocal => crypto::local(tx, root, slot)?,
            CredentialChoice::SourceRoaming | CredentialChoice::TargetRoaming => {
                let candidate = if *choice == CredentialChoice::SourceRoaming {
                    roamed(source, source_master.as_deref().map(Vec::as_slice), slot)?
                } else {
                    roamed(tx, target_master.as_deref().map(Vec::as_slice), slot)?
                };
                match candidate.state {
                    RoamingState::Value | RoamingState::Deleted => candidate.value,
                    RoamingState::Absent => {
                        return Err(invalid("selected roaming credential is absent"))
                    }
                    RoamingState::Locked => return Err(crypto::unavailable()),
                }
            }
        };
        let local_sealed = if let Some(value) = &plaintext {
            if existing_key.is_none() && new_key.is_none() {
                new_key = Some(crypto::generate_key());
            }
            let key = existing_key.as_ref().or(new_key.as_ref()).unwrap();
            Some(crate::secrets::encrypt_with_key(key, value)?)
        } else {
            None
        };
        let roaming = if !roaming_slot(slot) {
            RoamingPublication::NotRoaming
        } else if let Some(key) = &target_master {
            let value = match &plaintext {
                Some(value) if !value.is_empty() => {
                    serde_json::json!({"sealed": crypto::seal(key, slot, value)?})
                }
                _ => serde_json::Value::Null,
            };
            RoamingPublication::EventPayload(
                serde_json::json!({"key": format!("secret:{slot}"), "value": value}),
            )
        } else {
            RoamingPublication::PendingConnection
        };
        operations.push(PreparedCredential {
            slot: slot.clone(),
            local_sealed,
            roaming,
        });
    }
    check()?;
    plan.verify_target(tx, root, &mut check)?;
    plan.verify_source(&mut check)?;
    Ok(PreparedCredentials {
        plan,
        operations,
        new_key,
    })
}
#[cfg(test)]
#[path = "backup_credentials_tests.rs"]
mod tests;
