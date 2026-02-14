import { watch, type FSWatcher } from "fs";
import type { TddPhase, TddState, TddCycleEvent } from "../types.js";
import type { EventBus } from "./event-bus.js";

export interface TddEngineOptions {
  testFile: string;
  watchMode?: boolean;
  eventBus?: EventBus;
  onStateChange?: (state: TddState) => void;
}

export interface TestRunResult {
  passed: boolean;
  passCount: number;
  failCount: number;
  output: string;
  duration: number;
}

const VALID_TRANSITIONS: Record<TddPhase, TddPhase[]> = {
  idle: ["red"],
  red: ["green"],
  green: ["refactor"],
  refactor: ["red"],
};

export class TddEngine {
  private state: TddState;
  private watcher: FSWatcher | null = null;
  private options: TddEngineOptions;
  private running = false;

  constructor(options: TddEngineOptions) {
    this.options = options;
    this.state = {
      phase: "idle",
      testFile: options.testFile,
      cycles: [],
      lastTestOutput: "",
      lastTestPassed: false,
      startedAt: new Date().toISOString(),
    };
  }

  getState(): TddState {
    return { ...this.state, cycles: [...this.state.cycles] };
  }

  getPhase(): TddPhase {
    return this.state.phase;
  }

  canTransition(to: TddPhase): boolean {
    return VALID_TRANSITIONS[this.state.phase].includes(to);
  }

  transition(to: TddPhase): boolean {
    if (!this.canTransition(to)) return false;

    this.state.phase = to;

    const event: TddCycleEvent = {
      phase: to,
      timestamp: new Date().toISOString(),
      testFile: this.options.testFile,
    };
    this.state.cycles.push(event);

    if (to !== "idle" && this.options.eventBus) {
      if (to === "refactor") {
        this.options.eventBus.emit({
          type: "TDD_REFACTOR",
          testFile: this.options.testFile,
        });
      } else {
        this.options.eventBus.emit({
          type: "TDD_CYCLE_START",
          testFile: this.options.testFile,
          phase: to,
        });
      }
    }

    this.options.onStateChange?.(this.getState());
    return true;
  }

  start(): boolean {
    if (this.state.phase !== "idle") return false;
    this.transition("red");

    if (this.options.watchMode) {
      this.startWatcher();
    }

    return true;
  }

  stop(): void {
    this.stopWatcher();
    this.state.phase = "idle";
    this.options.onStateChange?.(this.getState());
  }

  async runTests(): Promise<TestRunResult> {
    if (this.running) {
      return { passed: false, passCount: 0, failCount: 0, output: "Tests already running", duration: 0 };
    }

    this.running = true;
    const startTime = Date.now();

    try {
      const proc = Bun.spawn(["bun", "test", this.options.testFile], {
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);

      const exitCode = await proc.exited;
      const output = stdout + (stderr ? "\n" + stderr : "");
      const duration = Date.now() - startTime;
      const passed = exitCode === 0;

      const passMatch = output.match(/(\d+)\s+pass/);
      const failMatch = output.match(/(\d+)\s+fail/);
      const passCount = passMatch ? parseInt(passMatch[1], 10) : 0;
      const failCount = failMatch ? parseInt(failMatch[1], 10) : 0;

      this.state.lastTestOutput = output;
      this.state.lastTestPassed = passed;

      // Update the last cycle event with test results
      const lastCycle = this.state.cycles[this.state.cycles.length - 1];
      if (lastCycle) {
        lastCycle.passed = passed;
        lastCycle.passCount = passCount;
        lastCycle.failCount = failCount;
        lastCycle.duration = duration;
      }

      // Emit events
      if (this.options.eventBus) {
        if (passed) {
          this.options.eventBus.emit({
            type: "TDD_TEST_PASS",
            testFile: this.options.testFile,
            passCount,
            duration,
          });
        } else {
          this.options.eventBus.emit({
            type: "TDD_TEST_FAIL",
            testFile: this.options.testFile,
            failCount,
            duration,
          });
        }
      }

      this.options.onStateChange?.(this.getState());

      return { passed, passCount, failCount, output, duration };
    } finally {
      this.running = false;
    }
  }

  /**
   * Advance the TDD cycle based on test results.
   * RED + tests pass -> GREEN
   * GREEN + tests pass -> REFACTOR
   * REFACTOR + tests pass -> RED (next cycle)
   */
  advanceAfterTests(passed: boolean): boolean {
    if (passed) {
      switch (this.state.phase) {
        case "red":
          return this.transition("green");
        case "green":
          return this.transition("refactor");
        case "refactor":
          return this.transition("red");
        default:
          return false;
      }
    }
    return false;
  }

  private startWatcher(): void {
    try {
      this.watcher = watch(this.options.testFile, { persistent: true }, async (eventType) => {
        if (eventType === "change") {
          await this.runTests();
        }
      });
    } catch {
      // File watching not available
    }
  }

  private stopWatcher(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}
