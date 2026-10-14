// Study Website desktop shell.
//
// The app itself is the page in ../src (built from ../app by tools/build.js).
// This file only wires up the window and the commands the page calls (the
// file commands are async, so Tauri runs them off the main thread and a
// slow disk never freezes the window); the
// work is done in the modules below:
//
//   files.rs   safe file names, size-limited reads, atomic writes
//   titles.rs  reading and rewriting a bank's unit_title line
//   store.rs   everything under ~/Documents/StudyWebsite (banks, bank IDs,
//              progress, checkpoints, rename and delete)
//   drops.rs   which paths were really dropped on the window

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod drops;
mod files;
mod images;
mod store;
mod titles;

use drops::Drops;
use files::{read_unit_file, read_zip_file, write_new_in};
use std::fs;
use std::path::Path;
use std::time::Duration;
use store::Store;
use tauri::{AppHandle, Emitter, Manager, State};

const ROOT_DIR: &str = "StudyWebsite";

/// The file commands run on worker threads now, so two could run at once.
/// Each holds this while it works, so they still happen one after another
/// (a rename never runs halfway through a save).
static STORE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

async fn with_store<T: Send + 'static>(
    app: &AppHandle,
    f: impl FnOnce(&Store) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let store = store(app)?;
    let app = app.clone();
    // Blocking file work goes to the blocking pool, not an async worker.
    tauri::async_runtime::spawn_blocking(move || {
        startup(&app);
        // Another copy of the app has the data folder: touch nothing.
        if let Some(Err(e)) = DATA_LOCK.get() {
            return Err(e.clone());
        }
        let _guard = STORE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        f(&store)
    })
    .await
    .map_err(|e| format!("The file operation stopped unexpectedly: {e}"))?
}

/// ~/Documents/StudyWebsite (falls back to ~/Documents if the XDG
/// documents dir isn't configured).
fn store(app: &AppHandle) -> Result<Store, String> {
    let docs = app
        .path()
        .document_dir()
        .or_else(|_| app.path().home_dir().map(|h| h.join("Documents")))
        .map_err(|e| format!("Could not find your Documents folder: {e}"))?;
    Ok(Store::new(docs.join(ROOT_DIR)))
}

/// Start-up work on the data folder, done once before anything else reads
/// it: undo a rename that didn't finish, and remove unused pictures. Every
/// store command and the page's notice request wait for it. Holds the
/// message for the page, if there is one.
static STARTUP: std::sync::OnceLock<std::sync::Mutex<Option<String>>> = std::sync::OnceLock::new();
/// The data folder's lock, held until the app exits (see store::lock_data_folder).
/// Err when another copy of the app holds it.
static DATA_LOCK: std::sync::OnceLock<Result<Option<std::fs::File>, String>> = std::sync::OnceLock::new();
fn startup(app: &AppHandle) -> &'static std::sync::Mutex<Option<String>> {
    STARTUP.get_or_init(|| {
        let note = store(app).ok().and_then(|s| {
            // First the folder's lock: the single-instance check works through
            // the desktop session and could miss a copy; this can't. Without
            // it, a second copy could "undo" a rename the first is making.
            let lock = DATA_LOCK.get_or_init(|| store::lock_data_folder(s.root()));
            if let Err(e) = lock {
                return Some(e.clone());
            }
            let _guard = STORE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            let note = s.recover_rename();
            s.collect_images();
            note
        });
        std::sync::Mutex::new(note)
    })
}

/// The start-up message, once.
#[tauri::command]
async fn take_startup_notice(app: AppHandle) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || startup(&app).lock().ok().and_then(|mut n| n.take()))
        .await
        .ok()
        .flatten()
}

/// Plain file work (not the store) on the blocking pool too, so a slow
/// drive doesn't hold up an async worker.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("The file operation stopped unexpectedly: {e}"))?
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

/* ------------------------------ commands ------------------------------ */

#[tauri::command]
fn data_folder(app: AppHandle) -> Result<String, String> {
    Ok(pretty_path(&app, store(&app)?.root()))
}

/// Close the app (the window is fullscreen, so there's no title bar).
/// Progress saved after each answer isn't synced to the disk straight away
/// (store::write_progress); it is here, before the app closes.
///
/// If that fails, the app stays open and says why (the page offers to try
/// again, or to quit anyway with `force`).
#[tauri::command]
async fn quit_app(app: AppHandle, force: Option<bool>) -> Result<(), String> {
    if let Err(e) = final_sync(&app).await {
        if !force.unwrap_or(false) {
            return Err(e);
        }
    }
    app.exit(0);
    Ok(())
}

/// The same final sync, for a window closed by the desktop (Alt+F4, Cmd+Q):
/// the page asks before letting the close go ahead.
#[tauri::command]
async fn finish_saves(app: AppHandle) -> Result<(), String> {
    final_sync(&app).await
}

/// Through the store lock, so a save that's still being written finishes
/// first. With no data folder, or another copy holding it, this copy saved
/// nothing, so there's nothing to sync (and quitting must still work).
async fn final_sync(app: &AppHandle) -> Result<(), String> {
    if store(app).is_err() || matches!(DATA_LOCK.get(), Some(Err(_))) {
        return Ok(());
    }
    with_store(app, |s| s.sync_progress()).await
}

/// Read a file the user dropped on the window. Native drag-and-drop gives
/// the page a path rather than the file, so the page asks for it here, and
/// only paths from a real drop in the last two minutes are allowed.
#[tauri::command]
async fn read_dropped_file(drops: State<'_, Drops>, path: String) -> Result<String, String> {
    let path = Path::new(&path);
    // The page hears about a drop at about the same time we do; give the
    // native handler a moment to record it.
    let mut tries = 0;
    while !drops.allows(path) && tries < 20 {
        tokio::time::sleep(Duration::from_millis(25)).await;
        tries += 1;
    }
    if !drops.allows(path) {
        return Err("That file wasn't dropped on the window. Drag it in again, or use Select file.".into());
    }
    let path = path.to_path_buf();
    blocking(move || read_unit_file(&path)).await
}

/// The bytes of a dropped .zip bank (same drop check as above). Sent as raw
/// bytes, which the page receives as an ArrayBuffer.
#[tauri::command]
async fn read_dropped_zip(drops: State<'_, Drops>, path: String) -> Result<tauri::ipc::Response, String> {
    let path = Path::new(&path);
    let mut tries = 0;
    while !drops.allows(path) && tries < 20 {
        tokio::time::sleep(Duration::from_millis(25)).await;
        tries += 1;
    }
    if !drops.allows(path) {
        return Err("That file wasn't dropped on the window. Drag it in again, or use Select file.".into());
    }
    let path = path.to_path_buf();
    blocking(move || read_zip_file(&path)).await.map(tauri::ipc::Response::new)
}

/// "Download" a text file (used for the documentation): the desktop window
/// can't do browser downloads, so write it to Downloads, never over an
/// existing file.
#[tauri::command]
async fn save_download(app: AppHandle, name: String, text: String) -> Result<String, String> {
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
    let path = blocking(move || write_new_in(&dir, &file, &text)).await?;
    Ok(pretty_path(&app, &path))
}

/// A picture from the picture folder (see images.rs), as raw bytes.
#[tauri::command]
async fn read_image(app: AppHandle, name: String) -> Result<tauri::ipc::Response, String> {
    let root = store(&app)?.root().to_path_buf();
    blocking(move || {
        startup(&app);
        images::read(&root, &name)
    })
    .await
    .map(tauri::ipc::Response::new)
}

#[tauri::command]
async fn save_bank(app: AppHandle, name: String, text: String) -> Result<String, String> {
    let path = with_store(&app, move |s| s.save_bank(&name, &text)).await?;
    Ok(pretty_path(&app, &path))
}

#[tauri::command]
async fn list_banks(app: AppHandle) -> Result<Vec<String>, String> {
    with_store(&app, move |s| s.list_banks()).await
}

#[tauri::command]
async fn read_bank(app: AppHandle, name: String) -> Result<String, String> {
    with_store(&app, move |s| s.read_bank(&name)).await
}

#[tauri::command]
async fn read_progress(app: AppHandle, name: String) -> Result<String, String> {
    with_store(&app, move |s| s.read_progress(&name)).await
}

#[tauri::command]
async fn write_progress(app: AppHandle, name: String, json: String) -> Result<String, String> {
    with_store(&app, move |s| s.write_progress(&name, &json)).await
}

#[tauri::command]
async fn save_checkpoint(app: AppHandle, id: String, json: String) -> Result<(), String> {
    with_store(&app, move |s| s.save_checkpoint(&id, &json)).await
}

#[tauri::command]
async fn list_checkpoints(app: AppHandle) -> Result<Vec<(String, String)>, String> {
    with_store(&app, move |s| s.list_checkpoints()).await
}

#[tauri::command]
async fn list_checkpoint_meta(app: AppHandle) -> Result<Vec<(String, u64, u64)>, String> {
    with_store(&app, move |s| s.list_checkpoint_meta()).await
}

#[tauri::command]
async fn read_checkpoint(app: AppHandle, id: String) -> Result<String, String> {
    with_store(&app, move |s| s.read_checkpoint(&id)).await
}

#[tauri::command]
async fn delete_checkpoint(app: AppHandle, id: String) -> Result<(), String> {
    with_store(&app, move |s| s.delete_checkpoint(&id)).await
}

#[tauri::command]
async fn list_bank_details(app: AppHandle) -> Result<Vec<(String, String, String, u64)>, String> {
    with_store(&app, move |s| s.list_bank_details()).await
}

#[tauri::command]
async fn read_banks(app: AppHandle, names: Vec<String>) -> Result<Vec<(String, String, String)>, String> {
    with_store(&app, move |s| s.read_banks(&names)).await
}

#[tauri::command]
async fn list_bank_meta(app: AppHandle) -> Result<Vec<(String, u64, u64, u64, u64)>, String> {
    with_store(&app, move |s| s.list_bank_meta()).await
}

#[tauri::command]
async fn rename_bank(app: AppHandle, name: String, new_title: String) -> Result<(String, String, String), String> {
    with_store(&app, move |s| s.rename_bank(&name, &new_title)).await
}

#[tauri::command]
async fn delete_bank(app: AppHandle, name: String) -> Result<(bool, String), String> {
    with_store(&app, move |s| s.delete_bank(&name)).await
}

fn main() {
    tauri::Builder::default()
        // One copy of the app at a time, so two windows can't save over each
        // other's progress. Starting it again closes the new copy and brings
        // this window forward, where the page explains what happened.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
            }
            let _ = app.emit("second-instance", ());
        }))
        .manage(Drops::default())
        // Start the data-folder check right away (see startup).
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                startup(&handle);
            });
            Ok(())
        })
        .on_webview_event(|webview, event| {
            if let tauri::WebviewEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                webview.state::<Drops>().record(paths);
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                window.state::<Drops>().record(paths);
            }
        })
        .invoke_handler(tauri::generate_handler![
            data_folder,
            take_startup_notice,
            quit_app,
            finish_saves,
            read_dropped_file,
            read_dropped_zip,
            save_download,
            save_bank,
            list_banks,
            read_bank,
            read_image,
            read_progress,
            write_progress,
            save_checkpoint,
            list_checkpoints,
            list_checkpoint_meta,
            read_checkpoint,
            delete_checkpoint,
            list_bank_details,
            list_bank_meta,
            read_banks,
            rename_bank,
            delete_bank
        ])
        .build(tauri::generate_context!())
        .expect("error while running Study Website")
        .run(|app, event| {
            // However the app closes (Quit, Alt+F4, Cmd+Q, logging out), the
            // last progress saves are made permanent first.
            if let tauri::RunEvent::Exit = event {
                if let Ok(s) = store(app) {
                    let _guard = STORE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
                    // Nothing can be shown any more; the page already asked
                    // (finish_saves, quit_app), so this is a last try.
                    if let Err(e) = s.sync_progress() {
                        eprintln!("{e}");
                    }
                }
            }
        });
}
