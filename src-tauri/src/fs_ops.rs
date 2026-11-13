//! Leitura, gravação e indexação de arquivos do projeto ativo.
//!
//! Todo caminho recebido do frontend passa por `ProjectState::resolve_inside`.

use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::State;

use crate::project::{path_to_string, ProjectState};

/// Arquivos maiores que isso não são abertos como texto.
const MAX_TEXT_BYTES: u64 = 5 * 1024 * 1024;
/// Limite de entradas do índice usado pela pesquisa (Ctrl + P).
const MAX_INDEX_ENTRIES: usize = 200_000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
}

#[tauri::command]
pub fn fs_list_dir(project: State<'_, ProjectState>, path: String) -> Result<Vec<DirEntry>, String> {
    let dir = project.resolve_inside(&path)?;
    let mut entries: Vec<DirEntry> = std::fs::read_dir(&dir)
        .map_err(|e| format!("{}: {e}", dir.display()))?
        .filter_map(Result::ok)
        .map(|entry| {
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            DirEntry {
                name: entry.file_name().to_string_lossy().into_owned(),
                path: path_to_string(&entry.path()),
                is_dir,
            }
        })
        .collect();
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

fn mtime_ms(path: &Path) -> Result<u64, String> {
    let modified = std::fs::metadata(path)
        .and_then(|m| m.modified())
        .map_err(|e| e.to_string())?;
    Ok(modified.duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFile {
    content: String,
    /// Última modificação (ms desde a época), usada para detectar conflitos.
    mtime: u64,
    /// O arquivo continha bytes que não são UTF-8 válidos.
    lossy: bool,
}

#[tauri::command]
pub fn fs_read_text(project: State<'_, ProjectState>, path: String) -> Result<TextFile, String> {
    let file = project.resolve_inside(&path)?;
    let meta = std::fs::metadata(&file).map_err(|e| e.to_string())?;
    if meta.is_dir() {
        return Err("é um diretório".into());
    }
    if meta.len() > MAX_TEXT_BYTES {
        return Err(format!("arquivo grande demais ({} bytes)", meta.len()));
    }
    let bytes = std::fs::read(&file).map_err(|e| e.to_string())?;
    let mtime = mtime_ms(&file)?;
    match String::from_utf8(bytes) {
        Ok(content) => Ok(TextFile { content, mtime, lossy: false }),
        Err(e) => Ok(TextFile {
            content: String::from_utf8_lossy(e.as_bytes()).into_owned(),
            mtime,
            lossy: true,
        }),
    }
}

#[tauri::command]
pub fn fs_stat_mtime(project: State<'_, ProjectState>, path: String) -> Result<u64, String> {
    let file = project.resolve_inside(&path)?;
    mtime_ms(&file)
}

/// Grava um arquivo existente do projeto.
///
/// Se `expected_mtime` for informado e o arquivo tiver sido alterado no disco
/// desde então, a gravação é recusada com o erro `"conflict"`; o frontend
/// decide (com o usuário) se sobrescreve chamando novamente sem `expected_mtime`.
#[tauri::command]
pub fn fs_write_text(
    project: State<'_, ProjectState>,
    path: String,
    content: String,
    expected_mtime: Option<u64>,
) -> Result<u64, String> {
    let file = project.resolve_inside(&path)?;
    if file.is_dir() {
        return Err("é um diretório".into());
    }
    if let Some(expected) = expected_mtime {
        if mtime_ms(&file)? != expected {
            return Err("conflict".into());
        }
    }
    std::fs::write(&file, content.as_bytes()).map_err(|e| e.to_string())?;
    mtime_ms(&file)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexEntry {
    /// Caminho relativo ao projeto, com `/`.
    rel: String,
    is_dir: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileIndex {
    entries: Vec<IndexEntry>,
    truncated: bool,
}

/// Lista recursivamente arquivos e diretórios do projeto (sem seguir links),
/// ignorando diretórios cujo nome esteja em `excludes`. Alimenta a pesquisa.
#[tauri::command]
pub async fn fs_index(project: State<'_, ProjectState>, excludes: Vec<String>) -> Result<FileIndex, String> {
    let root = project.root()?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut entries = Vec::new();
        let mut stack = vec![root.clone()];
        let mut truncated = false;
        'walk: while let Some(dir) = stack.pop() {
            let Ok(read) = std::fs::read_dir(&dir) else { continue };
            for entry in read.filter_map(Result::ok) {
                let Ok(ft) = entry.file_type() else { continue };
                if ft.is_symlink() {
                    continue;
                }
                let name = entry.file_name().to_string_lossy().into_owned();
                let is_dir = ft.is_dir();
                if is_dir && excludes.iter().any(|ex| *ex == name) {
                    continue;
                }
                let path = entry.path();
                let rel = path
                    .strip_prefix(&root)
                    .map(|p| p.to_string_lossy().replace('\\', "/"))
                    .unwrap_or(name);
                entries.push(IndexEntry { rel, is_dir });
                if entries.len() >= MAX_INDEX_ENTRIES {
                    truncated = true;
                    break 'walk;
                }
                if is_dir {
                    stack.push(path);
                }
            }
        }
        Ok(FileIndex { entries, truncated })
    })
    .await
    .map_err(|e| e.to_string())?
}
