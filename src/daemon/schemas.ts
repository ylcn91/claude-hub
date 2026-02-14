import { z } from "zod";

// --- Base fields shared across all messages ---
const requestId = z.string().optional();

// --- Pre-auth messages (handled before authentication) ---

const AuthMessage = z.object({
  type: z.literal("auth"),
  account: z.string().min(1),
  token: z.string().min(1),
  requestId,
});

const PingMessage = z.object({
  type: z.literal("ping"),
  requestId,
});

const ConfigReloadMessage = z.object({
  type: z.literal("config_reload"),
  requestId,
});

// --- Messaging handlers ---

const SendMessageMsg = z.object({
  type: z.literal("send_message"),
  to: z.string().min(1),
  content: z.string().min(1),
  requestId,
});

const CountUnreadMessage = z.object({
  type: z.literal("count_unread"),
  requestId,
});

const ReadMessagesMessage = z.object({
  type: z.literal("read_messages"),
  limit: z.number().int().nonnegative().optional(),
  offset: z.number().int().nonnegative().optional(),
  requestId,
});

const ListAccountsMessage = z.object({
  type: z.literal("list_accounts"),
  requestId,
});

const ArchiveMessagesMessage = z.object({
  type: z.literal("archive_messages"),
  days: z.number().int().min(1).optional(),
  requestId,
});

// --- Handoff handlers ---

const HandoffTaskMessage = z.object({
  type: z.literal("handoff_task"),
  to: z.string().min(1),
  payload: z.record(z.unknown()),
  context: z.record(z.unknown()).optional(),
  requestId,
});

const ReauthorizeDelegationMessage = z.object({
  type: z.literal("reauthorize_delegation"),
  handoffId: z.string().min(1),
  newMaxDepth: z.number().int().min(1),
  requestId,
});

const HandoffAcceptMessage = z.object({
  type: z.literal("handoff_accept"),
  handoffId: z.string().min(1),
  requestId,
});

const SuggestAssigneeMessage = z.object({
  type: z.literal("suggest_assignee"),
  skills: z.array(z.string()).optional(),
  excludeAccounts: z.array(z.string()).optional(),
  priority: z.string().optional(),
  requestId,
});

// --- Task handlers ---

const UpdateTaskStatusMessage = z.object({
  type: z.literal("update_task_status"),
  taskId: z.string().min(1),
  status: z.enum(["todo", "in_progress", "ready_for_review", "accepted", "rejected"]),
  reason: z.string().optional(),
  workspacePath: z.string().optional(),
  branch: z.string().optional(),
  workspaceId: z.string().optional(),
  requestId,
});

const ReportProgressMessage = z.object({
  type: z.literal("report_progress"),
  taskId: z.string().min(1),
  percent: z.number().min(0).max(100),
  agent: z.string().optional(),
  currentStep: z.string().optional(),
  blockers: z.array(z.string()).optional(),
  estimatedRemainingMinutes: z.number().optional(),
  artifactsProduced: z.array(z.string()).optional(),
  requestId,
});

const AdaptiveSlaCheckMessage = z.object({
  type: z.literal("adaptive_sla_check"),
  config: z.record(z.unknown()).optional(),
  requestId,
});

const GetTrustMessage = z.object({
  type: z.literal("get_trust"),
  account: z.string().optional(),
  requestId,
});

const ReinstateAgentMessage = z.object({
  type: z.literal("reinstate_agent"),
  account: z.string().min(1),
  requestId,
});

const CheckCircuitBreakerMessage = z.object({
  type: z.literal("check_circuit_breaker"),
  account: z.string().optional(),
  requestId,
});

// --- Workspace handlers ---

const PrepareWorktreeMessage = z.object({
  type: z.literal("prepare_worktree_for_handoff"),
  repoPath: z.string().min(1),
  branch: z.string().min(1),
  handoffId: z.string().optional(),
  requestId,
});

const GetWorkspaceStatusMessage = z.object({
  type: z.literal("get_workspace_status"),
  id: z.string().optional(),
  repoPath: z.string().optional(),
  branch: z.string().optional(),
  requestId,
});

const CleanupWorkspaceMessage = z.object({
  type: z.literal("cleanup_workspace"),
  id: z.string().min(1),
  requestId,
});

// --- Council handlers ---

const CouncilAnalyzeMessage = z.object({
  type: z.literal("council_analyze"),
  goal: z.string().min(1),
  context: z.unknown().optional(),
  requestId,
});

// --- Knowledge handlers ---

const SearchKnowledgeMessage = z.object({
  type: z.literal("search_knowledge"),
  query: z.string().min(1),
  category: z.string().optional(),
  limit: z.number().int().positive().optional(),
  requestId,
});

const IndexNoteMessage = z.object({
  type: z.literal("index_note"),
  title: z.string().min(1),
  content: z.string().min(1),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  requestId,
});

// --- Session handlers ---

const ShareSessionMessage = z.object({
  type: z.literal("share_session"),
  target: z.string().min(1),
  workspace: z.string().optional(),
  requestId,
});

const JoinSessionMessage = z.object({
  type: z.literal("join_session"),
  sessionId: z.string().min(1),
  requestId,
});

const SessionBroadcastMessage = z.object({
  type: z.literal("session_broadcast"),
  sessionId: z.string().min(1),
  data: z.unknown(),
  requestId,
});

const SessionStatusMessage = z.object({
  type: z.literal("session_status"),
  sessionId: z.string().optional(),
  requestId,
});

const SessionHistoryMessage = z.object({
  type: z.literal("session_history"),
  sessionId: z.string().min(1),
  requestId,
});

const LeaveSessionMessage = z.object({
  type: z.literal("leave_session"),
  sessionId: z.string().min(1),
  requestId,
});

const SessionPingMessage = z.object({
  type: z.literal("session_ping"),
  sessionId: z.string().min(1),
  requestId,
});

const NameSessionMessage = z.object({
  type: z.literal("name_session"),
  sessionId: z.string().min(1),
  name: z.string().min(1),
  account: z.string().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  requestId,
});

const ListSessionsMessage = z.object({
  type: z.literal("list_sessions"),
  account: z.string().optional(),
  limit: z.number().int().nonnegative().optional(),
  offset: z.number().int().nonnegative().optional(),
  requestId,
});

const SearchSessionsMessage = z.object({
  type: z.literal("search_sessions"),
  query: z.string().min(1),
  limit: z.number().int().positive().optional(),
  requestId,
});

// --- Workflow handlers ---

const WorkflowTriggerMessage = z.object({
  type: z.literal("workflow_trigger"),
  workflowName: z.string().min(1),
  context: z.string().optional(),
  requestId,
});

const WorkflowStatusMessage = z.object({
  type: z.literal("workflow_status"),
  runId: z.string().min(1),
  requestId,
});

const WorkflowListMessage = z.object({
  type: z.literal("workflow_list"),
  requestId,
});

const WorkflowCancelMessage = z.object({
  type: z.literal("workflow_cancel"),
  runId: z.string().min(1),
  requestId,
});

// --- Health handlers ---
// (ping is already defined above as PingMessage)

const HealthCheckMessage = z.object({
  type: z.literal("health_check"),
  requestId,
});

const HealthStatusMessage = z.object({
  type: z.literal("health_status"),
  requestId,
});

// --- Misc handlers ---

const SearchCodeMessage = z.object({
  type: z.literal("search_code"),
  pattern: z.string().min(1),
  targets: z.array(z.string()).optional(),
  maxResults: z.number().int().positive().optional(),
  requestId,
});

const ReplaySessionMessage = z.object({
  type: z.literal("replay_session"),
  sessionId: z.string().min(1),
  repoPath: z.string().min(1),
  requestId,
});

const LinkTaskMessage = z.object({
  type: z.literal("link_task"),
  taskId: z.string().min(1),
  url: z.string().optional(),
  externalId: z.string().optional(),
  provider: z.string().optional(),
  linkType: z.string().optional(),
  requestId,
});

const GetTaskLinksMessage = z.object({
  type: z.literal("get_task_links"),
  taskId: z.string().min(1),
  requestId,
});

const GetReviewBundleMessage = z.object({
  type: z.literal("get_review_bundle"),
  taskId: z.string().min(1),
  requestId,
});

const GenerateReviewBundleMessage = z.object({
  type: z.literal("generate_review_bundle"),
  taskId: z.string().min(1),
  workDir: z.string().optional(),
  baseBranch: z.string().optional(),
  branch: z.string().optional(),
  runCommands: z.array(z.string()).optional(),
  requestId,
});

const GetAnalyticsMessage = z.object({
  type: z.literal("get_analytics"),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  requestId,
});

const RetroStartSessionMessage = z.object({
  type: z.literal("retro_start_session"),
  workflowRunId: z.string().optional(),
  participants: z.array(z.string()).optional(),
  chairman: z.string().optional(),
  requestId,
});

const RetroSubmitReviewMessage = z.object({
  type: z.literal("retro_submit_review"),
  retroId: z.string().min(1),
  whatWentWell: z.array(z.string()).optional(),
  whatDidntWork: z.array(z.string()).optional(),
  suggestions: z.array(z.string()).optional(),
  agentPerformanceNotes: z.record(z.unknown()).optional(),
  requestId,
});

const RetroSubmitSynthesisMessage = z.object({
  type: z.literal("retro_submit_synthesis"),
  retroId: z.string().min(1),
  document: z.unknown(),
  requestId,
});

const RetroStatusMessage = z.object({
  type: z.literal("retro_status"),
  retroId: z.string().min(1),
  requestId,
});

const RetroGetPastLearningsMessage = z.object({
  type: z.literal("retro_get_past_learnings"),
  requestId,
});

// --- Discriminated union of all daemon message types ---

export const DaemonMessageSchema = z.discriminatedUnion("type", [
  // Pre-auth
  AuthMessage,
  PingMessage,
  ConfigReloadMessage,
  // Messaging
  SendMessageMsg,
  CountUnreadMessage,
  ReadMessagesMessage,
  ListAccountsMessage,
  ArchiveMessagesMessage,
  // Handoff
  HandoffTaskMessage,
  ReauthorizeDelegationMessage,
  HandoffAcceptMessage,
  SuggestAssigneeMessage,
  // Tasks
  UpdateTaskStatusMessage,
  ReportProgressMessage,
  AdaptiveSlaCheckMessage,
  GetTrustMessage,
  ReinstateAgentMessage,
  CheckCircuitBreakerMessage,
  // Workspace
  PrepareWorktreeMessage,
  GetWorkspaceStatusMessage,
  CleanupWorkspaceMessage,
  // Council
  CouncilAnalyzeMessage,
  // Knowledge
  SearchKnowledgeMessage,
  IndexNoteMessage,
  // Sessions
  ShareSessionMessage,
  JoinSessionMessage,
  SessionBroadcastMessage,
  SessionStatusMessage,
  SessionHistoryMessage,
  LeaveSessionMessage,
  SessionPingMessage,
  NameSessionMessage,
  ListSessionsMessage,
  SearchSessionsMessage,
  // Workflow
  WorkflowTriggerMessage,
  WorkflowStatusMessage,
  WorkflowListMessage,
  WorkflowCancelMessage,
  // Health
  HealthCheckMessage,
  HealthStatusMessage,
  // Misc
  SearchCodeMessage,
  ReplaySessionMessage,
  LinkTaskMessage,
  GetTaskLinksMessage,
  GetReviewBundleMessage,
  GenerateReviewBundleMessage,
  GetAnalyticsMessage,
  RetroStartSessionMessage,
  RetroSubmitReviewMessage,
  RetroSubmitSynthesisMessage,
  RetroStatusMessage,
  RetroGetPastLearningsMessage,
]);

export type DaemonMessage = z.infer<typeof DaemonMessageSchema>;

// --- CLI validation schemas ---

export const AccountNameSchema = z.string().regex(
  /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/,
  "Names must be 1-63 alphanumeric characters, hyphens, or underscores, starting with a letter or digit",
);

export const HexColorSchema = z.string().regex(
  /^#[0-9a-fA-F]{6}$/,
  "Color must be a hex color in #RRGGBB format",
);

export const ProviderSchema = z.enum([
  "claude-code",
  "codex-cli",
  "openhands",
  "gemini-cli",
  "opencode",
  "cursor-agent",
]);

export const AddAccountArgsSchema = z.object({
  name: AccountNameSchema,
  color: HexColorSchema.optional(),
  provider: ProviderSchema.optional(),
});
