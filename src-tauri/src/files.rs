//! Low-level file helpers: safe names, size-limited reads, atomic writes.

use std::fs;
use std::path::{Path, PathBuf};

/// Turn a unit title (or file name) into a safe file stem: no slashes,
/// no "..", no control characters, and a sensible length.
pub fn safe_stem(name: &str) -> String {
    let trimmed = name.trim();
    let without_ext = trimmed
        .strip_suffix(".txt")
        .or_else(|| trimmed.strip_suffix(".json"))
        .unwrap_or(trimmed);
    let mut out: String = without_ext
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    out = out.trim_matches(|c: char| c == '.' || c.is_whitespace()).to_string();
    // Most file systems allow 255 bytes per name; leave room for the
    // extension and temp-file suffixes, and never split a character.
    if out.len() > MAX_STEM_BYTES {
        let mut cut = MAX_STEM_BYTES;
        while !out.is_char_boundary(cut) {
            cut -= 1;
        }
        out.truncate(cut);
        out = out.trim_end_matches(|c: char| c == '.' || c.is_whitespace()).to_string();
    }
    if out.is_empty() {
        out = "unit".to_string();
    }
    // Windows reserves these names (with any extension).
    let base = out.split('.').next().unwrap_or("").trim().to_ascii_uppercase();
    let reserved = matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((base.starts_with("COM") || base.starts_with("LPT"))
            && base.len() == 4
            && base.as_bytes()[3].is_ascii_digit());
    if reserved {
        out.insert(0, '_');
    }
    out
}

pub const MAX_STEM_BYTES: usize = 180;

#[derive(Clone, Copy, PartialEq)]
enum Sync {
    /// The new contents are on the disk before they replace the old ones,
    /// so after a power cut the file is the old one or the new one, never
    /// empty or half written. The swap itself may still be lost.
    Data,
    /// Data, and the swap too: the new file is there after a power cut.
    Full,
}

/// Every write goes through a temp file + rename, so a crash or full disk
/// can't leave half a file, and the old contents survive until the new ones
/// are in place.
///
/// The save after every answer: the new contents are on the disk before
/// they replace the old ones, so a power cut can lose the latest save but
/// never turn the file into an empty or broken one. The swap is made
/// permanent on quit (sync_files).
pub fn write_safe(path: &Path, contents: impl AsRef<[u8]>) -> Result<(), String> {
    write_replacing(path, contents.as_ref(), Sync::Data)
}

/// write_safe, then wait until the swap is on the disk too, so a power
/// cut straight afterwards can't lose it. Slower, so it's used for banks,
/// checkpoints, pictures and the index, not the save after every answer.
pub fn write_durable(path: &Path, contents: impl AsRef<[u8]>) -> Result<(), String> {
    write_replacing(path, contents.as_ref(), Sync::Full)
}

fn write_replacing(path: &Path, contents: &[u8], sync: Sync) -> Result<(), String> {
    use std::io::Write;
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    // A unique temp name per write, so two saves at once can't share one.
    let mut tmp_name = std::ffi::OsString::from(".");
    tmp_name.push(path.file_name().unwrap_or_default());
    tmp_name.push(format!(
        ".{}-{}-{}.tmp",
        std::process::id(),
        nanos,
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let tmp = path.with_file_name(tmp_name);
    let written = fs::File::create(&tmp)
        .and_then(|mut file| {
            file.write_all(contents)?;
            match sync {
                Sync::Data => file.sync_data()?,
                Sync::Full => file.sync_all()?,
            }
            Ok(())
        });
    written.map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Could not write {}: {e}", tmp.display())
    })?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Could not save {}: {e}", path.display())
    })?;
    if sync == Sync::Full {
        sync_dir(path)?;
    }
    Ok(())
}

/// Make a rename in this file's folder permanent (the folder's own entry
/// list is cached too). Only Unix needs, and allows, this.
pub fn sync_dir(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    if let Some(dir) = path.parent() {
        match fs::File::open(dir).and_then(|d| d.sync_all()) {
            Ok(()) => {}
            // Some file systems (network drives, some FUSE mounts) can't
            // sync a folder at all; there's nothing more to do on those.
            Err(e) if matches!(e.kind(), std::io::ErrorKind::InvalidInput | std::io::ErrorKind::Unsupported) => {}
            Err(e) => return Err(format!("Could not finish saving {}: {e}", path.display())),
        }
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

/// Make earlier write_safe swaps permanent on the disk. Files that
/// are gone are skipped. Returns the first error.
pub fn sync_files<'a>(paths: impl IntoIterator<Item = &'a Path>) -> Result<(), String> {
    match sync_each(paths) {
        (_, None) => Ok(()),
        (_, Some(e)) => Err(e),
    }
}

/// sync_files, also returning the paths that couldn't be synced (to try
/// again later) along with the first error.
pub fn sync_each<'a>(paths: impl IntoIterator<Item = &'a Path>) -> (Vec<PathBuf>, Option<String>) {
    let mut failed = Vec::new();
    let mut first = None;
    for path in paths {
        if fs::symlink_metadata(path).is_err() {
            continue;
        }
        // Write access: Windows only flushes a handle that can write.
        let synced = fs::OpenOptions::new()
            .write(true)
            .open(path)
            .and_then(|f| f.sync_all())
            .map_err(|e| format!("Could not finish saving {}: {e}", path.display()))
            .and_then(|()| sync_dir(path));
        if let Err(e) = synced {
            failed.push(path.to_path_buf());
            first.get_or_insert(e);
        }
    }
    (failed, first)
}

/// A saved bank can carry its images (written into the text when a .zip is
/// loaded), so banks and checkpoints allow more than a plain unit file.
pub const MAX_BANK_BYTES: u64 = 40 * 1024 * 1024;
pub const MAX_JSON_BYTES: u64 = 64 * 1024 * 1024;
/// A dropped .txt: a unit file, or a saved bank with its pictures written in
/// (the page checks the 5 MB limit on the text itself).
pub const MAX_DROP_BYTES: u64 = MAX_BANK_BYTES;
/// A dropped .zip (a unit file plus its images).
pub const MAX_ZIP_BYTES: u64 = 40 * 1024 * 1024;

/// Read a regular file (not a folder or symlink) no bigger than `limit`.
pub fn read_limited(path: &Path, limit: u64) -> Result<String, String> {
    let meta = fs::symlink_metadata(path).map_err(|e| format!("Could not read {}: {e}", path.display()))?;
    if !meta.file_type().is_file() {
        return Err(format!("{} isn't a regular file.", path.display()));
    }
    if meta.len() > limit {
        return Err(format!("{} is too large to open.", path.display()));
    }
    fs::read_to_string(path).map_err(|e| format!("Could not read {}: {e}", path.display()))
}

/// Read a file the user dropped on the window. Native drag-and-drop gives
/// the page a path rather than the file itself, so the page asks for it here.
pub fn read_unit_file(path: &Path) -> Result<String, String> {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let meta = fs::metadata(path).map_err(|e| format!("Could not open {name}: {e}"))?;
    if meta.is_dir() {
        return Err(format!("\"{name}\" is a folder. Drop the unit file itself."));
    }
    if meta.len() > MAX_DROP_BYTES {
        return Err(format!("\"{name}\" is too large to be a unit file."));
    }
    let bytes = fs::read(path).map_err(|e| format!("Could not read {name}: {e}"))?;
    String::from_utf8(bytes)
        .map(|text| text.strip_prefix('\u{feff}').map(str::to_string).unwrap_or(text))
        .map_err(|_| format!("\"{name}\" isn't a plain-text file. Unit files are .txt files you can open in a text editor."))
}

/// Read a .zip the user dropped on the window (a unit file with images).
/// The page unpacks it; here it's only checked to be a real zip that isn't
/// too large.
pub fn read_zip_file(path: &Path) -> Result<Vec<u8>, String> {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let meta = fs::metadata(path).map_err(|e| format!("Could not open {name}: {e}"))?;
    if meta.is_dir() {
        return Err(format!("\"{name}\" is a folder. Zip it first, or drop the unit file itself."));
    }
    if meta.len() > MAX_ZIP_BYTES {
        return Err(format!("\"{name}\" is too large (the limit for a .zip is 40 MB)."));
    }
    let bytes = fs::read(path).map_err(|e| format!("Could not read {name}: {e}"))?;
    if !bytes.starts_with(b"PK") {
        return Err(format!("\"{name}\" isn't a .zip file."));
    }
    Ok(bytes)
}

/// `name` in `dir`, or "name (2)", "name (3)", ... if that's taken, so an
/// export never replaces a file that's already there.
fn candidates(dir: &Path, name: &str) -> impl Iterator<Item = PathBuf> {
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (name[..i].to_string(), name[i..].to_string()),
        _ => (name.to_string(), String::new()),
    };
    let dir = dir.to_path_buf();
    std::iter::once(dir.join(name)).chain((2..10_000).map(move |n| dir.join(format!("{stem} ({n}){ext}"))))
}

/// Write `contents` to a new file `name` in `dir` (or "name (2)", ...),
/// never over a file that's already there: each name is claimed with an
/// exclusive create, so two exports at once can't pick the same one.
pub fn write_new_in(dir: &Path, name: &str, contents: &str) -> Result<PathBuf, String> {
    use std::io::Write;
    for path in candidates(dir, name) {
        match fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                return file
                    .write_all(contents.as_bytes())
                    .and_then(|_| file.sync_all())
                    .map(|_| path.clone())
                    .map_err(|e| {
                        let _ = fs::remove_file(&path);
                        format!("Could not save {}: {e}", path.display())
                    });
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("Could not save {}: {e}", path.display())),
        }
    }
    Err(format!("There are too many files named like {name} in {}. Move some, then try again.", dir.display()))
}

/// The first `limit` bytes of a file as text (cut at a character boundary).
pub fn read_head(path: &Path, limit: u64) -> Option<String> {
    use std::io::Read;
    let file = fs::File::open(path).ok()?;
    let mut buf = Vec::new();
    file.take(limit).read_to_end(&mut buf).ok()?;
    Some(match String::from_utf8(buf) {
        Ok(s) => s,
        Err(e) => {
            let valid = e.utf8_error().valid_up_to();
            let mut bytes = e.into_bytes();
            bytes.truncate(valid);
            String::from_utf8(bytes).unwrap_or_default()
        }
    })
}

pub fn modified_ms(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dropped_files_are_checked() {
        let dir = std::env::temp_dir().join(format!("sw-drop-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let good = dir.join("unit.txt");
        fs::write(&good, "\u{feff}unit_title: A\n").unwrap();
        assert_eq!(read_unit_file(&good).unwrap(), "unit_title: A\n");
        let binary = dir.join("photo.png");
        fs::write(&binary, [0x89u8, 0x50, 0xff, 0xfe, 0x00]).unwrap();
        assert!(read_unit_file(&binary).unwrap_err().contains("plain-text"));
        assert!(read_unit_file(&dir).unwrap_err().contains("folder"));
        let zip = dir.join("unit.zip");
        fs::write(&zip, b"PK\x05\x06").unwrap();
        assert_eq!(read_zip_file(&zip).unwrap(), b"PK\x05\x06");
        assert!(read_zip_file(&good).unwrap_err().contains("isn't a .zip"));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn atomic_write_replaces_and_leaves_no_temp() {
        let dir = std::env::temp_dir().join(format!("sw-atomic-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("Cell Bio v1.2.txt");
        write_safe(&file, "one").unwrap();
        write_safe(&file, "two").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "two");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        fs::remove_dir_all(&dir).unwrap();
    }

    // A disk that refuses a write (full, read-only, or the path is wrong)
    // must leave the old file as it was and no temp file behind. Made to
    // fail here by putting a folder or a file where the write has to go,
    // which fails the same way for every user, root included.
    #[test]
    fn failed_writes_keep_the_old_file() {
        let dir = std::env::temp_dir().join(format!("sw-faulty-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        for durable in [false, true] {
            let write = |p: &Path, t: &str| if durable { write_durable(p, t) } else { write_safe(p, t) };
            // The temp file can't be made: the folder is really a file.
            let blocker = dir.join("not-a-folder");
            fs::write(&blocker, "x").unwrap();
            assert!(write(&blocker.join("bank.txt"), "new").unwrap_err().contains("Could not write"));
            // The temp file is written but can't replace the target (a folder
            // is in the way): the error says so and the temp file is gone.
            let target = dir.join("bank.txt");
            fs::create_dir_all(target.join("inside")).unwrap();
            assert!(write(&target, "new").unwrap_err().contains("Could not save"));
            assert!(target.join("inside").is_dir());
            fs::remove_dir_all(&target).unwrap();
            // After those failures the folder holds no temp files, and the
            // same path takes a normal write again.
            write(&target, "old").unwrap();
            let names = |d: &Path| fs::read_dir(d).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect::<Vec<_>>();
            assert_eq!(fs::read_to_string(&target).unwrap(), "old");
            assert!(names(&dir).iter().all(|n| !n.ends_with(".tmp")), "{:?}", names(&dir));
            fs::remove_file(&target).unwrap();
            fs::remove_file(&blocker).unwrap();
        }
        // Syncing skips files that are gone and reports ones it can't open.
        assert!(sync_files([dir.join("gone.json").as_path()]).is_ok());
        assert!(sync_files([dir.as_path()]).unwrap_err().contains("Could not finish saving"));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn stems_respect_limits_and_reserved_names() {
        let long = "é".repeat(200);
        let stem = safe_stem(&long);
        assert!(stem.len() <= MAX_STEM_BYTES);
        let dotted = format!("{}. . x", "a".repeat(MAX_STEM_BYTES - 1));
        assert!(!safe_stem(&dotted).ends_with('.') && !safe_stem(&dotted).ends_with(' '));
        assert_eq!(safe_stem("CON"), "_CON");
        assert_eq!(safe_stem("com1.notes"), "_com1.notes");
        assert_eq!(safe_stem("Console"), "Console");
    }

    #[test]
    fn concurrent_temp_names_differ() {
        let dir = std::env::temp_dir().join(format!("sw-conc-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("p.json");
        let handles: Vec<_> = (0..8)
            .map(|i| {
                let f = file.clone();
                std::thread::spawn(move || write_safe(&f, &format!("{i}")).unwrap())
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn exports_never_overwrite() {
        let dir = std::env::temp_dir().join(format!("sw-unique-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("a.txt"), "x").unwrap();
        assert_eq!(write_new_in(&dir, "a.txt", "y").unwrap(), dir.join("a (2).txt"));
        assert_eq!(fs::read_to_string(dir.join("a.txt")).unwrap(), "x");
        assert_eq!(write_new_in(&dir, "a.txt", "z").unwrap(), dir.join("a (3).txt"));
        assert_eq!(write_new_in(&dir, "new.md", "n").unwrap(), dir.join("new.md"));
        fs::remove_dir_all(&dir).unwrap();
    }
}
