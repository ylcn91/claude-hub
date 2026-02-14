import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { TddEngine } from "../src/services/tdd-engine";
import { EventBus } from "../src/services/event-bus";

const TEST_DIR = join(import.meta.dir, ".test-tdd-engine");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function writeTestFile(name: string, content: string): string {
  const path = join(TEST_DIR, name);
  writeFileSync(path, content);
  return path;
}

describe("TddEngine state machine", () => {
  test("starts in idle phase", () => {
    const engine = new TddEngine({ testFile: "dummy.test.ts" });
    expect(engine.getPhase()).toBe("idle");
    expect(engine.getState().phase).toBe("idle");
  });

  test("start transitions from idle to red", () => {
    const engine = new TddEngine({ testFile: "dummy.test.ts" });
    const started = engine.start();
    expect(started).toBe(true);
    expect(engine.getPhase()).toBe("red");
    engine.stop();
  });

  test("start fails if not idle", () => {
    const engine = new TddEngine({ testFile: "dummy.test.ts" });
    engine.start();
    const second = engine.start();
    expect(second).toBe(false);
    engine.stop();
  });

  test("valid transitions: red -> green -> refactor -> red", () => {
    const engine = new TddEngine({ testFile: "dummy.test.ts" });
    engine.start();
    expect(engine.getPhase()).toBe("red");

    expect(engine.transition("green")).toBe(true);
    expect(engine.getPhase()).toBe("green");

    expect(engine.transition("refactor")).toBe(true);
    expect(engine.getPhase()).toBe("refactor");

    expect(engine.transition("red")).toBe(true);
    expect(engine.getPhase()).toBe("red");

    engine.stop();
  });

  test("invalid transitions are rejected", () => {
    const engine = new TddEngine({ testFile: "dummy.test.ts" });
    engine.start();
    expect(engine.getPhase()).toBe("red");

    expect(engine.transition("refactor")).toBe(false);
    expect(engine.getPhase()).toBe("red");

    expect(engine.transition("idle")).toBe(false);
    expect(engine.getPhase()).toBe("red");

    engine.stop();
  });

  test("canTransition returns correct values", () => {
    const engine = new TddEngine({ testFile: "dummy.test.ts" });

    // idle -> only red
    expect(engine.canTransition("red")).toBe(true);
    expect(engine.canTransition("green")).toBe(false);
    expect(engine.canTransition("refactor")).toBe(false);

    engine.start();
    // red -> only green
    expect(engine.canTransition("green")).toBe(true);
    expect(engine.canTransition("refactor")).toBe(false);
    expect(engine.canTransition("red")).toBe(false);

    engine.transition("green");
    // green -> only refactor
    expect(engine.canTransition("refactor")).toBe(true);
    expect(engine.canTransition("red")).toBe(false);

    engine.transition("refactor");
    // refactor -> only red
    expect(engine.canTransition("red")).toBe(true);
    expect(engine.canTransition("green")).toBe(false);

    engine.stop();
  });

  test("stop resets phase to idle", () => {
    const engine = new TddEngine({ testFile: "dummy.test.ts" });
    engine.start();
    engine.transition("green");
    expect(engine.getPhase()).toBe("green");
    engine.stop();
    expect(engine.getPhase()).toBe("idle");
  });

  test("cycles are recorded", () => {
    const engine = new TddEngine({ testFile: "dummy.test.ts" });
    engine.start();
    engine.transition("green");
    engine.transition("refactor");
    engine.transition("red");

    const state = engine.getState();
    expect(state.cycles.length).toBe(4); // red, green, refactor, red
    expect(state.cycles[0].phase).toBe("red");
    expect(state.cycles[1].phase).toBe("green");
    expect(state.cycles[2].phase).toBe("refactor");
    expect(state.cycles[3].phase).toBe("red");

    engine.stop();
  });

  test("getState returns a copy", () => {
    const engine = new TddEngine({ testFile: "dummy.test.ts" });
    engine.start();

    const state1 = engine.getState();
    engine.transition("green");
    const state2 = engine.getState();

    expect(state1.phase).toBe("red");
    expect(state2.phase).toBe("green");
    expect(state1.cycles.length).toBe(1);
    expect(state2.cycles.length).toBe(2);

    engine.stop();
  });
});

describe("TddEngine advanceAfterTests", () => {
  test("advances red -> green on pass", () => {
    const engine = new TddEngine({ testFile: "dummy.test.ts" });
    engine.start();
    expect(engine.getPhase()).toBe("red");

    const advanced = engine.advanceAfterTests(true);
    expect(advanced).toBe(true);
    expect(engine.getPhase()).toBe("green");

    engine.stop();
  });

  test("advances green -> refactor on pass", () => {
    const engine = new TddEngine({ testFile: "dummy.test.ts" });
    engine.start();
    engine.transition("green");

    const advanced = engine.advanceAfterTests(true);
    expect(advanced).toBe(true);
    expect(engine.getPhase()).toBe("refactor");

    engine.stop();
  });

  test("advances refactor -> red on pass", () => {
    const engine = new TddEngine({ testFile: "dummy.test.ts" });
    engine.start();
    engine.transition("green");
    engine.transition("refactor");

    const advanced = engine.advanceAfterTests(true);
    expect(advanced).toBe(true);
    expect(engine.getPhase()).toBe("red");

    engine.stop();
  });

  test("does not advance on fail", () => {
    const engine = new TddEngine({ testFile: "dummy.test.ts" });
    engine.start();
    expect(engine.getPhase()).toBe("red");

    const advanced = engine.advanceAfterTests(false);
    expect(advanced).toBe(false);
    expect(engine.getPhase()).toBe("red");

    engine.stop();
  });

  test("does not advance from idle", () => {
    const engine = new TddEngine({ testFile: "dummy.test.ts" });
    const advanced = engine.advanceAfterTests(true);
    expect(advanced).toBe(false);
    expect(engine.getPhase()).toBe("idle");
  });
});

describe("TddEngine event bus integration", () => {
  test("emits TDD_CYCLE_START on transition to red", () => {
    const bus = new EventBus();
    const events: any[] = [];
    bus.on("TDD_CYCLE_START", (e) => events.push(e));

    const engine = new TddEngine({ testFile: "my.test.ts", eventBus: bus });
    engine.start();

    expect(events.length).toBe(1);
    expect(events[0].phase).toBe("red");
    expect(events[0].testFile).toBe("my.test.ts");

    engine.stop();
  });

  test("emits TDD_CYCLE_START on transition to green", () => {
    const bus = new EventBus();
    const events: any[] = [];
    bus.on("TDD_CYCLE_START", (e) => events.push(e));

    const engine = new TddEngine({ testFile: "my.test.ts", eventBus: bus });
    engine.start();
    engine.transition("green");

    expect(events.length).toBe(2);
    expect(events[1].phase).toBe("green");

    engine.stop();
  });

  test("emits TDD_REFACTOR on transition to refactor", () => {
    const bus = new EventBus();
    const events: any[] = [];
    bus.on("TDD_REFACTOR", (e) => events.push(e));

    const engine = new TddEngine({ testFile: "my.test.ts", eventBus: bus });
    engine.start();
    engine.transition("green");
    engine.transition("refactor");

    expect(events.length).toBe(1);
    expect(events[0].testFile).toBe("my.test.ts");

    engine.stop();
  });
});

describe("TddEngine onStateChange callback", () => {
  test("fires on start", () => {
    const states: any[] = [];
    const engine = new TddEngine({
      testFile: "dummy.test.ts",
      onStateChange: (s) => states.push(s),
    });
    engine.start();
    expect(states.length).toBe(1);
    expect(states[0].phase).toBe("red");
    engine.stop();
  });

  test("fires on each transition", () => {
    const states: any[] = [];
    const engine = new TddEngine({
      testFile: "dummy.test.ts",
      onStateChange: (s) => states.push(s),
    });
    engine.start();
    engine.transition("green");
    engine.transition("refactor");
    expect(states.length).toBe(3);
    expect(states[0].phase).toBe("red");
    expect(states[1].phase).toBe("green");
    expect(states[2].phase).toBe("refactor");
    engine.stop();
  });

  test("fires on stop", () => {
    const states: any[] = [];
    const engine = new TddEngine({
      testFile: "dummy.test.ts",
      onStateChange: (s) => states.push(s),
    });
    engine.start();
    engine.stop();
    // start fires once, stop fires once
    expect(states.length).toBe(2);
    expect(states[1].phase).toBe("idle");
  });
});

describe("TddEngine test execution", () => {
  test("runs passing test file", async () => {
    const testPath = writeTestFile(
      "pass.test.ts",
      `import { test, expect } from "bun:test";\ntest("passes", () => { expect(1).toBe(1); });\n`,
    );

    const engine = new TddEngine({ testFile: testPath });
    engine.start();

    const result = await engine.runTests();
    expect(result.passed).toBe(true);
    expect(result.passCount).toBeGreaterThanOrEqual(1);
    expect(result.failCount).toBe(0);
    expect(result.duration).toBeGreaterThan(0);
    expect(result.output.length).toBeGreaterThan(0);

    engine.stop();
  });

  test("runs failing test file", async () => {
    const testPath = writeTestFile(
      "fail.test.ts",
      `import { test, expect } from "bun:test";\ntest("fails", () => { expect(1).toBe(2); });\n`,
    );

    const engine = new TddEngine({ testFile: testPath });
    engine.start();

    const result = await engine.runTests();
    expect(result.passed).toBe(false);
    expect(result.failCount).toBeGreaterThanOrEqual(1);

    engine.stop();
  });

  test("emits TDD_TEST_PASS event on pass", async () => {
    const testPath = writeTestFile(
      "pass-event.test.ts",
      `import { test, expect } from "bun:test";\ntest("ok", () => { expect(true).toBe(true); });\n`,
    );

    const bus = new EventBus();
    const events: any[] = [];
    bus.on("TDD_TEST_PASS", (e) => events.push(e));

    const engine = new TddEngine({ testFile: testPath, eventBus: bus });
    engine.start();
    await engine.runTests();

    expect(events.length).toBe(1);
    expect(events[0].testFile).toBe(testPath);
    expect(events[0].passCount).toBeGreaterThanOrEqual(1);

    engine.stop();
  });

  test("emits TDD_TEST_FAIL event on fail", async () => {
    const testPath = writeTestFile(
      "fail-event.test.ts",
      `import { test, expect } from "bun:test";\ntest("bad", () => { expect(1).toBe(0); });\n`,
    );

    const bus = new EventBus();
    const events: any[] = [];
    bus.on("TDD_TEST_FAIL", (e) => events.push(e));

    const engine = new TddEngine({ testFile: testPath, eventBus: bus });
    engine.start();
    await engine.runTests();

    expect(events.length).toBe(1);
    expect(events[0].testFile).toBe(testPath);
    expect(events[0].failCount).toBeGreaterThanOrEqual(1);

    engine.stop();
  });

  test("updates state with test output", async () => {
    const testPath = writeTestFile(
      "output.test.ts",
      `import { test, expect } from "bun:test";\ntest("check", () => { expect(42).toBe(42); });\n`,
    );

    const engine = new TddEngine({ testFile: testPath });
    engine.start();
    await engine.runTests();

    const state = engine.getState();
    expect(state.lastTestOutput.length).toBeGreaterThan(0);
    expect(state.lastTestPassed).toBe(true);

    engine.stop();
  });

  test("records test results in cycle history", async () => {
    const testPath = writeTestFile(
      "history.test.ts",
      `import { test, expect } from "bun:test";\ntest("ok", () => { expect(1).toBe(1); });\n`,
    );

    const engine = new TddEngine({ testFile: testPath });
    engine.start();
    await engine.runTests();

    const state = engine.getState();
    const lastCycle = state.cycles[state.cycles.length - 1];
    expect(lastCycle.passed).toBe(true);
    expect(lastCycle.passCount).toBeGreaterThanOrEqual(1);
    expect(lastCycle.duration).toBeGreaterThan(0);

    engine.stop();
  });
});

describe("TddEngine startedAt", () => {
  test("records start timestamp", () => {
    const before = new Date().toISOString();
    const engine = new TddEngine({ testFile: "dummy.test.ts" });
    const after = new Date().toISOString();

    const state = engine.getState();
    expect(state.startedAt >= before).toBe(true);
    expect(state.startedAt <= after).toBe(true);
  });
});
