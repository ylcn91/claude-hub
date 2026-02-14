```
 █████╗   ██╗
██╔══██╗ ███║
╚█████╔╝ ╚██║
 ╚═══██║  ██║
 █████╔╝  ██║
 ╚════╝   ╚═╝
```

# agentctl

**Multi-account AI agent manager** — run multiple Claude Code, Codex CLI, OpenHands, and Gemini CLI accounts from a single TUI dashboard with inter-agent messaging, task handoff, SLA monitoring, and capability-based routing.

```
actl                          # launch TUI dashboard
actl add work                 # add a new account
actl launch work ~/project    # open in a new terminal
actl daemon start             # enable inter-agent communication
```

---

## Features

- **Multi-account management** — add, remove, launch, and monitor AI agent accounts with isolated config directories
- **TUI dashboard** — Ink/React terminal UI with accounts, tasks, messages, SLA board, and prompt library views
- **Inter-agent messaging** — send messages and share clipboard context between accounts via daemon
- **Structured task handoff** — hand off tasks with goals, acceptance criteria, run commands, and blockers
- **Auto-acceptance** — automatically run acceptance suites when tasks are submitted for review
- **Workspace isolation** — git worktree-based workspaces so agents work on isolated branches
- **Capability routing** — score and rank accounts by skill match, success rate, speed, and recency
- **SLA monitoring** — detect stale tasks and escalate with ping, reassign, or escalate actions
- **Prompt library** — save, search, and reuse prompts across accounts
- **Handoff templates** — reusable task handoff contracts (built-in and custom)
- **Notifications** — OS-native notifications for rate limits, handoffs, and messages
- **Multi-provider** — Claude Code, Codex CLI, OpenHands, Gemini CLI, OpenCode, Cursor Agent
- **Multi-terminal** — WezTerm, iTerm2, GNOME Terminal, Windows Terminal
- **MCP bridge** — 55 MCP tools for AI agents to interact with agentctl programmatically

---

## Quick Start

```bash
# Install
bun install
bun link

# Add your first account
actl add work

# Start the daemon (enables messaging & handoff)
actl daemon start

# Launch the TUI
actl
```

### Adding accounts

```bash
actl add work                                    # defaults to claude-code provider
actl add codex --provider codex-cli              # use Codex CLI
actl add cursor --provider cursor-agent         # use Cursor Agent
actl add opencode --provider opencode            # use OpenCode
actl add review --color "#f38ba8" --label "Code Review"
```

Each account gets:
- An isolated config directory (`~/.claude-<name>`)
- A unique token for daemon authentication
- A shell alias added to `.zshrc`

---

## CLI Reference

### Account Management

| Command | Description |
|---------|-------------|
| `actl add <name>` | Add new account |
| `actl remove <name>` | Remove account |
| `actl rotate-token <name>` | Rotate account token |
| `actl list` | List all accounts |
| `actl status` | Show account status and quota |
| `actl usage` | Detailed usage table |

#### `actl add` flags

| Flag | Description | Default |
|------|-------------|---------|
| `--dir` | Config directory | `~/.claude-<name>` |
| `--color` | Hex color for TUI | Catppuccin palette |
| `--label` | Display label | Capitalized name |
| `--provider` | Provider type | `claude-code` (default) |

#### `actl remove` flags

| Flag | Description |
|------|-------------|
| `--purge` | Also delete the config directory on disk |

### Launch

```bash
actl launch <name> [dir] [flags]
```

| Flag | Description |
|------|-------------|
| `--resume` | Resume last session |
| `--no-window` | Print shell command instead of opening terminal |
| `--bypass-permissions` | Skip permission checks |
| `--no-entire` | Skip auto-enabling entire monitoring |

### Daemon

| Command | Description |
|---------|-------------|
| `actl daemon start` | Start agentctl daemon (background) |
| `actl daemon stop` | Stop the daemon |
| `actl daemon status` | Check if daemon is running |

### Configuration

```bash
actl config set <dot.path> <value>
```

```bash
actl config set notifications.enabled true
actl config set notifications.events.rateLimit false
actl config set defaults.launchInNewWindow false
```

### Help

```bash
actl help              # overview of all commands
actl help launch       # detailed help for a command
actl help daemon
```

---

## TUI Dashboard

Run `actl` with no arguments to open the interactive dashboard.

### Views

| Key | View | Description |
|-----|------|-------------|
| `d` | Dashboard | Account cards with status, quota, and activity |
| `l` | Launcher | Quick-launch accounts into terminal windows |
| `u` | Usage | Detailed usage stats per account |
| `t` | Tasks | Task board with status columns |
| `m` | Inbox | Inter-account message inbox |
| `a` | Add | Add a new account interactively |
| `e` | SLA | SLA violation board with escalations |
| `r` | Prompts | Prompt library browser |

### Keybindings

| Key | Action |
|-----|--------|
| `j` / `k` | Navigate up/down |
| `Enter` | Select |
| `Escape` | Back to dashboard |
| `q` | Quit |

---

## MCP Tools

The MCP bridge exposes 55 tools that AI agents can use to communicate with agentctl. Start the bridge per-account:

```bash
actl bridge --account work
```

### Messaging

| Tool | Description |
|------|-------------|
| `send_message` | Send a message to another account |
| `read_messages` | Read unread messages (with pagination) |
| `count_unread` | Get unread message count |
| `archive_messages` | Archive old read messages |
| `list_accounts` | List all registered accounts and status |

### Clipboard

| Tool | Description |
|------|-------------|
| `copy_context` | Copy content to the shared clipboard |
| `paste_context` | Get recent clipboard entries |

### Task Handoff

| Tool | Description |
|------|-------------|
| `handoff_task` | Hand off a task with structured contract |
| `accept_handoff` | Accept a pending handoff (auto-creates workspace) |
| `update_task_status` | Update task status following lifecycle rules |

### Handoff Templates

| Tool | Description |
|------|-------------|
| `handoff_from_template` | Create handoff from a saved template |
| `list_handoff_templates` | List all available templates |
| `save_handoff_template` | Save a new template for reuse |

### Workspace

| Tool | Description |
|------|-------------|
| `prepare_workspace` | Create an isolated git worktree for a task |
| `get_workspace_status` | Get workspace status by ID or repo+branch |
| `cleanup_workspace` | Remove a worktree and clean up resources |

### Routing & SLA

| Tool | Description |
|------|-------------|
| `suggest_assignee` | Capability-based routing recommendations |
| `check_sla` | Check for stale tasks violating SLA thresholds |

### Prompt Library

| Tool | Description |
|------|-------------|
| `save_prompt` | Save a prompt with tags |
| `list_prompts` | List or search prompts |
| `use_prompt` | Retrieve a prompt by ID (increments usage count) |

---

## Daemon

The daemon is a Unix domain socket server that enables inter-account communication. All MCP bridge instances connect to it.

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│ Account A│     │ Account B│     │ Account C│
│ (bridge) │     │ (bridge) │     │ (bridge) │
└────┬─────┘     └────┬─────┘     └────┬─────┘
     │                │                │
     └───────┬────────┴────────┬───────┘
             │                 │
        ┌────▼─────────────────▼────┐
        │     agentctl Daemon       │
        │  ~/.agentctl/hub.sock   │
        │                           │
        │  • Message routing        │
        │  • Task state             │
        │  • Workspace management   │
        │  • Capability store       │
        │  • SLA timer              │
        └───────────────────────────┘
```

### Protocol

The daemon uses newline-delimited JSON over a Unix socket. The first message from each client must be an `auth` handshake with account name and token. Subsequent messages are request/response pairs with optional `requestId` for correlation.

### Start / Stop

```bash
actl daemon start    # writes PID to ~/.agentctl/daemon.pid
actl daemon status   # checks if PID is alive + socket exists
actl daemon stop     # sends SIGTERM to daemon PID
```

---

## Task Handoff

Tasks follow a strict lifecycle with enforced transitions:

```
todo → in_progress → ready_for_review → accepted
                                      → rejected → (back to in_progress)
```

### Handoff Payload Schema

```typescript
{
  goal: string;                    // what the task should accomplish
  acceptance_criteria: string[];   // at least 1 criterion
  run_commands: string[];          // commands to verify the work
  blocked_by: string[];            // task IDs or ["none"]
}
```

Optional context: `branch`, `projectDir`, `notes`.

### Auto-Acceptance

When the `autoAcceptance` feature flag is enabled, submitting a task for review triggers automatic execution of the handoff's `run_commands`. If all pass, the task is accepted; otherwise it's rejected with a summary.

### Templates

Save reusable handoff contracts:

```
save_handoff_template  → saves defaults for acceptance_criteria, run_commands, blocked_by
handoff_from_template  → loads template, merges with overrides, validates, and sends
```

---

## Workspace Isolation

When the `workspaceWorktree` feature flag is enabled, agentctl creates isolated git worktrees for each task.

```
repo/
├── .worktrees/
│   ├── feature-auth/      ← worktree for auth task
│   └── fix-bug-123/       ← worktree for bug fix
├── src/
└── ...
```

- **`prepare_workspace`** — creates a worktree at `<repo>/.worktrees/<branch>`
- **`accept_handoff`** — auto-creates a workspace if repo context is provided
- **`cleanup_workspace`** — removes worktree and cleans up store entry
- Workspace statuses: `preparing` → `ready` → `cleaning` (or `failed`)
- Path traversal protection on branch names

---

## Capability Routing

When the `capabilityRouting` feature flag is enabled, agentctl scores accounts for task assignment.

### Scoring Formula (100 points max)

| Factor | Points | Breakdown |
|--------|--------|-----------|
| **Skill match** | 40 | `(matching_skills / required_skills) * 40` |
| **Success rate** | 30 | `(accepted / total) * 30` (15 if no history) |
| **Speed** | 20 | `<5m → 20`, `<15m → 15`, `<30m → 10`, else `5` |
| **Recency** | 10 | `≤10m → 10`, `≤30m → 7`, `≤60m → 4`, else `1` |

Use `suggest_assignee` to get ranked recommendations with score breakdowns.

---

## SLA Monitoring

When the `slaEngine` feature flag is enabled, the daemon periodically checks for stale tasks and sends OS notifications.

### Default Thresholds

| Status | Threshold | Escalation |
|--------|-----------|------------|
| `in_progress` | 30 min | **ping** assignee |
| `in_progress` | 60 min | **reassign** suggestion |
| `in_progress` + blocked | 15 min | **escalate** immediately |
| `ready_for_review` | 10 min | **ping** reviewer |

Check interval: every 60 seconds.

Use `check_sla` to manually trigger a check and get escalation recommendations.

---

## Prompt Library

Save and reuse prompts across accounts.

### MCP Tools

- **`save_prompt`** — save with title, content, and optional tags
- **`list_prompts`** — list all or search by query (filters title and tags)
- **`use_prompt`** — retrieve by ID (increments usage counter)

### TUI

Press `r` in the dashboard to browse the prompt library.

---

## Configuration

Config file: `~/.agentctl/config.json`

```typescript
{
  schemaVersion: 1,
  accounts: [
    {
      name: "work",
      configDir: "~/.claude-work",
      color: "#cba6f7",
      label: "Work",
      provider: "claude-code",       // claude-code | codex-cli | openhands | gemini-cli | opencode | cursor-agent
      quotaPolicy?: {
        plan: "max-5x",              // max-5x | max-20x | pro | unknown
        windowMs: 18000000,          // 5 hours
        estimatedLimit: 225,
        source: "community-estimate"
      }
    }
  ],
  entire: { autoEnable: true },
  notifications?: {
    enabled: true,
    events: {
      rateLimit: true,
      handoffReceived: true,
      messageReceived: true
    },
    muteList?: ["account-name"]
  },
  features?: {
    workspaceWorktree?: true,
    autoAcceptance?: true,
    capabilityRouting?: true,
    slaEngine?: true
  },
  defaults: {
    launchInNewWindow: true,
    quotaPolicy: {
      plan: "max-5x",
      windowMs: 18000000,
      estimatedLimit: 225,
      source: "community-estimate"
    }
  }
}
```

### File Paths

| Path | Purpose |
|------|---------|
| `~/.agentctl/config.json` | agentctl configuration |
| `~/.agentctl/tokens/<name>.token` | Account auth tokens |
| `~/.agentctl/messages/` | Message store |
| `~/.agentctl/tasks.json` | Task board state |
| `~/.agentctl/daemon.pid` | Daemon PID file |
| `~/.agentctl/hub.sock` | Daemon Unix socket |
| `~/.agentctl/daemon.log` | Daemon log |
| `~/.agentctl/prompts.json` | Prompt library |
| `~/.agentctl/templates/` | Custom handoff templates |

Override the base directory with `AGENTCTL_DIR` environment variable.

---

## Providers

| ID | Name | Icon | Supports Entire |
|----|------|------|-----------------|
| `claude-code` | Claude Code | ✦ | Yes |
| `codex-cli` | Codex CLI | 🧬 | No |
| `openhands` | OpenHands | 🖐️ | No |
| `gemini-cli` | Gemini CLI | ♊ | No |
| `opencode` | OpenCode | 🔓 | No |
| `cursor-agent` | Cursor Agent | 🎯 | No |

Each provider implements process detection, launch command building, usage source reading, and quota estimation.

---

## Terminal Support

| ID | Name | Platform |
|----|------|----------|
| `wezterm` | WezTerm | macOS |
| `iterm` | iTerm2 | macOS |
| `gnome-terminal` | GNOME Terminal | Linux |
| `windows-terminal` | Windows Terminal | Windows |

The terminal registry auto-detects the best available terminal for the current platform.

---

## Architecture

```
┌─────────────────────────────────────────────┐
│                  CLI (actl)                  │
│          meow parser + command router       │
├─────────────────────────────────────────────┤
│                  TUI (Ink)                  │
│   Dashboard │ Tasks │ Inbox │ SLA │ Prompts │
├─────────────────────────────────────────────┤
│              Application Layer              │
│     use-cases: launch, dashboard, usage     │
├─────────────────────────────────────────────┤
│               Service Layer                 │
│  account-manager │ tasks │ handoff │ sla    │
│  capabilities │ workspace │ prompts │ notif │
├─────────────────────────────────────────────┤
│              Infrastructure                 │
│  daemon (Unix socket) │ MCP bridge │ store  │
│  providers │ terminals │ file-store         │
└─────────────────────────────────────────────┘
```

Built with:
- **Runtime** — [Bun](https://bun.sh)
- **TUI** — [Ink](https://github.com/vadimdemedes/ink) (React for CLIs)
- **CLI** — [meow](https://github.com/sindresorhus/meow)
- **MCP** — [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/sdk)
- **Styling** — [Chalk](https://github.com/chalk/chalk)

---

## Testing

```bash
bun test                     # run all tests
bun test test/               # unit tests
bun test tests/              # integration tests
bun test test/daemon.test.ts # single file
```

Test coverage includes: daemon protocol, MCP bridge, task lifecycle, handoff validation, SLA engine, capability routing, workspace management, provider interface, terminal profiles, config migration, prompt library, and TUI components.

---

## Project Structure

```
agentctl/
├── src/
│   ├── cli.tsx                  # CLI entry point & command router
│   ├── app.tsx                  # TUI root component
│   ├── config.ts                # Config loader/saver/migrator
│   ├── types.ts                 # Shared types & constants
│   ├── application/
│   │   └── use-cases/           # Launch, dashboard, usage use-cases
│   ├── components/
│   │   ├── Dashboard.tsx        # Account cards view
│   │   ├── TaskBoard.tsx        # Task kanban board
│   │   ├── MessageInbox.tsx     # Message inbox
│   │   ├── SLABoard.tsx         # SLA violation board
│   │   ├── PromptLibrary.tsx    # Prompt browser
│   │   ├── Launcher.tsx         # Quick-launch panel
│   │   └── ...                  # Header, AddAccount, UsageDetail, etc.
│   ├── daemon/
│   │   ├── server.ts            # Unix socket daemon
│   │   ├── state.ts             # In-memory daemon state
│   │   ├── framing.ts           # Newline-delimited JSON framing
│   │   ├── workspace-manager.ts # Git worktree operations
│   │   ├── workspace-store.ts   # Workspace persistence
│   │   ├── capability-store.ts  # Account capability persistence
│   │   ├── message-store.ts     # Message persistence
│   │   └── auto-launcher.ts     # Auto-launch logic
│   ├── mcp/
│   │   ├── bridge.ts            # MCP server ↔ daemon bridge
│   │   └── tools.ts             # 55 MCP tool registrations
│   ├── providers/
│   │   ├── claude-code.ts       # Claude Code provider
│   │   ├── codex-cli.ts         # Codex CLI provider
│   │   ├── openhands.ts         # OpenHands provider
│   │   ├── gemini-cli.ts        # Gemini CLI provider
│   │   ├── opencode.ts          # OpenCode provider
│   │   ├── cursor-agent.ts      # Cursor Agent provider
│   │   └── registry.ts          # Provider registry
│   ├── services/
│   │   ├── account-manager.ts   # Account CRUD + shell aliases
│   │   ├── tasks.ts             # Task board + lifecycle transitions
│   │   ├── handoff.ts           # Handoff payload validation
│   │   ├── handoff-templates.ts # Template CRUD
│   │   ├── sla-engine.ts        # SLA threshold checks
│   │   ├── account-capabilities.ts # Capability scoring
│   │   ├── workspace.ts         # Workspace types + validation
│   │   ├── prompt-library.ts    # Prompt CRUD + search
│   │   ├── notifications.ts     # OS notification dispatch
│   │   ├── clipboard.ts         # Shared clipboard
│   │   └── ...                  # file-store, cli-commands, help, etc.
│   └── terminals/
│       ├── wezterm.ts           # WezTerm profile
│       ├── iterm.ts             # iTerm2 profile
│       ├── gnome.ts             # GNOME Terminal profile
│       ├── windows-terminal.ts  # Windows Terminal profile
│       └── registry.ts          # Terminal auto-detection
├── test/                        # Unit tests
├── tests/                       # Integration tests
├── docs/plans/                  # Roadmap & sprint plans
├── index.ts                     # Entry point
└── package.json
```
