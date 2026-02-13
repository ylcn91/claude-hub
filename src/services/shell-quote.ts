/**
 * Shell-safe quoting utility to prevent command injection.
 */
export function shellQuote(arg: string): string {
  if (/^[a-zA-Z0-9._\-=/:@]+$/.test(arg)) return arg;
  return "'" + arg.replace(/'/g, "'\"'\"'") + "'";
}

export function buildShellCommand(parts: string[]): string {
  return parts.map(shellQuote).join(" ");
}
