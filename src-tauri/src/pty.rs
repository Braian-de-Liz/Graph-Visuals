//! Agent Manager: sessões PTY independentes (ConPTY no Windows).
//!
//! Princípio inviolável: o processo é iniciado exatamente com o executável,
//! argumentos e diretório pedidos, herdando o ambiente da IDE sem alterações.
//! A entrada vem apenas de ações explícitas do usuário (`pty_write`) e a saída
//! é repassada byte a byte ao terminal, sem interpretação.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PtyEvent {
    Output { data: String },
    Exit { code: Option<u32> },
}

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Default)]
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<u32, Session>>>,
    next_id: AtomicU32,
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Decodifica UTF-8 em fluxo, preservando sequências multibyte divididas
/// entre leituras.
fn drain_utf8(pending: &mut Vec<u8>, out: &mut String) {
    loop {
        match std::str::from_utf8(pending) {
            Ok(s) => {
                out.push_str(s);
                pending.clear();
                return;
            }
            Err(e) => {
                let valid = e.valid_up_to();
                out.push_str(std::str::from_utf8(&pending[..valid]).unwrap());
                match e.error_len() {
                    // Sequência incompleta no fim: aguarda a próxima leitura.
                    None => {
                        pending.drain(..valid);
                        return;
                    }
                    Some(len) => {
                        out.push('\u{FFFD}');
                        pending.drain(..valid + len);
                    }
                }
            }
        }
    }
}

#[tauri::command]
pub fn pty_spawn(
    state: State<'_, PtyManager>,
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    on_event: Channel<PtyEvent>,
) -> Result<u32, String> {
    // Resolver o caminho (incluindo PATHEXT no Windows) não altera o comando.
    let resolved = which::which(&program).map_err(|e| format!("'{program}' não encontrado no PATH: {e}"))?;

    let pair = native_pty_system()
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(err)?;

    let mut cmd = CommandBuilder::new(resolved);
    cmd.args(&args);
    // Ambiente idêntico ao da IDE: nada adicionado, nada removido.
    cmd.env_clear();
    for (k, v) in std::env::vars_os() {
        cmd.env(k, v);
    }
    if let Some(dir) = cwd {
        cmd.cwd(dir);
    }

    let mut child = pair.slave.spawn_command(cmd).map_err(err)?;
    drop(pair.slave);

    let killer = child.clone_killer();
    let mut reader = pair.master.try_clone_reader().map_err(err)?;
    let writer = pair.master.take_writer().map_err(err)?;

    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    state
        .sessions
        .lock()
        .unwrap()
        .insert(id, Session { master: pair.master, writer, killer });

    let out_channel = on_event.clone();
    let reader_thread = std::thread::spawn(move || {
        let mut buf = [0u8; 16 * 1024];
        let mut pending = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    pending.extend_from_slice(&buf[..n]);
                    let mut text = String::new();
                    drain_utf8(&mut pending, &mut text);
                    if !text.is_empty() && out_channel.send(PtyEvent::Output { data: text }).is_err() {
                        break;
                    }
                }
            }
        }
    });

    let sessions = state.sessions.clone();
    std::thread::spawn(move || {
        let code = child.wait().ok().map(|s| s.exit_code());
        // Remover a sessão fecha o pseudoconsole, o que encerra a leitura.
        let session = sessions.lock().unwrap().remove(&id);
        drop(session);
        let _ = reader_thread.join();
        let _ = on_event.send(PtyEvent::Exit { code });
    });

    Ok(id)
}

#[tauri::command]
pub fn pty_write(state: State<'_, PtyManager>, id: u32, data: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    let session = sessions.get_mut(&id).ok_or("sessão inexistente")?;
    session.writer.write_all(data.as_bytes()).map_err(err)?;
    session.writer.flush().map_err(err)
}

#[tauri::command]
pub fn pty_resize(state: State<'_, PtyManager>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = state.sessions.lock().unwrap();
    let session = sessions.get(&id).ok_or("sessão inexistente")?;
    session
        .master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(err)
}

#[tauri::command]
pub fn pty_kill(state: State<'_, PtyManager>, id: u32) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    match sessions.get_mut(&id) {
    Some(session) => match session.killer.kill() {
        // portable-pty no Windows pode devolver "os error 0" (sucesso) como erro.
        Err(e) if e.raw_os_error() == Some(0) => Ok(()),
        other => other.map_err(err),
    },
        None => Ok(()),
    }
}
