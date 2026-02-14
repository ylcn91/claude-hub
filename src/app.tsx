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
import Analytics from "./components/Analytics.js";
import { WorkflowBoard } from "./components/WorkflowBoard.js";
import { WorkflowDetail } from "./components/WorkflowDetail.js";
import { HealthDashboard } from "./components/HealthDashboard.js";
import { CouncilPanel } from "./components/CouncilPanel.js";
import { VerificationView } from "./components/VerificationView.js";
import { EntireSessions } from "./components/EntireSessions.js";
import { DelegationChain } from "./components/DelegationChain.js";

const NAV_KEYS: Record<string, string> = {
  d: "dashboard",
  l: "launcher",
  u: "usage",
  t: "tasks",
  m: "inbox",
  a: "add",
  e: "sla",
  r: "prompts",
  n: "analytics",
  w: "workflows",
  h: "health",
  c: "council",
  v: "verify",
  i: "entire",
  g: "chains",
};

export function App() {
  const [view, setView] = useState("dashboard");
  const [viewDetail, setViewDetail] = useState<any>(null);
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
      {view === "analytics" && <Analytics onNavigate={setView} />}
      {view === "workflows" && <WorkflowBoard onNavigate={(v, detail) => { setViewDetail(detail); setView(v); }} />}
      {view === "workflow_detail" && viewDetail?.runId && <WorkflowDetail runId={viewDetail.runId} onNavigate={setView} />}
      {view === "health" && <HealthDashboard onNavigate={setView} />}
      {view === "council" && <CouncilPanel onNavigate={setView} />}
      {view === "verify" && <VerificationView onNavigate={setView} />}
      {view === "entire" && <EntireSessions onNavigate={setView} />}
      {view === "chains" && <DelegationChain onNavigate={setView} />}
    </Box>
  );
}
