//! Detecção de CLIs de agentes e shells disponíveis no PATH.
//!
//! Apenas localiza executáveis. Nenhum arquivo de configuração dos agentes é
//! lido ou alterado.

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    id: &'static str,
    name: &'static str,
    /// Nome do executável, repassado sem alterações ao `pty_spawn`.
    command: &'static str,
    kind: &'static str,
    /// Caminho resolvido, ou `None` se não encontrado.
    path: Option<String>,
}

const AGENTS: &[(&str, &str, &str)] = &[
    ("claude", "Claude Code", "claude"),
    ("opencode", "OpenCode", "opencode"),
    ("codex", "Codex", "codex"),
    ("kiro", "Kiro CLI", "kiro-cli"),
];

#[cfg(windows)]
const SHELLS: &[(&str, &str, &str)] = &[
    ("pwsh", "PowerShell 7", "pwsh"),
    ("powershell", "Windows PowerShell", "powershell"),
    ("cmd", "Prompt de Comando", "cmd"),
];

#[cfg(not(windows))]
const SHELLS: &[(&str, &str, &str)] = &[("bash", "bash", "bash"), ("zsh", "zsh", "zsh")];

#[tauri::command]
pub fn agents_detect() -> Vec<AgentInfo> {
    let make = |kind: &'static str| {
        move |&(id, name, command): &(&'static str, &'static str, &'static str)| AgentInfo {
            id,
            name,
            command,
            kind,
            path: which::which(command).ok().map(|p| p.to_string_lossy().into_owned()),
        }
    };
    AGENTS
        .iter()
        .map(make("agent"))
        .chain(SHELLS.iter().map(make("shell")))
        .collect()
}
