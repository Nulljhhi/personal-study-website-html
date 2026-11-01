//! study-server: serves Study Website as a web page, to this computer and to
//! devices on your Tailscale network only.
//!
//!   study-server.exe                 serve on port 8787
//!   study-server.exe --port 9000     serve on another port
//!   study-server.exe --local-only    this computer only (no Tailscale)
//!
//! Who can connect is limited twice over:
//!   1. It listens only on the loopback addresses (127.0.0.1, ::1) and on
//!      this computer's Tailscale addresses, so it isn't reachable on
//!      Wi-Fi, Ethernet or any other network at all.
//!   2. Every connection's source address is checked again, and anything
//!      that isn't loopback or a Tailscale address (100.64.0.0/10,
//!      fd7a:115c:a1e0::/48) is closed without a reply.
//! It also refuses requests addressed to an outside domain name, so a web
//! page elsewhere can't reach it by pointing its own name at 127.0.0.1
//! (DNS rebinding).
//!
//! It serves only the built page (src/index.html, embedded at build time).
//! Progress stays in each browser's own storage, the same as opening the
//! page straight from a file; the folder features need the desktop app.
//!
//! Tailscale may start after this does, or come back with a new address,
//! so its addresses are checked again every few seconds and new ones are
//! picked up without a restart.

use std::collections::HashSet;
use std::io::{self, BufRead, Read, Write};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

const PAGE: &str = include_str!("../../src/index.html");
const DEFAULT_PORT: u16 = 8787;
const VERSION: &str = env!("CARGO_PKG_VERSION");
const MAX_REQUEST_HEAD: usize = 16 * 1024;
const TAILSCALE_RECHECK: Duration = Duration::from_secs(10);

// ---------------------------------------------------------------- addresses

/// Tailscale's IPv4 range (the CGNAT block 100.64.0.0/10).
fn is_tailscale_v4(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    o[0] == 100 && (o[1] & 0xC0) == 64
}

/// Tailscale's IPv6 range (fd7a:115c:a1e0::/48).
fn is_tailscale_v6(ip: Ipv6Addr) -> bool {
    let s = ip.segments();
    s[0] == 0xfd7a && s[1] == 0x115c && s[2] == 0xa1e0
}

fn is_tailscale(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_tailscale_v4(v4),
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => is_tailscale_v4(v4),
            None => is_tailscale_v6(v6),
        },
    }
}

fn is_loopback(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_loopback(),
        IpAddr::V6(v6) => v6.is_loopback() || v6.to_ipv4_mapped().is_some_and(|v4| v4.is_loopback()),
    }
}

/// May this address connect? Loopback always; Tailscale unless --local-only.
fn peer_allowed(ip: IpAddr, allow_tailscale: bool) -> bool {
    is_loopback(ip) || (allow_tailscale && is_tailscale(ip))
}

/// This computer's Tailscale addresses, or none if Tailscale isn't running.
fn tailscale_addresses() -> Vec<IpAddr> {
    let mut found: Vec<IpAddr> = Vec::new();
    // The Tailscale command knows for certain.
    for exe in tailscale_commands() {
        if let Ok(out) = Command::new(exe).arg("ip").output() {
            if out.status.success() {
                for line in String::from_utf8_lossy(&out.stdout).lines() {
                    if let Ok(ip) = line.trim().parse::<IpAddr>() {
                        if is_tailscale(ip) && !found.contains(&ip) {
                            found.push(ip);
                        }
                    }
                }
                break;
            }
        }
    }
    // Without the command: ask the system which local address it would use
    // to reach Tailscale's own DNS address. Connecting a UDP socket sends
    // nothing; it only picks the route, which goes through Tailscale.
    if found.is_empty() {
        let probes: [(&str, &str); 2] = [("0.0.0.0:0", "100.100.100.100:53"), ("[::]:0", "[fd7a:115c:a1e0::53]:53")];
        for (bind, target) in probes {
            if let Ok(sock) = UdpSocket::bind(bind) {
                if sock.connect(target).is_ok() {
                    if let Ok(local) = sock.local_addr() {
                        let ip = local.ip();
                        if is_tailscale(ip) && !found.contains(&ip) {
                            found.push(ip);
                        }
                    }
                }
            }
        }
    }
    found
}

fn tailscale_commands() -> Vec<&'static str> {
    if cfg!(windows) {
        vec!["tailscale", r"C:\Program Files\Tailscale\tailscale.exe"]
    } else {
        vec!["tailscale", "/usr/bin/tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"]
    }
}

// ------------------------------------------------------------------ requests

pub struct Response {
    pub status: u16,
    pub reason: &'static str,
    pub content_type: &'static str,
    pub body: Vec<u8>,
    pub head_only: bool,
    pub allow: Option<&'static str>,
}

impl Response {
    fn text(status: u16, reason: &'static str, body: &str) -> Response {
        Response { status, reason, content_type: "text/plain; charset=utf-8", body: body.as_bytes().to_vec(), head_only: false, allow: None }
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut head = format!(
            "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nCache-Control: no-cache\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nX-Frame-Options: DENY\r\nConnection: close\r\n",
            self.status,
            self.reason,
            self.content_type,
            self.body.len()
        );
        if let Some(allow) = self.allow {
            head.push_str(&format!("Allow: {}\r\n", allow));
        }
        head.push_str("\r\n");
        let mut bytes = head.into_bytes();
        if !self.head_only {
            bytes.extend_from_slice(&self.body);
        }
        bytes
    }
}

/// Is this Host header one of ours? An IP address, "localhost", a bare
/// machine name (Tailscale's MagicDNS short names) or a *.ts.net name.
/// Anything else is a page on another site that pointed its own domain at
/// this computer, which must not be able to read the page through it.
pub fn host_allowed(host: &str) -> bool {
    let host = host.trim().trim_end_matches('.');
    if host.is_empty() {
        return false;
    }
    // [ipv6]:port or [ipv6]
    let name = if let Some(rest) = host.strip_prefix('[') {
        match rest.split_once(']') {
            Some((inside, _)) => return inside.parse::<Ipv6Addr>().is_ok(),
            None => return false,
        }
    } else {
        match host.rsplit_once(':') {
            Some((name, port)) if !name.contains(':') && port.chars().all(|c| c.is_ascii_digit()) => name,
            _ => host,
        }
    }
    .to_ascii_lowercase();
    let name = name.trim_end_matches('.');
    name.parse::<IpAddr>().is_ok() || name == "localhost" || !name.contains('.') || name.ends_with(".ts.net")
}

/// Answers one request, given its head (request line and headers).
pub fn respond(head: &str) -> Response {
    let mut lines = head.split("\r\n");
    let request_line = lines.next().unwrap_or("");
    let mut parts = request_line.split(' ');
    let (method, target, version) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""), parts.next().unwrap_or(""));
    if !version.starts_with("HTTP/1.") || parts.next().is_some() {
        return Response::text(400, "Bad Request", "Bad request.\n");
    }
    let mut host: Option<&str> = None;
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            if name.trim().eq_ignore_ascii_case("host") {
                if host.is_some() {
                    return Response::text(400, "Bad Request", "Bad request.\n");
                }
                host = Some(value);
            }
        }
    }
    match host {
        Some(h) if host_allowed(h) => {}
        _ => return Response::text(403, "Forbidden", "This server only answers on this computer and its Tailscale network.\n"),
    }
    let head_only = method == "HEAD";
    if method != "GET" && !head_only {
        let mut r = Response::text(405, "Method Not Allowed", "Only GET and HEAD.\n");
        r.allow = Some("GET, HEAD");
        return r;
    }
    let path = target.split(['?', '#']).next().unwrap_or("");
    let mut r = match path {
        "/" | "/index.html" => Response {
            status: 200,
            reason: "OK",
            content_type: "text/html; charset=utf-8",
            body: PAGE.as_bytes().to_vec(),
            head_only: false,
            allow: None,
        },
        _ => Response::text(404, "Not Found", "Not found. Open / for Study Website.\n"),
    };
    r.head_only = head_only;
    r
}

/// Reads the request head (up to the blank line) from a connection.
fn read_head(stream: &mut TcpStream) -> io::Result<Option<String>> {
    let mut reader = io::BufReader::new(stream.take(MAX_REQUEST_HEAD as u64));
    let mut head = String::new();
    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line)?;
        if n == 0 {
            return Ok(None); // closed, or the head was too long
        }
        if line == "\r\n" || line == "\n" {
            return Ok(Some(head));
        }
        head.push_str(line.trim_end_matches(['\r', '\n']));
        head.push_str("\r\n");
    }
}

fn handle(mut stream: TcpStream) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(30)));
    let response = match read_head(&mut stream) {
        Ok(Some(head)) => respond(head.trim_end_matches("\r\n")),
        Ok(None) => Response::text(431, "Request Header Fields Too Large", "Request too large.\n"),
        Err(_) => return,
    };
    let _ = stream.write_all(&response.to_bytes());
    let _ = stream.flush();
}

// ----------------------------------------------------------------- listening

fn serve(listener: TcpListener, allow_tailscale: bool) {
    for conn in listener.incoming() {
        let stream = match conn {
            Ok(s) => s,
            Err(_) => continue,
        };
        let allowed = stream.peer_addr().map(|a| peer_allowed(a.ip(), allow_tailscale)).unwrap_or(false);
        if !allowed {
            // Not loopback or Tailscale: close without a word.
            drop(stream);
            continue;
        }
        thread::spawn(move || handle(stream));
    }
}

fn listen(addr: SocketAddr, allow_tailscale: bool) -> io::Result<()> {
    let listener = TcpListener::bind(addr)?;
    thread::spawn(move || serve(listener, allow_tailscale));
    Ok(())
}

fn url_for(ip: IpAddr, port: u16) -> String {
    match ip {
        IpAddr::V4(v4) => format!("http://{}:{}/", v4, port),
        IpAddr::V6(v6) => format!("http://[{}]:{}/", v6, port),
    }
}

struct Options {
    port: u16,
    allow_tailscale: bool,
}

fn usage() -> String {
    format!(
        "Study Website server {VERSION}\n\
         Serves Study Website to this computer and to your Tailscale network only.\n\n\
         Usage: study-server [--port N] [--local-only]\n\n\
         \x20 --port N       port to serve on (default {DEFAULT_PORT}; or set STUDY_SERVER_PORT)\n\
         \x20 --local-only   only this computer, not Tailscale\n\
         \x20 --help         show this help\n"
    )
}

fn parse_args(args: &[String], env_port: Option<String>) -> Result<Options, String> {
    let mut opts = Options { port: DEFAULT_PORT, allow_tailscale: true };
    if let Some(p) = env_port {
        opts.port = parse_port(&p)?;
    }
    let mut i = 0;
    while i < args.len() {
        let a = args[i].as_str();
        match a {
            "--port" | "-p" => {
                i += 1;
                let v = args.get(i).ok_or("--port needs a number, for example --port 8787")?;
                opts.port = parse_port(v)?;
            }
            _ if a.starts_with("--port=") => opts.port = parse_port(&a["--port=".len()..])?,
            "--local-only" => opts.allow_tailscale = false,
            "--help" | "-h" | "/?" => return Err(String::new()),
            _ => return Err(format!("Unknown option: {}", a)),
        }
        i += 1;
    }
    Ok(opts)
}

fn parse_port(s: &str) -> Result<u16, String> {
    match s.trim().parse::<u16>() {
        Ok(p) if p > 0 => Ok(p),
        _ => Err(format!("\"{}\" isn't a port number (1-65535).", s.trim())),
    }
}

/// When the exe was double-clicked, the window would vanish with the error;
/// keep it open until Enter.
fn fail(message: &str) -> ! {
    eprintln!("{}", message);
    if cfg!(windows) {
        eprintln!("\nPress Enter to close.");
        let _ = io::stdin().read_line(&mut String::new());
    }
    std::process::exit(1);
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let opts = match parse_args(&args, std::env::var("STUDY_SERVER_PORT").ok()) {
        Ok(o) => o,
        Err(e) if e.is_empty() => {
            print!("{}", usage());
            return;
        }
        Err(e) => fail(&format!("{}\n\n{}", e, usage())),
    };
    let port = opts.port;

    println!("Study Website server {VERSION}");
    if let Err(e) = listen(SocketAddr::from((Ipv4Addr::LOCALHOST, port)), opts.allow_tailscale) {
        let hint = if e.kind() == io::ErrorKind::AddrInUse {
            format!("Port {port} is already in use (is the server already running?). Pick another with --port.")
        } else {
            format!("Couldn't listen on port {port}: {e}")
        };
        fail(&hint);
    }
    let _ = listen(SocketAddr::from((Ipv6Addr::LOCALHOST, port)), opts.allow_tailscale);
    println!("  On this computer:  http://localhost:{port}/");

    if opts.allow_tailscale {
        let bound: Arc<Mutex<HashSet<IpAddr>>> = Arc::new(Mutex::new(HashSet::new()));
        let mut warned = false;
        let mut first = true;
        loop {
            let addrs = tailscale_addresses();
            if addrs.is_empty() && first {
                println!("  Tailscale:         not connected yet; it will be picked up when it is.");
                warned = true;
            }
            for ip in addrs {
                let mut set = bound.lock().unwrap();
                if set.contains(&ip) {
                    continue;
                }
                match listen(SocketAddr::new(ip, port), true) {
                    Ok(()) => {
                        set.insert(ip);
                        println!("  Over Tailscale:    {}", url_for(ip, port));
                        if warned || !first {
                            println!("                     (Tailscale connected)");
                        }
                    }
                    Err(e) if first => println!("  Couldn't listen on Tailscale address {ip}: {e}"),
                    Err(_) => {}
                }
            }
            if first {
                println!("  Other networks can't reach it. Close this window to stop the server.");
                if !bound.lock().unwrap().is_empty() {
                    println!("  (Other Tailscale devices can also use this computer's Tailscale name, for example http://my-pc:{port}/.)");
                }
                first = false;
            }
            thread::sleep(TAILSCALE_RECHECK);
        }
    } else {
        println!("  Local only: Tailscale devices can't reach it. Close this window to stop the server.");
        loop {
            thread::sleep(Duration::from_secs(3600));
        }
    }
}

// --------------------------------------------------------------------- tests

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    #[test]
    fn only_loopback_and_tailscale_peers() {
        for ok in ["127.0.0.1", "127.5.5.5", "::1", "::ffff:127.0.0.1", "100.64.0.1", "100.101.102.103", "100.127.255.254", "fd7a:115c:a1e0::1", "fd7a:115c:a1e0:ab12::99", "::ffff:100.100.1.1"] {
            assert!(peer_allowed(ip(ok), true), "{ok} should be allowed");
        }
        for bad in ["192.168.1.20", "10.0.0.5", "172.16.0.1", "100.63.255.255", "100.128.0.1", "8.8.8.8", "0.0.0.0", "fe80::1", "fd7a:115c:a1e1::1", "2001:db8::1", "::ffff:192.168.1.2"] {
            assert!(!peer_allowed(ip(bad), true), "{bad} should be refused");
        }
        assert!(peer_allowed(ip("127.0.0.1"), false));
        assert!(!peer_allowed(ip("100.100.1.1"), false), "--local-only refuses Tailscale");
    }

    #[test]
    fn host_names() {
        for ok in ["localhost", "localhost:8787", "127.0.0.1:8787", "100.101.1.2:8787", "[::1]:8787", "[fd7a:115c:a1e0::1]", "my-pc", "my-pc:8787", "my-pc.tail1234.ts.net", "MY-PC.TAIL1234.TS.NET:8787", "localhost."] {
            assert!(host_allowed(ok), "{ok} should be allowed");
        }
        for bad in ["", "evil.example.com", "evil.example.com:8787", "127.0.0.1.nip.io", "ts.net.evil.com", "[nope]", "localhost.evil.com"] {
            assert!(!host_allowed(bad), "{bad} should be refused");
        }
    }

    #[test]
    fn serves_the_page() {
        let r = respond("GET / HTTP/1.1\r\nHost: localhost:8787");
        assert_eq!(r.status, 200);
        assert_eq!(r.body, PAGE.as_bytes());
        let bytes = r.to_bytes();
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(text.contains(&format!("Content-Length: {}\r\n", PAGE.len())));
        assert!(text.contains("<html") || text.contains("<!DOCTYPE") || text.contains("<!doctype"));
        assert_eq!(respond("GET /index.html?x=1 HTTP/1.1\r\nHost: my-pc").status, 200);
    }

    #[test]
    fn head_has_no_body() {
        let r = respond("HEAD / HTTP/1.1\r\nHost: localhost");
        assert_eq!(r.status, 200);
        let bytes = r.to_bytes();
        assert!(bytes.ends_with(b"\r\n\r\n"));
        assert!(String::from_utf8_lossy(&bytes).contains(&format!("Content-Length: {}", PAGE.len())));
    }

    #[test]
    fn refuses_the_rest() {
        assert_eq!(respond("GET /../../secret HTTP/1.1\r\nHost: localhost").status, 404);
        assert_eq!(respond("GET /favicon.ico HTTP/1.1\r\nHost: localhost").status, 404);
        assert_eq!(respond("POST / HTTP/1.1\r\nHost: localhost").status, 405);
        assert_eq!(respond("GET / HTTP/1.1\r\nHost: attacker.example").status, 403);
        assert_eq!(respond("GET / HTTP/1.1").status, 403, "no Host header");
        assert_eq!(respond("GET / HTTP/1.1\r\nHost: localhost\r\nHost: evil.com").status, 400);
        assert_eq!(respond("garbage").status, 400);
    }

    #[test]
    fn options() {
        let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let o = parse_args(&a(&[]), None).unwrap();
        assert_eq!((o.port, o.allow_tailscale), (DEFAULT_PORT, true));
        assert_eq!(parse_args(&a(&["--port", "9000"]), None).unwrap().port, 9000);
        assert_eq!(parse_args(&a(&["--port=9001"]), None).unwrap().port, 9001);
        assert_eq!(parse_args(&a(&[]), Some("9002".into())).unwrap().port, 9002);
        assert_eq!(parse_args(&a(&["--port", "9003"]), Some("9002".into())).unwrap().port, 9003);
        assert!(!parse_args(&a(&["--local-only"]), None).unwrap().allow_tailscale);
        assert!(parse_args(&a(&["--port", "0"]), None).is_err());
        assert!(parse_args(&a(&["--port", "70000"]), None).is_err());
        assert!(parse_args(&a(&["--bogus"]), None).is_err());
    }

    #[test]
    fn serves_over_a_real_socket() {
        // Loopback over a real listener.
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        thread::spawn(move || serve(listener, true));
        let mut s = TcpStream::connect(addr).unwrap();
        s.write_all(format!("GET / HTTP/1.1\r\nHost: localhost:{}\r\n\r\n", addr.port()).as_bytes()).unwrap();
        let mut got = Vec::new();
        s.read_to_end(&mut got).unwrap();
        assert!(got.starts_with(b"HTTP/1.1 200 OK"));
        assert!(got.ends_with(PAGE.as_bytes()));
    }

    #[test]
    fn closes_connections_from_other_networks() {
        // This computer's LAN address stands in for a stranger: a listener on
        // it (as if it were a Tailscale address) must close the connection
        // without answering, since the source isn't loopback or Tailscale.
        let probe = UdpSocket::bind("0.0.0.0:0").unwrap();
        let lan = match probe.connect("192.0.2.1:9").and_then(|_| probe.local_addr()) {
            Ok(a) if !a.ip().is_loopback() && !a.ip().is_unspecified() && !is_tailscale(a.ip()) => a.ip(),
            _ => return, // no outside network here: nothing to test
        };
        let listener = match TcpListener::bind(SocketAddr::new(lan, 0)) {
            Ok(l) => l,
            Err(_) => return,
        };
        let addr = listener.local_addr().unwrap();
        thread::spawn(move || serve(listener, true));
        let mut s = TcpStream::connect(addr).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let _ = s.write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
        let mut got = Vec::new();
        let _ = s.read_to_end(&mut got);
        assert!(got.is_empty(), "a stranger got a reply: {:?}", String::from_utf8_lossy(&got[..got.len().min(80)]));
    }
}
