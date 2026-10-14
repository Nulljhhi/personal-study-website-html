//! Everything under ~/Documents/StudyWebsite, without any Tauri types so it
//! can be tested against a temporary folder.
//!
//!   StudyWebsite/
//!     index.json                  bank IDs: { "version": 1, "titles": { title: id } }
//!     banks/<unit title>.txt      copies of question banks (named for people)
//!     progress/<bank id>.json     completed questions + game data, one per bank
//!     checkpoints/<id>.json       saved quiz/exam sessions ("Save progress")
//!     images/<sha-256>.<ext>      pictures, stored once each (images.rs)
//!     .lock                       held by the running copy of the app
//!     .check-pictures             a bank or checkpoint went away since the
//!                                 last look for unused pictures
//!     rename-backup/              only while a rename runs: copies of every
//!                                 file it changes, put back on the next start
//!                                 if the app stopped partway through
//!
//! Every bank title gets a stable ID the first time its progress is saved.
//! Progress files are named by that ID, so two titles that clean up to the
//! same file name ("Week: 1" and "Week? 1") never share one, and renaming a
//! bank only changes the index, never which file holds its progress.
//! Files from older versions (progress/<title>.json) are moved to their ID
//! the first time they're read.
//!
//! Bank files are still named after their titles so they're easy to find,
//! and every write checks that an existing bank belongs to the same title.

use crate::images;
use crate::files::{modified_ms, read_head, read_limited, safe_stem, sync_files, write_durable, write_safe, MAX_BANK_BYTES, MAX_JSON_BYTES};
use crate::titles::{normalize_newlines, unit_title_of, with_unit_title};
use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const BANKS_DIR: &str = "banks";
pub const PROGRESS_DIR: &str = "progress";
pub const CHECKPOINTS_DIR: &str = "checkpoints";
const INDEX_FILE: &str = "index.json";
const RENAME_BACKUP_DIR: &str = "rename-backup";
const RENAME_MANIFEST: &str = "manifest.json";
const LOCK_FILE: &str = ".lock";
pub const READ_MANY_LIMIT: usize = 100;
const READ_MANY_BYTES: usize = 64 * 1024 * 1024;
/// There when a bank or checkpoint was deleted, renamed or replaced since
/// the last look for unused pictures (see collect_images).
const PICTURE_CHECK_MARK: &str = ".check-pictures";
const INDEX_VERSION: u64 = 1;

// Tests only: stop a rename after this step (1-3) without undoing it, the
// way a crash would.
#[cfg(test)]
thread_local! {
    static CRASH_AFTER: std::cell::Cell<u8> = const { std::cell::Cell::new(0) };
}
#[cfg(test)]
fn crashes_after(step: u8) -> bool {
    CRASH_AFTER.with(|c| c.get() == step)
}
#[cfg(not(test))]
fn crashes_after(_step: u8) -> bool {
    false
}

/// One read-modify-write of index.json at a time.
static INDEX_LOCK: Mutex<()> = Mutex::new(());
/// A file's size and last change, to tell whether it's still the one the
/// app last read or wrote. Times are kept to the nanosecond (100 ns on
/// Windows), so another program changing it in between always shows.
#[derive(Clone, PartialEq)]
struct Stamp(u64, Option<std::time::SystemTime>);
fn stamp(path: &Path) -> Option<Stamp> {
    let m = fs::symlink_metadata(path).ok()?;
    m.is_file().then(|| Stamp(m.len(), m.modified().ok()))
}
/// The index as last read or written (saved after every answer, it would
/// otherwise be read and checked again each time; with years of banks
/// that's thousands of entries).
static INDEX_CACHE: Mutex<Option<(PathBuf, Stamp, Map<String, Value>)>> = Mutex::new(None);
/// Progress files this app wrote, with the title they belong to: while
/// unchanged on disk they don't need reading back before the next save.
static OWN_PROGRESS: Mutex<Option<std::collections::HashMap<PathBuf, (Stamp, String)>>> = Mutex::new(None);
/// Progress files written but not yet forced onto the disk.
static UNSYNCED: Mutex<std::collections::BTreeSet<PathBuf>> = Mutex::new(std::collections::BTreeSet::new());

pub struct Store {
    root: PathBuf,
}

/// What a progress file on disk is: missing, valid (with the title it says
/// it belongs to, None for old files without one), or damaged.
pub enum ProgressFile {
    Missing,
    Valid(Option<String>),
    Damaged(String),
}

pub fn inspect_progress(path: &Path) -> ProgressFile {
    load_progress(path).0
}

/// What a progress file is, plus its text when it's valid, from one read.
/// The whole file is still checked to be valid JSON, but only its title is
/// kept, so this costs far less than building the full data.
fn load_progress(path: &Path) -> (ProgressFile, Option<String>) {
    if fs::symlink_metadata(path).is_err() {
        return (ProgressFile::Missing, None);
    }
    let raw = match read_limited(path, MAX_JSON_BYTES) {
        Ok(raw) => raw,
        Err(e) => return (ProgressFile::Damaged(e), None),
    };
    #[derive(serde::Deserialize)]
    struct Head {
        #[serde(rename = "unitTitle")]
        unit_title: Option<Value>,
    }
    // A struct also reads from a JSON list; progress has to be an object.
    let object = raw.trim_start_matches([' ', '\t', '\r', '\n']).starts_with('{');
    match serde_json::from_str::<Head>(&raw) {
        Ok(head) if object => {
            let owner = head.unit_title.as_ref().and_then(|t| t.as_str()).map(str::to_string);
            (ProgressFile::Valid(owner), Some(raw))
        }
        _ => (ProgressFile::Damaged(format!("{} isn't valid progress data", path.display())), None),
    }
}

/// Error if `path` already holds a bank for a different title. Fails
/// closed: a file that can't be read or has no title is never overwritten.
pub fn check_bank_owner(path: &Path, title: &str) -> Result<(), String> {
    if fs::symlink_metadata(path).is_err() {
        return Ok(());
    }
    let existing = read_limited(path, MAX_BANK_BYTES)
        .map_err(|e| format!("\"{title}\" can't be saved because the existing file can't be checked: {e}"))?;
    match unit_title_of(&existing) {
        Some(owner) if owner == title => Ok(()),
        Some(owner) => Err(format!(
            "\"{title}\" can't be saved because the bank \"{owner}\" already uses the same file name. Rename one of them so their names differ by more than punctuation."
        )),
        None => Err(format!(
            "\"{title}\" can't be saved because {} already exists and has no unit_title line. Move or fix that file first.",
            path.display()
        )),
    }
}

/// Lock the data folder for this copy of the app, for as long as the
/// returned file is kept open (the system drops the lock when the app
/// exits, even after a crash). Err when another copy holds it. On a drive
/// that can't lock files at all (some network drives), Ok(None): the app
/// works as before rather than not at all.
pub fn lock_data_folder(root: &Path) -> Result<Option<fs::File>, String> {
    fs::create_dir_all(root).map_err(|e| format!("Could not create {}: {e}", root.display()))?;
    let path = root.join(LOCK_FILE);
    // A lock file that can't be opened (read-only, another user's) means no
    // lock, as on a drive that can't lock: the app still works.
    let Ok(file) = fs::OpenOptions::new().create(true).truncate(false).write(true).open(&path) else {
        return Ok(None);
    };
    match file.try_lock() {
        Ok(()) => Ok(Some(file)),
        Err(fs::TryLockError::WouldBlock) => Err(format!(
            "Another copy of Study Website is using {}, so this one won't read or save anything. Close the other copy (check the taskbar, or other user accounts on this computer), then start the app again.",
            root.display()
        )),
        Err(fs::TryLockError::Error(_)) => Ok(None),
    }
}

/// Whether two paths are the same file on disk (e.g. two spellings that
/// differ only in case on a case-insensitive drive).
fn same_identity(a: &Path, b: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        match (fs::metadata(a), fs::metadata(b)) {
            (Ok(x), Ok(y)) => x.dev() == y.dev() && x.ino() == y.ino(),
            _ => false,
        }
    }
    #[cfg(not(unix))]
    {
        let la = a.to_string_lossy().to_lowercase();
        let lb = b.to_string_lossy().to_lowercase();
        la == lb && fs::metadata(a).is_ok()
    }
}

fn new_bank_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let mix = nanos ^ ((std::process::id() as u64) << 32) ^ COUNTER.fetch_add(1, Ordering::Relaxed).wrapping_mul(0x9E37_79B9_7F4A_7C15);
    format!("bank-{:016x}", mix)
}

fn valid_id(id: &str) -> bool {
    id.starts_with("bank-") && id.len() <= 40 && id[5..].chars().all(|c| c.is_ascii_hexdigit())
}

impl Store {
    pub fn new(root: PathBuf) -> Store {
        Store { root }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn dir(&self, name: &str, create: bool) -> Result<PathBuf, String> {
        let dir = self.root.join(name);
        if create {
            fs::create_dir_all(&dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
        }
        Ok(dir)
    }

    pub fn bank_path(&self, name: &str, create: bool) -> Result<PathBuf, String> {
        Ok(self.dir(BANKS_DIR, create)?.join(format!("{}.txt", safe_stem(name))))
    }

    /// Where a pre-1.10 progress file for this title would be.
    fn legacy_progress_path(&self, title: &str) -> Result<PathBuf, String> {
        Ok(self.dir(PROGRESS_DIR, false)?.join(format!("{}.json", safe_stem(title))))
    }

    fn progress_path_for(&self, id: &str, create: bool) -> Result<PathBuf, String> {
        Ok(self.dir(PROGRESS_DIR, create)?.join(format!("{id}.json")))
    }

    pub fn checkpoint_path(&self, id: &str, create: bool) -> Result<PathBuf, String> {
        Ok(self.dir(CHECKPOINTS_DIR, create)?.join(format!("{}.json", safe_stem(id))))
    }

    /// An existing file named exactly `name` (as a listing returned it) in
    /// `dir`. Names are never cleaned up again here: "A?.txt" must not turn
    /// into "A_.txt" and act on a different file.
    fn exact_file(&self, dir: &str, name: &str, ext: &str) -> Result<PathBuf, String> {
        let bad = name.is_empty() || name.len() > 255 || name.contains('/') || name.contains('\\') || name.contains('\0')
            || name == "." || name == ".." || !name.ends_with(ext)
            // One plain file name: on Windows "C:notes.txt" would replace the
            // whole folder when joined, and "A.txt:s.txt" is a hidden stream.
            || cfg!(windows) && name.contains(':')
            || !matches!(Path::new(name).components().collect::<Vec<_>>()[..], [std::path::Component::Normal(_)]);
        if bad {
            return Err(format!("\"{name}\" isn't a file name the app can use."));
        }
        Ok(self.dir(dir, false)?.join(name))
    }
    /// A listed bank by its exact file name.
    pub fn listed_bank(&self, name: &str) -> Result<PathBuf, String> {
        self.exact_file(BANKS_DIR, name, ".txt")
    }
    /// A listed checkpoint by its exact id (the file name without .json).
    pub fn listed_checkpoint(&self, id: &str) -> Result<PathBuf, String> {
        self.exact_file(CHECKPOINTS_DIR, &format!("{id}.json"), ".json")
    }

    /* ------------------------------ index ------------------------------ */

    /// The index, for anything that changes it. A rebuilt index that isn't
    /// sure (see read_index_partial) is refused.
    fn read_index(&self) -> Result<Map<String, Value>, String> {
        match self.read_index_partial()? {
            (titles, None) => Ok(titles),
            (_, Some(problem)) => Err(problem),
        }
    }

    /// The index, plus a problem if it had to be rebuilt and some progress
    /// couldn't be placed: a progress file that can't be read (its bank is
    /// unknown), or two that claim the same title. The titles that were
    /// placed safely are returned and can be used; nothing else may get a
    /// new ID (that would start a bank over and leave its real progress
    /// orphaned), and the rebuilt index isn't written until it's fixed.
    fn read_index_partial(&self) -> Result<(Map<String, Value>, Option<String>), String> {
        let path = self.root.join(INDEX_FILE);
        if fs::symlink_metadata(&path).is_err() {
            // Lost (or never written): rebuild it from the progress files,
            // which each record their own title and ID.
            let (rebuilt, problem) = self.rebuild_index();
            if problem.is_none() && !rebuilt.is_empty() {
                self.write_index(&rebuilt)?;
            }
            return Ok((rebuilt, problem));
        }
        let now = stamp(&path);
        if let (Some(now), Ok(cache)) = (&now, INDEX_CACHE.lock()) {
            if let Some((root, at, titles)) = cache.as_ref() {
                if root == &self.root && at == now {
                    return Ok((titles.clone(), None));
                }
            }
        }
        // Fail closed: a damaged index would otherwise hand out new IDs and
        // orphan everyone's progress.
        let raw = read_limited(&path, MAX_JSON_BYTES)?;
        let data: Value = serde_json::from_str(&raw)
            .map_err(|e| format!("{} is damaged ({e}). Fix or move it, then try again.", path.display()))?;
        let damaged = |why: &str| format!("{} is damaged ({why}). Fix or move it, then try again.", path.display());
        let obj = data.as_object().ok_or_else(|| damaged("not an object"))?;
        match obj.get("version").and_then(|v| v.as_u64()) {
            Some(v) if v > INDEX_VERSION => return Err(format!("{} was written by a newer version of Study Website.", path.display())),
            Some(v) if v >= 1 => {}
            _ => return Err(damaged("no valid version")),
        }
        // Every entry has to be a real ID, used by one title only; anything
        // else is refused instead of quietly dropped (which would hand out
        // new IDs and orphan existing progress).
        let titles = obj.get("titles").and_then(|t| t.as_object()).ok_or_else(|| damaged("no list of titles"))?;
        let mut seen = std::collections::HashSet::new();
        for (title, id) in titles {
            let id = id.as_str().filter(|i| valid_id(i)).ok_or_else(|| damaged(&format!("bad ID for \"{title}\"")))?;
            if !seen.insert(id.to_string()) {
                return Err(damaged(&format!("the ID {id} is listed twice")));
            }
        }
        if let (Some(now), Ok(mut cache)) = (now, INDEX_CACHE.lock()) {
            *cache = Some((self.root.clone(), now, titles.clone()));
        }
        Ok((titles.clone(), None))
    }

    fn rebuild_index(&self) -> (Map<String, Value>, Option<String>) {
        let mut found: std::collections::BTreeMap<String, Vec<String>> = Default::default();
        let mut unreadable = Vec::new();
        let Ok(dir) = self.dir(PROGRESS_DIR, false) else { return (Map::new(), None) };
        let Ok(entries) = fs::read_dir(&dir) else { return (Map::new(), None) };
        for path in entries.filter_map(|e| e.ok()).map(|e| e.path()) {
            let Some(stem) = path.file_stem().map(|s| s.to_string_lossy().into_owned()) else { continue };
            if !valid_id(&stem) || path.extension().map_or(true, |e| e != "json") {
                continue;
            }
            let data = read_limited(&path, MAX_JSON_BYTES).ok().and_then(|raw| serde_json::from_str::<Value>(&raw).ok());
            let id_ok = data.as_ref().and_then(|d| d.get("bankId")).and_then(|v| v.as_str()) == Some(stem.as_str());
            match data.as_ref().and_then(|d| d.get("unitTitle")).and_then(|v| v.as_str()) {
                Some(title) if id_ok => found.entry(title.to_string()).or_default().push(format!("{stem}.json")),
                _ => unreadable.push(format!("{stem}.json")),
            }
        }
        let mut titles = Map::new();
        let mut problems = Vec::new();
        for (title, mut files) in found {
            if files.len() == 1 {
                titles.insert(title, Value::String(files[0].trim_end_matches(".json").to_string()));
            } else {
                files.sort();
                problems.push(format!("{} all say they belong to \"{title}\"", files.join(" and ")));
            }
        }
        if !unreadable.is_empty() {
            unreadable.sort();
            problems.push(format!("{} can't be read", unreadable.join(", ")));
        }
        let problem = (!problems.is_empty()).then(|| {
            format!(
                "DAMAGED: index.json is missing and can't be rebuilt safely: in {}, {}. Move the files you don't want out of that folder (or fix them), then try again.",
                dir.display(),
                problems.join("; ")
            )
        });
        (titles, problem)
    }

    fn write_index(&self, titles: &Map<String, Value>) -> Result<(), String> {
        fs::create_dir_all(&self.root).map_err(|e| format!("Could not create {}: {e}", self.root.display()))?;
        let data = json!({ "version": INDEX_VERSION, "titles": titles });
        let text = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
        let path = self.root.join(INDEX_FILE);
        let written = write_durable(&path, &text);
        if let Ok(mut cache) = INDEX_CACHE.lock() {
            *cache = match (&written, stamp(&path)) {
                (Ok(()), Some(at)) => Some((self.root.clone(), at, titles.clone())),
                _ => None,
            };
        }
        written
    }

    /// The bank ID for a title. Without `create`, only an existing ID (or
    /// an old title-named progress file, which is moved to a new ID) counts.
    pub fn bank_id(&self, title: &str, create: bool) -> Result<Option<String>, String> {
        let _guard = INDEX_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let (mut titles, problem) = self.read_index_partial()?;
        if let Some(id) = titles.get(title).and_then(|v| v.as_str()) {
            return Ok(Some(id.to_string()));
        }
        // This bank's progress may be the file that couldn't be placed.
        if let Some(problem) = problem {
            return Err(problem);
        }
        let legacy = self.legacy_progress_path(title)?;
        let migrate = match inspect_progress(&legacy) {
            ProgressFile::Missing => false,
            ProgressFile::Valid(Some(owner)) => owner == title,
            ProgressFile::Valid(None) => true,
            ProgressFile::Damaged(e) => return Err(format!("DAMAGED: Saved progress couldn't be read ({e}).")),
        };
        if !migrate && !create {
            return Ok(None);
        }
        let id = new_bank_id();
        if migrate {
            let raw = read_limited(&legacy, MAX_JSON_BYTES)?;
            let mut data: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            data["unitTitle"] = Value::String(title.to_string());
            data["bankId"] = Value::String(id.clone());
            let text = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
            write_durable(&self.progress_path_for(&id, true)?, &text)?;
        }
        titles.insert(title.to_string(), Value::String(id.clone()));
        if let Err(e) = self.write_index(&titles) {
            if migrate {
                let _ = fs::remove_file(self.progress_path_for(&id, false)?);
            }
            return Err(e);
        }
        if migrate {
            // The copy under the ID is in place and indexed; the old one goes.
            let _ = fs::remove_file(&legacy);
        }
        Ok(Some(id))
    }

    /// Where this title's progress lives, without creating anything.
    fn progress_file_of(&self, title: &str) -> Result<Option<PathBuf>, String> {
        match self.bank_id(title, false)? {
            Some(id) => Ok(Some(self.progress_path_for(&id, false)?)),
            None => Ok(None),
        }
    }

    /* ------------------------------ progress ------------------------------ */

    /// The saved progress JSON for this title, "" if there is none. Damage
    /// is reported (prefixed "DAMAGED:") so the page never saves over it.
    pub fn read_progress(&self, title: &str) -> Result<String, String> {
        let title = title.trim();
        let Some(path) = self.progress_file_of(title)? else { return Ok(String::new()) };
        match load_progress(&path) {
            (ProgressFile::Missing, _) => Ok(String::new()),
            (ProgressFile::Valid(Some(owner)), _) if owner != title => {
                Err(format!("DAMAGED: {} says it belongs to \"{owner}\".", path.display()))
            }
            (ProgressFile::Valid(_), raw) => Ok(raw.unwrap_or_default()),
            (ProgressFile::Damaged(e), _) => Err(format!("DAMAGED: Saved progress couldn't be read ({e}).")),
        }
    }

    /// Saves and returns the bank's ID.
    pub fn write_progress(&self, title: &str, json: &str) -> Result<String, String> {
        let title = title.trim();
        let id = self.bank_id(title, true)?.ok_or("No bank ID")?;
        let path = self.progress_path_for(&id, true)?;
        // Written by this app and unchanged since: it's ours, no need to
        // read the whole file back.
        let known = OWN_PROGRESS.lock().ok().and_then(|own| {
            let (at, owner) = own.as_ref()?.get(&path)?.clone();
            (Some(at) == stamp(&path)).then(|| ProgressFile::Valid(Some(owner)))
        });
        match known.unwrap_or_else(|| inspect_progress(&path)) {
            ProgressFile::Damaged(e) => {
                return Err(format!(
                    "Progress for \"{title}\" wasn't saved so the damaged file isn't overwritten ({e}). Move that file somewhere else to start fresh."
                ))
            }
            // The index says this file is ours; the file has to agree.
            ProgressFile::Valid(Some(owner)) if owner != title => {
                return Err(format!("Progress for \"{title}\" wasn't saved: {} belongs to \"{owner}\".", path.display()))
            }
            _ => {}
        }
        if json.len() as u64 > MAX_JSON_BYTES {
            return Err("This progress is too large to save.".into());
        }
        let mut data: Value = serde_json::from_str(json).map_err(|e| format!("The progress to save isn't valid: {e}"))?;
        if !data.is_object() {
            return Err("The progress to save isn't valid.".into());
        }
        data["unitTitle"] = Value::String(title.to_string());
        data["bankId"] = Value::String(id.clone());
        // Compact: only the app reads it, and it's written after every answer.
        let text = serde_json::to_string(&data).map_err(|e| e.to_string())?;
        // Only the contents are synced here, to keep answering fast: a power
        // cut can cost the latest answer, never the file. sync_progress makes
        // the last swap permanent when the app quits.
        let written = write_safe(&path, &text);
        if let Ok(mut own) = OWN_PROGRESS.lock() {
            let own = own.get_or_insert_with(Default::default);
            match (&written, stamp(&path)) {
                (Ok(()), Some(at)) => { own.insert(path.clone(), (at, title.to_string())); }
                _ => { own.remove(&path); }
            }
        }
        written?;
        if let Ok(mut unsynced) = UNSYNCED.lock() {
            unsynced.insert(path);
        }
        Ok(id)
    }

    /// Push every progress file saved since the last call onto the disk.
    /// Called before the app quits.
    pub fn sync_progress(&self) -> Result<(), String> {
        let paths: Vec<PathBuf> = match UNSYNCED.lock() {
            Ok(mut unsynced) => std::mem::take(&mut *unsynced).into_iter().collect(),
            Err(_) => return Ok(()),
        };
        sync_files(paths.iter().map(|p| p.as_path()))
    }

    /// Last-modified time and size of this title's progress file (0, 0 if
    /// none), with the index already read (listings read it once).
    /// Read-only: an old title-named file is looked at, not moved.
    fn progress_stamp_in(&self, index: Option<&Map<String, Value>>, title: &str) -> (u64, u64) {
        let indexed = index.and_then(|t| t.get(title).and_then(|v| v.as_str()).map(str::to_string));
        let path = match indexed {
            Some(id) => self.progress_path_for(&id, false),
            None => self.legacy_progress_path(title),
        };
        path.map(|p| (modified_ms(&p), fs::metadata(&p).map(|m| m.len()).unwrap_or(0))).unwrap_or((0, 0))
    }

    /* ------------------------------ banks ------------------------------ */

    pub fn save_bank(&self, name: &str, text: &str) -> Result<PathBuf, String> {
        let text = normalize_newlines(text);
        if text.len() as u64 > MAX_BANK_BYTES {
            return Err("This bank is too large to save (the limit is 40 MB, images included).".into());
        }
        let title = unit_title_of(&text).unwrap_or_else(|| name.trim().to_string());
        // Pictures go to the picture folder; the bank keeps a pointer to each.
        let (text, new_pictures) = images::externalize_counting(&self.root, &text)?;
        let saved = (|| {
            let path = self.bank_path(&title, true)?;
            self.dir(PROGRESS_DIR, true)?;
            check_bank_owner(&path, &title)?;
            if path.exists() {
                self.note_pictures_may_be_unused();
            }
            write_durable(&path, &text)?;
            Ok(path)
        })();
        // Pictures stored for a bank that then wasn't saved aren't used.
        if saved.is_err() && new_pictures > 0 {
            self.note_pictures_may_be_unused();
        }
        saved
    }

    pub fn list_banks(&self) -> Result<Vec<String>, String> {
        let dir = self.dir(BANKS_DIR, false)?;
        if !dir.exists() {
            return Ok(Vec::new());
        }
        let mut names: Vec<String> = fs::read_dir(&dir)
            .map_err(|e| format!("Could not read {}: {e}", dir.display()))?
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .filter(|p| p.is_file() && p.extension().map_or(false, |ext| ext == "txt"))
            .filter_map(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
            .collect();
        names.sort_by_key(|n| n.to_lowercase());
        Ok(names)
    }

    pub fn read_bank(&self, name: &str) -> Result<String, String> {
        read_limited(&self.listed_bank(name)?, MAX_BANK_BYTES)
    }

    /// Every saved bank as (file name, contents, progress JSON or "", modified ms).
    pub fn list_bank_details(&self) -> Result<Vec<(String, String, String, u64)>, String> {
        let mut out = Vec::new();
        for name in self.list_banks()? {
            let path = self.listed_bank(&name)?;
            let text = read_limited(&path, MAX_BANK_BYTES).unwrap_or_default();
            // Damage is passed on ("DAMAGED: ..."), not shown as no progress.
            let progress = match unit_title_of(&text).map(|t| self.read_progress(&t)) {
                Some(Ok(p)) => p,
                Some(Err(e)) => format!("DAMAGED: {}", e.trim_start_matches("DAMAGED: ")),
                None => String::new(),
            };
            out.push((name, text, progress, modified_ms(&path)));
        }
        Ok(out)
    }

    /// Up to READ_MANY_LIMIT listed banks in one call, each as (contents,
    /// progress JSON or "" or "DAMAGED: why", error reading the bank or ""),
    /// so a long bank list needs a few calls rather than two per bank.
    pub fn read_banks(&self, names: &[String]) -> Result<Vec<(String, String, String)>, String> {
        if names.len() > READ_MANY_LIMIT {
            return Err(format!("At most {READ_MANY_LIMIT} banks at a time."));
        }
        // Old banks can still hold their pictures (up to 40 MB each): stop
        // at about 64 MB, and the page reads the rest one at a time.
        let mut out = Vec::new();
        let mut total = 0usize;
        for name in names {
            if total >= READ_MANY_BYTES {
                break;
            }
            out.push(match self.read_bank(name) {
                Err(e) => (String::new(), String::new(), e),
                Ok(text) => {
                    let progress = match unit_title_of(&text).map(|t| self.read_progress(&t)) {
                        Some(Ok(p)) => p,
                        Some(Err(e)) => format!("DAMAGED: {}", e.trim_start_matches("DAMAGED: ")),
                        None => String::new(),
                    };
                    total += text.len() + progress.len();
                    (text, progress, String::new())
                }
            });
        }
        Ok(out)
    }

    /// Cheap listing: (file name, modified ms, size, progress modified ms,
    /// progress size). The title is read from the first 64 KB only.
    pub fn list_bank_meta(&self) -> Result<Vec<(String, u64, u64, u64, u64)>, String> {
        let mut out = Vec::new();
        let index = {
            let _guard = INDEX_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            self.read_index_partial().ok().map(|(titles, _)| titles)
        };
        for name in self.list_banks()? {
            let path = self.listed_bank(&name)?;
            let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            let title = read_head(&path, 64 * 1024).and_then(|head| unit_title_of(&head));
            let (progress, progress_size) = title.map(|t| self.progress_stamp_in(index.as_ref(), &t)).unwrap_or((0, 0));
            out.push((name, modified_ms(&path), size, progress, progress_size));
        }
        Ok(out)
    }

    /// Rename a bank: rewrites its unit_title line, renames the bank file,
    /// moves its ID to the new title (the progress file keeps its name) and
    /// updates checkpoints made from it. Returns (new file name, new text,
    /// warning or ""). A failed step undoes the earlier ones; if the app
    /// stops partway (a crash, a power cut), the backup taken first puts
    /// everything back on the next start (see recover_rename).
    pub fn rename_bank(&self, name: &str, new_title: &str) -> Result<(String, String, String), String> {
        let dir = self.root.join(RENAME_BACKUP_DIR);
        // Copies left by a recovery that couldn't finish are the only way
        // back for that rename: never overwrite them with a new backup.
        if dir.join(RENAME_MANIFEST).exists() {
            return Err(format!(
                "An earlier rename couldn't be fully undone, and its copies are in {}. Move that folder somewhere else (after putting back anything you need from it), then rename again.",
                dir.display()
            ));
        }
        self.note_pictures_may_be_unused();
        let result = self.rename_bank_steps(name, new_title);
        // Failed: each step was undone, but an undo can fail too (a full
        // disk fails the undo as well). Put everything back from the backup
        // as a start-up recovery would; if even that fails, keep the copies.
        if let Err(e) = &result {
            if self.restore_rename_backup() == Some(false) {
                return Err(format!(
                    "{e} Not everything could be put back, so copies of the files as they were are kept in {}.",
                    dir.display()
                ));
            }
            return result;
        }
        // Finished: the backup isn't needed any more.
        match (self.discard_rename_backup(), result) {
            (Ok(()), result) => result,
            (Err(e), Ok((file, text, warning))) => {
                let more = format!("the rename's backup couldn't be removed ({e}); remove {} before the app starts again, or it will undo this rename", dir.display());
                Ok((file, text, if warning.is_empty() { more } else { format!("{warning}; {more}") }))
            }
            (Err(_), Err(e)) => Err(e),
        }
    }

    /// Remove rename-backup/. The list of files goes first, and for good,
    /// so that a removal stopped partway (a file held open by a virus
    /// scanner, say) can never leave a list without its copies: on the next
    /// start that would "undo" a rename that had finished.
    fn discard_rename_backup(&self) -> Result<(), String> {
        let dir = self.root.join(RENAME_BACKUP_DIR);
        if fs::symlink_metadata(&dir).is_err() {
            return Ok(());
        }
        let manifest = dir.join(RENAME_MANIFEST);
        let mut last = Ok(());
        // Windows can hold a just-written file for a moment; try a few times.
        for attempt in 0..5 {
            last = match fs::remove_file(&manifest) {
                Ok(()) => Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(e) => Err(e.to_string()),
            };
            if last.is_ok() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50 * (attempt + 1)));
        }
        last?;
        crate::files::sync_dir(&manifest);
        // Without its list the rest is never used; leftovers are harmless.
        let _ = fs::remove_dir_all(&dir);
        Ok(())
    }

    /// Copy every file a rename will change into rename-backup/, and list
    /// the files it will create, before it touches anything. The list is
    /// written last, so a backup that was itself cut short is never used.
    fn back_up_for_rename(&self, change: &[PathBuf], create: &[PathBuf]) -> Result<(), String> {
        let dir = self.root.join(RENAME_BACKUP_DIR);
        // Only leftovers without a list can be here (rename_bank checked).
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
        let rel = |p: &Path| p.strip_prefix(&self.root).unwrap_or(p).to_string_lossy().into_owned();
        let mut files = Vec::new();
        for (i, path) in change.iter().enumerate() {
            if fs::symlink_metadata(path).is_err() {
                // Didn't exist before: on recovery it's removed.
                files.push(json!({ "path": rel(path), "backup": Value::Null }));
                continue;
            }
            let text = read_limited(path, MAX_JSON_BYTES.max(MAX_BANK_BYTES))?;
            let copy = format!("{i}");
            write_durable(&dir.join(&copy), &text)?;
            files.push(json!({ "path": rel(path), "backup": copy }));
        }
        for path in create {
            files.push(json!({ "path": rel(path), "backup": Value::Null }));
        }
        let manifest = json!({ "version": 1, "files": files });
        write_durable(&dir.join(RENAME_MANIFEST), &manifest.to_string())
    }

    /// Put back the files of a rename that didn't finish. Returns a message
    /// for the page when it did.
    pub fn recover_rename(&self) -> Option<String> {
        let dir = self.root.join(RENAME_BACKUP_DIR);
        match self.restore_rename_backup()? {
            true => Some("A bank rename was interrupted the last time the app closed, so it was undone. Your banks, progress and checkpoints are as they were before it.".into()),
            false => Some(format!(
                "A bank rename was interrupted the last time the app closed, and not everything could be put back. The copies are kept in {}.",
                dir.display()
            )),
        }
    }

    /// Put every file a rename changed back from rename-backup/. None when
    /// there's no usable backup; Some(true) when all of it was put back (and
    /// the backup removed); Some(false) when something couldn't be, and the
    /// backup is kept.
    fn restore_rename_backup(&self) -> Option<bool> {
        let dir = self.root.join(RENAME_BACKUP_DIR);
        if fs::symlink_metadata(&dir).is_err() {
            return None;
        }
        let manifest = fs::read_to_string(dir.join(RENAME_MANIFEST)).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok());
        let Some(files) = manifest.as_ref().and_then(|m| m.get("files")).and_then(|f| f.as_array()) else {
            // The backup itself was cut short, so the rename never started.
            let _ = fs::remove_dir_all(&dir);
            return None;
        };
        let target = |rel: &str| -> Option<PathBuf> {
            let p = Path::new(rel);
            // Only paths inside the data folder, never "..".
            if p.is_absolute() || p.components().any(|c| !matches!(c, std::path::Component::Normal(_))) {
                return None;
            }
            Some(self.root.join(p))
        };
        let mut ok = true;
        // Files the rename made go first (a renamed bank can share a name,
        // up to capitals, with the original), then the originals come back.
        for f in files.iter().filter(|f| f.get("backup").map_or(true, |b| b.is_null())) {
            if let Some(path) = f.get("path").and_then(|p| p.as_str()).and_then(target) {
                if fs::symlink_metadata(&path).is_ok() && fs::remove_file(&path).is_err() {
                    ok = false;
                }
            }
        }
        for f in files {
            let (Some(path), Some(copy)) = (
                f.get("path").and_then(|p| p.as_str()).and_then(target),
                f.get("backup").and_then(|b| b.as_str()),
            ) else {
                continue;
            };
            let restored = fs::read_to_string(dir.join(copy)).map_err(|e| e.to_string()).and_then(|text| write_durable(&path, &text));
            if restored.is_err() {
                ok = false;
            }
        }
        if ok {
            let _ = self.discard_rename_backup();
        }
        Some(ok)
    }

    /// Checkpoints made from a bank: by its ID, or by its title for older ones.
    fn checkpoint_is_for(data: &Value, old_id: Option<&String>, old_title: &str) -> bool {
        let unit_text = data.get("unitText").and_then(|v| v.as_str()).unwrap_or("");
        let by_id = old_id.is_some() && data.get("bankId").and_then(|v| v.as_str()) == old_id.map(|s| s.as_str());
        by_id || unit_title_of(unit_text).as_deref() == Some(old_title)
    }

    fn rename_bank_steps(&self, name: &str, new_title: &str) -> Result<(String, String, String), String> {
        let new_title = new_title.trim().to_string();
        if new_title.is_empty() {
            return Err("The name can't be empty.".into());
        }
        if new_title.contains('\n') || new_title.contains('\r') {
            return Err("The name has to fit on one line.".into());
        }
        let old_path = self.listed_bank(name)?;
        let text = read_limited(&old_path, MAX_BANK_BYTES)?;
        let old_title = unit_title_of(&text).unwrap_or_default();
        let new_path = self.bank_path(&new_title, false)?;
        let file_name = new_path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        if old_title == new_title {
            return Ok((file_name, text, String::new()));
        }
        let same_file = new_path == old_path;
        // On case-insensitive drives (Windows, most Macs) "Biology.txt" and
        // "biology.txt" are one file: move it aside first, then write the
        // new name.
        let case_only = !same_file && fs::symlink_metadata(&new_path).is_ok() && same_identity(&old_path, &new_path);
        if !same_file && !case_only && fs::symlink_metadata(&new_path).is_ok() {
            return Err(match read_limited(&new_path, MAX_BANK_BYTES).ok().and_then(|t| unit_title_of(&t)) {
                Some(owner) if owner != new_title => format!(
                    "\"{new_title}\" can't be used because the bank \"{owner}\" already uses the same file name. Pick a name that differs by more than punctuation."
                ),
                _ => format!("A bank named \"{new_title}\" already exists."),
            });
        }

        // Old-style progress for either title is moved to an ID first
        // (bank_id takes the index lock itself).
        let old_id = if old_title.is_empty() { None } else { self.bank_id(&old_title, false)? };
        let taken = self.bank_id(&new_title, false)?;
        let _guard = INDEX_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut titles = self.read_index()?;
        if let Some(other) = &taken {
            if Some(other) != old_id.as_ref() {
                if fs::symlink_metadata(self.progress_path_for(other, false)?).is_ok() {
                    return Err(format!("Completed questions for \"{new_title}\" already exist. Pick a different name."));
                }
                titles.remove(&new_title); // an ID with nothing saved under it
            }
        }
        let progress_raw = match &old_id {
            Some(id) => match load_progress(&self.progress_path_for(id, false)?) {
                (ProgressFile::Missing, _) => None,
                (ProgressFile::Valid(_), raw) => raw,
                (ProgressFile::Damaged(e), _) => {
                    return Err(format!("The completed-questions file for this bank is damaged ({e}), so it wasn't renamed."))
                }
            },
            None => None,
        };

        // 0. A backup of everything this changes, in case the app stops partway.
        {
            let mut change = vec![old_path.clone(), self.root.join(INDEX_FILE)];
            if let (Some(id), Some(_)) = (&old_id, &progress_raw) {
                change.push(self.progress_path_for(id, false)?);
            }
            let cp_dir = self.dir(CHECKPOINTS_DIR, false)?;
            if !old_title.is_empty() && cp_dir.exists() {
                if let Ok(entries) = fs::read_dir(&cp_dir) {
                    for path in entries.filter_map(|e| e.ok()).map(|e| e.path()) {
                        if path.extension().map_or(true, |ext| ext != "json") {
                            continue;
                        }
                        let Ok(raw) = read_limited(&path, MAX_JSON_BYTES) else { continue };
                        let Ok(data) = serde_json::from_str::<Value>(&raw) else { continue };
                        if Self::checkpoint_is_for(&data, old_id.as_ref(), &old_title) {
                            change.push(path);
                        }
                    }
                }
            }
            let mut create = Vec::new();
            if !same_file {
                create.push(new_path.clone());
            }
            if case_only {
                create.push(old_path.with_file_name(format!(".{}.renaming-{}", file_name, std::process::id())));
            }
            self.back_up_for_rename(&change, &create)?;
        }

        // 1. The renamed bank (the original stays until the end, or its text
        //    is kept to undo when the file name doesn't change).
        let new_text = with_unit_title(&text, &new_title);
        let orig_path = old_path.clone();
        let old_path = if case_only {
            let tmp = orig_path.with_file_name(format!(".{}.renaming-{}", file_name, std::process::id()));
            fs::rename(&orig_path, &tmp).map_err(|e| format!("Could not rename {}: {e}", orig_path.display()))?;
            tmp
        } else {
            orig_path.clone()
        };
        if let Err(e) = write_durable(&new_path, &new_text) {
            if case_only {
                let _ = fs::rename(&old_path, &orig_path);
            }
            return Err(e);
        }
        let undo_bank = || {
            if same_file {
                let _ = write_durable(&old_path, &text);
            } else {
                let _ = fs::remove_file(&new_path);
                if case_only {
                    let _ = fs::rename(&old_path, &orig_path);
                }
            }
        };

        if crashes_after(1) {
            return Err("crash".into());
        }

        // 2. The ID follows the new title; the progress file only gets its
        //    stored title updated.
        if let Some(id) = &old_id {
            if let Some(raw) = &progress_raw {
                let path = self.progress_path_for(id, false)?;
                let updated = serde_json::from_str::<Value>(raw)
                    .map_err(|e| e.to_string())
                    .and_then(|mut data| {
                        data["unitTitle"] = Value::String(new_title.clone());
                        serde_json::to_string_pretty(&data).map_err(|e| e.to_string())
                    })
                    .and_then(|json| write_durable(&path, &json));
                if let Err(e) = updated {
                    undo_bank();
                    return Err(e);
                }
            }
            titles.remove(&old_title);
            titles.insert(new_title.clone(), Value::String(id.clone()));
            if let Err(e) = self.write_index(&titles) {
                if let Some(raw) = &progress_raw {
                    let _ = write_durable(&self.progress_path_for(id, false)?, raw);
                }
                undo_bank();
                return Err(e);
            }
        }
        drop(_guard);
        if crashes_after(2) {
            return Err("crash".into());
        }

        // 3. Checkpoints made from this bank (best effort, counted).
        let mut warnings = Vec::new();
        // Another file with the old title shared this progress; it moved with
        // this bank.
        if let Some(other) = (!old_title.is_empty()).then(|| self.banks_titled(&old_title, name)).and_then(|o| o.into_iter().next()) {
            warnings.push(format!("{other} still has the old title, and its completed questions moved with this bank, so it starts with none"));
        }
        let mut failed = 0;
        let cp_dir = self.dir(CHECKPOINTS_DIR, false)?;
        if !old_title.is_empty() && cp_dir.exists() {
            match fs::read_dir(&cp_dir) {
                Err(e) => warnings.push(format!("checkpoints couldn't be checked ({e}), so any made from this bank still use the old name")),
                Ok(entries) => {
                    for path in entries.filter_map(|e| e.ok()).map(|e| e.path()) {
                        if path.extension().map_or(true, |ext| ext != "json") {
                            continue;
                        }
                        let Ok(raw) = read_limited(&path, MAX_JSON_BYTES) else { continue };
                        let Ok(mut data) = serde_json::from_str::<Value>(&raw) else { continue };
                        if !Self::checkpoint_is_for(&data, old_id.as_ref(), &old_title) {
                            continue;
                        }
                        let unit_text = data.get("unitText").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        data["unitText"] = Value::String(with_unit_title(&unit_text, &new_title));
                        data["unitTitle"] = Value::String(new_title.clone());
                        let ok = serde_json::to_string_pretty(&data)
                            .map_err(|e| e.to_string())
                            .and_then(|json| write_durable(&path, &json));
                        if ok.is_err() {
                            failed += 1;
                        }
                    }
                }
            }
        }
        if failed > 0 {
            warnings.push(format!("{failed} checkpoint(s) couldn't be updated and still use the old name"));
        }

        if crashes_after(3) {
            return Err("crash".into());
        }

        // 4. The original bank file last.
        if !same_file {
            if let Err(e) = fs::remove_file(&old_path) {
                warnings.push(format!("the old file {} couldn't be removed ({e})", old_path.display()));
            }
        }
        let warning = if warnings.is_empty() { String::new() } else { format!("Renamed, but {}.", warnings.join("; ")) };
        Ok((file_name, new_text, warning))
    }

    /// Delete a bank and its progress. Checkpoints stay. The bank goes
    /// first, so a failure afterwards can only leave a progress file behind.
    /// Ok("") when everything went, Ok(warning) when the bank went but
    /// something after it didn't (the page then treats the bank as deleted).
    /// Other bank files (by file name) whose unit_title is `title`. They
    /// share one progress file, since progress follows the title.
    pub fn banks_titled(&self, title: &str, except: &str) -> Vec<String> {
        self.banks_maybe_titled(title, except).0
    }

    /// (files with this title, files whose title couldn't be read). Deleting
    /// treats the second kind as possibly sharing the progress.
    fn banks_maybe_titled(&self, title: &str, except: &str) -> (Vec<String>, Vec<String>) {
        let (mut same, mut unknown) = (Vec::new(), Vec::new());
        let Ok(names) = self.list_banks() else { return (same, vec!["the banks folder".into()]) };
        for n in names.into_iter().filter(|n| n != except) {
            match self.listed_bank(&n).ok().and_then(|p| read_head(&p, 64 * 1024)).map(|h| unit_title_of(&h)) {
                Some(Some(t)) if t == title => same.push(n),
                Some(_) => {}
                None => unknown.push(n),
            }
        }
        (same, unknown)
    }

    /// Delete a bank file, and its progress unless another bank file has the
    /// same title. Returns (whether the progress was kept for that copy, a
    /// warning or "").
    pub fn delete_bank(&self, name: &str) -> Result<(bool, String), String> {
        let path = self.listed_bank(name)?;
        self.note_pictures_may_be_unused();
        let read = read_limited(&path, MAX_BANK_BYTES);
        let title = read.as_ref().ok().and_then(|t| unit_title_of(t));
        if fs::symlink_metadata(&path).is_ok() {
            fs::remove_file(&path).map_err(|e| format!("Could not delete {}: {e}", path.display()))?;
        }
        let Some(title) = title else {
            // Without its title there's no telling which progress was its.
            return Ok((false, match read {
                Err(e) => format!("The bank was deleted, but its file couldn't be read ({e}), so any progress it had was left in place."),
                Ok(_) => String::new(),
            }));
        };
        let (same, unknown) = self.banks_maybe_titled(&title, name);
        if let Some(other) = same.first() {
            return Ok((true, format!("Its progress was kept, because {other} has the same title and uses it too.")));
        }
        if let Some(other) = unknown.first() {
            return Ok((true, format!("Its progress was kept, because {other} couldn't be read and might use it too.")));
        }
        Ok((false, self.delete_progress_of(&title)))
    }

    /// Remove a title's progress and index entry. Returns a warning or "".
    fn delete_progress_of(&self, title: &str) -> String {
        let id = match self.bank_id(title, false) {
            Ok(id) => id,
            Err(e) => return format!("The bank was deleted; its progress was left alone because it couldn't be checked ({}).", e.trim_start_matches("DAMAGED: ")),
        };
        let Some(id) = id else { return String::new() };
        let progress = match self.progress_path_for(&id, false) {
            Ok(p) => p,
            Err(e) => return format!("The bank was deleted, but its progress couldn't be found ({e})."),
        };
        if fs::symlink_metadata(&progress).is_ok() {
            if let Err(e) = fs::remove_file(&progress) {
                return format!("The bank was deleted, but its progress file {} couldn't be removed: {e}", progress.display());
            }
        }
        let cleanup = {
            let _guard = INDEX_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            self.read_index().and_then(|mut titles| {
                if titles.remove(title).is_some() {
                    self.write_index(&titles)?;
                }
                Ok(())
            })
        };
        match cleanup {
            Ok(()) => String::new(),
            Err(e) => format!("The bank and its progress were deleted, but the index couldn't be updated ({e})."),
        }
    }

    /* ------------------------------ checkpoints ------------------------------ */

    pub fn save_checkpoint(&self, id: &str, json: &str) -> Result<(), String> {
        if safe_stem(id) != id {
            return Err("That checkpoint name can't be used.".into());
        }
        if json.len() as u64 > MAX_JSON_BYTES {
            return Err("This checkpoint is too large to save.".into());
        }
        let mut data = match serde_json::from_str::<Value>(json) {
            Ok(v) if v.get("format").and_then(|f| f.as_str()) == Some("study-website-session") => v,
            _ => return Err("That isn't a valid checkpoint.".into()),
        };
        if self.checkpoint_path(id, false)?.exists() {
            self.note_pictures_may_be_unused();
        }
        // The bank inside keeps its pictures in the picture folder too, so a
        // checkpoint doesn't repeat them.
        let unit_text = data.get("unitText").and_then(|t| t.as_str()).unwrap_or("").to_string();
        if unit_text.contains(images::IMAGE_SECTION) {
            let (text, new_pictures) = images::externalize_counting(&self.root, &unit_text)?;
            data["unitText"] = Value::String(text);
            let saved = serde_json::to_string(&data)
                .map_err(|e| e.to_string())
                .and_then(|json| write_durable(&self.checkpoint_path(id, true)?, &json));
            if saved.is_err() && new_pictures > 0 {
                self.note_pictures_may_be_unused();
            }
            return saved;
        }
        write_durable(&self.checkpoint_path(id, true)?, json)
    }

    /// At start-up: remove stored pictures no bank or checkpoint uses. If
    /// any bank or checkpoint can't be read, nothing is removed.
    pub fn collect_images(&self) -> usize {
        // Nothing was removed or replaced since the last look: every
        // picture is still used, and the (with years of banks, slow) scan
        // of every bank and checkpoint is skipped.
        let mark = self.root.join(PICTURE_CHECK_MARK);
        if fs::symlink_metadata(&mark).is_err() {
            return 0;
        }
        // Copies kept from a rename that couldn't be undone may be the only
        // place a bank still exists; its pictures stay until that's sorted.
        if fs::symlink_metadata(self.root.join(RENAME_BACKUP_DIR)).is_ok() {
            return 0;
        }
        // No banks folder (moved away for a moment, say) isn't "no banks".
        let banks_dir = self.root.join(BANKS_DIR);
        if !banks_dir.is_dir() {
            return 0;
        }
        let mut texts = Vec::new();
        // Every bank and checkpoint, or nothing is removed: an entry that
        // can't be listed or read might be the one using a picture.
        let all = |dir: &Path, ext: &str| -> Option<Vec<PathBuf>> {
            if !dir.exists() {
                return Some(Vec::new());
            }
            let mut out = Vec::new();
            for entry in fs::read_dir(dir).ok()? {
                let path = entry.ok()?.path();
                if path.extension().map_or(false, |e| e == ext) {
                    out.push(path);
                }
            }
            Some(out)
        };
        let (Some(banks), Some(cps)) = (all(&banks_dir, "txt"), all(&self.root.join(CHECKPOINTS_DIR), "json")) else { return 0 };
        for (path, limit) in banks.iter().map(|p| (p, MAX_BANK_BYTES)).chain(cps.iter().map(|p| (p, MAX_JSON_BYTES))) {
            if !path.is_file() {
                continue;
            }
            match read_limited(path, limit) {
                Ok(t) => texts.push(t),
                Err(_) => return 0,
            }
        }
        let (removed, stuck) = images::collect_garbage(&self.root, texts.iter().map(|t| t.as_str()));
        // Checked against everything: done until the next removal (unless a
        // picture couldn't be removed, say one held open on Windows).
        if stuck == 0 {
            let _ = fs::remove_file(&mark);
        }
        removed
    }

    /// A bank or checkpoint is about to go or be replaced, so a picture
    /// may stop being used: look again at the next start. Written first, so
    /// a crash halfway still leaves it.
    fn note_pictures_may_be_unused(&self) {
        // Durable, so a power cut right after a delete can't lose it.
        if self.root.join(images::IMAGES_DIR).is_dir() {
            let _ = write_durable(&self.root.join(PICTURE_CHECK_MARK), "");
        }
    }

    fn checkpoint_files(&self) -> Result<Vec<(String, PathBuf)>, String> {
        let dir = self.dir(CHECKPOINTS_DIR, false)?;
        if !dir.exists() {
            return Ok(Vec::new());
        }
        let entries = fs::read_dir(&dir).map_err(|e| format!("Could not read {}: {e}", dir.display()))?;
        let mut out = Vec::new();
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if !path.is_file() || path.extension().map_or(true, |ext| ext != "json") {
                continue;
            }
            if let Some(stem) = path.file_stem() {
                out.push((stem.to_string_lossy().into_owned(), path));
            }
        }
        Ok(out)
    }

    /// Every checkpoint as (id, contents); unreadable ones are listed empty
    /// so they can still be deleted.
    pub fn list_checkpoints(&self) -> Result<Vec<(String, String)>, String> {
        Ok(self
            .checkpoint_files()?
            .into_iter()
            .map(|(id, path)| (id, read_limited(&path, MAX_JSON_BYTES).unwrap_or_default()))
            .collect())
    }

    /// Cheap listing: (id, modified ms, size).
    pub fn list_checkpoint_meta(&self) -> Result<Vec<(String, u64, u64)>, String> {
        Ok(self
            .checkpoint_files()?
            .into_iter()
            .map(|(id, path)| {
                let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                (id, modified_ms(&path), size)
            })
            .collect())
    }

    pub fn read_checkpoint(&self, id: &str) -> Result<String, String> {
        read_limited(&self.listed_checkpoint(id)?, MAX_JSON_BYTES)
    }

    pub fn delete_checkpoint(&self, id: &str) -> Result<(), String> {
        let path = self.listed_checkpoint(id)?;
        if fs::symlink_metadata(&path).is_err() {
            return Ok(());
        }
        self.note_pictures_may_be_unused();
        fs::remove_file(&path).map_err(|e| format!("Could not delete {}: {e}", path.display()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store(tag: &str) -> Store {
        let dir = std::env::temp_dir().join(format!("sw-store-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        Store::new(dir)
    }

    fn bank(title: &str) -> String {
        format!("unit_title: {title}\n\nquestion: Q?\nanswer: A\n")
    }

    // Report F01: two titles with one file stem kept sharing (and losing)
    // their progress. With IDs they never share a file.
    #[test]
    fn punctuation_only_titles_get_separate_progress() {
        let s = temp_store("punct");
        s.write_progress("Week: 1", r#"{"completed":["a"]}"#).unwrap();
        s.write_progress("Week? 1", r#"{"completed":["b"]}"#).unwrap();
        assert!(s.read_progress("Week: 1").unwrap().contains("\"a\""));
        assert!(s.read_progress("Week? 1").unwrap().contains("\"b\""));
        fs::remove_dir_all(s.root()).unwrap();
    }

    #[test]
    fn an_interrupted_rename_is_put_back() {
        for step in 1..=3u8 {
            let s = temp_store(&format!("crash{step}"));
            s.save_bank("x", &bank("Cells")).unwrap();
            s.write_progress("Cells", r#"{"completed":["k1:abc"]}"#).unwrap();
            let cp = r#"{"format":"study-website-session","unitTitle":"Cells","unitText":"unit_title: Cells\n\nquestion: Q?\nanswer: A\n"}"#;
            s.save_checkpoint("cp-1", cp).unwrap();
            let before = |s: &Store| {
                (
                    fs::read_to_string(s.bank_path("Cells", false).unwrap()).unwrap(),
                    s.read_progress("Cells").unwrap(),
                    fs::read_to_string(s.root().join(INDEX_FILE)).unwrap(),
                    s.read_checkpoint("cp-1").unwrap(),
                )
            };
            let original = before(&s);
            CRASH_AFTER.with(|c| c.set(step));
            assert!(s.rename_bank_steps("Cells.txt", "Organs").is_err());
            CRASH_AFTER.with(|c| c.set(0));
            assert!(s.root().join(RENAME_BACKUP_DIR).exists(), "step {step}: the backup is still there after the crash");
            let note = s.recover_rename().unwrap();
            assert!(note.contains("undone"), "step {step}: {note}");
            assert_eq!(before(&s), original, "step {step}: everything is as it was");
            assert!(!s.bank_path("Organs", false).unwrap().exists(), "step {step}: the renamed copy is gone");
            assert!(!s.root().join(RENAME_BACKUP_DIR).exists());
            assert!(s.recover_rename().is_none());
            // A finished rename leaves no backup behind.
            s.rename_bank("Cells.txt", "Organs").unwrap();
            assert!(!s.root().join(RENAME_BACKUP_DIR).exists());
            assert!(s.read_progress("Organs").unwrap().contains("k1:abc"));
            fs::remove_dir_all(s.root()).unwrap();
        }
    }

    #[test]
    fn a_cut_short_backup_is_ignored() {
        let s = temp_store("halfbackup");
        s.save_bank("x", &bank("Cells")).unwrap();
        let dir = s.root().join(RENAME_BACKUP_DIR);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("0"), "half").unwrap(); // no manifest: the rename never started
        assert!(s.recover_rename().is_none());
        assert!(!dir.exists());
        assert!(fs::read_to_string(s.bank_path("Cells", false).unwrap()).unwrap().starts_with("unit_title: Cells"));
        fs::remove_dir_all(s.root()).unwrap();
    }

    #[test]
    fn rename_keeps_progress_even_when_the_file_name_stays() {
        let s = temp_store("rename");
        s.save_bank("x", &bank("Week: 1")).unwrap();
        s.write_progress("Week: 1", r#"{"completed":["k1:abc"],"games":{"boss":{}}}"#).unwrap();
        let (file, text, warn) = s.rename_bank("Week_ 1.txt", "Week? 1").unwrap();
        assert_eq!(file, "Week_ 1.txt");
        assert!(text.starts_with("unit_title: Week? 1"));
        assert!(warn.is_empty());
        let p = s.read_progress("Week? 1").unwrap();
        assert!(p.contains("k1:abc") && p.contains("\"unitTitle\": \"Week? 1\""));
        assert_eq!(s.read_progress("Week: 1").unwrap(), "");
        // And a real file-name change keeps it too.
        s.rename_bank("Week_ 1.txt", "Biology 2").unwrap();
        assert!(s.read_progress("Biology 2").unwrap().contains("k1:abc"));
        assert!(s.bank_path("Biology 2", false).unwrap().exists());
        assert!(!s.bank_path("Week? 1", false).unwrap().exists());
        fs::remove_dir_all(s.root()).unwrap();
    }

    #[test]
    fn rename_refuses_a_title_with_its_own_progress() {
        let s = temp_store("taken");
        s.save_bank("a", &bank("A")).unwrap();
        s.write_progress("A", r#"{"completed":[]}"#).unwrap();
        s.write_progress("B", r#"{"completed":["mine"]}"#).unwrap();
        assert!(s.rename_bank("A.txt", "B").is_err());
        assert!(s.read_progress("B").unwrap().contains("mine"));
        fs::remove_dir_all(s.root()).unwrap();
    }

    #[test]
    fn old_title_named_progress_is_migrated() {
        let s = temp_store("migrate");
        fs::create_dir_all(s.root().join(PROGRESS_DIR)).unwrap();
        fs::write(s.root().join(PROGRESS_DIR).join("Cells.json"), r#"{"unitTitle":"Cells","completed":["x"]}"#).unwrap();
        let p = s.read_progress("Cells").unwrap();
        assert!(p.contains("\"x\"") && p.contains("bankId"));
        assert!(!s.root().join(PROGRESS_DIR).join("Cells.json").exists());
        // A file that belongs to another title isn't taken over.
        fs::write(s.root().join(PROGRESS_DIR).join("Week_ 1.json"), r#"{"unitTitle":"Week: 1","completed":[]}"#).unwrap();
        assert_eq!(s.read_progress("Week? 1").unwrap(), "");
        assert!(s.root().join(PROGRESS_DIR).join("Week_ 1.json").exists());
        fs::remove_dir_all(s.root()).unwrap();
    }

    #[test]
    fn damaged_files_are_never_overwritten() {
        let s = temp_store("damaged");
        s.write_progress("A", r#"{"completed":[]}"#).unwrap();
        let id = s.bank_id("A", false).unwrap().unwrap();
        fs::write(s.progress_path_for(&id, false).unwrap(), "{broken").unwrap();
        assert!(s.read_progress("A").unwrap_err().starts_with("DAMAGED"));
        assert!(s.write_progress("A", r#"{"completed":[]}"#).is_err());
        assert_eq!(fs::read_to_string(s.progress_path_for(&id, false).unwrap()).unwrap(), "{broken");
        // A damaged index refuses instead of handing out new IDs.
        fs::write(s.root().join(INDEX_FILE), "{nope").unwrap();
        assert!(s.write_progress("B", "{}").is_err());
        let bankfile = s.bank_path("C", true).unwrap();
        fs::write(&bankfile, "no title\n").unwrap();
        assert!(check_bank_owner(&bankfile, "C").is_err());
        fs::remove_dir_all(s.root()).unwrap();
    }

    #[test]
    fn a_lost_index_is_rebuilt_from_progress_files() {
        let s = temp_store("rebuild");
        let id = s.write_progress("Cells", r#"{"completed":["k"]}"#).unwrap();
        fs::remove_file(s.root().join(INDEX_FILE)).unwrap();
        assert_eq!(s.bank_id("Cells", false).unwrap(), Some(id));
        assert!(s.read_progress("Cells").unwrap().contains("\"k\""));
        fs::remove_dir_all(s.root()).unwrap();
    }

    #[test]
    fn deleting_an_unreadable_bank_says_its_progress_was_left() {
        let s = temp_store("unreadable");
        let dir = s.dir(BANKS_DIR, true).unwrap();
        fs::write(dir.join("Huge.txt"), vec![b'x'; (MAX_BANK_BYTES + 1) as usize]).unwrap();
        let (kept, note) = s.delete_bank("Huge.txt").unwrap();
        assert!(!kept && note.contains("left in place"), "{note}");
        assert!(!dir.join("Huge.txt").exists());
        fs::remove_dir_all(s.root()).unwrap();
    }

    // The caches never hide a change made by something else: a progress
    // file or index replaced behind the app's back is read again.
    #[test]
    fn caches_notice_outside_changes() {
        let s = temp_store("caches");
        s.write_progress("Cells", r#"{"completed":["a"]}"#).unwrap();
        let path = s.progress_file_of("Cells").unwrap().unwrap();
        // Same length, different owner: still caught.
        let theirs = fs::read_to_string(&path).unwrap().replace("Cells", "Other");
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(&path, &theirs).unwrap();
        assert!(s.write_progress("Cells", "{}").unwrap_err().contains("belongs to"));
        // The index edited by hand is read again.
        let index = s.root().join(INDEX_FILE);
        let text = fs::read_to_string(&index).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(&index, text.replace("\"Cells\"", "\"Cellz\"")).unwrap();
        assert_eq!(s.bank_id("Cells", false).unwrap(), None);
        assert!(s.bank_id("Cellz", false).unwrap().is_some());
        fs::remove_dir_all(s.root()).unwrap();
    }

    // Every store operation against a big data folder (made by a script;
    // set SW_SCALE_DIR to it). Not run by default:
    //   SW_SCALE_DIR=... cargo test --release bench_big_folder -- --ignored --nocapture
    #[test]
    #[ignore]
    fn bench_big_folder() {
        let Ok(dir) = std::env::var("SW_SCALE_DIR") else { return };
        let s = Store::new(PathBuf::from(dir));
        let time = |label: &str, f: &mut dyn FnMut()| {
            let t = std::time::Instant::now();
            f();
            println!("{label}: {:.0} ms", t.elapsed().as_secs_f64() * 1000.0);
        };
        let banks = s.list_banks().unwrap();
        let first = banks[0].clone();
        let title = unit_title_of(&s.read_bank(&first).unwrap()).unwrap();
        time("start-up picture check (collect_images)", &mut || { s.collect_images(); });
        time("list_bank_meta", &mut || { s.list_bank_meta().unwrap(); });
        time("read every bank + its progress (bank list, first open)", &mut || {
            for b in &banks { let t = s.read_bank(b).unwrap(); s.read_progress(&unit_title_of(&t).unwrap()).unwrap(); }
        });
        time("list_checkpoint_meta", &mut || { s.list_checkpoint_meta().unwrap(); });
        time("banks_titled (delete/rename check)", &mut || { s.banks_titled(&title, &first); });
        time("write_progress", &mut || { s.write_progress(&title, r#"{"completed":[]}"#).unwrap(); });
        time("rename_bank", &mut || { s.rename_bank(&first, "Renamed for timing").unwrap(); });
        let renamed = s.list_banks().unwrap().into_iter().find(|b| b.starts_with("Renamed")).unwrap();
        time("rename_bank back", &mut || { s.rename_bank(&renamed, &title).unwrap(); });
        time("lost index rebuilt", &mut || {
            fs::remove_file(s.root().join(INDEX_FILE)).unwrap();
            s.bank_id(&title, false).unwrap();
        });
    }

    // Timing at years-of-banks scale (2,000 banks in the index, a 1 MB
    // progress file). Not run by default: cargo test --release -- --ignored --nocapture
    #[test]
    #[ignore]
    fn bench_progress_saves() {
        let s = temp_store("bench");
        for i in 0..2000 {
            s.bank_id(&format!("Week {i} biology"), true).unwrap();
        }
        let big = format!(r#"{{"completed":[{}],"games":{{}}}}"#, (0..30000).map(|i| format!("\"k1:{i:028x}\"")).collect::<Vec<_>>().join(","));
        s.write_progress("Week 7 biology", &big).unwrap();
        let t = std::time::Instant::now();
        for _ in 0..50 {
            s.write_progress("Week 7 biology", &big).unwrap();
        }
        println!("write_progress: {:.2} ms each ({} KB)", t.elapsed().as_secs_f64() * 1000.0 / 50.0, big.len() / 1024);
        let t = std::time::Instant::now();
        for _ in 0..50 {
            s.read_progress("Week 7 biology").unwrap();
        }
        println!("read_progress: {:.2} ms each", t.elapsed().as_secs_f64() * 1000.0 / 50.0);
        fs::remove_dir_all(s.root()).unwrap();
    }

    // Years of banks: the start-up look for unused pictures only reads
    // every bank and checkpoint after something was removed or replaced.
    #[test]
    fn pictures_are_only_checked_after_a_removal() {
        use base64::Engine;
        let s = temp_store("picture-mark");
        let b64 = base64::engine::general_purpose::STANDARD.encode(b"\x89PNG\r\n\x1a\nmarked");
        let text = format!("unit_title: P\n\nquestion: Q?\nanswer: A\n\n{}\nImg.Q1.png 2x2 #abcdef12: data:image/png;base64,{b64}\n", crate::images::IMAGE_SECTION);
        s.save_bank("P", &text).unwrap();
        let mark = s.root().join(PICTURE_CHECK_MARK);
        assert!(!mark.exists(), "a new bank removes nothing");
        // An unused picture left by hand stays until something is removed.
        let stray = s.root().join(crate::images::IMAGES_DIR).join(format!("{}.png", "d".repeat(64)));
        fs::write(&stray, b"x").unwrap();
        assert_eq!(s.collect_images(), 0);
        assert!(stray.exists());
        // Deleting the bank marks it; the next start cleans up, then stops looking.
        s.delete_bank("P.txt").unwrap();
        assert!(mark.exists());
        assert_eq!(s.collect_images(), 2);
        assert!(!mark.exists() && !stray.exists());
        fs::remove_dir_all(s.root()).unwrap();
    }

    // Final review: a rename that fails partway with its undo also failing
    // is put back from its backup straight away, not left half done.
    #[test]
    fn a_failed_rename_is_put_back_from_its_backup() {
        for step in 1..=3u8 {
            let s = temp_store(&format!("failed{step}"));
            s.save_bank("x", &bank("Cells")).unwrap();
            s.write_progress("Cells", r#"{"completed":["k1:abc"]}"#).unwrap();
            let bank_before = fs::read_to_string(s.bank_path("Cells", false).unwrap()).unwrap();
            let index_before = fs::read_to_string(s.root().join(INDEX_FILE)).unwrap();
            // The hook stops after a step without undoing it, like an undo that failed.
            CRASH_AFTER.with(|c| c.set(step));
            assert!(s.rename_bank("Cells.txt", "Organs").is_err());
            CRASH_AFTER.with(|c| c.set(0));
            assert_eq!(fs::read_to_string(s.bank_path("Cells", false).unwrap()).unwrap(), bank_before, "step {step}");
            assert_eq!(fs::read_to_string(s.root().join(INDEX_FILE)).unwrap(), index_before, "step {step}");
            assert!(s.read_progress("Cells").unwrap().contains("k1:abc"), "step {step}");
            assert!(!s.bank_path("Organs", false).unwrap().exists(), "step {step}");
            assert!(!s.root().join(RENAME_BACKUP_DIR).exists(), "step {step}: put back, so the backup is gone");
            fs::remove_dir_all(s.root()).unwrap();
        }
    }

    #[test]
    fn a_lock_file_that_cant_be_opened_doesnt_block_the_app() {
        let s = temp_store("lock-blocked");
        fs::create_dir_all(s.root().join(LOCK_FILE)).unwrap(); // a folder where the file goes
        assert!(lock_data_folder(s.root()).unwrap().is_none());
        fs::remove_dir_all(s.root()).unwrap();
    }

    // Report 4 (R01): one copy of the app per data folder, even if the
    // desktop's single-instance check misses one.
    #[test]
    fn the_data_folder_is_locked_by_one_copy() {
        let s = temp_store("lock");
        let first = lock_data_folder(s.root()).unwrap();
        assert!(first.is_some());
        let err = lock_data_folder(s.root()).unwrap_err();
        assert!(err.contains("Another copy"), "{err}");
        drop(first);
        // Closed (or the app ended): the next copy gets it.
        assert!(lock_data_folder(s.root()).unwrap().is_some());
        // The lock file isn't mistaken for a bank or checkpoint.
        assert!(s.list_banks().unwrap().is_empty());
        fs::remove_dir_all(s.root()).unwrap();
    }

    // Report 4: copies kept from a rename that couldn't be undone are never
    // overwritten by a new rename, and their pictures aren't cleaned up.
    #[test]
    fn kept_rename_copies_are_protected() {
        let s = temp_store("kept-copies");
        s.save_bank("a", &bank("A")).unwrap();
        let backup = s.root().join(RENAME_BACKUP_DIR);
        fs::create_dir_all(&backup).unwrap();
        fs::write(backup.join("0"), "unit_title: Old\n").unwrap();
        fs::write(backup.join(RENAME_MANIFEST), r#"{"version":1,"files":[]}"#).unwrap();
        let err = s.rename_bank("A.txt", "B").unwrap_err();
        assert!(err.contains("couldn't be fully undone"), "{err}");
        assert!(backup.join("0").exists() && s.bank_path("A", false).unwrap().exists());
        // A picture only the kept copies might use stays.
        let pic = s.root().join(crate::images::IMAGES_DIR).join(format!("{}.png", "b".repeat(64)));
        fs::create_dir_all(pic.parent().unwrap()).unwrap();
        fs::write(&pic, b"png").unwrap();
        assert_eq!(s.collect_images(), 0);
        assert!(pic.exists());
        // Once the copies are dealt with, renaming works and leaves no backup.
        fs::remove_dir_all(&backup).unwrap();
        s.rename_bank("A.txt", "B").unwrap();
        assert!(!backup.exists());
        assert_eq!(s.collect_images(), 1);
        fs::remove_dir_all(s.root()).unwrap();
    }

    #[test]
    fn pictures_are_kept_when_the_banks_folder_is_missing() {
        let s = temp_store("no-banks");
        let pic = s.root().join(crate::images::IMAGES_DIR).join(format!("{}.png", "c".repeat(64)));
        fs::create_dir_all(pic.parent().unwrap()).unwrap();
        fs::write(&pic, b"png").unwrap();
        assert_eq!(s.collect_images(), 0);
        assert!(pic.exists());
        fs::remove_dir_all(s.root()).unwrap();
    }

    // Report 4: a name from the page is one file name in its folder.
    #[test]
    fn listed_names_stay_in_their_folder() {
        let s = temp_store("names");
        for bad in ["../x.txt", "a/b.txt", "..", "", "x.json"] {
            assert!(s.listed_bank(bad).is_err(), "{bad}");
        }
        #[cfg(windows)]
        for bad in ["C:notes.txt", "A.txt:hidden.txt"] {
            assert!(s.listed_bank(bad).is_err(), "{bad}");
            assert!(s.listed_checkpoint(bad.trim_end_matches(".txt")).is_err(), "{bad}");
        }
        assert!(s.listed_bank("Cell Bio v1.2.txt").unwrap().starts_with(s.root()));
        fs::remove_dir_all(s.root()).unwrap();
    }

    // Faulty disk: when a folder can't be made, saves fail with a message
    // instead of claiming success, and a bank or checkpoint whose pictures
    // can't be stored isn't written without them. (A failed progress save
    // may already have given the title its ID in index.json; that's
    // harmless, the next save uses it.)
    #[test]
    fn saves_fail_cleanly_when_folders_cant_be_made() {
        let s = temp_store("blocked");
        fs::write(s.root().join(PROGRESS_DIR), "a file where the folder goes").unwrap();
        let err = s.write_progress("Cells", "{}").unwrap_err();
        assert!(!err.is_empty());
        assert!(s.read_progress("Cells").unwrap_or_default().is_empty());
        fs::remove_file(s.root().join(PROGRESS_DIR)).unwrap();

        fs::write(s.root().join(crate::images::IMAGES_DIR), "a file where the folder goes").unwrap();
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(b"\x89PNG\r\n\x1a\nfake");
        let text = format!("unit_title: P\n\nquestion: Q?\nanswer: A\n\n{}\nImg.Q1.png 2x2 #abcdef12: data:image/png;base64,{b64}\n", crate::images::IMAGE_SECTION);
        assert!(s.save_bank("P", &text).is_err());
        assert!(!s.bank_path("P", false).unwrap().exists());
        assert!(s.save_checkpoint("cp-1", &format!(r#"{{"format":"study-website-session","unitText":{}}}"#, serde_json::to_string(&text).unwrap())).is_err());
        assert!(!s.checkpoint_path("cp-1", false).unwrap().exists());
        fs::remove_dir_all(s.root()).unwrap();
    }

    // Report R03: a rebuilt index that can't place every progress file
    // gives out no new IDs (and isn't written) until that's fixed.
    #[test]
    fn an_unsure_rebuild_hands_out_no_new_ids() {
        let s = temp_store("unsure");
        let cells = s.write_progress("Cells", r#"{"completed":["k"]}"#).unwrap();
        let lost = s.write_progress("Organs", r#"{"completed":["o"]}"#).unwrap();
        fs::remove_file(s.root().join(INDEX_FILE)).unwrap();
        let lost_path = s.root().join(PROGRESS_DIR).join(format!("{lost}.json"));
        fs::write(&lost_path, "{ damaged").unwrap();
        // Banks that were placed still work, reading and saving.
        assert!(s.read_progress("Cells").unwrap().contains("\"k\""));
        assert_eq!(s.write_progress("Cells", r#"{"completed":["k","l"]}"#).unwrap(), cells);
        // Anything else might be the damaged one: refused, not started over.
        let err = s.read_progress("Organs").unwrap_err();
        assert!(err.starts_with("DAMAGED:") && err.contains(&format!("{lost}.json")), "{err}");
        assert!(s.write_progress("Organs", "{}").is_err());
        assert!(s.write_progress("New", "{}").is_err());
        assert!(!s.root().join(INDEX_FILE).exists());
        // Fixed: everything works again and the index is written.
        fs::remove_file(&lost_path).unwrap();
        assert_eq!(s.read_progress("Organs").unwrap(), "");
        s.write_progress("Organs", "{}").unwrap();
        assert!(s.root().join(INDEX_FILE).exists());
        fs::remove_dir_all(s.root()).unwrap();
    }

    #[test]
    fn two_progress_files_for_one_title_are_refused() {
        let s = temp_store("twice");
        let id = s.write_progress("Cells", r#"{"completed":["k"]}"#).unwrap();
        s.write_progress("Organs", "{}").unwrap();
        fs::remove_file(s.root().join(INDEX_FILE)).unwrap();
        let copy = "bank-00000000000000aa";
        let text = fs::read_to_string(s.root().join(PROGRESS_DIR).join(format!("{id}.json"))).unwrap();
        fs::write(s.root().join(PROGRESS_DIR).join(format!("{copy}.json")), text.replace(&id, copy)).unwrap();
        let err = s.read_progress("Cells").unwrap_err();
        assert!(err.contains(&format!("{id}.json")) && err.contains(&format!("{copy}.json")), "{err}");
        assert!(s.write_progress("Cells", "{}").is_err());
        assert_eq!(s.read_progress("Organs").unwrap().contains("Organs"), true);
        fs::remove_dir_all(s.root()).unwrap();
    }

    // Report R04: two bank files with one title share one progress file.
    #[test]
    fn deleting_one_of_two_copies_keeps_their_progress() {
        let s = temp_store("copies");
        s.save_bank("a", &bank("A")).unwrap();
        fs::copy(s.bank_path("A", false).unwrap(), s.root().join(BANKS_DIR).join("A copy.txt")).unwrap();
        s.write_progress("A", r#"{"completed":["z"]}"#).unwrap();
        let (kept, note) = s.delete_bank("A copy.txt").unwrap();
        assert!(kept && note.contains("A.txt"), "{note}");
        assert!(s.read_progress("A").unwrap().contains("\"z\""));
        // The last copy takes it with it.
        let (kept, note) = s.delete_bank("A.txt").unwrap();
        assert!(!kept && note.is_empty());
        assert_eq!(s.bank_id("A", false).unwrap(), None);
        fs::remove_dir_all(s.root()).unwrap();
    }

    #[test]
    fn renaming_one_of_two_copies_says_so() {
        let s = temp_store("rename-copies");
        s.save_bank("a", &bank("A")).unwrap();
        fs::copy(s.bank_path("A", false).unwrap(), s.root().join(BANKS_DIR).join("A copy.txt")).unwrap();
        s.write_progress("A", "{}").unwrap();
        let (_, _, warning) = s.rename_bank("A.txt", "B").unwrap();
        assert!(warning.contains("A copy.txt"), "{warning}");
        fs::remove_dir_all(s.root()).unwrap();
    }

    // Report O08: progress is read once, and still checked whole.
    #[test]
    fn progress_is_read_once_and_still_checked() {
        let s = temp_store("read-once");
        s.write_progress("Cells", r#"{"completed":["k"],"games":{"x":[1,2]}}"#).unwrap();
        let text = s.read_progress("Cells").unwrap();
        let path = s.progress_file_of("Cells").unwrap().unwrap();
        assert_eq!(text, fs::read_to_string(&path).unwrap());
        for bad in [r#"["Cells"]"#, r#"{"unitTitle":"Cells","games":{"#, "", "null"] {
            fs::write(&path, bad).unwrap();
            assert!(s.read_progress("Cells").unwrap_err().starts_with("DAMAGED:"), "{bad}");
            assert!(s.write_progress("Cells", "{}").is_err(), "{bad}");
        }
        fs::write(&path, r#"{"unitTitle":"Organs"}"#).unwrap();
        assert!(s.read_progress("Cells").is_err());
        fs::write(&path, " \n{\"unitTitle\":\"Cells\",\"unitTitle2\":3}").unwrap();
        assert!(s.read_progress("Cells").is_ok());
        fs::remove_dir_all(s.root()).unwrap();
    }

    // Report R05: answers' saves are synced when the app quits.
    #[test]
    fn progress_saves_are_synced_on_quit() {
        let s = temp_store("sync");
        s.write_progress("Cells", "{}").unwrap();
        let path = s.progress_file_of("Cells").unwrap().unwrap();
        assert!(UNSYNCED.lock().unwrap().contains(&path));
        // The list is shared with tests running at the same time, whose
        // files may vanish meanwhile, so only the bookkeeping is checked.
        let _ = s.sync_progress();
        assert!(!UNSYNCED.lock().unwrap().contains(&path));
        fs::remove_dir_all(s.root()).unwrap();
    }

    #[test]
    fn delete_removes_bank_progress_and_id() {
        let s = temp_store("delete");
        s.save_bank("a", &bank("A")).unwrap();
        s.write_progress("A", r#"{"completed":["z"]}"#).unwrap();
        assert_eq!(s.delete_bank("A.txt").unwrap(), (false, String::new()));
        assert!(!s.bank_path("A", false).unwrap().exists());
        assert_eq!(s.bank_id("A", false).unwrap(), None);
        assert_eq!(fs::read_dir(s.root().join(PROGRESS_DIR)).unwrap().count(), 0);
        fs::remove_dir_all(s.root()).unwrap();
    }

    // B05: names from the listing are used exactly, never re-sanitized
    // into another file's name.
    #[test]
    fn listed_names_are_used_exactly() {
        let s = temp_store("exact");
        s.save_bank("a", &bank("A")).unwrap();
        assert!(s.read_bank("A.txt").is_ok());
        assert!(s.read_bank("A?.txt").is_err());
        assert!(s.read_bank("../A.txt").is_err());
        assert!(s.read_bank("A.json").is_err());
        let _ = s.delete_bank("A?.txt"); // no such file: nothing else is touched
        assert!(s.bank_path("A", false).unwrap().exists());
        assert!(s.read_checkpoint("../index").is_err());
        fs::remove_dir_all(s.root()).unwrap();
    }

    // B04: a structurally damaged index is refused, not trusted.
    #[test]
    fn damaged_index_shapes_are_refused() {
        let s = temp_store("index");
        let id = s.write_progress("A", r#"{"completed":[]}"#).unwrap();
        for bad in [
            r#"[]"#.to_string(),
            r#"{"version":1,"titles":[]}"#.to_string(),
            r#"{"version":99,"titles":{}}"#.to_string(),
            r#"{"version":1,"titles":{"A":"../x"}}"#.to_string(),
            format!(r#"{{"version":1,"titles":{{"A":"{id}","B":"{id}"}}}}"#),
        ] {
            fs::write(s.root().join(INDEX_FILE), &bad).unwrap();
            assert!(s.bank_id("A", false).is_err(), "accepted {bad}");
            assert!(s.write_progress("C", "{}").is_err(), "wrote with {bad}");
        }
        fs::remove_dir_all(s.root()).unwrap();
    }

    // B22: a rename that only changes letter case works (and keeps the
    // bank) even where the file system ignores case.
    #[test]
    fn case_only_rename_keeps_the_bank() {
        let s = temp_store("case");
        s.save_bank("a", &bank("cells")).unwrap();
        s.write_progress("cells", r#"{"completed":["k"]}"#).unwrap();
        let (file, text, _) = s.rename_bank("cells.txt", "Cells").unwrap();
        assert_eq!(file, "Cells.txt");
        assert!(text.starts_with("unit_title: Cells"));
        let names = s.list_banks().unwrap();
        assert_eq!(names, vec!["Cells.txt".to_string()]);
        assert!(s.read_progress("Cells").unwrap().contains("\"k\""));
        // No leftover aside copy.
        assert_eq!(fs::read_dir(s.root().join(BANKS_DIR)).unwrap().count(), 1);
        fs::remove_dir_all(s.root()).unwrap();
    }

    // H03 + checkpoint validation: oversized or non-checkpoint JSON is refused.
    #[test]
    fn writes_are_limited_and_checked() {
        let s = temp_store("limits");
        let big = "x".repeat(MAX_BANK_BYTES as usize + 10);
        assert!(s.save_bank("Big", &format!("unit_title: Big\n{big}")).is_err());
        assert!(s.save_checkpoint("cp-1", r#"{"format":"other"}"#).is_err());
        assert!(s.save_checkpoint("../cp", r#"{"format":"study-website-session"}"#).is_err());
        assert!(s.save_checkpoint("cp-1", r#"{"format":"study-website-session"}"#).is_ok());
        assert!(s.write_progress("A", "[1]").is_err());
        fs::remove_dir_all(s.root()).unwrap();
    }

    #[test]
    fn progress_is_saved_compact() {
        let s = temp_store("compact");
        let id = s.write_progress("A", r#"{"completed":["k"]}"#).unwrap();
        let text = fs::read_to_string(s.progress_path_for(&id, false).unwrap()).unwrap();
        assert!(!text.contains('\n'));
        fs::remove_dir_all(s.root()).unwrap();
    }
}
