//! The picture store: StudyWebsite/images/<sha-256>.<ext>.
//!
//! A bank loaded from a .zip carries its pictures inside its text, after
//! IMAGE_SECTION, one line each (app/scripts/01-core.js):
//!
//!   Img.Q3.png 800x600 #<id>: data:image/png;base64,...
//!
//! When the app saves a bank or a checkpoint, each picture is written once
//! into images/, named by the SHA-256 of its bytes, and the line points at
//! it instead:
//!
//!   Img.Q3.png 800x600 #<id>: asset:<sha-256>.png
//!
//! so a picture used by a bank and its checkpoints is stored once, and the
//! files stay small. Pictures nothing refers to any more are removed when
//! the app starts (collect_garbage).

use crate::files::write_durable;
use base64::Engine;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

pub const IMAGE_SECTION: &str = "=== images (added by Study Website from a .zip; don't edit below this line) ===";
pub const IMAGES_DIR: &str = "images";
/// The page allows 8 MB per picture; a little room on top.
const MAX_IMAGE_BYTES: u64 = 9 * 1024 * 1024;

fn ext_for(mime: &str) -> Option<&'static str> {
    Some(match mime {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        "image/bmp" => "bmp",
        _ => return None,
    })
}

/// A stored picture's file name: 64 hex digits, a dot, a known extension.
pub fn valid_name(name: &str) -> bool {
    let Some((hash, ext)) = name.split_once('.') else { return false };
    hash.len() == 64
        && hash.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        && ["png", "jpg", "gif", "webp", "svg", "bmp"].contains(&ext)
}

fn damaged() -> String {
    "The pictures in this bank are damaged. Load the original .zip again.".into()
}

/// The text with every inline picture moved into images/. Text without a
/// picture section comes back as it was.
pub fn externalize(root: &Path, text: &str) -> Result<String, String> {
    externalize_counting(root, text).map(|(t, _)| t)
}

/// externalize, also saying how many pictures it newly wrote (they're
/// unused until the bank or checkpoint holding them is saved).
pub fn externalize_counting(root: &Path, text: &str) -> Result<(String, usize), String> {
    let mut written = 0;
    let lines: Vec<&str> = text.split('\n').collect();
    let Some(at) = lines.iter().position(|l| l.trim_end_matches('\r').trim() == IMAGE_SECTION) else {
        return Ok((text.to_string(), 0));
    };
    let dir = root.join(IMAGES_DIR);
    let mut out: Vec<String> = lines[..=at].iter().map(|l| l.to_string()).collect();
    for raw in &lines[at + 1..] {
        let line = raw.trim_end_matches('\r').trim();
        if line.is_empty() {
            out.push(String::new());
            continue;
        }
        let (head, src) = line.split_once(": ").ok_or_else(damaged)?;
        if let Some(name) = src.strip_prefix("asset:") {
            if !valid_name(name) {
                return Err(damaged());
            }
            if !dir.join(name).is_file() {
                return Err(format!(
                    "A picture this bank uses ({name}) is missing from {}. Load the original .zip again.",
                    dir.display()
                ));
            }
            out.push(line.to_string());
            continue;
        }
        let rest = src.strip_prefix("data:").ok_or_else(damaged)?;
        let (mime, b64) = rest.split_once(";base64,").ok_or_else(damaged)?;
        let ext = ext_for(mime).ok_or_else(damaged)?;
        let bytes = base64::engine::general_purpose::STANDARD.decode(b64).map_err(|_| damaged())?;
        let hash = format!("{:x}", Sha256::digest(&bytes));
        let name = format!("{hash}.{ext}");
        let path = dir.join(&name);
        // Named by content, so a file that's there already is this picture.
        if !path.is_file() {
            fs::create_dir_all(&dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
            write_durable(&path, &bytes)?;
            written += 1;
        }
        out.push(format!("{head}: asset:{name}"));
    }
    Ok((out.join("\n"), written))
}

/// The bytes of a stored picture.
pub fn read(root: &Path, name: &str) -> Result<Vec<u8>, String> {
    if !valid_name(name) {
        return Err("That picture name can't be used.".into());
    }
    let path = root.join(IMAGES_DIR).join(name);
    let meta = fs::symlink_metadata(&path).map_err(|_| format!("The picture {name} is missing from {}.", root.join(IMAGES_DIR).display()))?;
    if !meta.file_type().is_file() || meta.len() > MAX_IMAGE_BYTES {
        return Err(format!("The picture {name} can't be read."));
    }
    fs::read(&path).map_err(|e| format!("Could not read {}: {e}", path.display()))
}

/// Every stored picture named in these texts.
pub fn referenced<'a>(texts: impl IntoIterator<Item = &'a str>) -> HashSet<String> {
    let mut found = HashSet::new();
    for text in texts {
        let mut rest = text;
        while let Some(i) = rest.find("asset:") {
            rest = &rest[i + 6..];
            let end = rest.find(|c: char| !(c.is_ascii_alphanumeric() || c == '.')).unwrap_or(rest.len());
            let name = &rest[..end];
            if valid_name(name) {
                found.insert(name.to_string());
            }
            rest = &rest[end..];
        }
    }
    found
}

/// Remove stored pictures that no bank or checkpoint uses. `texts` must be
/// every bank and checkpoint; the caller skips this if any couldn't be read.
/// Returns (removed, unused ones that couldn't be removed).
pub fn collect_garbage<'a>(root: &Path, texts: impl IntoIterator<Item = &'a str>) -> (usize, usize) {
    let keep = referenced(texts);
    let Ok(entries) = fs::read_dir(root.join(IMAGES_DIR)) else { return (0, 0) };
    let (mut removed, mut stuck) = (0, 0);
    for path in entries.filter_map(|e| e.ok()).map(|e| e.path()).collect::<Vec<PathBuf>>() {
        let Some(name) = path.file_name().map(|n| n.to_string_lossy().into_owned()) else { continue };
        if valid_name(&name) && !keep.contains(&name) {
            if fs::remove_file(&path).is_ok() { removed += 1 } else { stuck += 1 }
        }
    }
    (removed, stuck)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\nnot really a png";

    fn bank_with_picture() -> String {
        let b64 = base64::engine::general_purpose::STANDARD.encode(PNG);
        format!("unit_title: A\n\nquestion: Q?\nanswer: A\n\n{IMAGE_SECTION}\nImg.Q1.png 10x20 #abcdef12: data:image/png;base64,{b64}\n")
    }

    #[test]
    fn pictures_are_stored_once_and_read_back() {
        let root = std::env::temp_dir().join(format!("sw-images-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let text = bank_with_picture();
        let out = externalize(&root, &text).unwrap();
        let hash = format!("{:x}", Sha256::digest(PNG));
        assert!(out.contains(&format!("Img.Q1.png 10x20 #abcdef12: asset:{hash}.png")), "{out}");
        assert!(!out.contains("base64"));
        assert!(out.starts_with("unit_title: A\n\nquestion: Q?"));
        // Saving again (or a checkpoint of it) stores nothing new.
        assert_eq!(externalize(&root, &out).unwrap(), out);
        assert_eq!(externalize(&root, &text).unwrap(), out);
        assert_eq!(fs::read_dir(root.join(IMAGES_DIR)).unwrap().count(), 1);
        assert_eq!(read(&root, &format!("{hash}.png")).unwrap(), PNG);
        assert!(read(&root, "../index.json").is_err());
        // Text without pictures is untouched.
        assert_eq!(externalize(&root, "unit_title: B\n").unwrap(), "unit_title: B\n");
        // A missing stored picture is an error, not a silent gap.
        let missing = out.replace(&hash, &"0".repeat(64));
        assert!(externalize(&root, &missing).unwrap_err().contains("missing"));
        // Unused pictures go; used ones stay.
        assert_eq!(collect_garbage(&root, [out.as_str()]), (0, 0));
        assert_eq!(collect_garbage(&root, ["unit_title: B"]), (1, 0));
        assert!(read(&root, &format!("{hash}.png")).is_err());
        fs::remove_dir_all(&root).unwrap();
    }
}
