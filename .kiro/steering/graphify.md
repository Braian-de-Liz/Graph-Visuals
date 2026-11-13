---
inclusion: always
---

# Graphify — uso padrão neste projeto

Este projeto usa o **Graphify** (pacote PyPI `graphifyy`, comandos `graphify` e
`graphify-mcp`) como fonte de verdade da análise estrutural do código. O grafo de
conhecimento é a forma preferida de entender a estrutura do repositório.

## Regra padrão para o agente

Antes de ler arquivos em massa ou re-derivar a estrutura do projeto a partir do
texto, **consulte primeiro o grafo do Graphify**. Só caia para leitura direta de
arquivos quando o grafo não cobrir o que você precisa.

Ordem de preferência ao investigar o código:

1. Consultar o grafo (via ferramentas MCP do Graphify ou pelos arquivos de saída).
2. Ler `graphify-out/GRAPH_REPORT.md` para hubs, comunidades e perguntas sugeridas.
3. Só então abrir arquivos individuais.

## Saída do Graphify

Após a extração, os dados ficam em `graphify-out/`:

- `graph.json` — nós, arestas e comunidades (consumido pela CLI e pelo MCP).
- `graph.html` — visualização interativa.
- `GRAPH_REPORT.md` — god nodes, comunidades, conexões e perguntas sugeridas.
- `manifest.json` — hashes para atualização incremental.
- `cache/` — cache de AST por arquivo (adicionar ao `.gitignore`).

## Comandos úteis (terminal)

```bash
# Instalar (uma vez)
uv tool install "graphifyy[mcp]"      # ou: pipx install graphifyy / pip install graphifyy

# Extrair / construir o grafo deste projeto
graphify extract .                    # add --code-only para pular etapas com LLM

# Manter o grafo atualizado
graphify update .                     # re-extrai apenas arquivos novos/alterados
graphify hook install                 # rebuild automático via git hooks

# Consultas
graphify god-nodes --top 5
graphify query "como a análise chega na visualização 3D"
graphify path "GraphEngine" "ThreeScene"
graphify explain "FileWatcher"
```

## Servidor MCP do Graphify (ferramentas do grafo para o agente)

A maneira recomendada de dar ao Kiro acesso contínuo ao grafo é registrar o
servidor MCP `graphify-mcp`. Como a escrita automática em
`.kiro/settings/mcp.json` é bloqueada por política, adicione o bloco abaixo
manualmente nesse arquivo (ou em `~/.kiro/settings/mcp.json`):

```json
{
  "mcpServers": {
    "graphify": {
      "command": "graphify-mcp",
      "args": [
        "c:/Users/Usuário/desktop/Graph-Visuals/graphify-out/graph.json"
      ],
      "env": {},
      "disabled": false,
      "autoApprove": [
        "query_graph",
        "get_node",
        "get_neighbors",
        "get_community",
        "god_nodes",
        "graph_stats",
        "shortest_path"
      ]
    }
  }
}
```

Ferramentas expostas pelo MCP: `query_graph`, `get_node`, `get_neighbors`,
`get_community`, `god_nodes`, `graph_stats`, `shortest_path`, `list_prs`,
`get_pr_impact`, `triage_prs`. O servidor recarrega `graph.json` automaticamente
quando o arquivo muda.

## Limite arquitetural (do spec.md)

O Graphify é usado **exclusivamente** para alimentar a visualização da IDE e a
investigação do agente. Ele **não** deve injetar contexto automaticamente nos
agentes gerenciados pela IDE nem alterar seus prompts, argumentos ou ambiente.
