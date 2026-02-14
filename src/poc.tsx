import { useState, useEffect } from "react";
import { render, Box, Text } from "ink";

function App() {
  const [status, setStatus] = useState("testing...");

  useEffect(() => {
    async function test() {
      // Test 1: Can we read a file with Bun?
      const file = Bun.file(`${process.env.HOME}/.claude/stats-cache.json`);
      const exists = await file.exists();
      setStatus(exists ? "stats-cache.json found" : "stats-cache.json not found");

      // Test 2: Can we spawn a process?
      const result = await Bun.$`echo spawn works`.text();
      setStatus((prev) => `${prev} | ${result.trim()}`);
    }
    test();
  }, []);

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="magenta">agentctl PoC</Text>
      <Text>{status}</Text>
    </Box>
  );
}

render(<App />);
