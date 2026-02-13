import React, { useState, useEffect } from "react";
import { Box, useInput } from "ink";
import { loadConfig } from "./config.js";
import { Header } from "./components/Header.js";
import { Dashboard } from "./components/Dashboard.js";
import { Launcher } from "./components/Launcher.js";
import { UsageDetail } from "./components/UsageDetail.js";
import { AddAccount } from "./components/AddAccount.js";
import { TaskBoard } from "./components/TaskBoard.js";
import { MessageInbox } from "./components/MessageInbox.js";
import { SLABoard } from "./components/SLABoard.js";
import { PromptLibrary } from "./components/PromptLibrary.js";

const NAV_KEYS: Record<string, string> = {
  d: "dashboard",
  l: "launcher",
  u: "usage",
  t: "tasks",
  m: "inbox",
  a: "add",
  e: "sla",
  r: "prompts",
};

export function App() {
  const [view, setView] = useState("dashboard");
  const [accountNames, setAccountNames] = useState<string[]>([]);

  useEffect(() => {
    loadConfig().then((config) => {
      setAccountNames(config.accounts.map((a) => a.name));
    }).catch(e => console.error("[app]", e.message));
  }, []);

  // Global navigation - works from any view
  useInput((input, key) => {
    if (input === "q") process.exit(0);
    if (key.escape) { setView("dashboard"); return; }
    const target = NAV_KEYS[input];
    if (target && target !== view) setView(target);
  });

  return (
    <Box flexDirection="column">
      <Header view={view} showMascot={view === "dashboard"} />
      {view === "dashboard" && <Dashboard onNavigate={setView} />}
      {view === "launcher" && <Launcher onNavigate={setView} />}
      {view === "usage" && <UsageDetail onNavigate={setView} />}
      {view === "add" && <AddAccount onDone={() => setView("dashboard")} />}
      {view === "tasks" && <TaskBoard onNavigate={setView} accounts={accountNames} />}
      {view === "inbox" && <MessageInbox onNavigate={setView} />}
      {view === "sla" && <SLABoard onNavigate={setView} />}
      {view === "prompts" && <PromptLibrary onNavigate={setView} />}
    </Box>
  );
}
