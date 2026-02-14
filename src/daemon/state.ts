import { MessageStore } from "./message-store";
import { WorkspaceStore } from "./workspace-store";
import { WorkspaceManager } from "./workspace-manager";
import { CapabilityStore } from "./capability-store";
import { KnowledgeStore } from "./knowledge-store";
import { ExternalLinkStore } from "../services/external-links";
import { ActivityStore } from "../services/activity-store";
import { WorkflowStore } from "../services/workflow-store";
import { WorkflowEngine } from "../services/workflow-engine";
import { getKnowledgeDbPath, getActivityDbPath, getWorkflowDbPath, getRetroDbPath, getSessionsDbPath } from "../paths";
import { SessionStore } from "./session-store";
import { RetroStore } from "../services/retro-store";
import { RetroEngine } from "../services/retro-engine";
import { SharedSessionManager } from "./shared-session";
import { HealthMonitor } from "./health-monitor";

export interface Message {
  id?: string;
  from: string;
  to: string;
  type: "message" | "handoff";
  content: string;
  timestamp: string;
  read?: boolean;
  context?: Record<string, string>;
}

export class DaemonState {
  private connectedAccounts = new Map<string, { token: string; connectedAt: string }>();
  private store: MessageStore;
  workspaceStore?: WorkspaceStore;
  workspaceManager?: WorkspaceManager;
  capabilityStore?: CapabilityStore;
  knowledgeStore?: KnowledgeStore;
  externalLinkStore?: ExternalLinkStore;
  activityStore?: ActivityStore;
  workflowStore?: WorkflowStore;
  workflowEngine?: WorkflowEngine;
  retroStore?: RetroStore;
  retroEngine?: RetroEngine;
  sessionStore?: SessionStore;
  sharedSessionManager = new SharedSessionManager();
  healthMonitor = new HealthMonitor();
  startedAt: string = new Date().toISOString();
  slaTimerId?: ReturnType<typeof setInterval>;
  onMessagePersist?: (msg: Message) => Promise<void>;

  constructor(dbPath?: string) {
    this.store = new MessageStore(dbPath);
    this.startedAt = new Date().toISOString();
  }

  getUptime(): number {
    return Date.now() - new Date(this.startedAt).getTime();
  }

  initWorkspace(dbPath?: string): void {
    this.workspaceStore = new WorkspaceStore(dbPath);
    this.workspaceManager = new WorkspaceManager(this.workspaceStore);
    this.workspaceManager.recoverStaleWorkspaces();
  }

  initCapabilities(dbPath?: string): void {
    this.capabilityStore = new CapabilityStore(dbPath);
  }

  initKnowledge(dbPath?: string): void {
    const path = dbPath ?? getKnowledgeDbPath();
    this.knowledgeStore = new KnowledgeStore(path);
  }

  initExternalLinks(dbPath?: string): void {
    this.externalLinkStore = new ExternalLinkStore(dbPath);
  }

  initActivity(dbPath?: string): void {
    const path = dbPath ?? getActivityDbPath();
    this.activityStore = new ActivityStore(path);
  }

  initWorkflow(dbPath?: string): void {
    const path = dbPath ?? getWorkflowDbPath();
    this.workflowStore = new WorkflowStore(path);
    this.workflowEngine = new WorkflowEngine(this.workflowStore, this.activityStore, this);
  }

  initSessions(dbPath?: string): void {
    const path = dbPath ?? getSessionsDbPath();
    this.sessionStore = new SessionStore(path);
  }

  initRetro(dbPath?: string): void {
    const path = dbPath ?? getRetroDbPath();
    this.retroStore = new RetroStore(path);
    this.retroEngine = new RetroEngine(this.retroStore, this.activityStore, this.knowledgeStore);
    // Wire retro engine into workflow engine for auto-trigger on completion
    if (this.workflowEngine) {
      this.workflowEngine.retroEngine = this.retroEngine;
    }
  }

  connectAccount(name: string, token: string): void {
    this.connectedAccounts.set(name, { token, connectedAt: new Date().toISOString() });
    this.healthMonitor.markActive(name);
  }

  disconnectAccount(name: string): void {
    this.connectedAccounts.delete(name);
    this.healthMonitor.markDisconnected(name);
  }

  getConnectedAccounts(): string[] {
    return Array.from(this.connectedAccounts.keys());
  }

  isConnected(name: string): boolean {
    return this.connectedAccounts.has(name);
  }

  verifyToken(name: string, token: string): boolean {
    const entry = this.connectedAccounts.get(name);
    return entry?.token === token;
  }

  addMessage(msg: Message): string {
    const id = this.store.addMessage({
      from: msg.from,
      to: msg.to,
      type: msg.type,
      content: msg.content,
      timestamp: msg.timestamp,
      context: msg.context,
    });
    const stored = { ...msg, id, read: false };
    if (this.onMessagePersist) {
      this.onMessagePersist(stored).catch(e => console.error("[persist]", e.message));
    }
    return id;
  }

  getMessages(to: string, opts?: { limit?: number; offset?: number }): Message[] {
    return this.store.getMessages(to, opts);
  }

  getUnreadMessages(to: string): Message[] {
    return this.store.getUnreadMessages(to);
  }

  countUnread(to: string): number {
    return this.store.countUnread(to);
  }

  markAllRead(to: string): void {
    this.store.markAllRead(to);
  }

  getHandoffs(to: string): Message[] {
    return this.store.getHandoffs(to);
  }

  archiveOld(days?: number): number {
    return this.store.archiveOld(days);
  }

  close(): void {
    if (this.slaTimerId) clearInterval(this.slaTimerId);
    const stores = [
      this.workspaceStore,
      this.capabilityStore,
      this.knowledgeStore,
      this.externalLinkStore,
      this.activityStore,
      this.workflowStore,
      this.retroStore,
      this.sessionStore,
      this.store,
    ];
    for (const s of stores) {
      try { s?.close(); } catch (e: any) { console.error("[state] close error:", e.message); }
    }
  }
}
