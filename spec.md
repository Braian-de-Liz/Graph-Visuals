# Plano de Desenvolvimento — IDE Agêntica 3D

## 1. Visão do produto

Desenvolver uma IDE desktop leve, baseada em Tauri, cujo elemento central seja uma visualização tridimensional do grafo gerado pelo Graphify.

A IDE permitirá:

- Abrir diretórios de projetos.
- Visualizar a estrutura de arquivos.
- Explorar o grafo de conhecimento do Graphify em 3D.
- Executar e interagir com agentes de programação por meio de seus CLIs originais.
- Gerenciar múltiplas sessões de agentes.
- Acompanhar alterações no diretório e atualizar automaticamente o grafo e a árvore de arquivos.

### Princípio arquitetural inviolável

A IDE não deve interferir no contexto dos agentes.

Ela poderá iniciar os processos originais, apresentar seus terminais e encaminhar as entradas explicitamente realizadas pelo usuário.

Não poderá:
- Injetar contexto adicional.
- Modificar prompts ou instruções.
- Adicionar arquivos de contexto.
- Acrescentar argumentos ou flags não solicitados.
- Interceptar, interpretar ou modificar mensagens.
- Alterar variáveis de ambiente para modificar o comportamento dos agentes.

O Graphify será utilizado exclusivamente para alimentar a visualização da IDE, sem fornecer contexto automaticamente aos agentes.

---

## 2. Stack tecnológica

A prioridade será reduzir consumo de memória, dependências e quantidade de processos.

| Camada | Tecnologia | Responsabilidade |
|---|---|---|
| Desktop | Tauri 2 | Aplicação desktop |
| Backend | Rust | Processos, arquivos, eventos e sessões |
| Frontend | React + TypeScript | Interface |
| Grafo 3D | Three.js | Renderização tridimensional |
| Editor | CodeMirror 6 | Visualização e edição de código |
| Terminal | xterm.js | Interface dos terminais |
| PTY | Rust + ConPTY / PTY nativo | Comunicação com os agentes |
| File Watcher | notify (Rust) | Monitoramento do diretório |
| Grafo | Graphify | Extração e representação estrutural |
| Comunicação | Tauri IPC | Comunicação frontend/backend |

### Decisões de leveza

- Não utilizar Electron.
- Não utilizar um servidor backend separado.
- Não utilizar FastAPI ou Node.js como serviço auxiliar.
- Não implementar um sistema próprio de análise de código.
- Não utilizar Monaco inicialmente; CodeMirror 6 é uma alternativa mais leve.
- Utilizar Three.js diretamente, evitando adicionar React Three Fiber sem necessidade.
- Evitar bancos de dados no MVP.
- Utilizar JSON e cache local para os dados do Graphify.

O Rust será responsável pela infraestrutura, enquanto o frontend ficará concentrado na interface e renderização.

---

## 3. Arquitetura geral

A aplicação será dividida em quatro módulos principais.

### 3.1. Desktop Core — Tauri/Rust

Responsável por:

- Abrir e gerenciar projetos.
- Gerenciar permissões de acesso aos diretórios.
- Iniciar processos externos.
- Administrar sessões PTY.
- Monitorar alterações no sistema de arquivos.
- Executar o Graphify.
- Distribuir eventos para o frontend.

Não deve conter lógica de análise de código ou renderização gráfica.

### 3.2. Graph Engine

Responsável pela integração com o Graphify.

Funções:
- Gerar o grafo inicial.
- Ler os dados estruturais produzidos pelo Graphify.
- Detectar alterações no resultado.
- Disponibilizar os dados para a visualização.
- Coordenar atualizações após alterações no projeto.

O Graphify deve continuar sendo a fonte de verdade da análise estrutural.

A integração deve utilizar os formatos e comandos oficialmente disponíveis, sem depender de detalhes internos não documentados.

### 3.3. Agent Manager

Responsável exclusivamente pelo gerenciamento dos processos dos agentes.

Funções:
- Detectar CLIs instalados e disponibilizados no PATH.
- Iniciar os processos originais.
- Definir o diretório de trabalho.
- Gerenciar sessões independentes.
- Disponibilizar saída e entrada pelo terminal.
- Encerrar processos.
- Preservar o comportamento original de cada CLI.

Cada agente terá sua própria sessão PTY.

A comunicação será transparente: entrada do usuário encaminhada ao processo e saída do processo apresentada no terminal.

Não haverá middleware de contexto ou orquestrador inteligente.

### 3.4. Frontend

Responsável por:

- Renderização do grafo 3D.
- Explorador de arquivos.
- Editor de código.
- Painéis de agentes.
- Gerenciamento visual das sessões.
- Configurações da aplicação.

---

## 4. Plano de implementação

### Fase 0 — Fundação e validação técnica

Objetivo: validar as tecnologias antes de desenvolver a interface completa.

Atividades:

1. Criar projeto Tauri 2.
2. Configurar Rust, React e TypeScript.
3. Configurar comunicação IPC.
4. Validar execução de processos externos.
5. Validar PTY no Windows, especialmente ConPTY.
6. Validar leitura e atualização de arquivos.
7. Executar Graphify externamente e analisar seus formatos de saída.
8. Validar renderização de um grafo com milhares de nós.

**Critério de conclusão:** aplicação desktop funcional, capaz de executar um CLI em terminal integrado e renderizar um grafo de teste.

### Fase 1 — Gerenciamento de projetos

Objetivo: estabelecer a estrutura básica da IDE.

Implementar:

- Abertura de diretórios.
- Seleção de projeto ativo.
- Explorador de arquivos.
- Navegação por diretórios.
- Identificação de arquivos e pastas.
- Atualização da árvore após alterações.
- Exclusão de diretórios irrelevantes da indexação.

O File Watcher será implementado no backend Rust.

Deverá observar:
- Criação de arquivos.
- Remoção de arquivos.
- Modificações.
- Renomeações.
- Movimentações.

Ignorar inicialmente:
- `.git`
- `node_modules`
- `target`
- `dist`
- Diretórios de build.
- Cache da própria IDE.

A lista de exclusões deverá ser configurável.

### Fase 2 — Integração com Graphify

Objetivo: integrar o mecanismo de análise ao ambiente da IDE.

Implementar:

1. Execução inicial do Graphify.
2. Leitura do grafo gerado.
3. Conversão dos dados para um modelo interno estável.
4. Identificação de nós, arestas e comunidades.
5. Associação dos nós aos respectivos arquivos e posições no código.
6. Armazenamento do resultado em cache local.
7. Atualização após modificações no projeto.

Importante: não presumir que o Graphify oferece atualização incremental.

A primeira implementação deverá executar uma regeneração controlada após alterações, utilizando debounce e agrupamento de eventos.

Caso o Graphify ofereça mecanismos incrementais confiáveis, eles poderão ser incorporados posteriormente.

O cache deverá ficar fora do diretório do projeto sempre que possível.

### Fase 3 — Visualização tridimensional

Objetivo: transformar o grafo do Graphify no ambiente central da IDE.

Implementar com Three.js:

- Renderização 3D.
- Câmera orbital.
- Zoom e movimentação.
- Seleção de nós.
- Identificação visual de comunidades.
- Linhas de conexão.
- Destaque de vizinhanças.
- Busca por arquivos, funções e classes.
- Painel de informações do elemento selecionado.

A renderização deverá considerar desempenho desde o início.

Preferir:
- InstancedMesh para nós.
- BufferGeometry para conexões.
- Renderização sob demanda quando possível.
- Limitação de atualizações desnecessárias.
- Carregamento e processamento dos dados fora da thread principal quando necessário.

A posição dos elementos deverá permanecer estável entre atualizações sempre que possível, evitando que todo o grafo se reorganize a cada alteração.

### Fase 4 — Agent Manager

Objetivo: permitir executar os agentes originais diretamente na IDE.

Implementar:

1. Cadastro e identificação de CLIs.
2. Detecção de executáveis instalados.
3. Inicialização de processos.
4. Criação de sessões PTY independentes.
5. Terminal integrado com xterm.js.
6. Encaminhamento transparente de entrada e saída.
7. Gerenciamento de sessões simultâneas.
8. Encerramento controlado de processos.

Agentes iniciais:
- Claude Code.
- OpenCode.
- Codex.
- Kiro CLI.

A integração deverá utilizar os executáveis originais, sem adaptadores que alterem mensagens ou contexto.

Não implementar abstrações específicas de raciocínio, ferramentas ou memória dos agentes.

A compatibilidade deverá ser validada individualmente para cada CLI.

### Fase 5 — Integração visual entre os módulos

Objetivo: unir grafo, arquivos, editor e agentes.

Implementar:

- Seleção de nó abre o arquivo correspondente.
- Seleção de arquivo destaca o nó correspondente, quando disponível.
- Agente pode ser aberto em um painel próprio.
- Múltiplas sessões podem permanecer abertas.
- Arquivos modificados recebem indicação visual.
- Nós correspondentes às alterações recebem destaque.
- Grafo e explorador atualizam independentemente dos agentes.

A atualização visual não deverá depender de informações extraídas das conversas dos agentes.

A única fonte de atualização será o estado real do diretório e os resultados do Graphify.

### Fase 6 — Estabilização e otimização

Objetivo: preparar a aplicação para utilização diária.

Implementar:

- Tratamento de falhas de processos.
- Recuperação de sessões quando possível.
- Controle de consumo de memória.
- Cancelamento de análises antigas.
- Prevenção de atualizações concorrentes do grafo.
- Reconciliação periódica da árvore de arquivos.
- Tratamento de alterações em branches Git.
- Testes de desempenho com projetos grandes.
- Testes de estabilidade com vários agentes simultâneos.

---

## 5. Estratégia de atualização do grafo

Fluxo esperado:

1. O File Watcher detecta alterações.
2. Os eventos são agrupados por um intervalo de debounce.
3. A IDE identifica quais arquivos e diretórios foram afetados.
4. A árvore de arquivos é atualizada imediatamente.
5. O Graph Engine agenda uma nova análise.
6. O Graphify gera a representação atualizada.
7. A IDE valida e carrega o novo resultado.
8. O grafo 3D atualiza os elementos afetados.

O sistema deverá impedir que uma análise antiga sobrescreva uma análise mais recente.

Também deverá possuir uma rotina de reconciliação para corrigir eventos perdidos pelo sistema operacional.

Não será necessário atualizar o grafo a cada tecla digitada. O objetivo é acompanhar alterações efetivamente gravadas no disco.

---

## 6. Organização da interface

A interface deverá priorizar o grafo 3D.

Estrutura proposta:

- Centro: grafo tridimensional.
- Esquerda: explorador de arquivos.
- Direita: informações do nó selecionado.
- Inferior: terminal e sessões de agentes.
- Superior: projeto ativo, pesquisa, configurações e controles de visualização.

Os painéis deverão ser redimensionáveis e recolhíveis.

O terminal poderá ocupar a parte inferior ou ser destacado em uma janela/painel próprio.

O editor deverá abrir dentro da IDE, sem obrigar o usuário a abandonar o grafo.

---

## 7. MVP — Escopo inicial

A primeira versão utilizável deverá conter somente:

1. Aplicação desktop Tauri.
2. Abertura de diretórios.
3. Explorador de arquivos.
4. Integração inicial com Graphify.
5. Visualização 3D navegável.
6. Seleção e inspeção de nós.
7. File Watcher.
8. Atualização automática do grafo.
9. Execução de pelo menos um CLI.
10. Terminal integrado.

O primeiro agente recomendado para validação é Claude Code.

Após validar o gerenciamento de processos e PTY, adicionar os demais agentes.

Não implementar inicialmente:
- Orquestração multiagente.
- Sistema de memória.
- RAG.
- Banco de dados.
- Indexador próprio.
- Chat inteligente da IDE.
- Análise semântica adicional.
- Colaboração remota.
- Sistema de plugins.

---

## 8. Critérios de qualidade

A IDE deverá cumprir os seguintes requisitos:

**Leveza**
- Um único aplicativo desktop.
- Sem backend HTTP separado.
- Sem serviços Python permanentes.
- Sem processos auxiliares desnecessários.

**Isolamento dos agentes**
- Contexto original preservado.
- Entrada encaminhada somente por ação explícita do usuário.
- Nenhuma injeção de contexto.
- Nenhuma alteração silenciosa de argumentos ou ambiente.

**Consistência**
- Árvore de arquivos correspondente ao diretório real.
- Grafo correspondente à última análise válida.
- Atualizações sem perda de dados.
- Tratamento de eventos de arquivos duplicados ou perdidos.

**Desempenho**
- Renderização fluida em grafos de milhares de elementos.
- Atualização sem reconstruir desnecessariamente toda a cena.
- Interface responsiva durante análises.
- Terminais sem bloqueio da interface.

---

## 9. Ordem recomendada de desenvolvimento

| Prioridade | Fase | Resultado |
|---|---|---|
| P0 | Fundação | Tauri funcional |
| P1 | Projetos | Explorador de arquivos |
| P2 | Graphify | Dados estruturais integrados |
| P3 | Grafo 3D | Visualização navegável |
| P4 | Agent Manager | CLIs em PTY |
| P5 | Integração | IDE unificada |
| P6 | Estabilização | Aplicação pronta para uso |

**Recomendação final:** desenvolver em incrementos pequenos, validando cada módulo isoladamente antes de integrá-lo. A arquitetura deve permanecer simples: Rust gerencia o ambiente, Graphify analisa, Three.js visualiza e os CLIs trabalham independentemente.

O sucesso do projeto não depende de criar mais inteligência artificial, mas de proporcionar uma experiência visual e operacional melhor para trabalhar com os agentes que já existem.