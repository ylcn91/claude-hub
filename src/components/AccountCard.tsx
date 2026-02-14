import React from "react";
import { Box, Text } from "ink";
import { QuotaBar } from "./QuotaBar.js";
import type { AgentStats, QuotaEstimate } from "../providers/types.js";
import type { AccountConfig } from "../types.js";

interface Props {
  account: AccountConfig;
  stats: AgentStats;
  quota: QuotaEstimate;
  entireStatus?: string;
  unreadMessages: number;
  pairedWith?: string;
}

export function AccountCard({
  account,
  stats,
  quota,
  entireStatus,
  unreadMessages,
  pairedWith,
}: Props) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={account.color} bold>
          {account.name}
        </Text>
        <Text color="gray"> ({account.label})</Text>
        {pairedWith && (
          <Text color="magenta" bold>
            {"  "}PAIRED with {pairedWith}
          </Text>
        )}
        {stats.todayActivity && (
          <Text>
            {"  "}Today: {stats.todayActivity.messageCount} msgs |{" "}
            {stats.todayActivity.sessionCount} sess
          </Text>
        )}
        {!stats.todayActivity && (
          <Text color="gray">{"  "}Today: no activity</Text>
        )}
      </Box>
      {stats.todayTokens && (
        <Box marginLeft={2}>
          <Text color="gray">
            Tokens:{" "}
            {Object.entries(stats.todayTokens)
              .map(
                ([m, t]) =>
                  `${(t / 1000).toFixed(1)}K ${m.replace("claude-", "")}`
              )
              .join(", ")}
          </Text>
        </Box>
      )}
      <Box marginLeft={2}>
        <QuotaBar estimate={quota} />
      </Box>
      {entireStatus && (
        <Box marginLeft={2}>
          <Text color="gray">entire: {entireStatus}</Text>
        </Box>
      )}
      {unreadMessages > 0 && (
        <Box marginLeft={2}>
          <Text color="yellow">
            inbox: {unreadMessages} new message(s)
          </Text>
        </Box>
      )}
    </Box>
  );
}
