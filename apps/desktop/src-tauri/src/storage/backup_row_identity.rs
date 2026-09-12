use crate::error::CommandError;
use rusqlite::types::ValueRef;
fn invalid() -> CommandError {
    CommandError::new("backup/invalid-archive", "Invalid backup row identity")
}

// Borrow the original text bytes, including unusual UTF-8, rather than round
// tripping primary keys through JSON strings or JavaScript numbers.
pub(super) struct BoundCell<'a>(pub(super) ValueRef<'a>);
impl rusqlite::ToSql for BoundCell<'_> {
    fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
        Ok(rusqlite::types::ToSqlOutput::Borrowed(self.0))
    }
}
pub(super) fn decode_key(
    mut key: &[u8],
    expected: usize,
) -> Result<Vec<ValueRef<'_>>, CommandError> {
    fn take<'a>(bytes: &mut &'a [u8], count: usize) -> Result<&'a [u8], CommandError> {
        if bytes.len() < count {
            return Err(invalid());
        }
        let (head, tail) = bytes.split_at(count);
        *bytes = tail;
        Ok(head)
    }
    fn number(bytes: &mut &[u8]) -> Result<[u8; 8], CommandError> {
        Ok(take(bytes, 8)?.try_into().map_err(|_| invalid())?)
    }
    if u64::from_le_bytes(number(&mut key)?) != expected as u64 {
        return Err(invalid());
    }
    let mut values = Vec::with_capacity(expected);
    for _ in 0..expected {
        values.push(match take(&mut key, 1)?[0] {
            1 => ValueRef::Integer(i64::from_le_bytes(number(&mut key)?)),
            2 => ValueRef::Real(f64::from_bits(u64::from_le_bytes(number(&mut key)?))),
            tag @ (3 | 4) => {
                let len = usize::try_from(u64::from_le_bytes(number(&mut key)?))
                    .map_err(|_| invalid())?;
                let bytes = take(&mut key, len)?;
                if tag == 3 {
                    ValueRef::Text(bytes)
                } else {
                    ValueRef::Blob(bytes)
                }
            }
            _ => return Err(invalid()),
        });
    }
    if !key.is_empty() {
        return Err(invalid());
    }
    Ok(values)
}
