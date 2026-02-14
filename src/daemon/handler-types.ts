import type { Socket } from "net";
import type { DaemonState } from "./state";
import type { DelegationDepthConfig } from "../services/delegation-depth";

export type HandlerFn = (socket: Socket, msg: any) => void;

export interface HandlerContext {
  state: DaemonState;
  features?: DaemonFeatures;
  councilConfig?: { members: string[]; chairman: string; timeoutMs?: number };
  safeWrite: (socket: Socket, data: string) => void;
  reply: (msg: any, response: object) => string;
  getAccountName: (socket: Socket) => string;
}

export interface DaemonFeatures {
  workspaceWorktree?: boolean;
  autoAcceptance?: boolean;
  capabilityRouting?: boolean;
  slaEngine?: boolean;
  githubIntegration?: boolean;
  reviewBundles?: boolean;
  knowledgeIndex?: boolean;
  reliability?: boolean;
  workflow?: boolean;
  retro?: boolean;
  sessions?: boolean;
  trust?: boolean;
  council?: boolean;
  circuitBreaker?: boolean;
  cognitiveFriction?: boolean;
  entireMonitoring?: boolean;
  delegationDepth?: DelegationDepthConfig;
}
