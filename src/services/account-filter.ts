export function filterAccounts<T extends { name: string; label?: string }>(
  accounts: T[],
  query: string
): T[] {
  if (!query) return accounts;
  const q = query.toLowerCase();
  return accounts.filter(
    (a) => a.name.toLowerCase().includes(q) || (a.label?.toLowerCase().includes(q) ?? false)
  );
}
