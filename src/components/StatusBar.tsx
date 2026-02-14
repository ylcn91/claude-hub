import { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { existsSync } from "fs";
import { getSockPath } from "../paths.js";
import { loadConfig } from "../config.js";

const POLL_INTERVAL_MS = 5_000;

export function StatusBar() {
  const [daemonUp, setDaemonUp] = useState(false);
  const [accountCount, setAccountCount] = useState(0);

  useEffect(() => {
    function check() {
      setDaemonUp(existsSync(getSockPath()));
    }
    check();
    const interval = setInterval(check, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    loadConfig()
      .then((config) => setAccountCount(config.accounts.length))
      .catch(() => {});
  }, []);

  return (
    <Box
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      marginTop={1}
    >
      <Text color={daemonUp ? "green" : "red"}>
        {daemonUp ? "daemon: connected" : "daemon: offline"}
      </Text>
      <Text color="gray"> | </Text>
      <Text color="gray">
        accounts: {accountCount}
      </Text>
      <Text color="gray"> | </Text>
      <Text color="gray">
        Ctrl+r refresh | ? help | q quit
      </Text>
    </Box>
  );
}
