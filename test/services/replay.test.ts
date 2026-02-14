import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { buildTimeline } from "../../src/services/replay";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { $ } from "bun";

let testDir: string;
let testCounter = 0;

beforeEach(async () => {
  testCounter++;
  testDir = join(import.meta.dir, `.test-replay-${process.pid}-${testCounter}`);
  mkdirSync(testDir, { recursive: true });
  await $`git init`.cwd(testDir).quiet();
  await $`git config user.email "test@test.com"`.cwd(testDir).quiet();
  await $`git config user.name "Test"`.cwd(testDir).quiet();
  await Bun.write(join(testDir, "file.txt"), "hello\n");
  await $`git add .`.cwd(testDir).quiet();
  await $`git commit -m "initial commit"`.cwd(testDir).quiet();
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

async function setupCheckpoint(dir: string, checkpointId: string, transcriptLines: any[]) {
  const prefix = checkpointId.slice(0, 2);
  const suffix = checkpointId.slice(2);

  await $`git checkout --orphan entire/checkpoints/v1`.cwd(dir).quiet();
  await $`git rm -rf .`.cwd(dir).quiet();

  const cpDir = join(dir, prefix, suffix);
  const sessionDir = join(cpDir, "0");
  mkdirSync(sessionDir, { recursive: true });

  await Bun.write(join(cpDir, "metadata.json"), JSON.stringify({
    checkpoint_id: checkpointId,
    strategy: "manual-commit",
  }));

  const transcript = transcriptLines.map(l => JSON.stringify(l)).join("\n");
  await Bun.write(join(sessionDir, "full.jsonl"), transcript);

  await $`git add .`.cwd(dir).quiet();
  await $`git commit -m "Checkpoint: ${checkpointId}"`.cwd(dir).quiet();
  await $`git checkout main`.cwd(dir).quiet();
}

describe("buildTimeline", () => {
  test("returns empty timeline for non-existent checkpoint", async () => {
    const events = await buildTimeline(testDir, "nonexistent12");
    expect(events).toEqual([]);
  });

  test("classifies user messages as prompt events", async () => {
    await setupCheckpoint(testDir, "e1f2a3b4c5d6", [
      { role: "user", content: "Write a function" },
    ]);

    const events = await buildTimeline(testDir, "e1f2a3b4c5d6");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("prompt");
    expect(events[0].content).toBe("Write a function");
  });

  test("classifies assistant messages as response events", async () => {
    await setupCheckpoint(testDir, "f1a2b3c4d5e6", [
      { role: "assistant", content: "Here is the function..." },
    ]);

    const events = await buildTimeline(testDir, "f1a2b3c4d5e6");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("response");
    expect(events[0].content).toBe("Here is the function...");
  });

  test("classifies tool_use content blocks as tool_call events", async () => {
    await setupCheckpoint(testDir, "a1a2a3a4a5a6", [
      {
        role: "assistant",
        content: [
          { type: "tool_use", name: "Read", input: { file_path: "/test.ts" } },
        ],
      },
    ]);

    const events = await buildTimeline(testDir, "a1a2a3a4a5a6");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("tool_call");
    expect(events[0].toolName).toBe("Read");
    expect(events[0].toolInput!.file_path).toBe("/test.ts");
  });

  test("classifies text content blocks as response events", async () => {
    await setupCheckpoint(testDir, "b1b2b3b4b5b6", [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me read that file." },
        ],
      },
    ]);

    const events = await buildTimeline(testDir, "b1b2b3b4b5b6");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("response");
    expect(events[0].content).toBe("Let me read that file.");
  });

  test("skips tool_result messages", async () => {
    await setupCheckpoint(testDir, "c1c2c3c4c5c6", [
      { role: "user", content: "Hello" },
      { role: "tool", content: "tool output" },
      { role: "assistant", content: "Done!" },
    ]);

    const events = await buildTimeline(testDir, "c1c2c3c4c5c6");
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("prompt");
    expect(events[1].type).toBe("response");
  });

  test("builds multi-turn timeline in order", async () => {
    await setupCheckpoint(testDir, "d1d2d3d4d5d6", [
      { role: "user", content: "Create a test" },
      { role: "assistant", content: [{ type: "tool_use", name: "Write", input: { file_path: "test.ts", content: "..." } }] },
      { role: "tool", content: "File written" },
      { role: "assistant", content: "I created the test file." },
      { role: "user", content: "Run the test" },
      { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: { command: "bun test" } }] },
    ]);

    const events = await buildTimeline(testDir, "d1d2d3d4d5d6");
    expect(events).toHaveLength(5);
    expect(events[0].type).toBe("prompt");
    expect(events[1].type).toBe("tool_call");
    expect(events[1].toolName).toBe("Write");
    expect(events[2].type).toBe("response");
    expect(events[3].type).toBe("prompt");
    expect(events[4].type).toBe("tool_call");
    expect(events[4].toolName).toBe("Bash");
  });

  test("events have sequential index values", async () => {
    await setupCheckpoint(testDir, "e1e2e3e4e5e6", [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi" },
    ]);

    const events = await buildTimeline(testDir, "e1e2e3e4e5e6");
    expect(events[0].index).toBe(0);
    expect(events[1].index).toBe(1);
  });

  test("handles messages with content as array of text blocks", async () => {
    await setupCheckpoint(testDir, "f1f2f3f4f5f6", [
      {
        role: "user",
        content: [{ type: "text", text: "Multiple text blocks" }],
      },
    ]);

    const events = await buildTimeline(testDir, "f1f2f3f4f5f6");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("prompt");
    expect(events[0].content).toBe("Multiple text blocks");
  });

  // C1 fix: multi-block assistant messages should emit ALL events
  test("emits BOTH text and tool_use events from multi-block assistant message", async () => {
    await setupCheckpoint(testDir, "g1g2g3g4g5g6", [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me write that file." },
          { type: "tool_use", name: "Write", input: { file_path: "/out.ts", content: "code" } },
        ],
      },
    ]);

    const events = await buildTimeline(testDir, "g1g2g3g4g5g6");
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("response");
    expect(events[0].content).toBe("Let me write that file.");
    expect(events[1].type).toBe("tool_call");
    expect(events[1].toolName).toBe("Write");
    expect(events[1].toolInput!.file_path).toBe("/out.ts");
  });

  // Test with type: "human" variant
  test("classifies type: 'human' messages as prompt events", async () => {
    await setupCheckpoint(testDir, "h1h2h3h4h5h6", [
      { type: "human", content: "A human-typed message" },
    ]);

    const events = await buildTimeline(testDir, "h1h2h3h4h5h6");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("prompt");
    expect(events[0].content).toBe("A human-typed message");
  });

  // Test with type: "tool_result" (should return empty/no events)
  test("skips type: 'tool_result' messages", async () => {
    await setupCheckpoint(testDir, "i1i2i3i4i5i6", [
      { type: "tool_result", content: "some result" },
    ]);

    const events = await buildTimeline(testDir, "i1i2i3i4i5i6");
    expect(events).toHaveLength(0);
  });

  // Test standalone type: "tool_use" fallback
  test("classifies standalone type: 'tool_use' as tool_call via fallback", async () => {
    await setupCheckpoint(testDir, "j1j2j3j4j5j6", [
      { type: "tool_use", name: "Bash", input: { command: "ls" } },
    ]);

    const events = await buildTimeline(testDir, "j1j2j3j4j5j6");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("tool_call");
    expect(events[0].toolName).toBe("Bash");
    expect(events[0].toolInput!.command).toBe("ls");
  });

  // Test extractContent with msg.text fallback
  test("extractContent falls back to msg.text", async () => {
    await setupCheckpoint(testDir, "k1k2k3k4k5k6", [
      { role: "user", text: "Text field fallback" },
    ]);

    const events = await buildTimeline(testDir, "k1k2k3k4k5k6");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("prompt");
    expect(events[0].content).toBe("Text field fallback");
  });

  // Test extractContent with msg.message fallback
  test("extractContent falls back to msg.message", async () => {
    await setupCheckpoint(testDir, "l1l2l3l4l5l6", [
      { role: "assistant", message: "Message field fallback" },
    ]);

    const events = await buildTimeline(testDir, "l1l2l3l4l5l6");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("response");
    expect(events[0].content).toBe("Message field fallback");
  });

  // Test with malformed parsed object (e.g., {role: 123}) - should not crash after M3 fix
  test("handles malformed parsed object without crashing", async () => {
    await setupCheckpoint(testDir, "m1m2m3m4m5m6", [
      { role: 123, content: "not a valid role" },
      { role: "assistant", content: 42 },
      { some: "random", fields: true },
    ]);

    // Should not throw -- just returns no events or skips gracefully
    const events = await buildTimeline(testDir, "m1m2m3m4m5m6");
    expect(Array.isArray(events)).toBe(true);
  });

  // Test with empty content array
  test("handles assistant message with empty content array", async () => {
    await setupCheckpoint(testDir, "n1n2n3n4n5n6", [
      { role: "assistant", content: [] },
    ]);

    const events = await buildTimeline(testDir, "n1n2n3n4n5n6");
    expect(events).toHaveLength(0);
  });
});
