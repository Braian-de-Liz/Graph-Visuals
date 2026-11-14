//! Operações do menu de contexto do explorador: criar, renomear, excluir
//! (para a Lixeira) e revelar no gerenciador de arquivos do sistema.
//!
//! Os caminhos de origem passam por `ProjectState::resolve_inside`. Nomes novos
//! são validados componente a componente (sem `..`, raiz ou caracteres
//! inválidos), então o destino continua dentro do projeto.

use std::path::{Component, Path, PathBuf};

use tauri::State;

use crate::project::{path_to_string, ProjectState};

/// Valida um único nome de arquivo/pasta (regras do Windows, que são as mais restritas).
fn valid_component(name: &str) -> Result<(), String> {
    let bad = |m: &str| Err(format!("nome inválido: {m}"));
    if name.is_empty() || name == "." || name == ".." {
        return bad("vazio ou reservado");
    }
    if name.chars().any(|c| c.is_control() || "<>:\"/\\|?*".contains(c)) {
        return bad("contém caracteres não permitidos (< > : \" / \\ | ? *)");
    }
    if name.ends_with(' ') || name.ends_with('.') {
        return bad("não pode terminar com espaço ou ponto");
    }
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = ["CON", "PRN", "AUX", "NUL"];
    let numbered = (stem.starts_with("COM") || stem.starts_with("LPT")) && stem.len() == 4 && stem.as_bytes()[3].is_ascii_digit();
    if reserved.contains(&stem.as_str()) || numbered {
        return bad("nome reservado pelo Windows");
    }
    Ok(())
}

/// Converte "a/b/c.ts" em um caminho relativo seguro (cada parte validada).
fn safe_relative(name: &str) -> Result<PathBuf, String> {
    let mut out = PathBuf::new();
    for part in name.split(['/', '\\']).filter(|p| !p.is_empty()) {
        valid_component(part)?;
        out.push(part);
    }
    if out.as_os_str().is_empty() {
        return Err("nome vazio".into());
    }
    // Defesa extra: nenhum componente especial pode sobrar.
    if out.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err("nome inválido".into());
    }
    Ok(out)
}

/// Cria um arquivo vazio ou uma pasta dentro de `parent`. Aceita subpastas
/// ("a/b/c.ts"), como o VS Code. Retorna o caminho criado.
#[tauri::command]
pub fn fs_create(project: State<'_, ProjectState>, parent: String, name: String, is_dir: bool) -> Result<String, String> {
    let parent = project.resolve_inside(&parent)?;
    if !parent.is_dir() {
        return Err("o destino não é uma pasta".into());
    }
    let target = parent.join(safe_relative(&name)?);
    if target.exists() {
        return Err(format!("já existe: {}", target.display()));
    }
    if is_dir {
        std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    } else {
        if let Some(dir) = target.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
            .map_err(|e| e.to_string())?;
    }
    Ok(path_to_string(&target))
}

/// Renomeia um arquivo ou pasta na mesma pasta. Retorna o novo caminho.
#[tauri::command]
pub fn fs_rename(project: State<'_, ProjectState>, path: String, new_name: String) -> Result<String, String> {
    let source = project.resolve_inside(&path)?;
    if source == project.root()? {
        return Err("não é possível renomear a raiz do projeto".into());
    }
    valid_component(&new_name)?;
    let target = source.parent().ok_or("caminho sem pasta")?.join(&new_name);
    let same_ignoring_case = path_to_string(&target).to_lowercase() == path_to_string(&source).to_lowercase();
    if target.exists() && !same_ignoring_case {
        return Err(format!("já existe: {new_name}"));
    }
    std::fs::rename(&source, &target).map_err(|e| e.to_string())?;
    Ok(path_to_string(&target))
}

/// Move um arquivo ou pasta para a Lixeira (recuperável), como o VS Code.
#[tauri::command]
pub fn fs_delete(project: State<'_, ProjectState>, path: String) -> Result<(), String> {
    let target = project.resolve_inside(&path)?;
    if target == project.root()? {
        return Err("não é possível excluir a raiz do projeto".into());
    }
    trash::delete(&target).map_err(|e| e.to_string())
}

/// Abre o gerenciador de arquivos do sistema com o item selecionado.
#[tauri::command]
pub fn reveal_in_os(project: State<'_, ProjectState>, path: String) -> Result<(), String> {
    let target = project.resolve_inside(&path)?;
    reveal(&target)
}

#[cfg(windows)]
fn reveal(target: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    // `/select,` precisa vir colado ao caminho; raw_arg evita aspas extras do Rust.
    std::process::Command::new("explorer.exe")
        .raw_arg(format!("/select,\"{}\"", target.display()))
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn reveal(target: &Path) -> Result<(), String> {
    std::process::Command::new("open").arg("-R").arg(target).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn reveal(target: &Path) -> Result<(), String> {
    let dir = if target.is_dir() { target } else { target.parent().unwrap_or(target) };
    std::process::Command::new("xdg-open").arg(dir).spawn().map(|_| ()).map_err(|e| e.to_string())
}
