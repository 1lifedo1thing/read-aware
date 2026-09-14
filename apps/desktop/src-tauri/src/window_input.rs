//! Host-private input generation. No key codes, positions or event payloads
//! cross IPC. This distinguishes later native user input from window feedback.
#[cfg(target_os = "macos")]
static REVISION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

#[cfg(target_os = "macos")]
static AVAILABLE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[tauri::command]
pub fn window_input_revision(window: tauri::WebviewWindow) -> Result<Option<u64>, crate::error::CommandError> {
    if window.label() != "main" { return Err(crate::error::CommandError::new("ui/unavailable", "Main window only")); }
    #[cfg(target_os = "macos")]
    { Ok(AVAILABLE.load(std::sync::atomic::Ordering::SeqCst).then(|| REVISION.load(std::sync::atomic::Ordering::SeqCst))) }
    #[cfg(not(target_os = "macos"))]
    { Ok(None) }
}

#[cfg(target_os = "macos")]
pub fn install() {
    use block::ConcreteBlock;
    use cocoa::base::{id, nil};
    use objc::{class, msg_send, sel, sel_impl};
    // Mouse downs, drags, key downs, scroll and gesture beginnings. Includes
    // AppKit frame/traffic-light interaction, which the WebView cannot observe.
    const MASK: u64 = (1 << 1) | (1 << 3) | (1 << 6) | (1 << 7) | (1 << 10)
        | (1 << 18) | (1 << 19) | (1 << 22) | (1 << 25) | (1 << 27) | (1 << 29) | (1 << 30) | (1 << 31);
    let handler = ConcreteBlock::new(move |event: id| -> id {
        let kind: u64 = unsafe { msg_send![event, type] };
        // Momentum is feedback from an earlier gesture, not a fresh input edge.
        let momentum: u64 = if kind == 22 { unsafe { msg_send![event, momentumPhase] } } else { 0 };
        if momentum == 0 { REVISION.fetch_add(1, std::sync::atomic::Ordering::SeqCst); }
        event
    }).copy();
    let monitor: id = unsafe { msg_send![class!(NSEvent), addLocalMonitorForEventsMatchingMask: MASK handler: &*handler] };
    if monitor == nil { log::warn!("Window input monitor unavailable"); return; }
    let _: id = unsafe { msg_send![monitor, retain] };
    AVAILABLE.store(true, std::sync::atomic::Ordering::SeqCst);
    // Same app lifetime as the existing wheel-phase monitor; never consumes input.
    std::mem::forget(handler);
}
