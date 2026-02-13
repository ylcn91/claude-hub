import React, { useState } from "react";
import { Box, useInput } from "ink";
import { Header } from "./components/Header.js";
import { Dashboard } from "./components/Dashboard.js";
import { Launcher } from "./components/Launcher.js";
import { UsageDetail } from "./components/UsageDetail.js";
import { AddAccount } from "./components/AddAccount.js";
import { TaskBoard } from "./components/TaskBoard.js";
import { MessageInbox } from "./components/MessageInbox.js";

const NAV_KEYS: Record<string, string> = {
  d: "dashboard",
  l: "launcher",
  u: "usage",
  t: "tasks",
  m: "inbox",
  a: "add",
};

export function App() {
  const [view, setView] = useState("dashboard");

  // Global navigation - works from any view
  useInput((input, key) => {
    if (input === "q") process.exit(0);
    if (key.escape) { setView("dashboard"); return; }
    const target = NAV_KEYS[input];
    if (target && target !== view) setView(target);
  });

  return (
    <Box flexDirection="column">
      <Header view={view} />
      {view === "dashboard" && <Dashboard onNavigate={setView} />}
      {view === "launcher" && <Launcher onNavigate={setView} />}
      {view === "usage" && <UsageDetail onNavigate={setView} />}
      {view === "add" && <AddAccount onDone={() => setView("dashboard")} />}
      {view === "tasks" && <TaskBoard onNavigate={setView} />}
      {view === "inbox" && <MessageInbox onNavigate={setView} />}
    </Box>
  );
}
