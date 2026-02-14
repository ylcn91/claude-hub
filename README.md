```
 █████╗   ██╗
██╔══██╗ ███║
╚█████╔╝ ╚██║
 ╚═══██║  ██║
 █████╔╝  ██║
 ╚════╝   ╚═╝
```

# agentctl

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/Runtime-Bun-f9f1e1.svg)](https://bun.sh)
[![Platform: macOS | Linux](https://img.shields.io/badge/Platform-macOS%20%7C%20Linux-lightgrey.svg)]()

**Multi-account AI agent manager** — run multiple Claude Code, Codex CLI, OpenHands, Gemini CLI, OpenCode, and Cursor Agent accounts from a single TUI dashboard with inter-agent messaging, task handoff, and MCP tooling.

```
actl                          # launch TUI dashboard
actl add work                 # add a new account
actl launch work ~/project    # open in a new terminal
actl daemon start             # enable inter-agent communication
```

---

## Install

### Homebrew (macOS & Linux)

```bash
brew tap ylcn91/agentctl
brew install agentctl
```

### From Source

```bash
git clone https://github.com/ylcn91/agentctl.git
cd agentctl
bun install && bun link
```

Pre-built binaries for macOS (arm64, x64) and Linux (x64) are attached to each [GitHub Release](https://github.com/ylcn91/agentctl/releases).

---

## Quick Start

```bash
actl add work                          # add first account (defaults to claude-code)
actl add codex --provider codex-cli    # add another provider
actl daemon start                      # start daemon for messaging & handoff
actl                                   # open TUI
```

Each account gets an isolated config directory, a unique auth token, and a shell alias.

---

## CLI Reference

### Account Management

| Command | Description |
|---------|-------------|
| `actl add <name>` | Add account (`--dir`, `--color`, `--label`, `--provider`) |
| `actl remove <name>` | Remove account (`--purge` to delete config dir) |
| `actl rotate-token <name>` | Rotate auth token |
| `actl list` | List accounts |
| `actl status` | Show account status and quota |
| `actl usage` | Detailed usage table |
| `actl find <pattern>` | Find accounts by name/label/provider |

### Launch & Operations

| Command | Description |
|---------|-------------|
| `actl launch <name> [dir]` | Launch in terminal (`--resume`, `--no-window`, `--bypass-permissions`) |
| `actl bridge --account <name>` | Start MCP bridge for an account (internal) |
| `actl search <pattern>` | Search across all account working directories |
| `actl health [account]` | Health check |

### Daemon

| Command | Description |
|---------|-------------|
| `actl daemon start` | Start daemon (background) |
| `actl daemon stop` | Stop daemon |
| `actl daemon status` | Check daemon status |
| `actl daemon supervise` | Start with auto-restart supervisor |

### Sessions & Config

| Command | Description |
|---------|-------------|
| `actl sessions [--search <q>]` | List or search named sessions |
| `actl session name <id> <name>` | Name a session |
| `actl replay <session-id>` | Replay entire.io checkpoint (`--json`) |
| `actl config set <key> <value>` | Set config (dot-path notation) |
| `actl config reload` | Hot-reload config via daemon |
| `actl help [topic]` | Show help |

---

## TUI Dashboard

Run `actl` to open the interactive dashboard.

| Key | View | Key | View |
|-----|------|-----|------|
| `d` | Dashboard | `e` | SLA Board |
| `l` | Launcher | `r` | Prompts |
| `u` | Usage | `n` | Analytics |
| `t` | Tasks | `w` | Workflows |
| `m` | Inbox | `h` | Health |
| `a` | Add Account | `c` | Council |
| `v` | Verification | `i` | Entire Sessions |
| `g` | Delegation Chains | `?` | Help |

**Navigation:** `j`/`k` up/down, `Enter` select, `Escape` back, `q` quit, `Ctrl+P` command palette, `Ctrl+X b` sidebar.

---

## Features

### Core
- **Multi-account management** with isolated config dirs, tokens, and shell aliases
- **TUI dashboard** with 15+ views (Ink/React)
- **15 built-in themes** — catppuccin, tokyonight, dracula, gruvbox, nord, solarized, and more
- **Command palette** (`Ctrl+P`) with fuzzy search across all views and actions

### Communication & Handoff
- **Inter-agent messaging** via daemon with per-account auth tokens
- **Structured task handoff** with goals, acceptance criteria, run commands, and blockers
- **Auto-acceptance** — automatic execution of acceptance suites on submission
- **Handoff templates** — reusable contracts (built-in and custom)
- **Live session sharing** — pair-programming between accounts with real-time updates

### Intelligent Delegation
- **Multi-model council** — pre-delegation analysis using multiple accounts' CLI tools
- **Council verification** — multi-account review against acceptance criteria (ACCEPT/REJECT/ACCEPT_WITH_NOTES)
- **Capability routing** — score and rank accounts by skill match, success rate, speed
- **Trust & reputation** — track completion rate, SLA compliance, quality metrics
- **Delegation chains** — track depth to prevent accountability vacuums

### Monitoring & Ops
- **SLA monitoring** with adaptive graduated responses (ping, reassign, quarantine, escalate)
- **Workspace isolation** via git worktrees for parallel task branches
- **Workflow automation** — YAML-based DAG workflows with conditions and retries
- **Retrospectives** — AI-powered post-session reviews with learnings
- **GitHub integration** — link tasks to issues/PRs with status sync
- **Review bundles** — auto-generated diff summaries, test results, risk notes
- **Knowledge index** — full-text search across prompts, handoffs, decisions

### MCP Bridge

56 tools across 14 categories for programmatic agent interaction:

**Messaging** (5) · **Clipboard** (2) · **Task Handoff** (3) · **Templates** (4) · **Workspace** (3) · **Routing & SLA** (3) · **Delegation** (4) · **GitHub** (3) · **Review** (2) · **Knowledge** (2) · **Prompts** (3) · **Workflows** (4) · **Retros** (5) · **Sessions** (9) · **Health & Search** (3)

```bash
actl bridge --account work    # start MCP bridge for an account
```

---

## Architecture

```
┌─────────────────────────────────────────────┐
│                  CLI (actl)                  │
│          meow parser + command router       │
├─────────────────────────────────────────────┤
│                  TUI (Ink)                  │
│   Dashboard │ Tasks │ Inbox │ SLA │ ...     │
├─────────────────────────────────────────────┤
│               Service Layer                 │
│  accounts │ tasks │ handoff │ council │ sla │
│  workflows │ trust │ analytics │ retros    │
├─────────────────────────────────────────────┤
│              Infrastructure                 │
│  daemon (Unix socket) │ MCP bridge │ stores │
│  providers │ terminals │ file-store         │
└─────────────────────────────────────────────┘
```

**Daemon** — Unix domain socket server (`~/.agentctl/hub.sock`) with NDJSON protocol. Handles message routing, task state, workspace management, council orchestration, session sharing, and config hot-reload.

**Built with:** [Bun](https://bun.sh) · [Ink](https://github.com/vadimdemedes/ink) · [meow](https://github.com/sindresorhus/meow) · [MCP SDK](https://github.com/modelcontextprotocol/sdk) · [Zod](https://github.com/colinhacks/zod)

---

## Configuration

Config file: `~/.agentctl/config.json`

```bash
actl config set theme "tokyonight"
actl config set features.council true
actl config set notifications.enabled true
actl config set defaults.launchInNewWindow false
```

Feature flags: `workspaceWorktree`, `autoAcceptance`, `capabilityRouting`, `slaEngine`, `githubIntegration`, `reviewBundles`, `knowledgeIndex`, `workflow`, `retro`, `sessions`, `trust`, `council`, `circuitBreaker`, `cognitiveFriction`, `entireMonitoring`.

Override base directory with `AGENTCTL_DIR` env var.

---

## Development

```bash
bun install && bun link              # install + register CLI
bun test                             # run all tests (124 files, 1875 tests)
bun build --compile src/cli.tsx --outfile dist/actl   # standalone binary
```

---

## License

[MIT](LICENSE)
