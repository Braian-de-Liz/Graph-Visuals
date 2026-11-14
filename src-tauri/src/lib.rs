//! Desktop Core da IDE.
//!
//! Responsável apenas por infraestrutura: projeto ativo, arquivos, watcher,
//! execução do Graphify e sessões PTY dos agentes. Não contém análise de código
//! nem renderização.

mod agents;
mod fs_edit;
mod fs_ops;
mod graph;
mod project;
mod pty;
mod watcher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(project::ProjectState::default())
        .manage(pty::PtyManager::default())
        .manage(watcher::WatcherState::default())
        .manage(graph::GraphState::default())
        .invoke_handler(tauri::generate_handler![
            project::project_open,
            project::project_current,
            fs_ops::fs_list_dir,
            fs_ops::fs_read_text,
            fs_ops::fs_stat_mtime,
            fs_ops::fs_write_text,
            fs_ops::fs_index,
            fs_edit::fs_create,
            fs_edit::fs_rename,
            fs_edit::fs_delete,
            fs_edit::reveal_in_os,
            watcher::watch_start,
            watcher::watch_stop,
            graph::graphify_run,
            graph::graph_load,
            agents::agents_detect,
            agents::agent_resolve,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
