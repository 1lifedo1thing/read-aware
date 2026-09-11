use super::{revision, EventMatchKind, EventPlanReport};
use crate::error::CommandError;
use rusqlite::{params, types::ValueRef, Connection, Params, Row, Statement, Transaction};
use serde_json::Value;
use sha2::{Digest, Sha256};

const FIELDS: &str = "id,type,schema_version,hlc_wall_ms,hlc_counter,hlc_device,aggregate_type,aggregate_id,payload_json,actor_id,origin,created_at";
const SAFE_INTEGER: i64 = 9_007_199_254_740_991;
fn invalid() -> CommandError {
    CommandError::new(
        "db/error",
        "event identity planning encountered an invalid stored envelope",
    )
}
struct Event {
    id: String,
    wall: i64,
    counter: i64,
    device: String,
    digest: String,
}

fn text<'a>(row: &'a Row<'_>, column: usize, limit: usize) -> Result<&'a str, CommandError> {
    match row.get_ref(column)? {
        ValueRef::Text(bytes) if bytes.len() <= limit => {
            std::str::from_utf8(bytes).map_err(|_| invalid())
        }
        _ => Err(invalid()),
    }
}
// Normalize decimal spelling without an f64 conversion: 1, 1.0 and 1e0 are
// equal, but neighboring large integer facts must never be rounded together.
fn number(value: &serde_json::Number) -> Result<String, CommandError> {
    let raw = value.to_string();
    let (negative, raw) = match raw.strip_prefix('-') {
        Some(value) => (true, value),
        None => (false, raw.as_str()),
    };
    let (mantissa, exponent) = match raw.find(['e', 'E']) {
        Some(index) => (
            &raw[..index],
            raw[index + 1..].parse::<i64>().map_err(|_| invalid())?,
        ),
        None => (raw, 0),
    };
    let (whole, fraction) = mantissa.split_once('.').unwrap_or((mantissa, ""));
    let digits = format!("{whole}{fraction}");
    let digits = digits.trim_start_matches('0');
    if digits.is_empty() {
        return Ok("0e0".into());
    }
    let significant = digits.trim_end_matches('0');
    let exponent = exponent
        .checked_sub(fraction.len() as i64)
        .and_then(|value| value.checked_add((digits.len() - significant.len()) as i64))
        .ok_or_else(invalid)?;
    Ok(format!(
        "{}{significant}e{exponent}",
        if negative { "-" } else { "" }
    ))
}
fn json(
    hash: &mut Sha256,
    value: &Value,
    check: &mut impl FnMut() -> Result<(), CommandError>,
) -> Result<(), CommandError> {
    check()?;
    match value {
        Value::Null => hash.update([0]),
        Value::Bool(value) => hash.update([1, *value as u8]),
        Value::Number(value) => {
            hash.update([2]);
            revision::bytes(hash, number(value)?.as_bytes(), check)?;
        }
        Value::String(value) => {
            hash.update([3]);
            revision::bytes(hash, value.as_bytes(), check)?;
        }
        Value::Array(values) => {
            hash.update([4]);
            hash.update((values.len() as u64).to_le_bytes());
            for value in values {
                json(hash, value, check)?;
            }
        }
        Value::Object(values) => {
            hash.update([5]);
            hash.update((values.len() as u64).to_le_bytes());
            let mut keys: Vec<_> = values.keys().collect();
            keys.sort_unstable();
            for key in keys {
                revision::bytes(hash, key.as_bytes(), check)?;
                json(hash, &values[key], check)?;
            }
        }
    }
    Ok(())
}
fn event(
    row: &Row<'_>,
    check: &mut impl FnMut() -> Result<(), CommandError>,
) -> Result<Event, CommandError> {
    check()?;
    let version: i64 = row.get(2)?;
    let wall: i64 = row.get(3)?;
    let counter: i64 = row.get(4)?;
    if !(1..=SAFE_INTEGER).contains(&version)
        || !(0..=SAFE_INTEGER).contains(&wall)
        || !(0..=SAFE_INTEGER).contains(&counter)
    {
        return Err(invalid());
    }
    let mut hash = Sha256::new();
    hash.update(b"readaware.backup.event-envelope.v1\0");
    for column in 0..12 {
        hash.update([column as u8]);
        match column {
            2..=4 => {
                hash.update([1]);
                hash.update(row.get::<_, i64>(column)?.to_le_bytes());
            }
            8 => {
                let payload: Value = serde_json::from_str(text(row, column, 64 * 1024 * 1024)?)
                    .map_err(|_| invalid())?;
                if !payload.is_object() {
                    return Err(invalid());
                }
                json(&mut hash, &payload, check)?;
            }
            6 | 7 if row.get_ref(column)? == ValueRef::Null => hash.update([0]),
            _ => {
                let value = text(row, column, 4096)?;
                if value.contains('\0') || (!matches!(column, 6 | 7) && value.trim().is_empty()) {
                    return Err(invalid());
                }
                hash.update([2]);
                revision::bytes(&mut hash, value.as_bytes(), check)?;
            }
        }
    }
    // Ingestion time is intentionally not part of an immutable event envelope:
    // two devices may have received the same fact on different days.
    Ok(Event {
        id: text(row, 0, 4096)?.into(),
        wall,
        counter,
        device: text(row, 5, 4096)?.into(),
        digest: format!("{:x}", hash.finalize()),
    })
}
fn lookup(
    statement: &mut Statement<'_>,
    parameters: impl Params,
    check: &mut impl FnMut() -> Result<(), CommandError>,
) -> Result<Option<Event>, CommandError> {
    let mut rows = statement.query(parameters)?;
    let found = match rows.next()? {
        Some(row) => Some(event(row, check)?),
        None => None,
    };
    if rows.next()?.is_some() {
        return Err(invalid());
    }
    Ok(found)
}

pub(super) fn compare(
    source: &Connection,
    target: &Transaction<'_>,
    plan: &Transaction<'_>,
    check: &mut impl FnMut() -> Result<(), CommandError>,
) -> Result<EventPlanReport, CommandError> {
    let mut source_query =
        source.prepare(&format!("SELECT {FIELDS} FROM domain_events ORDER BY id"))?;
    let mut by_id = target.prepare(&format!(
        "SELECT {FIELDS} FROM domain_events WHERE id=?1 LIMIT 2"
    ))?;
    let mut by_clock = target.prepare(&format!("SELECT {FIELDS} FROM domain_events WHERE hlc_wall_ms=?1 AND hlc_counter=?2 AND hlc_device=?3 LIMIT 2"))?;
    let mut insert = plan.prepare("INSERT INTO event_matches VALUES (?1,?2,?3,?4,?5,?6)")?;
    let mut report = EventPlanReport::default();
    let mut rows = source_query.query([])?;
    while let Some(row) = rows.next()? {
        let source = event(row, check)?;
        let id_target = lookup(&mut by_id, [&source.id], check)?;
        let clock_target = lookup(
            &mut by_clock,
            params![source.wall, source.counter, source.device],
            check,
        )?;
        let id_conflict = id_target
            .as_ref()
            .is_some_and(|target| target.digest != source.digest);
        let clock_conflict = clock_target
            .as_ref()
            .is_some_and(|target| target.id != source.id);
        let kind = match (id_conflict, clock_conflict) {
            (true, true) => EventMatchKind::IdAndClockConflict,
            (true, false) => EventMatchKind::IdConflict,
            (false, true) => EventMatchKind::ClockConflict,
            (false, false) if id_target.is_some() => EventMatchKind::Existing,
            (false, false) => EventMatchKind::New,
        };
        match kind {
            EventMatchKind::New => report.new_events += 1,
            EventMatchKind::Existing => report.existing_events += 1,
            _ => report.conflicting_events += 1,
        }
        report.id_conflicts += u64::from(id_conflict);
        report.clock_conflicts += u64::from(clock_conflict);
        insert.execute(params![
            source.id,
            kind.code(),
            source.digest,
            id_target.as_ref().map(|event| &event.digest),
            clock_target.as_ref().map(|event| &event.id),
            clock_target.as_ref().map(|event| &event.digest)
        ])?;
    }
    Ok(report)
}
