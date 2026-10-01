//! Tiny local HTTP proxy used to feed googlevideo media streams to the
//! webview's <audio>/<video> element. It forwards Range requests with the
//! right User-Agent for the InnerTube client that produced the URL, caps
//! open-ended ranges (avoids server-side throttling) and adds CORS headers so
//! the stream can be routed through the Web Audio graph (EQ / normalization).

use std::io::Read;
use std::thread;
use std::time::Duration;

use tiny_http::{Header, Request, Response, Server, StatusCode};

const CHUNK: u64 = 4 * 1024 * 1024;

#[derive(Clone)]
pub struct ProxyInfo {
    pub port: u16,
    pub token: String,
}

fn random_token() -> String {
    const CH: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    (0..32).map(|_| CH[fastrand::usize(..CH.len())] as char).collect()
}

pub fn start() -> ProxyInfo {
    let server = Server::http("127.0.0.1:0").expect("failed to bind local stream proxy");
    let port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(0);
    let token = random_token();
    let info = ProxyInfo { port, token: token.clone() };

    thread::Builder::new()
        .name("stream-proxy".into())
        .spawn(move || {
            let client = reqwest::blocking::Client::builder()
                .connect_timeout(Duration::from_secs(15))
                .timeout(None)
                .build()
                .expect("http client");
            for req in server.incoming_requests() {
                let client = client.clone();
                let token = token.clone();
                thread::spawn(move || handle(req, &client, &token));
            }
        })
        .expect("spawn proxy thread");

    info
}

fn query_param(url: &str, key: &str) -> Option<String> {
    let q = url.split_once('?')?.1;
    for pair in q.split('&') {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        if k == key {
            return urlencoding::decode(v).ok().map(|s| s.into_owned());
        }
    }
    None
}

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).unwrap()
}

fn cors_headers() -> Vec<Header> {
    vec![
        header("Access-Control-Allow-Origin", "*"),
        header("Access-Control-Allow-Headers", "Range"),
        header("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges"),
        header("Cache-Control", "no-store"),
    ]
}

fn respond_status(req: Request, code: u16) {
    let mut r = Response::empty(StatusCode(code));
    for h in cors_headers() {
        r.add_header(h);
    }
    let _ = req.respond(r);
}

/// Turns "bytes=START-" / "bytes=START-END" into a bounded range.
fn bounded_range(range: Option<&str>) -> String {
    let (start, end) = match range.and_then(|r| r.trim().strip_prefix("bytes=")) {
        Some(spec) => {
            let (s, e) = spec.split_once('-').unwrap_or((spec, ""));
            (s.trim().parse::<u64>().unwrap_or(0), e.trim().parse::<u64>().ok())
        }
        None => (0, None),
    };
    let end = match end {
        Some(e) if e >= start && e - start < CHUNK => e,
        _ => start + CHUNK - 1,
    };
    format!("bytes={}-{}", start, end)
}

fn handle(req: Request, client: &reqwest::blocking::Client, token: &str) {
    if req.method().as_str() == "OPTIONS" {
        return respond_status(req, 204);
    }
    let url = req.url().to_string();
    if !url.starts_with("/stream") || query_param(&url, "t").as_deref() != Some(token) {
        return respond_status(req, 403);
    }
    let target = match query_param(&url, "u") {
        Some(u) if u.starts_with("https://") => u,
        _ => return respond_status(req, 400),
    };
    // Only ever proxy Google media hosts.
    let host_ok = target
        .trim_start_matches("https://")
        .split('/')
        .next()
        .map(|h| h.ends_with(".googlevideo.com") || h.ends_with(".youtube.com"))
        .unwrap_or(false);
    if !host_ok {
        return respond_status(req, 400);
    }
    let ua = query_param(&url, "ua").unwrap_or_else(|| crate::BROWSER_UA.to_string());

    let range_in = req
        .headers()
        .iter()
        .find(|h| h.field.equiv("Range"))
        .map(|h| h.value.as_str().to_string());
    let range = bounded_range(range_in.as_deref());

    let upstream = client
        .get(&target)
        .header("User-Agent", ua)
        .header("Range", range)
        .header("Origin", "https://www.youtube.com")
        .header("Referer", "https://www.youtube.com/")
        .send();

    let upstream = match upstream {
        Ok(r) => r,
        Err(_) => return respond_status(req, 502),
    };
    let status = upstream.status().as_u16();
    if status >= 400 {
        return respond_status(req, status);
    }

    let mut headers = cors_headers();
    headers.push(header("Accept-Ranges", "bytes"));
    for name in ["Content-Type", "Content-Range"] {
        if let Some(v) = upstream.headers().get(name).and_then(|v| v.to_str().ok()) {
            headers.push(header(name, v));
        }
    }
    let len = upstream.content_length().map(|l| l as usize);
    let body: Box<dyn Read + Send> = Box::new(upstream);
    let resp = Response::new(StatusCode(status), headers, body, len, None);
    let _ = req.respond(resp);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caps_open_ended_ranges() {
        assert_eq!(bounded_range(None), format!("bytes=0-{}", CHUNK - 1));
        assert_eq!(bounded_range(Some("bytes=0-")), format!("bytes=0-{}", CHUNK - 1));
        assert_eq!(bounded_range(Some("bytes=1000-")), format!("bytes=1000-{}", 1000 + CHUNK - 1));
    }

    #[test]
    fn keeps_small_explicit_ranges() {
        assert_eq!(bounded_range(Some("bytes=10-20")), "bytes=10-20");
        assert_eq!(bounded_range(Some("bytes=0-99999999")), format!("bytes=0-{}", CHUNK - 1));
    }

    #[test]
    fn parses_query() {
        let u = "/stream?t=abc&u=https%3A%2F%2Fr1.googlevideo.com%2Fvideoplayback%3Fa%3D1%26b%3D2&ua=X%20Y";
        assert_eq!(query_param(u, "t").as_deref(), Some("abc"));
        assert_eq!(query_param(u, "u").as_deref(), Some("https://r1.googlevideo.com/videoplayback?a=1&b=2"));
        assert_eq!(query_param(u, "ua").as_deref(), Some("X Y"));
        assert_eq!(query_param(u, "zz"), None);
    }
}
