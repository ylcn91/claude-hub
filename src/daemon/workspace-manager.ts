import { WorkspaceStore } from "./workspace-store";
import {
  type Workspace,
  type WorkspaceRequest,
  type WorkspaceResponse,
  validateWorkspaceRequest,
  computeWorktreePath,
} from "../services/workspace";

export type GitExecutor = (
  args: string[],
  cwd?: string
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

// Bun.spawn is safe from shell injection (like execFile, not exec).
// It passes args as an array without a shell.
export const defaultGitExecutor: GitExecutor = async (args, cwd) => {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
};

export class WorkspaceManager {
  private store: WorkspaceStore;
  private git: GitExecutor;

  constructor(store: WorkspaceStore, git?: GitExecutor) {
    this.store = store;
    this.git = git ?? defaultGitExecutor;
  }

  async prepareWorktree(req: WorkspaceRequest): Promise<WorkspaceResponse> {
    const validation = validateWorkspaceRequest(req);
    if (!validation.valid) {
      return {
        ok: false,
        error_code: "VALIDATION_ERROR",
        message: validation.errors.join("; "),
      };
    }

    const existing = this.store.getActiveByKey(req.repoPath, req.branch);
    if (existing) {
      return { ok: true, data: existing };
    }

    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const worktreePath = computeWorktreePath(req.repoPath, req.branch);

    const ws: Omit<Workspace, "events"> = {
      id,
      handoffId: req.handoffId ?? "",
      ownerAccount: req.ownerAccount,
      repoPath: req.repoPath,
      branch: req.branch,
      worktreePath,
      status: "preparing",
      createdAt: now,
      updatedAt: now,
    };

    this.store.create(ws);
    this.store.addEvent(id, {
      type: "workspace_preparing",
      timestamp: now,
      to: "preparing",
    });

    const result = await this.git(
      ["worktree", "add", worktreePath, req.branch],
      req.repoPath
    );

    if (result.exitCode !== 0) {
      this.store.updateStatus(id, "failed");
      this.store.addEvent(id, {
        type: "workspace_failed",
        timestamp: new Date().toISOString(),
        from: "preparing",
        to: "failed",
        error: result.stderr,
        gitOutput: result.stdout,
      });
      return {
        ok: false,
        error_code: "GIT_ERROR",
        message: result.stderr,
        data: this.store.getById(id)!,
      };
    }

    this.store.updateStatus(id, "ready");
    this.store.addEvent(id, {
      type: "workspace_ready",
      timestamp: new Date().toISOString(),
      from: "preparing",
      to: "ready",
      gitOutput: result.stdout,
    });

    return { ok: true, data: this.store.getById(id)! };
  }

  async cleanupWorkspace(id: string): Promise<WorkspaceResponse> {
    const ws = this.store.getById(id);
    if (!ws) {
      return {
        ok: false,
        error_code: "NOT_FOUND",
        message: `Workspace ${id} not found`,
      };
    }

    this.store.updateStatus(id, "cleaning");
    this.store.addEvent(id, {
      type: "workspace_cleaning",
      timestamp: new Date().toISOString(),
      from: ws.status,
      to: "cleaning",
    });

    const result = await this.git(
      ["worktree", "remove", ws.worktreePath, "--force"],
      ws.repoPath
    );

    if (result.exitCode !== 0) {
      this.store.updateStatus(id, "failed");
      this.store.addEvent(id, {
        type: "workspace_failed",
        timestamp: new Date().toISOString(),
        from: "cleaning",
        to: "failed",
        error: result.stderr,
      });
      return {
        ok: false,
        error_code: "GIT_ERROR",
        message: result.stderr,
        data: this.store.getById(id)!,
      };
    }

    this.store.delete(id);
    return { ok: true };
  }

  async getWorkspace(id: string): Promise<Workspace | null> {
    return this.store.getById(id);
  }

  async getWorkspaceByKey(
    repoPath: string,
    branch: string
  ): Promise<Workspace | null> {
    return this.store.getActiveByKey(repoPath, branch);
  }

  recoverStaleWorkspaces(): void {
    const stale = this.store.getByStatus("preparing");
    for (const ws of stale) {
      this.store.updateStatus(ws.id, "failed");
      this.store.addEvent(ws.id, {
        type: "workspace_failed",
        timestamp: new Date().toISOString(),
        from: "preparing",
        to: "failed",
        error: "Recovered stale workspace",
      });
    }
  }
}
