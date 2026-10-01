// Study Website desktop shell.
// The whole app lives in ../src/index.html; this file only adds commands
// that read and write ~/Documents/StudyWebsite:
//
//   StudyWebsite/
//     banks/<unit title>.txt      copies of question banks
//     progress/<unit title>.json  completed-question lists (quiz mode)
//     checkpoints/<id>.json       saved quiz/exam sessions ("Save progress")
//
// File names come from unit titles with unsafe characters replaced, so two
// different titles can map to the same name ("Week: 1" and "Week? 1").
// Every write checks that an existing file belongs to the same title and
// refuses to overwrite one that doesn't.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const ROOT_DIR: &str = "StudyWebsite";
const BANKS_DIR: &str = "banks";
const PROGRESS_DIR: &str = "progress";
const CHECKPOINTS_DIR: &str = "checkpoints";

/* ------------------------------ paths ------------------------------ */

/// ~/Documents/StudyWebsite (falls back to ~/Documents if the XDG
/// documents dir isn't configured).
fn root_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let docs = app
        .path()
        .document_dir()
        .or_else(|_| app.path().home_dir().map(|h| h.join("Documents")))
        .map_err(|e| format!("Could not find your Documents folder: {e}"))?;
    Ok(docs.join(ROOT_DIR))
}

fn sub_dir(app: &AppHandle, name: &str, create: bool) -> Result<PathBuf, String> {
    let dir = root_dir(app)?.join(name);
    if create {
        fs::create_dir_all(&dir)
            .map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    }
    Ok(dir)
}

/// Turn a unit title (or file name) into a safe file stem: no slashes,
/// no "..", no control characters, and a sensible length.
fn safe_stem(name: &str) -> String {
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
    if out.chars().count() > 120 {
        out = out.chars().take(120).collect();
    }
    if out.is_empty() {
        out = "unit".to_string();
    }
    out
}

fn bank_path(app: &AppHandle, name: &str, create: bool) -> Result<PathBuf, String> {
    Ok(sub_dir(app, BANKS_DIR, create)?.join(format!("{}.txt", safe_stem(name))))
}

fn progress_path(app: &AppHandle, title: &str, create: bool) -> Result<PathBuf, String> {
    Ok(sub_dir(app, PROGRESS_DIR, create)?.join(format!("{}.json", safe_stem(title))))
}

fn checkpoint_path(app: &AppHandle, id: &str, create: bool) -> Result<PathBuf, String> {
    Ok(sub_dir(app, CHECKPOINTS_DIR, create)?.join(format!("{}.json", safe_stem(id))))
}

/// Show a path the way people type it: /home/alex/Documents -> ~/Documents.
fn pretty_path(app: &AppHandle, path: &Path) -> String {
    if !cfg!(windows) {
        if let Ok(home) = app.path().home_dir() {
            if let Ok(rest) = path.strip_prefix(&home) {
                return format!("~/{}", rest.display());
            }
        }
    }
    path.display().to_string()
}

/* ------------------------------ helpers ------------------------------ */

/// Write through a temp file + rename so a crash or full disk can't leave
/// half a file, and the old contents survive until the new ones are in place.
fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let mut tmp_name = path.file_name().unwrap_or_default().to_os_string();
    tmp_name.push(".tmp");
    let tmp = path.with_file_name(tmp_name);
    fs::write(&tmp, contents).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Could not write {}: {e}", tmp.display())
    })?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Could not save {}: {e}", path.display())
    })
}

/// Convert \r\n and lone \r line endings to \n. The page accepts all three,
/// so the Rust side has to treat them the same way.
fn normalize_newlines(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

/// The value of the first `unit_title:` line, if any.
fn unit_title_of(text: &str) -> Option<String> {
    normalize_newlines(text).lines().find_map(|line| {
        let (tag, value) = line.split_once(':')?;
        (tag.trim() == "unit_title").then(|| value.trim().to_string())
    })
}

/// Replace the value of the first `unit_title:` line. Line endings are
/// normalized to \n first, so every other line is kept intact.
fn with_unit_title(text: &str, title: &str) -> String {
    let normalized = normalize_newlines(text);
    let mut done = false;
    normalized
        .split_inclusive('\n')
        .map(|line| {
            if !done {
                if let Some((tag, _)) = line.split_once(':') {
                    if tag.trim() == "unit_title" {
                        done = true;
                        let ending = if line.ends_with('\n') { "\n" } else { "" };
                        return format!("unit_title: {title}{ending}");
                    }
                }
            }
            line.to_string()
        })
        .collect()
}

/// The unit title a progress file says it belongs to.
fn progress_owner(json: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(json)
        .ok()?
        .get("unitTitle")?
        .as_str()
        .map(|s| s.to_string())
}

/// Error if `path` already holds a bank for a different title.
fn check_bank_owner(path: &Path, title: &str) -> Result<(), String> {
    if let Ok(existing) = fs::read_to_string(path) {
        if let Some(owner) = unit_title_of(&existing) {
            if owner != title {
                return Err(format!(
                    "\"{title}\" can't be saved because the bank \"{owner}\" already uses the same file name. Rename one of them so their names differ by more than punctuation."
                ));
            }
        }
    }
    Ok(())
}

/// Error if `path` already holds progress for a different title.
fn check_progress_owner(path: &Path, title: &str) -> Result<(), String> {
    if let Ok(existing) = fs::read_to_string(path) {
        if let Some(owner) = progress_owner(&existing) {
            if owner != title {
                return Err(format!(
                    "Completed questions for \"{title}\" can't be saved because \"{owner}\" already uses the same file name. Rename one of the banks so their names differ by more than punctuation."
                ));
            }
        }
    }
    Ok(())
}

/* ------------------------------ commands ------------------------------ */

#[tauri::command]
fn data_folder(app: AppHandle) -> Result<String, String> {
    Ok(pretty_path(&app, &root_dir(&app)?))
}

/// Close the app (the window is fullscreen, so there's no title bar).
#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

const MAX_DROP_BYTES: u64 = 5 * 1024 * 1024;

/// Read a file the user dropped on the window. Native drag-and-drop gives
/// the page a path rather than the file itself, so the page asks for it here.
fn read_unit_file(path: &Path) -> Result<String, String> {
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

#[tauri::command]
fn read_dropped_file(path: String) -> Result<String, String> {
    read_unit_file(Path::new(&path))
}

/// "Download" a text file (used for the documentation): the desktop window
/// can't do browser downloads, so write it to the Downloads folder instead.
#[tauri::command]
fn save_download(app: AppHandle, name: String, text: String) -> Result<String, String> {
    let dir = app
        .path()
        .download_dir()
        .or_else(|_| app.path().home_dir().map(|h| h.join("Downloads")))
        .map_err(|e| format!("Could not find your Downloads folder: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    let file = Path::new(&name)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "download.txt".into());
    let path = dir.join(file);
    write_atomic(&path, &text)?;
    Ok(pretty_path(&app, &path))
}

#[tauri::command]
fn save_bank(app: AppHandle, name: String, text: String) -> Result<String, String> {
    let text = normalize_newlines(&text);
    let title = unit_title_of(&text).unwrap_or_else(|| name.trim().to_string());
    let path = bank_path(&app, &title, true)?;
    sub_dir(&app, PROGRESS_DIR, true)?;
    check_bank_owner(&path, &title)?;
    write_atomic(&path, &text)?;
    Ok(pretty_path(&app, &path))
}

#[tauri::command]
fn list_banks(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = sub_dir(&app, BANKS_DIR, false)?;
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

#[tauri::command]
fn read_bank(app: AppHandle, name: String) -> Result<String, String> {
    let path = bank_path(&app, &name, false)?;
    fs::read_to_string(&path).map_err(|e| format!("Could not read {}: {e}", path.display()))
}

/// Returns the saved progress JSON for this title, or "" if there is none
/// (or the file belongs to a different title that shares the file name).
#[tauri::command]
fn read_progress(app: AppHandle, name: String) -> Result<String, String> {
    let path = progress_path(&app, &name, false)?;
    if !path.exists() {
        return Ok(String::new());
    }
    let json = fs::read_to_string(&path).map_err(|e| format!("Could not read {}: {e}", path.display()))?;
    match progress_owner(&json) {
        Some(owner) if owner != name.trim() => Ok(String::new()),
        _ => Ok(json),
    }
}

#[tauri::command]
fn write_progress(app: AppHandle, name: String, json: String) -> Result<(), String> {
    let path = progress_path(&app, &name, true)?;
    check_progress_owner(&path, name.trim())?;
    write_atomic(&path, &json)
}

#[tauri::command]
fn save_checkpoint(app: AppHandle, id: String, json: String) -> Result<(), String> {
    write_atomic(&checkpoint_path(&app, &id, true)?, &json)
}

/// Every checkpoint as (id, file contents). The page reads the metadata
/// out of the JSON itself; unreadable files are still listed so they can
/// be deleted.
#[tauri::command]
fn list_checkpoints(app: AppHandle) -> Result<Vec<(String, String)>, String> {
    let dir = sub_dir(&app, CHECKPOINTS_DIR, false)?;
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
        let id = match path.file_stem() {
            Some(stem) => stem.to_string_lossy().into_owned(),
            None => continue,
        };
        out.push((id, fs::read_to_string(&path).unwrap_or_default()));
    }
    Ok(out)
}

#[tauri::command]
fn read_checkpoint(app: AppHandle, id: String) -> Result<String, String> {
    let path = checkpoint_path(&app, &id, false)?;
    fs::read_to_string(&path).map_err(|e| format!("Could not read {}: {e}", path.display()))
}

#[tauri::command]
fn delete_checkpoint(app: AppHandle, id: String) -> Result<(), String> {
    let path = checkpoint_path(&app, &id, false)?;
    if !path.exists() {
        return Ok(());
    }
    fs::remove_file(&path).map_err(|e| format!("Could not delete {}: {e}", path.display()))
}

/// Every saved bank as (file name, contents, completed-progress JSON or "",
/// last-modified time in ms since the epoch).
#[tauri::command]
fn list_bank_details(app: AppHandle) -> Result<Vec<(String, String, String, u64)>, String> {
    let mut out = Vec::new();
    for name in list_banks(app.clone())? {
        let path = bank_path(&app, &name, false)?;
        let text = fs::read_to_string(&path).unwrap_or_default();
        let progress = unit_title_of(&text)
            .and_then(|t| read_progress(app.clone(), t).ok())
            .unwrap_or_default();
        let modified = fs::metadata(&path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        out.push((name, text, progress, modified));
    }
    Ok(out)
}

/// Rename a bank: rewrites its unit_title line, renames the file and its
/// completed-progress file, and updates checkpoints made from it.
/// Returns (new file name, new contents, warning or "").
/// Everything that could fail is checked before anything is changed, and
/// the original file is only removed once the new one is safely written.
#[tauri::command]
fn rename_bank(app: AppHandle, name: String, new_title: String) -> Result<(String, String, String), String> {
    let new_title = new_title.trim().to_string();
    if new_title.is_empty() {
        return Err("The name can't be empty.".into());
    }
    if new_title.contains('\n') || new_title.contains('\r') {
        return Err("The name has to fit on one line.".into());
    }
    let old_path = bank_path(&app, &name, false)?;
    let text = fs::read_to_string(&old_path)
        .map_err(|e| format!("Could not read {}: {e}", old_path.display()))?;
    let old_title = unit_title_of(&text).unwrap_or_default();
    let new_path = bank_path(&app, &new_title, false)?;
    let same_file = new_path == old_path;
    if !same_file && new_path.exists() {
        return Err(match fs::read_to_string(&new_path).ok().and_then(|t| unit_title_of(&t)) {
            Some(owner) if owner != new_title => format!(
                "\"{new_title}\" can't be used because the bank \"{owner}\" already uses the same file name. Pick a name that differs by more than punctuation."
            ),
            _ => format!("A bank named \"{new_title}\" already exists."),
        });
    }
    let old_progress = progress_path(&app, &old_title, false)?;
    let new_progress = progress_path(&app, &new_title, false)?;
    let move_progress = !old_title.is_empty() && old_progress != new_progress && old_progress.exists();
    if move_progress && new_progress.exists() {
        check_progress_owner(&new_progress, &new_title)?;
        return Err(format!("Completed questions for \"{new_title}\" already exist. Pick a different name."));
    }

    // 1. Write the renamed bank (the original stays until this succeeds).
    let new_text = with_unit_title(&text, &new_title);
    write_atomic(&new_path, &new_text)?;

    // 2. Move completed questions, rewriting the title stored inside.
    if move_progress {
        let moved = fs::read_to_string(&old_progress)
            .map_err(|e| format!("Could not read {}: {e}", old_progress.display()))
            .and_then(|raw| {
                let mut data: serde_json::Value = serde_json::from_str(&raw).unwrap_or(serde_json::json!({}));
                data["unitTitle"] = serde_json::Value::String(new_title.clone());
                let json = serde_json::to_string_pretty(&data).unwrap_or(raw);
                write_atomic(&new_progress, &json)
            });
        if let Err(e) = moved {
            if !same_file {
                let _ = fs::remove_file(&new_path); // roll back step 1
            }
            return Err(e);
        }
        if let Err(e) = fs::remove_file(&old_progress) {
            return Err(format!("Renamed, but the old completed-questions file couldn't be removed: {e}"));
        }
    }

    // 3. Point checkpoints made from this bank at the new title.
    let mut failed = 0;
    let cp_dir = sub_dir(&app, CHECKPOINTS_DIR, false)?;
    if !old_title.is_empty() && cp_dir.exists() {
        if let Ok(entries) = fs::read_dir(&cp_dir) {
            for path in entries.filter_map(|e| e.ok()).map(|e| e.path()) {
                if path.extension().map_or(true, |ext| ext != "json") {
                    continue;
                }
                let Ok(raw) = fs::read_to_string(&path) else { continue };
                let Ok(mut data) = serde_json::from_str::<serde_json::Value>(&raw) else { continue };
                let unit_text = data.get("unitText").and_then(|v| v.as_str()).unwrap_or("").to_string();
                if unit_title_of(&unit_text).as_deref() != Some(old_title.as_str()) {
                    continue;
                }
                data["unitText"] = serde_json::Value::String(with_unit_title(&unit_text, &new_title));
                data["unitTitle"] = serde_json::Value::String(new_title.clone());
                let ok = serde_json::to_string_pretty(&data)
                    .map_err(|e| e.to_string())
                    .and_then(|json| write_atomic(&path, &json));
                if ok.is_err() {
                    failed += 1;
                }
            }
        }
    }

    // 4. Remove the original file last.
    if !same_file {
        fs::remove_file(&old_path)
            .map_err(|e| format!("Renamed, but the old file {} couldn't be removed: {e}", old_path.display()))?;
    }

    let warning = if failed > 0 {
        format!("Renamed, but {failed} checkpoint(s) couldn't be updated and still use the old name.")
    } else {
        String::new()
    };
    let file_name = new_path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok((file_name, new_text, warning))
}

/// Delete a bank and its completed-question progress. Checkpoints stay.
#[tauri::command]
fn delete_bank(app: AppHandle, name: String) -> Result<(), String> {
    let path = bank_path(&app, &name, false)?;
    if let Some(title) = fs::read_to_string(&path).ok().and_then(|t| unit_title_of(&t)) {
        let progress = progress_path(&app, &title, false)?;
        let belongs = fs::read_to_string(&progress)
            .ok()
            .map_or(false, |json| progress_owner(&json).map_or(true, |owner| owner == title));
        if belongs {
            fs::remove_file(&progress)
                .map_err(|e| format!("Could not delete {}: {e}", progress.display()))?;
        }
    }
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Could not delete {}: {e}", path.display()))?;
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            data_folder,
            quit_app,
            read_dropped_file,
            save_download,
            save_bank,
            list_banks,
            read_bank,
            read_progress,
            write_progress,
            save_checkpoint,
            list_checkpoints,
            read_checkpoint,
            delete_checkpoint,
            list_bank_details,
            rename_bank,
            delete_bank
        ])
        .run(tauri::generate_context!())
        .expect("error while running Study Website");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn title_helpers_crlf() {
        let text = "\r\nunit_title: Old; 2026\r\n\r\nquestion: a: b\r\nanswer: c\r\n";
        assert_eq!(unit_title_of(text).as_deref(), Some("Old; 2026"));
        let renamed = with_unit_title(text, "New: Topic; Jan 2026");
        assert_eq!(unit_title_of(&renamed).as_deref(), Some("New: Topic; Jan 2026"));
        assert!(renamed.contains("question: a: b\n"));
        assert!(renamed.contains("answer: c\n"));
    }

    // Report finding: renaming a file with bare-\r line endings replaced
    // the whole file with the title.
    #[test]
    fn rename_keeps_questions_with_cr_only_endings() {
        let text = "unit_title: Old\r\rquestion: What is 2 + 2?\ranswer: 4\r";
        assert_eq!(unit_title_of(text).as_deref(), Some("Old"));
        let renamed = with_unit_title(text, "New");
        assert_eq!(renamed, "unit_title: New\n\nquestion: What is 2 + 2?\nanswer: 4\n");
    }

    // Report finding: different titles can share a file name.
    #[test]
    fn colliding_titles_are_detected() {
        assert_eq!(safe_stem("Week: 1"), safe_stem("Week? 1"));
        let dir = std::env::temp_dir().join(format!("sw-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let bank = dir.join("Week_ 1.txt");
        fs::write(&bank, "unit_title: Week: 1\n").unwrap();
        assert!(check_bank_owner(&bank, "Week: 1").is_ok());
        assert!(check_bank_owner(&bank, "Week? 1").is_err());
        let progress = dir.join("Week_ 1.json");
        fs::write(&progress, r#"{"unitTitle":"Week: 1","completed":[]}"#).unwrap();
        assert!(check_progress_owner(&progress, "Week: 1").is_ok());
        assert!(check_progress_owner(&progress, "Week? 1").is_err());
        fs::remove_dir_all(&dir).unwrap();
    }

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
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn atomic_write_replaces_and_leaves_no_temp() {
        let dir = std::env::temp_dir().join(format!("sw-atomic-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("Cell Bio v1.2.txt");
        write_atomic(&file, "one").unwrap();
        write_atomic(&file, "two").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "two");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        fs::remove_dir_all(&dir).unwrap();
    }
}
