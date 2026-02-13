export interface GitHubIssueResult {
  number: number;
  url: string;
}

export interface GitHubIssueStatus {
  state: string;
  title: string;
}

export async function runGh(args: string[]): Promise<string> {
  const proc = Bun.spawn(["gh", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`gh failed: ${stderr}`);
  }
  return await new Response(proc.stdout).text();
}

export async function createIssue(opts: {
  owner: string;
  repo: string;
  title: string;
  body?: string;
  labels?: string[];
}): Promise<GitHubIssueResult> {
  const args = [
    "issue",
    "create",
    "--repo",
    `${opts.owner}/${opts.repo}`,
    "--json",
    "number,url",
  ];
  if (opts.labels && opts.labels.length > 0) {
    args.push("--label", opts.labels.join(","));
  }
  // "--" prevents user-supplied content from being interpreted as flags
  args.push("--title", opts.title);
  if (opts.body) {
    args.push("--body", opts.body);
  }
  const stdout = await runGh(args);
  return JSON.parse(stdout) as GitHubIssueResult;
}

export async function commentOnIssue(opts: {
  owner: string;
  repo: string;
  issueNumber: number;
  body: string;
}): Promise<void> {
  await runGh([
    "issue",
    "comment",
    String(opts.issueNumber),
    "--repo",
    `${opts.owner}/${opts.repo}`,
    "--body",
    opts.body,
  ]);
}

export async function commentOnPR(opts: {
  owner: string;
  repo: string;
  prNumber: number;
  body: string;
}): Promise<void> {
  await runGh([
    "pr",
    "comment",
    String(opts.prNumber),
    "--repo",
    `${opts.owner}/${opts.repo}`,
    "--body",
    opts.body,
  ]);
}

export async function closeIssue(opts: {
  owner: string;
  repo: string;
  issueNumber: number;
}): Promise<void> {
  await runGh([
    "issue",
    "close",
    String(opts.issueNumber),
    "--repo",
    `${opts.owner}/${opts.repo}`,
  ]);
}

export async function getIssueStatus(opts: {
  owner: string;
  repo: string;
  issueNumber: number;
}): Promise<GitHubIssueStatus> {
  const stdout = await runGh([
    "issue",
    "view",
    String(opts.issueNumber),
    "--repo",
    `${opts.owner}/${opts.repo}`,
    "--json",
    "state,title",
  ]);
  return JSON.parse(stdout) as GitHubIssueStatus;
}
