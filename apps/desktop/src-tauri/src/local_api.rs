//! Loopback HTTP is a transport, not a second data layer. Only the main webview
//! can answer requests, through an explicit read-only domain route table.
use crate::error::CommandError;
use axum::{
    extract::{Request, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{Emitter, Manager};
use tokio::sync::{oneshot, Mutex as AsyncMutex, Semaphore};

const SECRET: &str = "local-api.connection";
const MAX_RESPONSE: usize = 2 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Default, Serialize, Deserialize)]
struct Config {
    enabled: bool,
    token: String,
}
#[derive(Default)]
struct Inner {
    config: Option<Config>,
    session: String,
    server: Option<Server>,
    error: Option<String>,
}
#[derive(Default)]
pub struct LocalApi(AsyncMutex<Inner>);
struct Server {
    task: tauri::async_runtime::JoinHandle<()>,
    bridge: Arc<Bridge>,
}
struct Bridge {
    app: tauri::AppHandle,
    port: u16,
    token_hash: [u8; 32],
    active: AtomicBool,
    requests: Mutex<Requests>,
    slots: Semaphore,
}
struct Requests {
    session: String,
    pending: HashMap<String, oneshot::Sender<Reply>>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiStatus {
    enabled: bool,
    running: bool,
    base_url: String,
    error_code: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiRequest {
    id: String,
    session: String,
    path: String,
    query: String,
}
#[derive(Deserialize)]
pub struct Reply {
    status: u16,
    body: Value,
}

fn port(app: &tauri::AppHandle) -> u16 {
    if app.config().identifier.ends_with(".dev") {
        19281
    } else {
        19280
    }
}
fn status(app: &tauri::AppHandle, inner: &Inner) -> ApiStatus {
    ApiStatus {
        enabled: inner.config.as_ref().is_some_and(|config| config.enabled),
        running: inner
            .server
            .as_ref()
            .is_some_and(|s| s.bridge.active.load(Ordering::SeqCst)),
        base_url: format!("http://127.0.0.1:{}", port(app)),
        error_code: inner.error.clone(),
    }
}
fn new_token() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}
async fn load(app: &tauri::AppHandle, inner: &mut Inner) -> Result<(), CommandError> {
    if inner.config.is_none() {
        inner.config = Some(
            match crate::secrets::secret_get(app.clone(), SECRET.into()).await? {
                Some(value) => serde_json::from_str(&value)?,
                None => Config::default(),
            },
        );
        let config = inner.config.as_ref().unwrap();
        if !config.token.is_empty()
            && (config.token.len() != 64 || !config.token.bytes().all(|b| b.is_ascii_hexdigit()))
            || config.enabled && config.token.is_empty()
        {
            inner.config = None;
            return Err(CommandError::new(
                "secrets/unavailable",
                "Invalid local API credentials",
            ));
        }
    }
    Ok(())
}
async fn save(app: &tauri::AppHandle, config: &Config) -> Result<(), CommandError> {
    crate::secrets::secret_set(
        app.clone(),
        SECRET.into(),
        serde_json::to_string(config)?,
        Some(false),
        None,
    )
    .await
}
async fn stop(inner: &mut Inner) {
    if let Some(server) = inner.server.take() {
        server.bridge.active.store(false, Ordering::SeqCst);
        if let Ok(mut requests) = server.bridge.requests.lock() {
            requests.pending.clear();
        }
        server.task.abort();
        let _ = server.task.await;
    }
}
async fn start(app: &tauri::AppHandle, inner: &mut Inner, token: &str) -> Result<(), CommandError> {
    if inner
        .server
        .as_ref()
        .is_some_and(|s| s.bridge.active.load(Ordering::SeqCst))
    {
        return Ok(());
    }
    stop(inner).await;
    if inner.session.is_empty() {
        return Err(CommandError::new(
            "local-api/unavailable",
            "Domain bridge is not ready",
        ));
    }
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port(app)))
        .await
        .map_err(|error| {
            CommandError::new("local-api/bind", format!("Loopback listener: {error}"))
        })?;
    let bridge = Arc::new(Bridge {
        app: app.clone(),
        port: port(app),
        token_hash: Sha256::digest(token.as_bytes()).into(),
        active: AtomicBool::new(true),
        requests: Mutex::new(Requests {
            session: inner.session.clone(),
            pending: HashMap::new(),
        }),
        slots: Semaphore::new(8),
    });
    let router = Router::new().fallback(handle).with_state(bridge.clone());
    let active = bridge.clone();
    let task = tauri::async_runtime::spawn(async move {
        if let Err(error) = axum::serve(listener, router).await {
            log::error!("Local API listener failed: {error}");
        }
        active.active.store(false, Ordering::SeqCst);
    });
    inner.server = Some(Server { task, bridge });
    inner.error = None;
    Ok(())
}
fn main_window(window: &tauri::WebviewWindow) -> Result<(), CommandError> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(CommandError::new(
            "local-api/forbidden",
            "Main window required",
        ))
    }
}

#[tauri::command]
pub async fn local_api_status(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<ApiStatus, CommandError> {
    main_window(&window)?;
    let state = app.state::<LocalApi>();
    let mut inner = state.0.lock().await;
    load(&app, &mut inner).await?;
    Ok(status(&app, &inner))
}
#[tauri::command]
pub async fn local_api_attach(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    session: String,
) -> Result<ApiStatus, CommandError> {
    main_window(&window)?;
    if uuid::Uuid::parse_str(&session).is_err() {
        return Err(CommandError::new(
            "local-api/invalid-input",
            "Invalid bridge session",
        ));
    }
    let state = app.state::<LocalApi>();
    let mut inner = state.0.lock().await;
    load(&app, &mut inner).await?;
    inner.session = session.clone();
    if let Some(server) = &inner.server {
        let mut requests = server.bridge.requests.lock()?;
        requests.session = session;
        requests.pending.clear();
    }
    let config = inner.config.as_ref().unwrap();
    if config.enabled {
        let token = config.token.clone();
        if let Err(error) = start(&app, &mut inner, &token).await {
            log::error!("Local API startup failed: {error}");
            inner.error = Some(error.code);
        }
    }
    Ok(status(&app, &inner))
}
#[tauri::command]
pub async fn local_api_set_enabled(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    enabled: bool,
) -> Result<ApiStatus, CommandError> {
    main_window(&window)?;
    let state = app.state::<LocalApi>();
    let mut inner = state.0.lock().await;
    load(&app, &mut inner).await?;
    let old = inner.config.as_ref().unwrap();
    let next = Config {
        enabled,
        token: if old.token.is_empty() {
            new_token()
        } else {
            old.token.clone()
        },
    };
    let was_running = inner.server.is_some();
    if enabled {
        if let Err(error) = start(&app, &mut inner, &next.token).await {
            inner.error = Some(error.code.clone());
            return Err(error);
        }
    }
    if let Err(error) = save(&app, &next).await {
        if !was_running {
            stop(&mut inner).await;
        }
        return Err(error);
    }
    if !enabled {
        stop(&mut inner).await;
    }
    inner.config = Some(next);
    inner.error = None;
    Ok(status(&app, &inner))
}
#[tauri::command]
pub async fn local_api_token(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<String, CommandError> {
    main_window(&window)?;
    let state = app.state::<LocalApi>();
    let mut inner = state.0.lock().await;
    load(&app, &mut inner).await?;
    let config = inner.config.as_ref().unwrap();
    if !config.enabled {
        return Err(CommandError::new(
            "local-api/unavailable",
            "Local API is disabled",
        ));
    }
    Ok(config.token.clone())
}
#[tauri::command]
pub async fn local_api_rotate_token(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<ApiStatus, CommandError> {
    main_window(&window)?;
    let state = app.state::<LocalApi>();
    let mut inner = state.0.lock().await;
    load(&app, &mut inner).await?;
    let next = Config {
        enabled: inner.config.as_ref().unwrap().enabled,
        token: new_token(),
    };
    save(&app, &next).await?;
    stop(&mut inner).await;
    inner.config = Some(next);
    let config = inner.config.as_ref().unwrap();
    if config.enabled {
        let token = config.token.clone();
        if let Err(error) = start(&app, &mut inner, &token).await {
            inner.error = Some(error.code.clone());
            return Err(error);
        }
    }
    Ok(status(&app, &inner))
}
#[tauri::command]
pub async fn local_api_complete(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    session: String,
    id: String,
    reply: Reply,
) -> Result<(), CommandError> {
    main_window(&window)?;
    let state = app.state::<LocalApi>();
    let inner = state.0.lock().await;
    if let Some(server) = &inner.server {
        let mut requests = server.bridge.requests.lock()?;
        if requests.session == session {
            if let Some(sender) = requests.pending.remove(&id) {
                let _ = sender.send(reply);
            }
        }
    }
    Ok(())
}

fn failure(status: u16, code: &str, message: &str) -> Reply {
    Reply {
        status,
        body: json!({ "error": { "code": code, "message": message } }),
    }
}
fn response(reply: Reply) -> Response {
    let mut response = (
        StatusCode::from_u16(reply.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
        Json(reply.body),
    )
        .into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    response
        .headers_mut()
        .insert("x-content-type-options", "nosniff".parse().unwrap());
    response
}
fn authorize(request: &Request, port: u16, token_hash: &[u8; 32]) -> Result<(), Reply> {
    let headers = request.headers();
    let host = headers
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");
    if host != format!("127.0.0.1:{port}") && host != format!("localhost:{port}")
        || headers.contains_key(header::ORIGIN)
    {
        return Err(failure(
            403,
            "local-api/forbidden",
            "Only direct local clients are supported.",
        ));
    }
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .unwrap_or("");
    // Comparing hashes avoids leaking the token's common prefix through timing.
    if token.len() != 64 || <[u8; 32]>::from(Sha256::digest(token.as_bytes())) != *token_hash {
        return Err(failure(
            401,
            "local-api/unauthorized",
            "A valid ReadAware access token is required.",
        ));
    }
    if request.method() != axum::http::Method::GET {
        return Err(failure(
            405,
            "local-api/read-only",
            "This API only accepts GET requests.",
        ));
    }
    if request.uri().to_string().len() > 16 * 1024 {
        return Err(failure(
            414,
            "local-api/invalid-input",
            "Request URL is too long.",
        ));
    }
    Ok(())
}
struct PendingRequest {
    bridge: Arc<Bridge>,
    id: String,
}
impl Drop for PendingRequest {
    fn drop(&mut self) {
        if let Ok(mut requests) = self.bridge.requests.lock() {
            requests.pending.remove(&self.id);
        }
    }
}
async fn handle(State(bridge): State<Arc<Bridge>>, request: Request) -> Response {
    if let Err(reply) = authorize(&request, bridge.port, &bridge.token_hash) {
        return response(reply);
    }
    if !bridge.active.load(Ordering::SeqCst) {
        return response(failure(
            503,
            "local-api/unavailable",
            "Local API is stopped.",
        ));
    }
    let Ok(_slot) = bridge.slots.try_acquire() else {
        return response(failure(
            429,
            "local-api/busy",
            "Too many requests. Retry shortly.",
        ));
    };
    let id = uuid::Uuid::new_v4().to_string();
    let (sender, receiver) = oneshot::channel();
    let session = match bridge.requests.lock() {
        Ok(mut requests) => {
            requests.pending.insert(id.clone(), sender);
            requests.session.clone()
        }
        Err(_) => {
            return response(failure(
                503,
                "local-api/unavailable",
                "ReadAware is not ready.",
            ))
        }
    };
    let _pending = PendingRequest {
        bridge: bridge.clone(),
        id: id.clone(),
    };
    let payload = ApiRequest {
        id,
        session,
        path: request.uri().path().into(),
        query: request.uri().query().unwrap_or("").into(),
    };
    if bridge
        .app
        .emit_to("main", "local-api-request", payload)
        .is_err()
    {
        return response(failure(
            503,
            "local-api/unavailable",
            "ReadAware is not ready.",
        ));
    }
    let reply = match tokio::time::timeout(REQUEST_TIMEOUT, receiver).await {
        Ok(Ok(reply)) if bridge.active.load(Ordering::SeqCst) => reply,
        Ok(_) => failure(
            503,
            "local-api/unavailable",
            "ReadAware reloaded or stopped. Retry when ready.",
        ),
        Err(_) => failure(
            504,
            "local-api/timeout",
            "ReadAware did not respond in time.",
        ),
    };
    if serde_json::to_vec(&reply.body).map_or(true, |body| body.len() > MAX_RESPONSE) {
        return response(failure(
            413,
            "local-api/too-large",
            "Result too large. Use a smaller page or text range.",
        ));
    }
    response(reply)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(method: &str, host: &str, token: &str, origin: Option<&str>) -> Request {
        let mut builder = Request::builder()
            .method(method)
            .uri("/v1/books")
            .header("host", host)
            .header("authorization", format!("Bearer {token}"));
        if let Some(origin) = origin {
            builder = builder.header("origin", origin);
        }
        builder.body(axum::body::Body::empty()).unwrap()
    }
    #[test]
    fn authentication_loopback_and_read_only_are_independent_gates() {
        let token = new_token();
        let hash = Sha256::digest(token.as_bytes()).into();
        assert!(authorize(
            &request("GET", "127.0.0.1:19280", &token, None),
            19280,
            &hash
        )
        .is_ok());
        for (method, host, key, origin, status) in [
            ("GET", "127.0.0.1:19280", "", None, 401),
            ("GET", "attacker.example:19280", token.as_str(), None, 403),
            (
                "GET",
                "127.0.0.1:19280",
                token.as_str(),
                Some("https://example.com"),
                403,
            ),
            ("POST", "127.0.0.1:19280", token.as_str(), None, 405),
        ] {
            assert_eq!(
                authorize(&request(method, host, key, origin), 19280, &hash)
                    .err()
                    .unwrap()
                    .status,
                status
            );
        }
    }
    #[test]
    fn replies_never_enable_caching_or_cross_origin_access() {
        let result = response(failure(401, "local-api/unauthorized", "Token required"));
        assert_eq!(result.headers()[header::CACHE_CONTROL], "no-store");
        assert!(!result.headers().contains_key("access-control-allow-origin"));
    }
}
