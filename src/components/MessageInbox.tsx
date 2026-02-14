import { useState, useEffect, useContext, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { loadConfig } from "../config.js";
import { fetchUnreadMessages } from "../services/daemon-client.js";
import { NavContext } from "../app.js";

interface Message {
  id: string;
  from: string;
  to: string;
  type: "message" | "handoff";
  content: string;
  timestamp: string;
  context?: Record<string, string>;
}

interface AccountMessages {
  accountName: string;
  accountColor: string;
  messages: Message[];
}

interface Props {
  onNavigate: (view: string) => void;
}

type Mode = "browse" | "search";

export function MessageInbox({ onNavigate: _onNavigate }: Props) {
  const [accounts, setAccounts] = useState<AccountMessages[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAccount, setSelectedAccount] = useState(0);
  const [mode, setMode] = useState<Mode>("browse");
  const [searchQuery, setSearchQuery] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const { refreshTick: globalRefresh } = useContext(NavContext);

  useEffect(() => {
    if (globalRefresh > 0) setRefreshTick((prev) => prev + 1);
  }, [globalRefresh]);

  useEffect(() => {
    async function load() {
      try {
        const config = await loadConfig();
        const results = await Promise.all(
          config.accounts.map(async (account) => ({
            accountName: account.name,
            accountColor: account.color,
            messages: await fetchUnreadMessages(account.name),
          }))
        );

        setAccounts(results);
      } catch(e: any) { console.error("[inbox]", e.message) }
      setLoading(false);
    }
    load();
  }, [refreshTick]);

  const filteredAccounts = useMemo(() => {
    if (!searchQuery) return accounts;
    const q = searchQuery.toLowerCase();
    return accounts
      .map((a) => ({
        ...a,
        messages: a.messages.filter(
          (msg) =>
            msg.from.toLowerCase().includes(q) ||
            msg.content.toLowerCase().includes(q) ||
            msg.type.toLowerCase().includes(q)
        ),
      }))
      .filter((a) => a.accountName.toLowerCase().includes(q) || a.messages.length > 0);
  }, [accounts, searchQuery]);

  useInput((input, key) => {
    if (mode === "search") {
      if (key.return || key.escape) {
        if (key.escape) setSearchQuery("");
        setMode("browse");
        setSelectedAccount(0);
      } else if (key.backspace || key.delete) {
        setSearchQuery((q) => q.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setSearchQuery((q) => q + input);
      }
      return;
    }

    // Browse mode
    if ((key.upArrow || input === "k") && selectedAccount > 0) {
      setSelectedAccount(selectedAccount - 1);
    } else if ((key.downArrow || input === "j") && selectedAccount < filteredAccounts.length - 1) {
      setSelectedAccount(selectedAccount + 1);
    } else if (input === "/") {
      setMode("search");
      setSearchQuery("");
    }
  });

  if (loading) return <Text color="gray">Loading messages...</Text>;

  const totalUnread = filteredAccounts.reduce((sum, a) => sum + a.messages.length, 0);

  if (accounts.length === 0) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text color="gray">No accounts configured.</Text>
        <Text color="gray">Press [a] to add an account, or run: actl add {"<name>"}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingY={1}>
      <Text bold>
        Inbox ({totalUnread} unread)
      </Text>

      {mode === "search" && (
        <Box marginTop={1}>
          <Text color="cyan">Search: </Text>
          <Text>{searchQuery}</Text>
          <Text color="gray">_</Text>
        </Box>
      )}

      {searchQuery && mode === "browse" && (
        <Box marginTop={1}>
          <Text color="cyan">filter: "{searchQuery}"</Text>
        </Box>
      )}

      {filteredAccounts.map((a, idx) => (
        <Box key={a.accountName} flexDirection="column" marginTop={1}>
          <Box>
            <Text color={a.accountColor} bold inverse={idx === selectedAccount}>
              {a.accountName}
            </Text>
            <Text color="gray">
              {" "}({a.messages.length} message{a.messages.length !== 1 ? "s" : ""})
            </Text>
          </Box>
          {a.messages.length === 0 && (
            <Box marginLeft={2}>
              <Text color="gray">No new messages</Text>
            </Box>
          )}
          {a.messages.map((msg) => (
            <Box key={msg.id} marginLeft={2} flexDirection="column">
              <Box>
                <Text color={msg.type === "handoff" ? "yellow" : "white"}>
                  [{msg.type}] from {msg.from}
                </Text>
                <Text color="gray"> {formatTime(msg.timestamp)}</Text>
              </Box>
              <Box marginLeft={2}>
                <Text wrap="wrap">{msg.content}</Text>
              </Box>
              {msg.context && Object.keys(msg.context).length > 0 && (
                <Box marginLeft={2}>
                  <Text color="gray">
                    context: {Object.entries(msg.context).map(([k, v]) => `${k}=${v}`).join(", ")}
                  </Text>
                </Box>
              )}
            </Box>
          ))}
        </Box>
      ))}
      <Box marginTop={1}>
        <Text color="gray">[j/k] navigate  [/] search  [Esc] dashboard  [q] quit</Text>
      </Box>
    </Box>
  );
}

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return ts;
  }
}
