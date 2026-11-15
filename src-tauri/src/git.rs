//! Integração mínima com o Git do projeto ativo, via CLI `git`.
//!
//! Expõe o status da working tree (alterações até o próximo commit), a lista
//! de branches e a troca/criação de branch. Os argumentos nunca passam por um
//! shell; nomes de branch são validados antes de chegar ao `git`.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use tauri::State;

use crate::project::ProjectState;

fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    let exe = which::which("git").map_err(|_| "git não encontrado no PATH".to_string())?;
    let mut cmd = Command::new(exe);
    cmd.args(["-c", "core.quotepath=false"])
        .args(args)
        .current_dir(root)
        // Evita que `git status` grave o índice (e dispare o watcher em loop).
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = cmd.output().map_err(|e| format!("falha ao executar git: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(if err.is_empty() { format!("git saiu com {}", out.status) } else { err })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChange {
    /// Caminho relativo à raiz do projeto, com `/`.
    rel: String,
    /// M modificado, A adicionado, D excluído, R renomeado, U não rastreado, C conflito.
    status: char,
    /// Alteração já está no índice (staged).
    staged: bool,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    is_repo: bool,
    /// Branch atual; vazio em HEAD destacado.
    branch: String,
    /// Commit curto quando o HEAD está destacado.
    detached: Option<String>,
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    changes: Vec<GitChange>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranch {
    /// Nome curto (`main`, `origin/main`).
    name: String,
    remote: bool,
    current: bool,
    upstream: Option<String>,
}

fn classify(x: char, y: char) -> (char, bool) {
    match (x, y) {
        ('?', '?') => ('U', false),
        ('U', _) | (_, 'U') | ('A', 'A') | ('D', 'D') => ('C', false),
        _ => {
            let staged = x != ' ';
            let c = if y != ' ' { y } else { x };
            let status = match c {
                'A' => 'A',
                'D' => 'D',
                'R' | 'C' => 'R',
                _ => 'M',
            };
            (status, staged)
        }
    }
}

/// Lê "## main...origin/main [ahead 1, behind 2]".
fn parse_branch_line(line: &str, st: &mut GitStatus) {
    let line = line.trim_start_matches("## ");
    let (head, track) = match line.find(" [") {
        Some(i) => (&line[..i], &line[i + 2..line.len().saturating_sub(1)]),
        None => (line, ""),
    };
    let (branch, upstream) = match head.split_once("...") {
        Some((b, u)) => (b, Some(u.to_string())),
        None => (head, None),
    };
    let branch = branch.strip_prefix("No commits yet on ").unwrap_or(branch);
    if !branch.starts_with("HEAD (") {
        st.branch = branch.to_string();
    }
    st.upstream = upstream;
    for part in track.split(", ") {
        if let Some(n) = part.strip_prefix("ahead ") {
            st.ahead = n.parse().unwrap_or(0);
        } else if let Some(n) = part.strip_prefix("behind ") {
            st.behind = n.parse().unwrap_or(0);
        }
    }
}

fn read_status(root: &Path) -> Result<GitStatus, String> {
    // Fora de um repositório (ou sem git instalado): não é erro para a UI.
    let Ok(prefix) = git(root, &["rev-parse", "--show-prefix"]) else {
        return Ok(GitStatus::default());
    };
    let prefix = prefix.trim().to_string();
    let raw = git(root, &["status", "--porcelain=v1", "-z", "--branch", "--untracked-files=all"])?;

    let mut st = GitStatus { is_repo: true, ..Default::default() };
    let mut fields = raw.split('\0');
    while let Some(entry) = fields.next() {
        if entry.is_empty() {
            continue;
        }
        if entry.starts_with("## ") {
            parse_branch_line(entry, &mut st);
            continue;
        }
        if entry.len() < 4 {
            continue;
        }
        let mut chars = entry.chars();
        let (x, y) = (chars.next().unwrap(), chars.next().unwrap());
        let path = &entry[3..];
        // Renomeações/cópias trazem o caminho de origem no campo seguinte.
        if matches!(x, 'R' | 'C') || matches!(y, 'R' | 'C') {
            fields.next();
        }
        // Caminhos vêm relativos à raiz do repositório.
        let Some(rel) = path.strip_prefix(prefix.as_str()) else { continue };
        let rel = rel.trim_end_matches('/');
        if rel.is_empty() {
            continue;
        }
        let (status, staged) = classify(x, y);
        st.changes.push(GitChange { rel: rel.to_string(), status, staged });
    }
    if st.branch.is_empty() {
        st.detached = git(root, &["rev-parse", "--short", "HEAD"]).ok().map(|s| s.trim().to_string());
    }
    Ok(st)
}

fn read_branches(root: &Path) -> Result<Vec<GitBranch>, String> {
    let raw = git(
        root,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(HEAD)%09%(refname)%09%(refname:short)%09%(upstream:short)",
            "refs/heads",
            "refs/remotes",
        ],
    )?;
    let mut out = Vec::new();
    for line in raw.lines() {
        let mut p = line.split('\t');
        let (Some(head), Some(full), Some(short)) = (p.next(), p.next(), p.next()) else { continue };
        if full.starts_with("refs/remotes/") && full.ends_with("/HEAD") {
            continue;
        }
        let upstream = p.next().filter(|u| !u.is_empty()).map(str::to_string);
        out.push(GitBranch {
            name: short.to_string(),
            remote: full.starts_with("refs/remotes/"),
            current: head == "*",
            upstream,
        });
    }
    Ok(out)
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_status(project: State<'_, ProjectState>) -> Result<GitStatus, String> {
    let root: PathBuf = project.root()?;
    blocking(move || read_status(&root)).await
}

#[tauri::command]
pub async fn git_branches(project: State<'_, ProjectState>) -> Result<Vec<GitBranch>, String> {
    let root = project.root()?;
    blocking(move || read_branches(&root)).await
}

/// Troca para `name`. Só aceita branches existentes; uma branch remota sem
/// equivalente local cria a branch local rastreando a remota.
#[tauri::command]
pub async fn git_checkout(project: State<'_, ProjectState>, name: String) -> Result<(), String> {
    let root = project.root()?;
    blocking(move || {
        let branches = read_branches(&root)?;
        let target = branches
            .iter()
            .find(|b| b.name == name)
            .ok_or_else(|| format!("branch não encontrada: {name}"))?;
        if !target.remote {
            git(&root, &["switch", "--no-guess", &target.name])?;
            return Ok(());
        }
        let local = target.name.split_once('/').map(|(_, l)| l).unwrap_or(&target.name);
        if branches.iter().any(|b| !b.remote && b.name == local) {
            git(&root, &["switch", "--no-guess", local])?;
        } else {
            git(&root, &["switch", "--track", &target.name])?;
        }
        Ok(())
    })
    .await
}

/// Cria `name` a partir do HEAD atual e troca para ela.
#[tauri::command]
pub async fn git_create_branch(project: State<'_, ProjectState>, name: String) -> Result<(), String> {
    let root = project.root()?;
    blocking(move || {
        let name = name.trim().to_string();
        if name.is_empty() || name.starts_with('-') {
            return Err("nome de branch inválido".into());
        }
        git(&root, &["check-ref-format", "--branch", &name]).map_err(|_| format!("nome de branch inválido: {name}"))?;
        git(&root, &["switch", "-c", &name])?;
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn branch_line() {
        let mut st = GitStatus::default();
        parse_branch_line("## main...origin/main [ahead 2, behind 1]", &mut st);
        assert_eq!((st.branch.as_str(), st.upstream.as_deref(), st.ahead, st.behind), ("main", Some("origin/main"), 2, 1));
        let mut st = GitStatus::default();
        parse_branch_line("## HEAD (no branch)", &mut st);
        assert_eq!(st.branch, "");
        let mut st = GitStatus::default();
        parse_branch_line("## No commits yet on dev", &mut st);
        assert_eq!(st.branch, "dev");
    }

    #[test]
    fn codes() {
        assert_eq!(classify('?', '?'), ('U', false));
        assert_eq!(classify(' ', 'M'), ('M', false));
        assert_eq!(classify('M', ' '), ('M', true));
        assert_eq!(classify('A', ' '), ('A', true));
        assert_eq!(classify('R', ' '), ('R', true));
        assert_eq!(classify('U', 'U'), ('C', false));
    }

    #[test]
    fn this_repo() {
        let root = dunce::canonicalize(concat!(env!("CARGO_MANIFEST_DIR"), "/..")).unwrap();
        let st = read_status(&root).unwrap();
        assert!(st.is_repo);
        for c in &st.changes {
            println!("{} {} {}", c.status, if c.staged { "S" } else { "-" }, c.rel);
        }
        println!("branch={} upstream={:?}", st.branch, st.upstream);
        let sub = read_status(&root.join("src")).unwrap();
        assert!(sub.changes.iter().all(|c| !c.rel.starts_with("src/")));
        println!("branches={:?}", read_branches(&root).unwrap().iter().map(|b| &b.name).collect::<Vec<_>>());
    }
}
