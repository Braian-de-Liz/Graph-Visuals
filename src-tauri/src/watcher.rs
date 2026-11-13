//! File Watcher do projeto ativo (notify + debounce).
//!
//! Eventos são agrupados pelo debouncer e enviados ao frontend como
//! `fs://changed`. Caminhos que contenham um componente da lista de exclusão
//! são descartados.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use notify_debouncer_full::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::project::{path_to_string, ProjectState};

const DEBOUNCE: Duration = Duration::from_millis(300);

#[derive(Default)]
pub struct WatcherState(Mutex<Option<Debouncer<RecommendedWatcher, RecommendedCache>>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FsChanged {
    paths: Vec<String>,
    /// O SO perdeu eventos; o frontend deve reconciliar tudo.
    rescan: bool,
}

fn is_excluded(path: &Path, root: &Path, excludes: &[String]) -> bool {
    let rel = path.strip_prefix(root).unwrap_or(path);
    rel.components().any(|c| {
        let name = c.as_os_str().to_string_lossy();
        excludes.iter().any(|ex| ex == name.as_ref())
    })
}

#[tauri::command]
pub fn watch_start(
    app: AppHandle,
    project: State<'_, ProjectState>,
    watcher: State<'_, WatcherState>,
    excludes: Vec<String>,
) -> Result<(), String> {
    let root: PathBuf = project.root()?;
    let root_for_handler = root.clone();

    let mut debouncer = new_debouncer(DEBOUNCE, None, move |result: DebounceEventResult| {
        let mut payload = FsChanged { paths: Vec::new(), rescan: false };
        match result {
            Ok(events) => {
                for event in events {
                    if event.need_rescan() {
                        payload.rescan = true;
                    }
                    for p in &event.paths {
                        if !is_excluded(p, &root_for_handler, &excludes) {
                            let s = path_to_string(p);
                            if !payload.paths.contains(&s) {
                                payload.paths.push(s);
                            }
                        }
                    }
                }
            }
            Err(_) => payload.rescan = true,
        }
        if payload.rescan || !payload.paths.is_empty() {
            let _ = app.emit("fs://changed", payload);
        }
    })
    .map_err(|e| e.to_string())?;

    debouncer
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    // Substituir o watcher anterior o encerra (Drop).
    *watcher.0.lock().unwrap() = Some(debouncer);
    Ok(())
}

#[tauri::command]
pub fn watch_stop(watcher: State<'_, WatcherState>) {
    *watcher.0.lock().unwrap() = None;
}
