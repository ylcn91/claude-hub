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
  private messages: Message[] = [];
  onMessagePersist?: (msg: Message) => Promise<void>;

  connectAccount(name: string, token: string): void {
    this.connectedAccounts.set(name, { token, connectedAt: new Date().toISOString() });
  }

  disconnectAccount(name: string): void {
    this.connectedAccounts.delete(name);
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

  addMessage(msg: Message): void {
    const stored = { ...msg, id: crypto.randomUUID(), read: false };
    this.messages.push(stored);
    if (this.onMessagePersist) {
      this.onMessagePersist(stored).catch(() => {});
    }
  }

  getMessages(to: string): Message[] {
    return this.messages.filter((m) => m.to === to);
  }

  getUnreadMessages(to: string): Message[] {
    return this.messages.filter((m) => m.to === to && !m.read);
  }

  markAllRead(to: string): void {
    for (const m of this.messages) {
      if (m.to === to) m.read = true;
    }
  }

  getHandoffs(to: string): Message[] {
    return this.messages.filter((m) => m.to === to && m.type === "handoff");
  }
}
