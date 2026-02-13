import React, { useState } from "react";
import { Box } from "ink";
import { Header } from "./components/Header.js";
import { Dashboard } from "./components/Dashboard.js";
import { Launcher } from "./components/Launcher.js";
import { UsageDetail } from "./components/UsageDetail.js";
import { AddAccount } from "./components/AddAccount.js";

export function App() {
  const [view, setView] = useState("dashboard");

  return (
    <Box flexDirection="column">
      <Header view={view} />
      {view === "dashboard" && <Dashboard onNavigate={setView} />}
      {view === "launcher" && <Launcher onNavigate={setView} />}
      {view === "usage" && <UsageDetail onNavigate={setView} />}
      {view === "add" && <AddAccount onDone={() => setView("dashboard")} />}
      {/* Other views added in subsequent tasks */}
    </Box>
  );
}
