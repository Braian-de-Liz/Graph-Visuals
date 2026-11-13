//! Projeto ativo e controle de acesso a caminhos.
//!
//! Toda operação de arquivo passa por `ProjectState::resolve_inside`, que
//! garante que o caminho pedido pelo frontend está dentro do projeto aberto.

use std::path::{Path, PathBuf};
use std::sync::RwLock;

#[derive(Default)]
pub struct ProjectState {
    root: RwLock<Option<PathBuf>>,
}

impl ProjectState {
    pub fn root(&self) -> Result<PathBuf, String> {
        self.root
            .read()
            .unwrap()
            .clone()
            .ok_or_else(|| "nenhum projeto aberto".to_string())
    }

    /// Canonicaliza `path` e verifica que ele está dentro do projeto ativo.
    pub fn resolve_inside(&self, path: &str) -> Result<PathBuf, String> {
        let root = self.root()?;
        let canonical = dunce::canonicalize(path).map_err(|e| format!("{path}: {e}"))?;
        if canonical.starts_with(&root) {
            Ok(canonical)
        } else {
            Err(format!("acesso negado fora do projeto: {}", canonical.display()))
        }
    }
}

pub fn path_to_string(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// Define o diretório do projeto ativo. Retorna o caminho canônico.
#[tauri::command]
pub fn project_open(state: tauri::State<'_, ProjectState>, path: String) -> Result<String, String> {
    let canonical = dunce::canonicalize(&path).map_err(|e| format!("{path}: {e}"))?;
    if !canonical.is_dir() {
        return Err(format!("não é um diretório: {}", canonical.display()));
    }
    *state.root.write().unwrap() = Some(canonical.clone());
    Ok(path_to_string(&canonical))
}

#[tauri::command]
pub fn project_current(state: tauri::State<'_, ProjectState>) -> Option<String> {
    state.root.read().unwrap().as_deref().map(path_to_string)
}
