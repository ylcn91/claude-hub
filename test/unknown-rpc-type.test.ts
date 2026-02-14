/**
 * Tests that the daemon handles unknown/invalid message types gracefully.
 *
 * Messages are validated against DaemonMessageSchema before reaching handlers.
 * Unknown or malformed types are rejected at the schema level with an error response.
 * These tests verify that behavior and ensure unknown types never crash the daemon.
 */
import { describe, test, expect, afterEach } from "bun:test";
import { join } from "path";
import { mkdirSync } from "fs";
import {
  startTestDaemon,
  connectAndAuth,
  sendAndWait,
  type TestDaemon,
} from "./helpers/daemon-test-utils";

let dirCounter = 0;
function freshDir(): string {
  const dir = join(import.meta.dir, `.test-unknown-rpc-${++dirCounter}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const ACCOUNT = "alice";
const TOKEN = "alice-secret-token";

let daemon: TestDaemon | undefined;

afterEach(() => {
  if (daemon) {
    daemon.cleanup();
    daemon = undefined;
  }
});

describe("unknown RPC message type", () => {
  test("unknown type returns error and connection stays alive", async () => {
    const dir = freshDir();
    daemon = await startTestDaemon(dir, { accounts: [{ name: ACCOUNT, token: TOKEN }] });

    const socket = await connectAndAuth(daemon.sockPath, ACCOUNT, TOKEN);
    try {
      // Send an unknown message type — the daemon should return an error
      const errorResult = await sendAndWait(socket, { type: "nonexistent_command" });
      expect(errorResult.type).toBe("error");
      expect(errorResult.error).toContain("Invalid message");

      // The connection should still be alive — verify by sending a known message
      const pingResult = await sendAndWait(socket, { type: "send_message", to: ACCOUNT, content: "ping after unknown" });
      // A valid response means the daemon didn't crash or disconnect
      expect(pingResult).toBeDefined();
      expect(pingResult.type).not.toBe("error");
    } finally {
      socket.destroy();
    }
  });

  test("multiple unknown types return errors without crashing daemon", async () => {
    const dir = freshDir();
    daemon = await startTestDaemon(dir, { accounts: [{ name: ACCOUNT, token: TOKEN }] });

    const socket = await connectAndAuth(daemon.sockPath, ACCOUNT, TOKEN);
    try {
      // Send unknown types with requestIds so we can collect responses
      const result1 = await sendAndWait(socket, { type: "totally_fake" });
      expect(result1.type).toBe("error");

      const result2 = await sendAndWait(socket, { type: "does_not_exist" });
      expect(result2.type).toBe("error");

      // Verify daemon is still responsive with a valid message
      const result = await sendAndWait(socket, { type: "send_message", to: ACCOUNT, content: "still alive" });
      expect(result).toBeDefined();
      expect(result.type).not.toBe("error");
    } finally {
      socket.destroy();
    }
  });

  test("message with missing type field does not crash daemon", async () => {
    const dir = freshDir();
    daemon = await startTestDaemon(dir, { accounts: [{ name: ACCOUNT, token: TOKEN }] });

    const socket = await connectAndAuth(daemon.sockPath, ACCOUNT, TOKEN);
    try {
      // Send a message with no type field at all
      socket.write(JSON.stringify({ requestId: "req-notype", data: "hello" }) + "\n");

      await Bun.sleep(100);

      // Verify daemon is still responsive
      const result = await sendAndWait(socket, { type: "send_message", to: ACCOUNT, content: "still alive" });
      expect(result).toBeDefined();
    } finally {
      socket.destroy();
    }
  });

  test("message with null type does not crash daemon", async () => {
    const dir = freshDir();
    daemon = await startTestDaemon(dir, { accounts: [{ name: ACCOUNT, token: TOKEN }] });

    const socket = await connectAndAuth(daemon.sockPath, ACCOUNT, TOKEN);
    try {
      socket.write(JSON.stringify({ type: null, requestId: "req-null" }) + "\n");
      await Bun.sleep(100);

      const result = await sendAndWait(socket, { type: "send_message", to: ACCOUNT, content: "still alive" });
      expect(result).toBeDefined();
    } finally {
      socket.destroy();
    }
  });

  test("message with numeric type does not crash daemon", async () => {
    const dir = freshDir();
    daemon = await startTestDaemon(dir, { accounts: [{ name: ACCOUNT, token: TOKEN }] });

    const socket = await connectAndAuth(daemon.sockPath, ACCOUNT, TOKEN);
    try {
      socket.write(JSON.stringify({ type: 12345, requestId: "req-num" }) + "\n");
      await Bun.sleep(100);

      const result = await sendAndWait(socket, { type: "send_message", to: ACCOUNT, content: "still alive" });
      expect(result).toBeDefined();
    } finally {
      socket.destroy();
    }
  });
});
