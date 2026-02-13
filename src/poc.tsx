import React, { useState, useEffect } from "react";
import { render, Box, Text } from "ink";
import { execa } from "execa";

function App() {
  const [status, setStatus] = useState("testing...");

  useEffect(() => {
    async function test() {
      // Test 1: Can we read a file with Bun?
      const file = Bun.file(`${process.env.HOME}/.claude/stats-cache.json`);
      const exists = await file.exists();
      setStatus(exists ? "stats-cache.json found" : "stats-cache.json not found");

      // Test 2: Can we spawn a process?
      const result = await execa("echo", ["spawn works"]);
      setStatus((prev) => `${prev} | ${result.stdout}`);
    }
    test();
  }, []);

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="magenta">Claude Hub PoC</Text>
      <Text>{status}</Text>
    </Box>
  );
}

render(<App />);
