import { closeIssue, commentOnIssue, commentOnPR } from "../integrations/github";
import { getLinksForTask } from "./external-links";
import type { TaskStatus } from "./tasks";

function parseExternalId(externalId: string): { owner: string; repo: string; number: number } {
  // Format: "owner/repo#123"
  const hashIdx = externalId.lastIndexOf("#");
  if (hashIdx === -1) throw new Error(`Invalid externalId format: ${externalId}`);
  const repoPath = externalId.slice(0, hashIdx);
  const number = parseInt(externalId.slice(hashIdx + 1), 10);
  const slashIdx = repoPath.indexOf("/");
  if (slashIdx === -1 || isNaN(number)) {
    throw new Error(`Invalid externalId format: ${externalId}`);
  }
  return {
    owner: repoPath.slice(0, slashIdx),
    repo: repoPath.slice(slashIdx + 1),
    number,
  };
}

export { parseExternalId };

export async function onTaskStatusChanged(
  taskId: string,
  newStatus: TaskStatus,
  context?: { reason?: string }
): Promise<void> {
  const links = await getLinksForTask(taskId);
  if (links.length === 0) return;

  for (const link of links) {
    try {
      const { owner, repo, number } = parseExternalId(link.externalId);

      const comment =
        link.type === "issue"
          ? (opts: { owner: string; repo: string; issueNumber: number; body: string }) =>
              commentOnIssue(opts)
          : (opts: { owner: string; repo: string; issueNumber: number; body: string }) =>
              commentOnPR({ owner: opts.owner, repo: opts.repo, prNumber: opts.issueNumber, body: opts.body });

      if (newStatus === "accepted") {
        if (link.type === "issue") {
          await closeIssue({ owner, repo, issueNumber: number });
        }
        await comment({ owner, repo, issueNumber: number, body: "Task accepted in agentctl" });
      } else if (newStatus === "rejected") {
        const body = context?.reason
          ? `Task rejected in agentctl: ${context.reason}`
          : "Task rejected in agentctl";
        await comment({ owner, repo, issueNumber: number, body });
      } else if (newStatus === "ready_for_review") {
        await comment({ owner, repo, issueNumber: number, body: "Ready for review in agentctl" });
      }
    } catch (err) {
      console.error(`Failed to sync link ${link.id} for task ${taskId}:`, err);
    }
  }
}
