import { test, expect, describe } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";

// ─── CouncilPanel ───────────────────────────────────────────────────

describe("CouncilPanel", () => {
  test("renders loading state", async () => {
    const { CouncilPanel } = await import("../src/components/CouncilPanel");
    const { lastFrame } = render(
      React.createElement(CouncilPanel, { onNavigate: () => {} })
    );
    expect(lastFrame()).toContain("Loading");
  });

  test("exports a callable component (memo-wrapped)", async () => {
    const mod = await import("../src/components/CouncilPanel");
    // React.memo wraps the component — typeof may be "object" (memo node) or "function"
    expect(mod.CouncilPanel).toBeTruthy();
    expect(typeof mod.CouncilPanel === "function" || typeof mod.CouncilPanel === "object").toBe(true);
  });
});

// ─── VerificationView ───────────────────────────────────────────────

describe("VerificationView", () => {
  test("renders loading state", async () => {
    const { VerificationView } = await import("../src/components/VerificationView");
    const { lastFrame } = render(
      React.createElement(VerificationView, { onNavigate: () => {} })
    );
    expect(lastFrame()).toContain("Loading");
  });

  test("exports a callable component (memo-wrapped)", async () => {
    const mod = await import("../src/components/VerificationView");
    expect(mod.VerificationView).toBeTruthy();
    expect(typeof mod.VerificationView === "function" || typeof mod.VerificationView === "object").toBe(true);
  });
});

// ─── EntireSessions ─────────────────────────────────────────────────

describe("EntireSessions", () => {
  test("renders without crashing", async () => {
    const { EntireSessions } = await import("../src/components/EntireSessions");
    const { lastFrame } = render(
      React.createElement(EntireSessions, { onNavigate: () => {} })
    );
    // Should render either loading or the empty state
    const frame = lastFrame();
    expect(frame).toBeTruthy();
  });

  test("exports a named function component", async () => {
    const mod = await import("../src/components/EntireSessions");
    expect(typeof mod.EntireSessions).toBe("function");
  });
});

// ─── DelegationChain ────────────────────────────────────────────────

describe("DelegationChain", () => {
  test("renders without crashing", async () => {
    const { DelegationChain } = await import("../src/components/DelegationChain");
    const { lastFrame } = render(
      React.createElement(DelegationChain, { onNavigate: () => {} })
    );
    const frame = lastFrame();
    expect(frame).toBeTruthy();
  });

  test("exports a callable component (memo-wrapped)", async () => {
    const mod = await import("../src/components/DelegationChain");
    expect(mod.DelegationChain).toBeTruthy();
    expect(typeof mod.DelegationChain === "function" || typeof mod.DelegationChain === "object").toBe(true);
  });
});

// ─── Extended SLABoard ──────────────────────────────────────────────

describe("SLABoard (extended)", () => {
  test("renders loading state", async () => {
    const { SLABoard } = await import("../src/components/SLABoard");
    const { lastFrame } = render(
      React.createElement(SLABoard, { onNavigate: () => {} })
    );
    expect(lastFrame()).toContain("Loading");
  });

  test("has adaptive action labels in source", async () => {
    const { readFileSync } = await import("fs");
    const src = readFileSync(
      new URL("../src/components/SLABoard.tsx", import.meta.url).pathname,
      "utf-8"
    );
    expect(src).toContain("suggest_reassign");
    expect(src).toContain("auto_reassign");
    expect(src).toContain("escalate_human");
    expect(src).toContain("terminate");
  });
});

// ─── Extended TaskBoard ─────────────────────────────────────────────

describe("TaskBoard (extended)", () => {
  test("renders loading state", async () => {
    const { TaskBoard } = await import("../src/components/TaskBoard");
    const { lastFrame } = render(
      React.createElement(TaskBoard, { onNavigate: () => {}, accounts: [] })
    );
    expect(lastFrame()).toContain("Loading");
  });

  test("has friction gate mode in source", async () => {
    const { readFileSync } = await import("fs");
    const src = readFileSync(
      new URL("../src/components/TaskBoard.tsx", import.meta.url).pathname,
      "utf-8"
    );
    expect(src).toContain("justify");
    expect(src).toContain("getGatedAcceptanceAction");
    expect(src).toContain("calculateProviderFit");
  });
});

// ─── Extended WorkflowDetail ────────────────────────────────────────

describe("WorkflowDetail (extended)", () => {
  test("has entire.io evidence section in source", async () => {
    const { readFileSync } = await import("fs");
    const src = readFileSync(
      new URL("../src/components/WorkflowDetail.tsx", import.meta.url).pathname,
      "utf-8"
    );
    expect(src).toContain("EntireRetroEvidence");
    expect(src).toContain("Entire.io Evidence");
    expect(src).toContain("Burn Rate");
  });
});

// ─── App routing ────────────────────────────────────────────────────

describe("App routing", () => {
  test("NAV_KEYS includes new views", async () => {
    const { readFileSync } = await import("fs");
    const src = readFileSync(
      new URL("../src/app.tsx", import.meta.url).pathname,
      "utf-8"
    );
    expect(src).toContain('c: "council"');
    expect(src).toContain('v: "verify"');
    expect(src).toContain('i: "entire"');
    expect(src).toContain('g: "chains"');
  });

  test("app.tsx imports all new components", async () => {
    const { readFileSync } = await import("fs");
    const src = readFileSync(
      new URL("../src/app.tsx", import.meta.url).pathname,
      "utf-8"
    );
    expect(src).toContain("CouncilPanel");
    expect(src).toContain("VerificationView");
    expect(src).toContain("EntireSessions");
    expect(src).toContain("DelegationChain");
  });

  test("Header includes new nav hints", async () => {
    const { readFileSync } = await import("fs");
    const src = readFileSync(
      new URL("../src/components/Header.tsx", import.meta.url).pathname,
      "utf-8"
    );
    expect(src).toContain("[c]ouncil");
    expect(src).toContain("[v]erify");
    expect(src).toContain("[i]entire");
    expect(src).toContain("[g]chains");
  });
});
