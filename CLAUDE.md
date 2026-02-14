# agentctl

Multi-account AI agent manager -- TUI dashboard, inter-agent messaging, task handoff, MCP bridge.

## Commands

```bash
# Install
bun install && bun link                    # install deps + register `actl` CLI globally
brew tap ylcn91/agentctl && brew install agentctl  # or install via Homebrew

# Development
bun test                                   # run all tests (~124 files)
bun test test/<name>.test.ts               # run a single test file
bun build --compile src/cli.tsx --outfile dist/actl  # build standalone binary

# TUI & Daemon
actl                                       # launch TUI dashboard
actl daemon start                          # start Unix socket daemon (required for messaging/handoff)
actl daemon stop                           # stop daemon
actl daemon status                         # show daemon status
actl daemon supervise                      # start daemon with auto-restart supervisor

# Account Management
actl add <name> [--dir --color --label --provider]   # add new account
actl remove <name> [--purge]               # remove account (--purge deletes config dir)
actl rotate-token <name>                   # rotate account auth token
actl list                                  # list accounts
actl status                                # show account status
actl usage                                 # show usage table

# Agent Operations
actl launch <name> [dir] [--resume --no-window --bypass-permissions --no-entire]
actl bridge --account <name>               # start MCP bridge for an account (internal)

# Config
actl config set <key> <value>              # set config value (dot-path notation)
actl config reload                         # hot-reload config via daemon

# Sessions & Search
actl sessions [--search <q>]               # list or search named sessions
actl session name <id> <name>              # name a session
actl replay <session-id> [--json]          # replay entire.io checkpoint
actl search <pattern>                      # search across accounts
actl find <pattern>                        # find accounts/resources
actl health [account]                      # health check
actl help [topic]                          # show help
```

## Bun

- Use `bun` everywhere -- not node, npm, npx, jest, vite, or webpack
- Use `Bun.file()` over node:fs readFile/writeFile
- Bun auto-loads .env -- don't use dotenv
- Tests use `import { test, expect } from "bun:test"`

## Architecture

CLI (meow) -> TUI (Ink/React) -> Services -> Daemon (Unix socket) -> MCP bridge

Key directories:
- `src/cli.tsx` -- CLI entry point & command router (20+ subcommands)
- `src/app.tsx` -- TUI root (Ink)
- `src/components/` -- Dashboard, TaskBoard, MessageInbox, SLABoard, CouncilPanel, DelegationChain, HealthDashboard, HelpOverlay, VerificationView, WorkflowBoard, WorkflowDetail, Analytics, PromptLibrary, EntireSessions, CommandPalette, Sidebar, etc.
- `src/themes/` -- Theme system: `types.ts` (theme type definitions), `definitions.ts` (15 built-in themes), `index.ts` (exports & useTheme hook)
- `src/daemon/` -- Unix socket server, state, framing, stores (message, workspace, capability, knowledge, session, trust), health-monitor, watchdog, supervisor, config-watcher, shared-session
- `src/mcp/` -- MCP bridge (`bridge.ts`) + tool registrations split into `tools/` domain modules (messaging, handoff, tasks, workspace, prompts, github, review, knowledge, analytics, workflow, retro, health, sessions, search)
- `src/services/` -- Business logic (50+ modules): account-manager, tasks, handoff, sla-engine, council, council-store, event-bus, circuit-breaker, cognitive-friction, verification-council, verification-receipts, adaptive-coordinator, progress-tracker, delegation-depth, provider-profiles, input-sanitizer, workflow-engine, workflow-parser, retro-engine, analytics, etc.
- `src/constants.ts` -- Centralized numeric constants for daemon, protocol, and infrastructure (timeouts, payload limits, reconnect bounds)
- `src/providers/` -- claude-code, codex-cli, openhands, gemini-cli, opencode, cursor-agent (6 providers)
- `src/terminals/` -- WezTerm, iTerm2, GNOME, Windows Terminal
- `src/integrations/` -- GitHub issue/PR linking, WezTerm integration
- `src/hooks/` -- Shared React hooks (useListNavigation)
- `src/application/use-cases/` -- Application-layer use cases (launch-account, load-dashboard-data, load-usage-data)
- `src/types.ts` -- Shared types, constants, path re-exports
- `src/paths.ts` -- All file path functions (20+), override base dir with `AGENTCTL_DIR` env var
- `src/config.ts` -- Zod-validated config with migration support
- `test/` -- All test files (flat, named `<module>.test.ts`)

## Code Patterns

- **File store**: `src/services/file-store.ts` provides `atomicWrite`/`atomicRead` with advisory locking (mkdir-based), plus `acquireLock`, `backupFile`, `cleanTempFiles` -- use for all JSON persistence
- **Config**: `src/config.ts` validates with Zod schemas, uses `loadConfig()`/`saveConfig()` -- never read config JSON directly. Supports `setConfigValue(dotPath, value)` for CLI, `migrateConfig()` for schema upgrades with automatic backup
- **Daemon protocol**: Newline-delimited JSON over Unix socket. First message must be `auth` with account+token. Max payload 1 MB, idle timeout 30 min. See `src/daemon/framing.ts` for `createLineParser`/`frameSend`/`generateRequestId`. Protocol constants in `src/constants.ts`. Message schemas validated via `DaemonMessageSchema` discriminated union in `src/daemon/schemas.ts`. `createLineParser` accepts optional `onError` callback for parse failure visibility
- **Feature flags**: Gated via `config.features?.flagName` (see `FeatureFlags` in `types.ts`). All flags: `workspaceWorktree`, `autoAcceptance`, `capabilityRouting`, `slaEngine`, `githubIntegration`, `reviewBundles`, `knowledgeIndex`, `reliability`, `workflow`, `retro`, `sessions`, `trust`, `council`, `circuitBreaker`, `cognitiveFriction`, `entireMonitoring`
- **Paths**: All file paths computed in `src/paths.ts` via getter functions. Override base dir with `AGENTCTL_DIR` env var. Paths include: config, socket, PID, tokens, messages, workspaces, capabilities, knowledge, prompts, handoff-templates, clipboard, external-links, review-bundles, activity, workflow, retro, sessions, trust, receipt-key
- **Task lifecycle**: `todo -> in_progress -> ready_for_review -> accepted/rejected`. Rejection bounces back to `in_progress` automatically. Enforced transitions in `src/services/tasks.ts` via `VALID_TRANSITIONS` map. Tasks support priority (P0/P1/P2), due dates, tags, workspace context, and event history
- **Event bus**: `src/services/event-bus.ts` defines a discriminated union of delegation lifecycle events (TASK_CREATED, TASK_ASSIGNED, CHECKPOINT_REACHED, PROGRESS_UPDATE, etc.). Used for observability across the system
- **Council**: Multi-account analysis (`src/services/council.ts`) and verification (`src/services/verification-council.ts`). Both flows route through daemon handlers (`src/daemon/handlers/council.ts`) for consistent feature-flag gating. LLM timeout enforced via `Promise.race` in `council-framework.ts` (configurable `timeoutMs`, default 30s). Results persisted via `src/services/council-store.ts` for CouncilPanel UI history. Config: `council.members`, `council.chairman`, `council.timeoutMs`. Feature-gated on `council` flag
- **Themes**: 15 built-in themes in `src/themes/`. Config: `theme?: string` field in HubConfig. Set via `actl config set theme "tokyonight"`. All 24 components use `useTheme()` hook
- **Command Palette**: `Ctrl+P` opens fuzzy-search overlay for all views and actions (`src/components/CommandPalette.tsx`)
- **Leader Keys**: `Ctrl+X` prefix with 500ms chord timeout. `Ctrl+X b` toggles info sidebar, `Ctrl+X p` opens command palette
- **Input sanitizer**: `src/services/input-sanitizer.ts` -- validate/sanitize all external inputs. Includes `sanitizeShellCommand()` for acceptance runner (blocks injection patterns), `sanitizeSearchQuery()` for search stores, and `sanitizeHandoffPayload()` for handoff validation
- **CLI validation**: All CLI commands validate inputs via Zod schemas in `src/daemon/schemas.ts` (ConfigSetArgsSchema, SessionNameArgsSchema, LaunchDirSchema, SearchPatternSchema, AddAccountArgsSchema) before passing to services

## MCP Tools (56 registered)

Core: send_message, read_messages, list_accounts, copy_context, paste_context, count_unread, archive_messages
Tasks: handoff_task, update_task_status, accept_handoff, suggest_assignee, check_sla, report_progress, analyze_task, check_adaptive_sla, verify_task, get_trust_scores
Workspace: prepare_workspace, get_workspace_status, cleanup_workspace
Templates: handoff_from_template, list_handoff_templates, save_handoff_template, list_handoff_types
Prompts: save_prompt, list_prompts, use_prompt
GitHub: link_to_github, get_task_links, sync_github_status
Review: get_review_bundle, generate_review_bundle
Knowledge: search_knowledge, index_note
Analytics: get_analytics
Workflows: trigger_workflow, workflow_status, list_workflows, cancel_workflow
Retros: start_retro, submit_retro_review, submit_retro_synthesis, retro_status, get_past_learnings
Health: daemon_health, check_account_health
Sessions: share_session, join_session, session_broadcast, session_status, session_history, leave_session, name_session, list_named_sessions, search_sessions
Search: search_across_accounts

## Testing

- 124 test files in `test/` (flat directory, not nested under src)
- Tests mock file I/O and daemon connections -- some tests (auth-reconnect, council-framework) use real Unix sockets and real processes for behavioral verification
- Use `import { test, expect, describe, beforeEach, mock } from "bun:test"`
- Mock pattern: `mock.module("../src/services/file-store", () => ({ atomicRead: ..., atomicWrite: ... }))`
- Test helpers in `test/helpers/` and `test/fixtures/`

## Build & Release

- `bun build --compile src/cli.tsx --outfile dist/actl` -- standalone binary
- `.github/workflows/release.yml` -- builds macOS (arm64/x64) + Linux (x64) binaries on tag push
- Release flow: push a `v*` tag -> GitHub Actions builds binaries -> creates release -> updates Homebrew formula
- Check release status: `gh run list --limit 5`
- Latest tag convention: semver (v0.1.0, v0.2.0, v0.3.0)
- Auto-updates Homebrew formula at `ylcn91/homebrew-agentctl` on release
- Requires `HOMEBREW_TAP_TOKEN` secret for formula auto-update

## Gotchas

- The binary is `actl` or `agentctl` (both work via package.json `bin`)
- Config lives at `~/.agentctl/config.json`, socket at `~/.agentctl/hub.sock`
- Account tokens are per-file at `~/.agentctl/tokens/<name>.token` -- verified with `timingSafeEqual`
- Rejected tasks auto-bounce to `in_progress` (not a terminal state) -- see `rejectTask()` in `tasks.ts`
- Provider list has 6 entries: claude-code, codex-cli, openhands, gemini-cli, opencode, cursor-agent
- Daemon supervisor (`actl daemon supervise`) auto-restarts the daemon on crash
- `config reload` sends a `config_reload` message over the socket -- requires daemon to be running
- `COMMANDS` array in `CommandPalette.tsx` is exported and tested for exact count in `test/command-palette.test.ts` -- update the count test when adding/removing commands
- Large TUI components use `React.memo()` -- `typeof` check returns "object" not "function"; use `expect(Component).toBeTruthy()` in tests
- Daemon handler modules live in `src/daemon/handlers/` (messaging, handoff, tasks, workspace, council, knowledge, sessions, workflow, health, misc) -- add new handlers there, not in server.ts
