//! Ordering for the shared resume position. Reuse this at both the pending
//! session and event projection boundaries: an offline session must not lose
//! its high-water mark before it even becomes a sync event.
use serde_json::Value;
use std::cmp::Ordering;

fn fraction(p: &Value) -> f64 {
    match (p["currentLocation"].as_f64(), p["totalLocations"].as_f64()) {
        (Some(current), Some(total)) if current >= 0.0 && total > 0.0 => {
            (current / total).clamp(0.0, 1.0)
        }
        _ => {
            p["progressPercent"]
                .as_f64()
                .unwrap_or(0.0)
                .clamp(0.0, 100.0)
                / 100.0
        }
    }
}

fn locator(p: &Value) -> &str {
    p["locator"]
        .as_str()
        .or_else(|| p["cfi"].as_str())
        .or_else(|| p["chapterHref"].as_str())
        .or_else(|| p["href"].as_str())
        .unwrap_or("")
}

/// Numeric text CFI start path, following foliate's collapse/compare semantics.
/// Assertions (including escaped brackets/commas) do not affect ordering. A
/// range resumes at its start; its visible end changes with window geometry.
/// Unsupported/non-CFI locators fall back to the format-neutral location.
fn cfi_start(value: &str) -> Option<Vec<Vec<(u64, u64)>>> {
    let body = value.strip_prefix("epubcfi(")?.strip_suffix(')')?;
    let mut stripped = String::new();
    let mut assertion = false;
    let mut escaped = false;
    for ch in body.chars() {
        if escaped {
            escaped = false;
            continue;
        }
        if ch == '^' {
            escaped = true;
            continue;
        }
        if ch == '[' {
            assertion = true;
            continue;
        }
        if ch == ']' {
            assertion = false;
            continue;
        }
        if !assertion {
            stripped.push(ch);
        }
    }
    if assertion || escaped {
        return None;
    }
    let parts: Vec<_> = stripped.split(',').collect();
    let start = match parts.as_slice() {
        [point] => (*point).to_owned(),
        [parent, start, _end] => format!("{parent}{start}"),
        _ => return None,
    };
    start
        .split('!')
        .map(|path| {
            path.strip_prefix('/')?
                .split('/')
                .map(|step| {
                    let (index, offset) = step.split_once(':').unwrap_or((step, "0"));
                    Some((index.parse().ok()?, offset.parse().ok()?))
                })
                .collect()
        })
        .collect()
}

/// A total, arrival-independent order. Location counts are more precise than
/// rounded percentages; CFI starts distinguish positions in the same location.
/// Opaque locators only break otherwise indistinguishable ties.
pub(crate) fn compare(left: &Value, right: &Value) -> Ordering {
    fraction(left)
        .total_cmp(&fraction(right))
        .then_with(|| cfi_start(locator(left)).cmp(&cfi_start(locator(right))))
        // Match JavaScript's string ordering for the optimistic shelf too.
        .then_with(|| {
            locator(left)
                .encode_utf16()
                .cmp(locator(right).encode_utf16())
        })
        .then_with(|| {
            left["chapterHref"]
                .as_str()
                .or(left["href"].as_str())
                .unwrap_or("")
                .encode_utf16()
                .cmp(
                    right["chapterHref"]
                        .as_str()
                        .or(right["href"].as_str())
                        .unwrap_or("")
                        .encode_utf16(),
                )
        })
}
