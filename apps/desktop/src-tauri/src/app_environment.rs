//! Check identity before plugins, single-instance dispatch or storage can touch
//! an existing installation. Frontend dev mode alone cannot isolate native data.
pub(crate) const PRODUCTION_ID: &str = "com.readaware.app";

pub(crate) fn validate(config: &tauri::Config, local_dev: bool) -> Result<(), &'static str> {
    let identifier = config.identifier.as_str();
    let dev_name = config.product_name.as_deref().unwrap_or("").starts_with("ReadAware Dev");
    let dev_id = identifier == "com.readaware.app.dev" || identifier == "com.readaware.app.dev2";
    if dev_name != dev_id {
        return Err("ReadAware Dev must use an isolated development bundle identifier");
    }
    // The existing acceptance harness has its own non-production data root.
    if local_dev && !dev_id && identifier != "com.readaware.app.capability-e2e" {
        return Err("Local dev requires the development identity. Start with `bun run dev`.");
    }
    Ok(())
}

pub(crate) fn can_update(identifier: &str) -> bool {
    identifier == PRODUCTION_ID
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(identifier: &str, name: &str) -> tauri::Config {
        tauri::Config { identifier: identifier.into(), product_name: Some(name.into()), ..Default::default() }
    }

    #[test]
    fn local_dev_cannot_open_production_identity_even_with_a_dev_name() {
        assert!(validate(&config(PRODUCTION_ID, "ReadAware"), true).is_err());
        assert!(validate(&config(PRODUCTION_ID, "ReadAware Dev"), true).is_err());
        assert!(validate(&config("com.readaware.app.dev", "ReadAware"), true).is_err());
        assert!(validate(&config("com.readaware.app.dev", "ReadAware Dev"), true).is_ok());
        assert!(validate(&config("com.readaware.app.capability-e2e", "ReadAware Capability Tests"), true).is_ok());
    }

    #[test]
    fn release_builds_preserve_identity_and_only_production_can_update() {
        for (id, name) in [(PRODUCTION_ID, "ReadAware"), ("com.readaware.app.dev", "ReadAware Dev")] {
            assert!(validate(&config(id, name), false).is_ok());
        }
        assert!(can_update(PRODUCTION_ID));
        assert!(!can_update("com.readaware.app.dev"));
        assert!(!can_update("com.readaware.app.capability-e2e"));
    }
}
