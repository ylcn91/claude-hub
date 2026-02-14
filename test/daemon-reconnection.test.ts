/**
 * Tests that a client can reconnect to the daemon after socket close.
 *
 * Verifies:
 * - Client can re-authenticate after socket destruction
 * - Daemon state survives client disconnection
 * - Messages sent before disconnect are still accessible after reconnect
 * - Multiple sequential reconnections work
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
  const dir = join(import.meta.dir, `.test-daemon-reconnect-${++dirCounter}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const ALICE = { name: "alice", token: "alice-secret" };
const BOB = { name: "bob", token: "bob-secret" };

let daemon: TestDaemon | undefined;

afterEach(() => {
  if (daemon) {
    daemon.cleanup();
    daemon = undefined;
  }
});

describe("daemon reconnection", () => {
  test("client can reconnect after socket destroy", async () => {
    const dir = freshDir();
    daemon = await startTestDaemon(dir, { accounts: [ALICE, BOB] });

    // First connection
    const socket1 = await connectAndAuth(daemon.sockPath, ALICE.name, ALICE.token);
    const result1 = await sendAndWait(socket1, {
      type: "send_message",
      to: BOB.name,
      content: "hello from first connection",
    });
    expect(result1.type).not.toBe("error");
    socket1.destroy();

    // Wait for socket close to propagate
    await Bun.sleep(50);

    // Reconnect with a fresh socket
    const socket2 = await connectAndAuth(daemon.sockPath, ALICE.name, ALICE.token);
    const result2 = await sendAndWait(socket2, {
      type: "send_message",
      to: BOB.name,
      content: "hello from second connection",
    });
    expect(result2.type).not.toBe("error");
    socket2.destroy();
  });

  test("messages survive client disconnection", async () => {
    const dir = freshDir();
    daemon = await startTestDaemon(dir, { accounts: [ALICE, BOB] });

    // Alice sends a message then disconnects
    const aliceSocket = await connectAndAuth(daemon.sockPath, ALICE.name, ALICE.token);
    await sendAndWait(aliceSocket, {
      type: "send_message",
      to: BOB.name,
      content: "message before disconnect",
    });
    aliceSocket.destroy();
    await Bun.sleep(50);

    // Bob connects and reads the message
    const bobSocket = await connectAndAuth(daemon.sockPath, BOB.name, BOB.token);
    const readResult = await sendAndWait(bobSocket, {
      type: "read_messages",
      limit: 10,
    });

    expect(readResult.messages).toBeDefined();
    expect(readResult.messages.length).toBeGreaterThanOrEqual(1);
    const msg = readResult.messages.find((m: any) => m.content === "message before disconnect");
    expect(msg).toBeDefined();
    expect(msg.from).toBe(ALICE.name);

    bobSocket.destroy();
  });

  test("multiple sequential reconnections work", async () => {
    const dir = freshDir();
    daemon = await startTestDaemon(dir, { accounts: [ALICE] });

    for (let i = 0; i < 5; i++) {
      const socket = await connectAndAuth(daemon.sockPath, ALICE.name, ALICE.token);
      const result = await sendAndWait(socket, {
        type: "send_message",
        to: ALICE.name,
        content: `round ${i}`,
      });
      expect(result.type).not.toBe("error");
      socket.destroy();
      await Bun.sleep(30);
    }
  });

  test("different accounts can reconnect independently", async () => {
    const dir = freshDir();
    daemon = await startTestDaemon(dir, { accounts: [ALICE, BOB] });

    // Alice connects and disconnects
    const alice1 = await connectAndAuth(daemon.sockPath, ALICE.name, ALICE.token);
    await sendAndWait(alice1, { type: "send_message", to: BOB.name, content: "from alice" });
    alice1.destroy();
    await Bun.sleep(30);

    // Bob connects while Alice is disconnected
    const bob1 = await connectAndAuth(daemon.sockPath, BOB.name, BOB.token);
    await sendAndWait(bob1, { type: "send_message", to: ALICE.name, content: "from bob" });

    // Alice reconnects while Bob is still connected
    const alice2 = await connectAndAuth(daemon.sockPath, ALICE.name, ALICE.token);
    const aliceMessages = await sendAndWait(alice2, { type: "read_messages", limit: 10 });
    expect(aliceMessages.messages).toBeDefined();
    const fromBob = aliceMessages.messages.find((m: any) => m.content === "from bob");
    expect(fromBob).toBeDefined();

    alice2.destroy();
    bob1.destroy();
  });

  test("daemon tracks connection status across reconnects", async () => {
    const dir = freshDir();
    daemon = await startTestDaemon(dir, { accounts: [ALICE] });

    // Connect
    const socket = await connectAndAuth(daemon.sockPath, ALICE.name, ALICE.token);
    expect(daemon.state.isConnected(ALICE.name)).toBe(true);

    // Disconnect
    socket.destroy();
    await Bun.sleep(50);
    expect(daemon.state.isConnected(ALICE.name)).toBe(false);

    // Reconnect
    const socket2 = await connectAndAuth(daemon.sockPath, ALICE.name, ALICE.token);
    expect(daemon.state.isConnected(ALICE.name)).toBe(true);

    socket2.destroy();
  });
});
