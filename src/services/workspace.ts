import { resolve } from "path";

export type WorkspaceStatus = "preparing" | "ready" | "failed" | "cleaning";

export type WorkspaceEventType =
  | "workspace_preparing"
  | "workspace_ready"
  | "workspace_failed"
  | "workspace_cleaning";

export interface WorkspaceEvent {
  type: WorkspaceEventType;
  timestamp: string;
  from?: WorkspaceStatus;
  to?: WorkspaceStatus;
  error?: string;
  gitOutput?: string;
}

export interface Workspace {
  id: string;
  handoffId: string;
  ownerAccount: string;
  repoPath: string;
  branch: string;
  worktreePath: string;
  status: WorkspaceStatus;
  createdAt: string;
  updatedAt: string;
  events: WorkspaceEvent[];
}

export interface WorkspaceResponse<T = Workspace> {
  ok: boolean;
  error_code?: string;
  message?: string;
  data?: T;
}

export interface WorkspaceRequest {
  repoPath: string;
  branch: string;
  ownerAccount: string;
  handoffId?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const MAX_BRANCH_LENGTH = 200;

/** Validates a git branch name, rejecting path traversal and unsafe patterns. */
export function isValidBranch(branch: string): boolean {
  if (!branch || branch.length > MAX_BRANCH_LENGTH) return false;
  if (branch.startsWith("/") || branch.startsWith("-")) return false;
  if (branch.includes("..")) return false;
  const segments = branch.split("/");
  return segments.every(
    (s) => s.length > 0 && !s.startsWith(".") && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(s),
  );
}

export function validateWorkspaceRequest(req: Partial<WorkspaceRequest> | null | undefined): ValidationResult {
  const errors: string[] = [];

  if (!req || typeof req.repoPath !== "string" || req.repoPath.trim() === "") {
    errors.push("repoPath is required and must be a non-empty string");
  } else if (!req.repoPath.startsWith("/")) {
    errors.push("repoPath must be an absolute path");
  }

  if (!req || typeof req.branch !== "string" || req.branch.trim() === "") {
    errors.push("branch is required and must be a non-empty string");
  } else if (!isValidBranch(req.branch)) {
    if (req.branch.includes("..")) {
      errors.push("branch must not contain '..'");
    } else {
      errors.push("branch contains invalid characters");
    }
  }

  if (!req || typeof req.ownerAccount !== "string" || req.ownerAccount.trim() === "") {
    errors.push("ownerAccount is required and must be a non-empty string");
  }

  return { valid: errors.length === 0, errors };
}

export function isActiveStatus(status: WorkspaceStatus): boolean {
  return status === "preparing" || status === "ready" || status === "cleaning";
}

export function computeWorktreePath(repoPath: string, branch: string): string {
  const safeBranch = branch.replace(/\//g, "-");
  const base = resolve(repoPath, ".worktrees");
  const proposed = resolve(base, safeBranch);
  if (!proposed.startsWith(base + "/") && proposed !== base) {
    throw new Error("Path traversal detected");
  }
  return proposed;
}
