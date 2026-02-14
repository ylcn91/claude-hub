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

**Multi-account AI agent manager** — run multiple Claude Code, Codex CLI, OpenHands, and Gemini CLI accounts from a single TUI dashboard with inter-agent messaging, task handoff, SLA monitoring, and capability-based routing.

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
bun install
bun link    # registers `actl` and `agentctl` globally
```

### Standalone Binary

Pre-built binaries for macOS (arm64, x64) and Linux (x64) are attached to each [GitHub Release](https://github.com/ylcn91/agentctl/releases).

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
- **Adaptive SLA** — graduated responses based on task criticality and progress
- **Prompt library** — save, search, and reuse prompts across accounts
- **Handoff templates** — reusable task handoff contracts (built-in and custom)
- **Notifications** — OS-native notifications for rate limits, handoffs, and messages
- **Multi-provider** — Claude Code, Codex CLI, OpenHands, Gemini CLI, OpenCode, Cursor Agent
- **Multi-terminal** — WezTerm, iTerm2, GNOME Terminal, Windows Terminal
- **MCP bridge** — 56 MCP tools for AI agents to interact with agentctl programmatically
- **GitHub integration** — link tasks to issues/PRs with status sync
- **Review bundles** — auto-generate diff summaries, test results, and risk notes for review
- **Knowledge index** — full-text search across prompts, handoffs, decisions, and notes
- **Analytics** — cycle times, accept/reject ratios, per-account productivity, SLA violations
- **Live session sharing** — pair-programming sessions between accounts with real-time updates
- **Session naming** — name, tag, and search sessions for future reference
- **Multi-model council** — pre-delegation task analysis using multiple LLMs via OpenRouter
- **Council verification** — multi-LLM review of completed work against acceptance criteria
- **Trust & reputation** — track agent completion rate, SLA compliance, and quality metrics
- **Progress tracking** — agents report intermediate progress for proactive monitoring
- **Workflow automation** — YAML-based DAG workflows with steps, conditions, and retries
- **Retrospectives** — AI-powered post-session retrospectives with learnings
- **Delegation chains** — track delegation depth to prevent accountability vacuums
- **Cross-account code search** — search for patterns across all account working directories
- **Circuit breaker** — failure handling for agent reliability
- **Daemon supervisor** — auto-restart and health watchdog for the daemon process
- **Session replay** — replay Entire checkpoint transcripts with timeline visualization

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
| `actl find <pattern>` | Find accounts by name, label, color, or provider |

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
| `actl daemon supervise` | Start daemon with auto-restart supervisor |

### Search

| Command | Description |
|---------|-------------|
| `actl search <pattern>` | Search for a pattern across all account working directories |
| `actl find <pattern>` | Find accounts matching a pattern |

### Health

```bash
actl health [account]        # show health status for all or a specific account
```

### Sessions

| Command | Description |
|---------|-------------|
| `actl sessions` | List all named sessions |
| `actl sessions --search <query>` | Search sessions by name |
| `actl session name <id> <name>` | Name or rename a session |

### Replay

```bash
actl replay <session-id>          # replay Entire checkpoint transcript
actl replay <session-id> --json   # output as JSON
```

### Configuration

```bash
actl config set <dot.path> <value>
actl config reload                    # hot-reload config via daemon
```

```bash
actl config set notifications.enabled true
actl config set notifications.events.rateLimit false
actl config set defaults.launchInNewWindow false
actl config set features.council true
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
| `n` | Analytics | Usage analytics and trends |
| `w` | Workflows | Workflow execution board |
| `h` | Health | Account health monitoring |
| `c` | Council | Multi-model task analysis |
| `v` | Verification | Task verification receipts |
| `i` | Entire | Claude Enterprise session monitoring |
| `g` | Chains | Delegation chain tracking |

### Keybindings

| Key | Action |
|-----|--------|
| `j` / `k` | Navigate up/down |
| `Enter` | Select |
| `Escape` | Back to dashboard |
| `q` | Quit |
| `?` | Toggle help overlay |

---

## MCP Tools

The MCP bridge exposes 56 tools that AI agents can use to communicate with agentctl. Start the bridge per-account:

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
| `handoff_task` | Hand off a task with structured contract (supports enriched characteristics) |
| `accept_handoff` | Accept a pending handoff (auto-creates workspace) |
| `update_task_status` | Update task status following lifecycle rules |

### Handoff Templates

| Tool | Description |
|------|-------------|
| `handoff_from_template` | Create handoff from a saved template |
| `list_handoff_templates` | List all available templates |
| `save_handoff_template` | Save a new template for reuse |
| `list_handoff_types` | List all template types with descriptions and defaults |

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
| `check_adaptive_sla` | Adaptive SLA with graduated responses (ping, reassign, quarantine, escalate) |

### Intelligent Delegation

| Tool | Description |
|------|-------------|
| `report_progress` | Report intermediate task progress for proactive monitoring |
| `analyze_task` | Multi-model council analysis before delegation |
| `get_trust_scores` | Trust and reputation scores for agents |
| `verify_task` | Multi-LLM council verification of completed work |

### GitHub Integration

| Tool | Description |
|------|-------------|
| `link_to_github` | Link a task to a GitHub issue or PR |
| `get_task_links` | Get all external links for a task |
| `sync_github_status` | Get current status of a linked GitHub issue |

### Review Bundles

| Tool | Description |
|------|-------------|
| `get_review_bundle` | Get review bundle for a task (diff, tests, risks) |
| `generate_review_bundle` | Generate review bundle with git diff analysis and risk assessment |

### Knowledge Index

| Tool | Description |
|------|-------------|
| `search_knowledge` | Full-text search across prompts, handoffs, events, and notes |
| `index_note` | Index a note or decision for future search |

### Analytics

| Tool | Description |
|------|-------------|
| `get_analytics` | Operational analytics: cycle times, ratios, productivity, SLA violations |

### Prompt Library

| Tool | Description |
|------|-------------|
| `save_prompt` | Save a prompt with tags |
| `list_prompts` | List or search prompts |
| `use_prompt` | Retrieve a prompt by ID (increments usage count) |

### Workflow Automation

| Tool | Description |
|------|-------------|
| `trigger_workflow` | Trigger a workflow by name |
| `workflow_status` | Get status of a workflow run |
| `list_workflows` | List all workflow definitions |
| `cancel_workflow` | Cancel a running workflow |

### Retrospectives

| Tool | Description |
|------|-------------|
| `start_retro` | Start a retrospective session for a workflow run |
| `submit_retro_review` | Submit a review for an active retro session |
| `submit_retro_synthesis` | Submit final synthesized retro document |
| `retro_status` | Get retro session status and document |
| `get_past_learnings` | Get learnings from past retrospectives |

### Live Session Sharing

| Tool | Description |
|------|-------------|
| `share_session` | Start a pair-programming session with another account |
| `join_session` | Join a live session |
| `session_broadcast` | Send updates to the other participant |
| `session_status` | Check session status |
| `session_history` | Get recent session updates |
| `leave_session` | End participation in a session |

### Session Management

| Tool | Description |
|------|-------------|
| `name_session` | Name or rename a session with tags and notes |
| `list_named_sessions` | List named sessions (filterable by account) |
| `search_sessions` | Full-text search across named sessions |

### Health & Search

| Tool | Description |
|------|-------------|
| `daemon_health` | Daemon health: uptime, connections, memory, store status |
| `check_account_health` | Account health: connection, activity, errors, rate limits |
| `search_across_accounts` | Search for patterns across all account working directories |

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
        │  • Trust store            │
        │  • Knowledge index        │
        │  • Session sharing        │
        │  • Config hot-reload      │
        └───────────────────────────┘
```

### Protocol

The daemon uses newline-delimited JSON over a Unix socket. The first message from each client must be an `auth` handshake with account name and token. Subsequent messages are request/response pairs with optional `requestId` for correlation.

### Start / Stop

```bash
actl daemon start      # writes PID to ~/.agentctl/daemon.pid
actl daemon status     # checks if PID is alive + socket exists
actl daemon stop       # sends SIGTERM to daemon PID
actl daemon supervise  # start with auto-restart supervisor + watchdog
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

### Enriched Task Characteristics

Handoffs support enriched metadata for intelligent delegation:

| Field | Values | Description |
|-------|--------|-------------|
| `complexity` | low, medium, high, critical | Task complexity level |
| `criticality` | low, medium, high, critical | How critical the task is |
| `uncertainty` | low, medium, high | Requirement uncertainty |
| `estimated_duration_minutes` | number | Estimated duration |
| `verifiability` | auto-testable, needs-review, subjective | How to verify the outcome |
| `reversibility` | reversible, partial, irreversible | Can changes be reverted? |
| `required_skills` | string[] | Skills needed |
| `autonomy_level` | strict, standard, open-ended | Delegatee autonomy |
| `monitoring_level` | outcome-only, periodic, continuous | Monitoring frequency |

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

### Adaptive SLA

The `check_adaptive_sla` tool provides graduated responses based on task criticality and progress: ping, reassign, quarantine, or escalate. Agents report progress via `report_progress` to enable behind-schedule detection.

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

## Workflow Automation

When the `workflow` feature flag is enabled, agentctl supports YAML-based workflow automation with steps, conditions, and retries.

### Workflow Definition

```yaml
name: code-review-pipeline
trigger: on_task_handoff
steps:
  - id: analyze
    action: council.analyze
    input: "{{ task.goal }}"
  - id: review
    action: task.assign
    condition: "{{ steps.analyze.complexity != 'critical' }}"
    input:
      assignee: "{{ steps.analyze.recommendedProvider }}"
  - id: escalate
    action: notification.send
    condition: "{{ steps.analyze.complexity == 'critical' }}"
```

### TUI

Press `w` in the dashboard to view workflow executions.

---

## Multi-Model Council

When the `council` feature flag is enabled, agentctl can analyze tasks using multiple LLM models and reach consensus on approach, complexity, and provider selection.

### How It Works

1. Task goal is sent to multiple models via OpenRouter
2. Each model returns analysis (complexity, duration, skills, risks)
3. Models rank each other's responses
4. Chairman model synthesizes consensus

### Council Verification

The `verify_task` tool runs multi-LLM council verification on completed work. Multiple models independently review the diff against the goal and acceptance criteria, then a chairman produces a final verdict: ACCEPT, REJECT, or ACCEPT_WITH_NOTES.

### Configuration

```json
{
  "council": {
    "models": ["anthropic/claude-3.5-sonnet", "google/gemini-2.0-flash"],
    "chairman": "anthropic/claude-3.5-sonnet",
    "apiKey": "your-openrouter-key"
  }
}
```

### TUI

Press `c` in the dashboard to access the Council panel. Press `v` for verification receipts.

---

## Live Session Sharing

When the `sessions` feature flag is enabled, accounts can start pair-programming sessions with real-time updates.

### How It Works

1. Account A starts a session with `share_session` targeting Account B
2. Account B joins with `join_session`
3. Both participants exchange updates via `session_broadcast`
4. Either can leave with `leave_session`

### Session Naming

Sessions can be named, tagged, and searched for easy reference:
- `name_session` — assign a human-readable name and tags
- `list_named_sessions` — list sessions, filterable by account
- `search_sessions` — full-text search across session names, tags, and notes

### CLI

```bash
actl sessions                      # list all named sessions
actl sessions --search "auth"      # search sessions
actl session name <id> "Auth Fix"  # name a session
```

---

## GitHub Integration

When the `githubIntegration` feature flag is enabled, tasks can be linked to GitHub issues and PRs.

### MCP Tools

- **`link_to_github`** — link a task to an issue or PR
- **`get_task_links`** — get all external links for a task
- **`sync_github_status`** — check the current status of a linked issue

---

## Review Bundles

When the `reviewBundles` feature flag is enabled, agentctl can auto-generate comprehensive review bundles for tasks.

### What's Included

- Git diff summary (files changed, insertions, deletions)
- Test execution results
- Risk assessment notes

### MCP Tools

- **`generate_review_bundle`** — generate a bundle from a branch diff
- **`get_review_bundle`** — retrieve a saved bundle for a task

---

## Knowledge Index

When the `knowledgeIndex` feature flag is enabled, agentctl maintains a full-text search index across prompts, handoffs, task events, and decision notes.

### MCP Tools

- **`search_knowledge`** — search by query, optionally filtered by category
- **`index_note`** — index a note or decision for future search

---

## Retrospectives

When the `retro` feature flag is enabled, agentctl generates AI-powered post-session retrospectives.

### Features

- Collect evidence from Entire sessions (tokens, files modified, duration)
- Prompt participants for feedback
- Generate structured documentation with learnings
- Track delta from past retrospectives

### TUI

Workflow retrospectives are viewable in the Workflow board (`w`).

---

## Health Monitoring

When the `entireMonitoring` feature flag is enabled, agentctl monitors account health metrics.

### Tracked Metrics

- CPU/Memory usage trends
- Error rate per account
- Average response time
- Session success rate

### CLI & TUI

```bash
actl health            # show health for all accounts
actl health <name>     # show health for one account
```

Press `h` in the dashboard to view health dashboard.

---

## Delegation Chains

Track task delegation depth to prevent accountability vacuums.

### Configuration

```json
{
  "delegationDepth": {
    "maxDepth": 3,
    "requireReauthAbove": 2
  }
}
```

### Rules

- Tasks can be delegated up to `maxDepth` times
- Beyond max depth, human re-authorization required
- Warning issued when approaching limit

### TUI

Press `g` in the dashboard to view delegation chains.

---

## Claude Enterprise (Entire)

When the `entireMonitoring` feature flag is enabled, agentctl integrates with Claude Enterprise for session monitoring.

### Features

- Track active Entire sessions per account
- Session metadata: tokens, duration, files modified
- Retro evidence collection for post-session reviews
- Session replay with timeline visualization

### CLI

```bash
actl replay <session-id>          # replay a checkpoint transcript
actl replay <session-id> --json   # output as JSON
```

### TUI

Press `i` in the dashboard to view Entire sessions.

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
    slaEngine?: true,
    githubIntegration?: true,
    reviewBundles?: true,
    knowledgeIndex?: true,
    reliability?: true,
    workflow?: true,
    retro?: true,
    sessions?: true,
    trust?: true,
    council?: true,
    circuitBreaker?: true,
    cognitiveFriction?: true,
    entireMonitoring?: true
  },
  github?: {
    enabled: true,
    defaultOwner: "your-org",
    defaultRepo: "your-repo"
  },
  council?: {
    models: ["anthropic/claude-3.5-sonnet", "google/gemini-2.0-flash"],
    chairman: "anthropic/claude-3.5-sonnet",
    apiKey: "your-openrouter-key"
  },
  delegationDepth?: {
    maxDepth: 3
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
| `~/.agentctl/workflows.json` | Workflow definitions |
| `~/.agentctl/workflow-runs.json` | Workflow execution history |
| `~/.agentctl/health.json` | Account health data |
| `~/.agentctl/delegation-chains.json` | Delegation chain tracking |
| `~/.agentctl/retro.json` | Retrospective documents |
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
│  council │ trust │ analytics │ workflows    │
│  knowledge │ review-bundles │ retros        │
├─────────────────────────────────────────────┤
│              Infrastructure                 │
│  daemon (Unix socket) │ MCP bridge │ store  │
│  providers │ terminals │ file-store         │
│  supervisor │ watchdog │ session-store      │
└─────────────────────────────────────────────┘
```

Built with:
- **Runtime** — [Bun](https://bun.sh)
- **TUI** — [Ink](https://github.com/vadimdemedes/ink) (React for CLIs)
- **CLI** — [meow](https://github.com/sindresorhus/meow)
- **MCP** — [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/sdk)
- **Validation** — [Zod](https://github.com/colinhacks/zod)
- **Styling** — [Chalk](https://github.com/chalk/chalk)
- **Workflows** — [yaml](https://github.com/eemeli/yaml) (YAML parsing)

---

## Testing

```bash
bun test                     # run all 86 test files
bun test test/               # unit tests
bun test tests/              # integration tests
bun test test/daemon.test.ts # single file
```

Test coverage includes: daemon protocol, MCP bridge, task lifecycle, handoff validation, SLA engine, adaptive SLA, capability routing, workspace management, provider interface, terminal profiles, config migration, prompt library, council, trust scoring, progress tracking, delegation chains, circuit breaker, cognitive friction, review bundles, knowledge index, analytics, workflow engine, retro engine, GitHub integration, session sharing, verification council, event bus, and TUI components.

---

## Development

### Prerequisites

- [Bun](https://bun.sh) v1.0+
- macOS or Linux

### Building

```bash
bun build --compile src/cli.tsx --outfile dist/actl
```

### Project Structure

```
agentctl/
├── src/
│   ├── cli.tsx                  # CLI entry point & command router
│   ├── app.tsx                  # TUI root component
│   ├── config.ts                # Config loader/saver/migrator
│   ├── types.ts                 # Shared types & constants
│   ├── paths.ts                 # All file path computation
│   ├── application/
│   │   └── use-cases/           # Launch, dashboard, usage use-cases
│   ├── components/
│   │   ├── Dashboard.tsx         # Account cards view
│   │   ├── TaskBoard.tsx          # Task kanban board
│   │   ├── MessageInbox.tsx       # Message inbox
│   │   ├── SLABoard.tsx           # SLA violation board
│   │   ├── PromptLibrary.tsx      # Prompt browser
│   │   ├── Launcher.tsx           # Quick-launch panel
│   │   ├── Analytics.tsx          # Usage analytics
│   │   ├── WorkflowBoard.tsx      # Workflow execution board
│   │   ├── WorkflowDetail.tsx     # Workflow run details
│   │   ├── HealthDashboard.tsx    # Account health monitoring
│   │   ├── CouncilPanel.tsx       # Multi-model analysis
│   │   ├── VerificationView.tsx   # Task verification receipts
│   │   ├── EntireSessions.tsx     # Claude Enterprise sessions
│   │   ├── DelegationChain.tsx    # Delegation chain tracking
│   │   └── HelpOverlay.tsx        # Keyboard shortcut help
│   ├── daemon/
│   │   ├── server.ts             # Unix socket daemon
│   │   ├── state.ts              # In-memory daemon state
│   │   ├── framing.ts            # Newline-delimited JSON framing
│   │   ├── supervisor.ts         # Daemon auto-restart supervisor
│   │   ├── watchdog.ts           # Health watchdog
│   │   ├── config-watcher.ts     # Config hot-reload
│   │   ├── health-monitor.ts     # Account health monitoring
│   │   ├── health.ts             # Health status reporting
│   │   ├── workspace-manager.ts  # Git worktree operations
│   │   ├── workspace-store.ts    # Workspace persistence
│   │   ├── capability-store.ts   # Account capability persistence
│   │   ├── message-store.ts      # Message persistence
│   │   ├── knowledge-store.ts    # Knowledge index persistence
│   │   ├── session-store.ts      # Named session persistence
│   │   ├── shared-session.ts     # Live session sharing
│   │   ├── trust-store.ts        # Trust & reputation store
│   │   ├── base-store.ts         # Base store abstraction
│   │   └── auto-launcher.ts      # Auto-launch logic
│   ├── mcp/
│   │   ├── bridge.ts             # MCP server ↔ daemon bridge
│   │   └── tools.ts              # 56 MCP tool registrations
│   ├── integrations/
│   │   ├── github.ts             # GitHub issue/PR integration
│   │   └── wezterm.ts            # WezTerm integration
│   ├── providers/
│   │   ├── claude-code.ts        # Claude Code provider
│   │   ├── codex-cli.ts          # Codex CLI provider
│   │   ├── openhands.ts          # OpenHands provider
│   │   ├── gemini-cli.ts         # Gemini CLI provider
│   │   ├── opencode.ts           # OpenCode provider
│   │   ├── cursor-agent.ts       # Cursor Agent provider
│   │   └── registry.ts           # Provider registry
│   ├── services/
│   │   ├── account-manager.ts    # Account CRUD + shell aliases
│   │   ├── tasks.ts              # Task board + lifecycle transitions
│   │   ├── handoff.ts            # Handoff payload validation
│   │   ├── handoff-templates.ts  # Template CRUD
│   │   ├── sla-engine.ts         # SLA threshold checks
│   │   ├── adaptive-coordinator.ts # Adaptive SLA with graduated responses
│   │   ├── account-capabilities.ts # Capability scoring
│   │   ├── workspace.ts          # Workspace types + validation
│   │   ├── prompt-library.ts     # Prompt CRUD + search
│   │   ├── notifications.ts      # OS notification dispatch
│   │   ├── clipboard.ts          # Shared clipboard
│   │   ├── workflow-engine.ts    # YAML workflow execution
│   │   ├── workflow-parser.ts    # Workflow YAML parsing
│   │   ├── workflow-store.ts     # Workflow state persistence
│   │   ├── retro-engine.ts       # Post-session retrospectives
│   │   ├── retro-store.ts        # Retro document storage
│   │   ├── council.ts            # Multi-model analysis
│   │   ├── council-config.ts     # Council configuration
│   │   ├── verification-council.ts # Multi-LLM task verification
│   │   ├── verification-receipts.ts # Verification receipt storage
│   │   ├── progress-tracker.ts   # Task progress tracking
│   │   ├── provider-profiles.ts  # Provider capability profiles
│   │   ├── delegation-depth.ts   # Delegation chain tracking
│   │   ├── circuit-breaker.ts    # Failure handling
│   │   ├── cognitive-friction.ts # Task difficulty tracking
│   │   ├── analytics.ts          # Operational analytics
│   │   ├── knowledge-indexer.ts  # Knowledge base indexing
│   │   ├── review-bundle.ts      # Review bundle generation
│   │   ├── code-search.ts        # Cross-account code search
│   │   ├── replay.ts             # Session replay timeline
│   │   ├── entire-integration.ts # Claude Enterprise integration
│   │   ├── entire-adapter.ts     # Entire session adapter
│   │   ├── external-links.ts     # GitHub/external link management
│   │   ├── event-bus.ts          # Internal event bus
│   │   ├── input-sanitizer.ts    # Input validation & sanitization
│   │   ├── file-store.ts         # Atomic JSON persistence
│   │   ├── cli-commands.ts       # CLI command implementations
│   │   └── help.ts               # Help text generation
│   └── terminals/
│       ├── wezterm.ts            # WezTerm profile
│       ├── iterm.ts              # iTerm2 profile
│       ├── gnome.ts              # GNOME Terminal profile
│       ├── windows-terminal.ts   # Windows Terminal profile
│       └── registry.ts           # Terminal auto-detection
├── test/                         # 86 test files
├── docs/plans/                   # Roadmap & sprint plans
├── index.ts                      # Entry point
└── package.json
```

---

## License

[MIT](LICENSE)
