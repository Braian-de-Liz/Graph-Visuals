IDE leve em que o código vira um grafo 3D e os agentes de IA rodam ao lado, nos próprios CLIs.

> **Versão alpha.** Testada no Windows 10 e 11. macOS e Linux ainda não têm instalador.

## Qual arquivo baixar

| Arquivo | Para quem |
|---|---|
| `Graph.Visuals_x.y.z_x64-setup.exe` | A maioria das pessoas: instalador comum, não precisa de administrador |
| `Graph.Visuals_x.y.z_x64_en-US.msi` | Instalação gerenciada (empresa, GPO, Intune) |

## Antes de abrir

1. **Instale o Graphify**, que gera o grafo. Sem ele a IDE abre, mas o grafo fica vazio:
   ```bash
   uv tool install graphifyy
   # ou
   pipx install graphifyy
   ```
2. **Agentes são opcionais.** Claude Code, GitHub Copilot, Codex, OpenCode, Kiro CLI e Antigravity são detectados no PATH. Instale os que você já usa.

## Aviso do Windows (SmartScreen)

O instalador ainda não tem assinatura digital, então o Windows pode mostrar **"O Windows protegeu o computador"**. Para continuar: **Mais informações → Executar assim mesmo**. O código-fonte de tudo que vai no instalador está neste repositório, e o arquivo é gerado pelo GitHub Actions a partir dele.

## Problemas

Abra uma [issue](https://github.com/Braian-de-Liz/Graph-Visuals/issues) com a versão do Windows e o que aconteceu.
