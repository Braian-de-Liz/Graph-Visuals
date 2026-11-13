//! Graph Engine: executa o Graphify e converte `graph.json` (formato
//! node-link do NetworkX) para um modelo interno estável.
//!
//! O resultado fica no diretório de cache da aplicação, fora do projeto:
//! `<app_cache_dir>/graphs/<hash do caminho>/graphify-out/graph.json`.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::project::{path_to_string, ProjectState};

#[derive(Default)]
pub struct GraphState {
    /// Incrementado a cada execução solicitada. Uma execução cujo número não
    /// for o mais recente ao terminar é marcada como obsoleta.
    generation: Arc<AtomicU64>,
    /// Serializa execuções: o Graphify escreve sempre no mesmo diretório.
    run_lock: Arc<Mutex<()>>,
}

/// FNV-1a 64 bits: estável entre versões do Rust (ao contrário de DefaultHasher).
fn fnv1a(s: &str) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

fn cache_dir(app: &AppHandle, root: &Path) -> Result<PathBuf, String> {
    let base = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    let key = format!("{:016x}", fnv1a(&path_to_string(root).to_lowercase()));
    Ok(base.join("graphs").join(key))
}

fn graph_json_path(out_dir: &Path) -> PathBuf {
    out_dir.join("graphify-out").join("graph.json")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphRunResult {
    generation: u64,
    /// Uma execução mais nova foi solicitada; o resultado deve ser ignorado.
    stale: bool,
    success: bool,
    log: String,
}

#[tauri::command]
pub async fn graphify_run(
    app: AppHandle,
    project: State<'_, ProjectState>,
    graph: State<'_, GraphState>,
) -> Result<GraphRunResult, String> {
    let root = project.root()?;
    let out_dir = cache_dir(&app, &root)?;
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
    let exe = which::which("graphify").map_err(|_| "graphify não encontrado no PATH".to_string())?;

    let my_gen = graph.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let generation = graph.generation.clone();
    let run_lock = graph.run_lock.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let _guard = run_lock.lock().unwrap();
        if generation.load(Ordering::SeqCst) != my_gen {
            return Ok(GraphRunResult { generation: my_gen, stale: true, success: false, log: String::new() });
        }

        let mut cmd = Command::new(exe);
        cmd.arg("extract")
            .arg(&root)
            .arg("--code-only")
            .arg("--out")
            .arg(&out_dir)
            .current_dir(&root);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let output = cmd.output().map_err(|e| format!("falha ao executar graphify: {e}"))?;
        let log = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        Ok(GraphRunResult {
            generation: my_gen,
            stale: generation.load(Ordering::SeqCst) != my_gen,
            success: output.status.success(),
            log,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------- modelo bruto (graph.json do Graphify) ----------

#[derive(Deserialize)]
struct RawGraph {
    #[serde(default)]
    nodes: Vec<RawNode>,
    #[serde(default, alias = "edges")]
    links: Vec<RawLink>,
}

#[derive(Deserialize)]
struct RawNode {
    id: Value,
    label: Option<String>,
    community: Option<i64>,
    file_type: Option<String>,
    source_file: Option<String>,
    source_location: Option<Value>,
}

#[derive(Deserialize)]
struct RawLink {
    source: Value,
    target: Value,
    relation: Option<String>,
}

fn value_to_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

// ---------- modelo interno enviado ao frontend ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    id: String,
    label: String,
    community: Option<i64>,
    file_type: Option<String>,
    source_file: Option<String>,
    source_location: Option<String>,
}

#[derive(Serialize)]
pub struct GraphEdge {
    /// Índices em `nodes`.
    source: u32,
    target: u32,
    relation: Option<String>,
}

#[derive(Serialize)]
pub struct GraphData {
    nodes: Vec<GraphNode>,
    edges: Vec<GraphEdge>,
}

fn convert(raw: RawGraph) -> GraphData {
    let mut index = std::collections::HashMap::with_capacity(raw.nodes.len());
    let nodes: Vec<GraphNode> = raw
        .nodes
        .into_iter()
        .enumerate()
        .map(|(i, n)| {
            let id = value_to_string(&n.id);
            index.insert(id.clone(), i as u32);
            GraphNode {
                label: n.label.unwrap_or_else(|| id.clone()),
                id,
                community: n.community,
                file_type: n.file_type,
                source_file: n.source_file,
                source_location: n.source_location.as_ref().map(value_to_string),
            }
        })
        .collect();
    // Arestas para nós inexistentes são descartadas.
    let edges = raw
        .links
        .into_iter()
        .filter_map(|l| {
            let s = *index.get(&value_to_string(&l.source))?;
            let t = *index.get(&value_to_string(&l.target))?;
            Some(GraphEdge { source: s, target: t, relation: l.relation })
        })
        .collect();
    GraphData { nodes, edges }
}

/// Carrega o último grafo válido do projeto ativo, se existir.
#[tauri::command]
pub async fn graph_load(app: AppHandle, project: State<'_, ProjectState>) -> Result<Option<GraphData>, String> {
    let root = project.root()?;
    let path = graph_json_path(&cache_dir(&app, &root)?);
    tauri::async_runtime::spawn_blocking(move || {
        if !path.exists() {
            return Ok(None);
        }
        let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let raw: RawGraph = serde_json::from_str(&text).map_err(|e| format!("graph.json inválido: {e}"))?;
        Ok(Some(convert(raw)))
    })
    .await
    .map_err(|e| e.to_string())?
}
