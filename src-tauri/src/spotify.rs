//! Spotify integration.
//!
//! * Official: OAuth 2 Authorization Code + PKCE against the user's own
//!   Spotify developer app (client id pasted in Settings). The redirect is
//!   intercepted inside the login window, so nothing listens on the port.
//! * Experimental: the user signs into open.spotify.com in a webview; a small
//!   init script reports the web player's bearer token through the document
//!   title. That token unlocks Spotify's private endpoints (friend activity,
//!   following lists, full profiles). Tokens live ~1 h; a hidden window is
//!   briefly reopened to refresh.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

use crate::AppState;

pub const REDIRECT_URI: &str = "http://127.0.0.1:43821/callback";
const SCOPES: &str = "user-read-private user-read-email playlist-read-private playlist-read-collaborative user-follow-read user-library-read user-read-recently-played user-top-read";
const WEB_LABEL: &str = "spotify-web";
const TOKEN_TITLE: &str = "__SPTOKEN__";

#[derive(Default, Serialize, Deserialize, Clone)]
pub struct OAuth {
    client_id: String,
    access_token: String,
    refresh_token: String,
    expires_at: u64,
}

#[derive(Default, Clone)]
pub struct WebToken {
    token: String,
    client_token: String,
    at: u64,
}

#[derive(Default)]
pub struct Spotify {
    oauth: Mutex<Option<OAuth>>,
    path: Mutex<PathBuf>,
    pending: Mutex<Option<(String, String, String)>>, // (client_id, verifier, state)
    web: Arc<Mutex<Option<WebToken>>>,
    web_visible: Mutex<bool>,
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

fn b64url(bytes: &[u8]) -> String {
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        let chars = chunk.len() + 1;
        for i in 0..chars {
            out.push(T[((n >> (18 - 6 * i)) & 63) as usize] as char);
        }
    }
    out
}

fn random_string(n: usize) -> String {
    const CH: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    (0..n).map(|_| CH[fastrand::usize(..CH.len())] as char).collect()
}

impl Spotify {
    pub fn load(dir: &std::path::Path) -> Self {
        let path = dir.join("spotify.json");
        let oauth = std::fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str(&s).ok());
        Spotify { oauth: Mutex::new(oauth), path: Mutex::new(path), ..Default::default() }
    }
    fn save(&self) {
        let path = self.path.lock().clone();
        match &*self.oauth.lock() {
            Some(o) => {
                if let Some(d) = path.parent() {
                    let _ = std::fs::create_dir_all(d);
                }
                let _ = std::fs::write(&path, serde_json::to_string(o).unwrap_or_default());
            }
            None => {
                let _ = std::fs::remove_file(&path);
            }
        }
    }
}

// ----------------------------------------------------------------- official OAuth

#[derive(Deserialize)]
struct TokenResp {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: u64,
}

async fn token_request(state: &AppState, form: &[(&str, &str)]) -> Result<TokenResp, String> {
    let body: String = form
        .iter()
        .map(|(k, v)| format!("{}={}", k, urlencoding::encode(v)))
        .collect::<Vec<_>>()
        .join("&");
    let r = state
        .http
        .post("https://accounts.spotify.com/api/token")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = r.status();
    let text = r.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("Spotify rejected the login ({status}): {text}"));
    }
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn spotify_login(app: AppHandle, state: State<'_, AppState>, client_id: String) -> Result<(), String> {
    let client_id = client_id.trim().to_string();
    if client_id.len() < 16 || !client_id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("That doesn't look like a Spotify Client ID".into());
    }
    if let Some(w) = app.get_webview_window("spotify-login") {
        let _ = w.set_focus();
        return Ok(());
    }
    let verifier = random_string(64);
    let challenge = b64url(&Sha256::digest(verifier.as_bytes()));
    let st = random_string(16);
    *state.spotify.pending.lock() = Some((client_id.clone(), verifier, st.clone()));
    let url = format!(
        "https://accounts.spotify.com/authorize?response_type=code&client_id={}&scope={}&redirect_uri={}&state={}&code_challenge_method=S256&code_challenge={}",
        client_id,
        urlencoding::encode(SCOPES),
        urlencoding::encode(REDIRECT_URI),
        st,
        challenge
    );
    let handle = app.clone();
    WebviewWindowBuilder::new(&app, "spotify-login", WebviewUrl::External(url.parse().unwrap()))
        .title("Connect Spotify")
        .inner_size(480.0, 720.0)
        .center()
        .on_navigation(move |u| {
            if !u.as_str().starts_with(REDIRECT_URI) {
                return true;
            }
            let q: std::collections::HashMap<String, String> = u.query_pairs().into_owned().collect();
            let app = handle.clone();
            tauri::async_runtime::spawn(async move {
                let state = app.state::<AppState>();
                let res = finish_login(&state, q).await;
                if let Some(w) = app.get_webview_window("spotify-login") {
                    let _ = w.close();
                }
                let _ = app.emit("spotify-changed", res.err());
            });
            false
        })
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

async fn finish_login(state: &AppState, q: std::collections::HashMap<String, String>) -> Result<(), String> {
    if let Some(e) = q.get("error") {
        return Err(format!("Spotify login was cancelled ({e})"));
    }
    let (client_id, verifier, st) = state.spotify.pending.lock().take().ok_or("No login in progress")?;
    if q.get("state") != Some(&st) {
        return Err("Login state mismatch".into());
    }
    let code = q.get("code").ok_or("No authorization code")?;
    let t = token_request(
        state,
        &[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", REDIRECT_URI),
            ("client_id", &client_id),
            ("code_verifier", &verifier),
        ],
    )
    .await?;
    *state.spotify.oauth.lock() = Some(OAuth {
        client_id,
        access_token: t.access_token,
        refresh_token: t.refresh_token.unwrap_or_default(),
        expires_at: now() + t.expires_in.saturating_sub(60),
    });
    state.spotify.save();
    Ok(())
}

async fn oauth_token(state: &AppState) -> Result<Option<String>, String> {
    let o = state.spotify.oauth.lock().clone();
    let Some(o) = o else { return Ok(None) };
    if now() < o.expires_at {
        return Ok(Some(o.access_token));
    }
    let t = token_request(
        state,
        &[("grant_type", "refresh_token"), ("refresh_token", &o.refresh_token), ("client_id", &o.client_id)],
    )
    .await?;
    let mut n = o.clone();
    n.access_token = t.access_token.clone();
    if let Some(r) = t.refresh_token {
        n.refresh_token = r;
    }
    n.expires_at = now() + t.expires_in.saturating_sub(60);
    *state.spotify.oauth.lock() = Some(n);
    state.spotify.save();
    Ok(Some(t.access_token))
}

#[tauri::command]
pub fn spotify_logout(app: AppHandle, state: State<'_, AppState>) {
    *state.spotify.oauth.lock() = None;
    state.spotify.save();
    let _ = app.emit("spotify-changed", Option::<String>::None);
}

// ----------------------------------------------------------------- experimental web token

const HOOK: &str = r#"(() => {
  if (window.__stHook) return; window.__stHook = 1;
  let last = '';
  const send = (auth, ct) => {
    if (!auth || !/^Bearer /i.test(auth)) return;
    const t = auth.slice(7);
    if (t === last) return; last = t;
    const prev = document.title;
    document.title = '__SPTOKEN__' + t + '|' + (ct || '');
    setTimeout(() => { if (document.title.startsWith('__SPTOKEN__')) document.title = prev; }, 60);
  };
  const get = (h, k) => {
    if (!h) return null;
    try {
      if (h instanceof Headers) return h.get(k);
      if (Array.isArray(h)) { const e = h.find((x) => String(x[0]).toLowerCase() === k); return e ? e[1] : null; }
      for (const key in h) if (key.toLowerCase() === k) return h[key];
    } catch (e) {}
    return null;
  };
  const of = window.fetch;
  window.fetch = function (input, init) {
    try {
      const u = typeof input === 'string' ? input : (input && input.url) || '';
      if (/spotify\.com/.test(u)) {
        const h = (init && init.headers) || (input instanceof Request ? input.headers : null);
        send(get(h, 'authorization'), get(h, 'client-token'));
      }
    } catch (e) {}
    return of.apply(this, arguments);
  };
  const seen = new WeakMap();
  const osh = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    try {
      const m = seen.get(this) || {}; m[String(k).toLowerCase()] = v; seen.set(this, m);
      if (String(k).toLowerCase() === 'authorization') send(v, m['client-token']);
    } catch (e) {}
    return osh.apply(this, arguments);
  };
})();"#;

fn has_session(w: &tauri::WebviewWindow) -> bool {
    w.cookies_for_url("https://open.spotify.com/".parse().unwrap())
        .map(|c| c.iter().any(|c| c.name() == "sp_dc" && !c.value().is_empty()))
        .unwrap_or(false)
}

/// Tracks whether the web window is still open, so background threads
/// don't touch a closing webview (never blocks: the close handler runs on
/// the UI thread, which cookie calls also wait on).
#[derive(Clone)]
struct Life(Arc<std::sync::atomic::AtomicBool>);
impl Life {
    fn with<R>(&self, f: impl FnOnce() -> R) -> Option<R> {
        self.0.load(std::sync::atomic::Ordering::SeqCst).then(f)
    }
    /// marks the window gone; returns false if it already was
    fn end(&self) -> bool {
        self.0.swap(false, std::sync::atomic::Ordering::SeqCst)
    }
}

fn open_web(app: &AppHandle, visible: bool) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(WEB_LABEL) {
        if visible {
            let _ = w.show();
            let _ = w.set_focus();
        }
        return Ok(());
    }
    *app.state::<AppState>().spotify.web_visible.lock() = visible;
    let web = app.state::<AppState>().spotify.web.clone();
    let life = Life(Arc::new(std::sync::atomic::AtomicBool::new(true)));
    let (life1, life2, life3) = (life.clone(), life.clone(), life.clone());
    let handle = app.clone();
    let handle2 = app.clone();
    let w = WebviewWindowBuilder::new(app, WEB_LABEL, WebviewUrl::External("https://open.spotify.com/".parse().unwrap()))
        .title("Sign in to Spotify")
        .inner_size(460.0, 720.0)
        .center()
        .visible(visible)
        .skip_taskbar(!visible)
        .initialization_script(HOOK)
        .on_document_title_changed(move |w, title| {
            let Some(rest) = title.strip_prefix(TOKEN_TITLE) else { return };
            let (tok, ct) = rest.split_once('|').unwrap_or((rest, ""));
            if tok.len() < 40 {
                return;
            }
            let app = handle.clone();
            let web = web.clone();
            let life = life1.clone();
            let tok = tok.to_string();
            let ct = ct.to_string();
            // cookie access must not run on the UI thread (WebView2)
            std::thread::spawn(move || {
                if life.with(|| has_session(&w)) != Some(true) {
                    return; // anonymous token (wait for the user to log in) or window gone
                }
                *web.lock() = Some(WebToken { token: tok, client_token: ct, at: now() });
                // tell the UI only after an interactive sign-in, not on silent refreshes
                if *app.state::<AppState>().spotify.web_visible.lock() {
                    let _ = app.emit("spotify-web-changed", true);
                }
                // got what we need: free the web player's memory (once)
                if life.end() {
                    let _ = w.close();
                }
            });
        })
        .on_page_load(move |w, p| {
            if p.event() == PageLoadEvent::Finished {
                let app = handle2.clone();
                let life = life2.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(2));
                    let signed_in = life.with(|| has_session(&w));
                    // not signed in and opened hidden: show it so the user can log in
                    if signed_in == Some(false) && !*app.state::<AppState>().spotify.web_visible.lock() {
                        *app.state::<AppState>().spotify.web_visible.lock() = true;
                        life.with(|| {
                            let _ = w.show();
                            let _ = w.set_skip_taskbar(false);
                            let _ = w.set_focus();
                        });
                    }
                });
            }
        })
        .build()
        .map_err(|e| e.to_string())?;
    w.on_window_event(move |e| {
        if matches!(e, tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed) {
            life3.end();
        }
    });
    Ok(())
}

/// Opens the Spotify web sign-in window (visible).
// async: creating windows from a sync command deadlocks on Windows
#[tauri::command]
pub async fn spotify_web_connect(app: AppHandle) -> Result<(), String> {
    open_web(&app, true)
}

/// Returns a fresh web-player token, refreshing it in a hidden window when needed.
#[tauri::command]
pub async fn spotify_web_token(app: AppHandle, state: State<'_, AppState>) -> Result<Option<String>, String> {
    let fresh = |t: &Option<WebToken>| t.as_ref().filter(|t| now() - t.at < 45 * 60).map(|t| t.token.clone());
    if let Some(t) = fresh(&state.spotify.web.lock().clone()) {
        return Ok(Some(t));
    }
    open_web(&app, false)?;
    for _ in 0..100 {
        sleep(Duration::from_millis(300)).await;
        if let Some(t) = fresh(&state.spotify.web.lock().clone()) {
            return Ok(Some(t));
        }
        if *state.spotify.web_visible.lock() {
            // user has to sign in first; the UI waits for "spotify-web-changed"
            return Ok(None);
        }
    }
    Err("Spotify web player didn't respond".into())
}

async fn sleep(d: Duration) {
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(d)).await;
}

#[tauri::command]
pub async fn spotify_web_logout(app: AppHandle, state: State<'_, AppState>) -> Result<(), ()> {
    *state.spotify.web.lock() = None;
    // remove the web session cookies from a hidden window
    if let Ok(w) = WebviewWindowBuilder::new(&app, "spotify-cleanup", WebviewUrl::External("https://open.spotify.com/robots.txt".parse().unwrap()))
        .visible(false)
        .skip_taskbar(true)
        .build()
    {
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(2));
            for u in ["https://open.spotify.com/", "https://accounts.spotify.com/", "https://www.spotify.com/"] {
                if let Ok(cs) = w.cookies_for_url(u.parse().unwrap()) {
                    for c in cs {
                        let _ = w.delete_cookie(c);
                    }
                }
            }
            let _ = w.close();
        });
    }
    let _ = app.emit("spotify-web-changed", false);
    Ok(())
}

// ----------------------------------------------------------------- requests

#[derive(Serialize)]
pub struct SpStatus {
    linked: bool,
    client_id: Option<String>,
    web_token: bool,
}

#[tauri::command]
pub fn spotify_status(state: State<'_, AppState>) -> SpStatus {
    let o = state.spotify.oauth.lock().clone();
    SpStatus {
        linked: o.is_some(),
        client_id: o.map(|o| o.client_id),
        web_token: state.spotify.web.lock().as_ref().map(|t| now() - t.at < 45 * 60).unwrap_or(false),
    }
}

fn allowed_host(url: &str) -> bool {
    let host = url.strip_prefix("https://").and_then(|r| r.split('/').next()).unwrap_or("");
    host == "api.spotify.com" || host.ends_with(".spotify.com") && (host.contains("spclient") || host == "api-partner.spotify.com")
}

/// GET a Spotify URL. `via`: "oauth" (official token), "web" (web-player
/// token) or "auto" (official when linked, else web).
#[tauri::command]
pub async fn spotify_get(app: AppHandle, state: State<'_, AppState>, url: String, via: Option<String>) -> Result<String, String> {
    if !allowed_host(&url) {
        return Err("host not allowed".into());
    }
    let via = via.unwrap_or_else(|| "auto".into());
    let mut client_token = String::new();
    let token = match via.as_str() {
        "oauth" => oauth_token(&state).await?,
        "web" => {
            let t = spotify_web_token(app.clone(), state.clone()).await?;
            client_token = state.spotify.web.lock().as_ref().map(|w| w.client_token.clone()).unwrap_or_default();
            t
        }
        _ => match oauth_token(&state).await? {
            Some(t) => Some(t),
            None => {
                let t = spotify_web_token(app.clone(), state.clone()).await?;
                client_token = state.spotify.web.lock().as_ref().map(|w| w.client_token.clone()).unwrap_or_default();
                t
            }
        },
    }
    .ok_or("Spotify isn't connected")?;
    let mut req = state
        .http
        .get(&url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/json")
        .header("App-Platform", "WebPlayer");
    if !client_token.is_empty() {
        req = req.header("client-token", client_token);
    }
    let r = req.send().await.map_err(|e| e.to_string())?;
    let status = r.status();
    if status.as_u16() == 401 && via != "oauth" {
        // web token expired early: drop it so the next call refreshes
        *state.spotify.web.lock() = None;
    }
    let text = r.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        crate::log::write(&format!("spotify {status} via {via}: {}", url.split('?').next().unwrap_or("")));
        return Err(format!("Spotify returned HTTP {status}"));
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64url_matches_rfc7636_example() {
        // RFC 7636 Appendix B
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(b64url(&Sha256::digest(verifier.as_bytes())), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn hosts() {
        assert!(allowed_host("https://api.spotify.com/v1/me"));
        assert!(allowed_host("https://guc-spclient.spotify.com/presence-view/v1/buddylist"));
        assert!(allowed_host("https://spclient.wg.spotify.com/user-profile-view/v3/profile/x"));
        assert!(!allowed_host("https://evil.com/api.spotify.com"));
        assert!(!allowed_host("https://accounts.spotify.com/api/token"));
    }
}
