import { useState, useEffect, createContext } from "react";
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
import { HelpOverlay } from "./components/HelpOverlay.js";

export const NAV_KEYS: Record<string, string> = {
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

export const NavContext = createContext<{
  setGlobalNavEnabled: (enabled: boolean) => void;
}>({ setGlobalNavEnabled: () => {} });

export function App() {
  const [view, setView] = useState("dashboard");
  const [viewDetail, setViewDetail] = useState<any>(null);
  const [accountNames, setAccountNames] = useState<string[]>([]);
  const [globalNavEnabled, setGlobalNavEnabled] = useState(true);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    loadConfig().then((config) => {
      setAccountNames(config.accounts.map((a) => a.name));
    }).catch(e => console.error("[app]", e.message));
  }, []);

  // Global navigation - works from any view unless a component disables it
  useInput((input, key) => {
    if (input === "?") { setShowHelp(prev => !prev); return; }
    if (input === "q") process.exit(0);
    if (key.escape) { setView("dashboard"); setGlobalNavEnabled(true); setShowHelp(false); return; }
    if (!globalNavEnabled) return;
    const target = NAV_KEYS[input];
    if (target && target !== view) setView(target);
  });

  return (
    <NavContext.Provider value={{ setGlobalNavEnabled }}>
      <Box flexDirection="column">
        <Header view={view} showMascot={view === "dashboard"} globalNavEnabled={globalNavEnabled} />
        <HelpOverlay view={view} visible={showHelp} />
        {view === "dashboard" && <Dashboard />}
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
    </NavContext.Provider>
  );
}
