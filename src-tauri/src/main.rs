// Study Website desktop shell.
// The whole app lives in ../src/index.html; this file only adds a few
// commands that read and write ~/Documents/StudyWebsite:
//
//   StudyWebsite/
//     banks/<unit title>.txt      copies of question banks
//     progress/<unit title>.json  completed-question lists (quiz mode)
//     checkpoints/<id>.json       saved quiz/exam sessions ("Save progress")

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const ROOT_DIR: &str = "StudyWebsite";
const BANKS_DIR: &str = "banks";
const PROGRESS_DIR: &str = "progress";
const CHECKPOINTS_DIR: &str = "checkpoints";

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

#[tauri::command]
fn data_folder(app: AppHandle) -> Result<String, String> {
    Ok(root_dir(&app)?.display().to_string())
}

#[tauri::command]
fn save_bank(app: AppHandle, name: String, text: String) -> Result<String, String> {
    let dir = sub_dir(&app, BANKS_DIR, true)?;
    sub_dir(&app, PROGRESS_DIR, true)?;
    let path = dir.join(format!("{}.txt", safe_stem(&name)));
    fs::write(&path, text).map_err(|e| format!("Could not write {}: {e}", path.display()))?;
    Ok(path.display().to_string())
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
    let path = sub_dir(&app, BANKS_DIR, false)?.join(format!("{}.txt", safe_stem(&name)));
    fs::read_to_string(&path).map_err(|e| format!("Could not read {}: {e}", path.display()))
}

/// Returns the saved progress JSON, or an empty string if none exists yet.
#[tauri::command]
fn read_progress(app: AppHandle, name: String) -> Result<String, String> {
    let path = sub_dir(&app, PROGRESS_DIR, false)?.join(format!("{}.json", safe_stem(&name)));
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| format!("Could not read {}: {e}", path.display()))
}

#[tauri::command]
fn write_progress(app: AppHandle, name: String, json: String) -> Result<(), String> {
    let path = sub_dir(&app, PROGRESS_DIR, true)?.join(format!("{}.json", safe_stem(&name)));
    write_atomic(&path, json)
}

/// Write through a temp file + rename so a crash can't leave half a file.
fn write_atomic(path: &PathBuf, contents: String) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, contents).map_err(|e| format!("Could not write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| format!("Could not save {}: {e}", path.display()))
}

fn checkpoint_path(app: &AppHandle, id: &str, create: bool) -> Result<PathBuf, String> {
    Ok(sub_dir(app, CHECKPOINTS_DIR, create)?.join(format!("{}.json", safe_stem(id))))
}

#[tauri::command]
fn save_checkpoint(app: AppHandle, id: String, json: String) -> Result<(), String> {
    write_atomic(&checkpoint_path(&app, &id, true)?, json)
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

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            data_folder,
            save_bank,
            list_banks,
            read_bank,
            read_progress,
            write_progress,
            save_checkpoint,
            list_checkpoints,
            read_checkpoint,
            delete_checkpoint
        ])
        .run(tauri::generate_context!())
        .expect("error while running Study Website");
}
