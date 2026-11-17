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

/// Resolve `source` e a pasta de destino, garantindo que a pasta não seja o
/// próprio item nem um descendente dele.
fn resolve_pair(project: &ProjectState, path: &str, dest_dir: &str) -> Result<(PathBuf, PathBuf), String> {
    let source = project.resolve_inside(path)?;
    if source == project.root()? {
        return Err("não é possível mover ou copiar a raiz do projeto".into());
    }
    let dest = project.resolve_inside(dest_dir)?;
    if !dest.is_dir() {
        return Err("o destino não é uma pasta".into());
    }
    if source.is_dir() && dest.starts_with(&source) {
        return Err("não é possível colocar uma pasta dentro dela mesma".into());
    }
    Ok((source, dest))
}

/// Move um arquivo ou pasta para `dest_dir`. Retorna o novo caminho.
#[tauri::command]
pub fn fs_move(project: State<'_, ProjectState>, path: String, dest_dir: String) -> Result<String, String> {
    let (source, dest) = resolve_pair(&project, &path, &dest_dir)?;
    let name = source.file_name().ok_or("caminho sem nome")?;
    let target = dest.join(name);
    if target == source {
        return Ok(path_to_string(&source));
    }
    if target.exists() {
        return Err(format!("já existe em {}: {}", dest.display(), name.to_string_lossy()));
    }
    if std::fs::rename(&source, &target).is_err() {
        // rename falha entre volumes diferentes: copia e remove a origem.
        copy_recursive(&source, &target)?;
        if source.is_dir() { std::fs::remove_dir_all(&source) } else { std::fs::remove_file(&source) }
            .map_err(|e| e.to_string())?;
    }
    Ok(path_to_string(&target))
}

/// Copia um arquivo ou pasta para `dest_dir`; se o nome já existir, usa
/// "nome copia", "nome copia 2"… Retorna o novo caminho.
#[tauri::command]
pub fn fs_copy(project: State<'_, ProjectState>, path: String, dest_dir: String) -> Result<String, String> {
    let (source, dest) = resolve_pair(&project, &path, &dest_dir)?;
    let name = source.file_name().ok_or("caminho sem nome")?.to_string_lossy().to_string();
    let mut target = dest.join(&name);
    if target.exists() {
        let (stem, ext) = match name.rfind('.') {
            Some(i) if i > 0 && source.is_file() => (&name[..i], &name[i..]),
            _ => (name.as_str(), ""),
        };
        let mut n = 1;
        loop {
            let suffix = if n == 1 { " copia".to_string() } else { format!(" copia {n}") };
            target = dest.join(format!("{stem}{suffix}{ext}"));
            if !target.exists() {
                break;
            }
            n += 1;
        }
    }
    copy_recursive(&source, &target)?;
    Ok(path_to_string(&target))
}

fn copy_recursive(from: &Path, to: &Path) -> Result<(), String> {
    if from.is_dir() {
        std::fs::create_dir_all(to).map_err(|e| e.to_string())?;
        for entry in std::fs::read_dir(from).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            copy_recursive(&entry.path(), &to.join(entry.file_name()))?;
        }
    } else {
        std::fs::copy(from, to).map_err(|e| e.to_string())?;
    }
    Ok(())
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

/// Formata `content` como o arquivo `path` (gofmt, rustfmt, Prettier ou fixer de
/// PHP). Não grava nada: devolve o texto formatado e o editor decide aplicar.
#[tauri::command]
pub async fn fs_format(project: State<'_, ProjectState>, path: String, content: String) -> Result<String, String> {
    let file = project.resolve_inside(&path)?;
    let root = project.root()?;
    tauri::async_runtime::spawn_blocking(move || crate::formatter::format(&root, &file, &content))
        .await
        .map_err(|e| e.to_string())?
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
