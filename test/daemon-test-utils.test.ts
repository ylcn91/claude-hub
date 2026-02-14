import { describe, test, expect, afterEach } from "bun:test";
import { join } from "path";
import {
  startTestDaemon,
  connectAndAuth,
  sendAndWait,
  sendOneShot,
  createTestToken,
  waitForSocket,
  type TestDaemon,
} from "./helpers/daemon-test-utils";

const TEST_DIR = join(import.meta.dir, ".test-daemon-utils");

describe("daemon-test-utils", () => {
  let daemon: TestDaemon | null = null;

  afterEach(() => {
    if (daemon) {
      daemon.cleanup();
      daemon = null;
    }
  });

  test("startTestDaemon starts and cleanup tears down", async () => {
    daemon = await startTestDaemon(join(TEST_DIR, "lifecycle"), {
      accounts: [{ name: "alice", token: "alice-tok" }],
    });
    await waitForSocket(daemon.sockPath);

    expect(daemon.server).toBeDefined();
    expect(daemon.state).toBeDefined();
    expect(daemon.sockPath).toContain("hub.sock");
  });

  test("connectAndAuth authenticates successfully", async () => {
    daemon = await startTestDaemon(join(TEST_DIR, "auth"), {
      accounts: [{ name: "bob", token: "bob-tok" }],
    });
    await waitForSocket(daemon.sockPath);

    const socket = await connectAndAuth(daemon.sockPath, "bob", "bob-tok");
    expect(socket.writable).toBe(true);
    socket.destroy();
  });

  test("connectAndAuth rejects invalid token", async () => {
    daemon = await startTestDaemon(join(TEST_DIR, "bad-auth"), {
      accounts: [{ name: "carol", token: "carol-tok" }],
    });
    await waitForSocket(daemon.sockPath);

    await expect(connectAndAuth(daemon.sockPath, "carol", "wrong")).rejects.toThrow("Auth failed");
  });

  test("sendAndWait sends and receives response", async () => {
    daemon = await startTestDaemon(join(TEST_DIR, "send-wait"), {
      accounts: [{ name: "dave", token: "dave-tok" }],
    });
    await waitForSocket(daemon.sockPath);

    const socket = await connectAndAuth(daemon.sockPath, "dave", "dave-tok");
    const result = await sendAndWait(socket, { type: "count_unread" });
    expect(result.type).toBe("result");
    expect(result.count).toBe(0);
    socket.destroy();
  });

  test("sendOneShot connects, sends, receives, and disconnects", async () => {
    daemon = await startTestDaemon(join(TEST_DIR, "oneshot"), {
      accounts: [{ name: "eve", token: "eve-tok" }],
    });
    await waitForSocket(daemon.sockPath);

    const result = await sendOneShot(daemon.sockPath, "eve", "eve-tok", { type: "count_unread" });
    expect(result.type).toBe("result");
    expect(result.count).toBe(0);
  });

  test("createTestToken creates token file for later auth", async () => {
    daemon = await startTestDaemon(join(TEST_DIR, "late-token"), {
      accounts: [],
    });
    await waitForSocket(daemon.sockPath);

    // Create token after daemon started
    createTestToken(daemon.testDir, "frank", "frank-secret");

    const socket = await connectAndAuth(daemon.sockPath, "frank", "frank-secret");
    expect(socket.writable).toBe(true);
    socket.destroy();
  });

  test("sendAndWait with message flow: send_message + read_messages", async () => {
    daemon = await startTestDaemon(join(TEST_DIR, "flow"), {
      accounts: [
        { name: "sender", token: "s-tok" },
        { name: "reader", token: "r-tok" },
      ],
    });
    await waitForSocket(daemon.sockPath);

    const sender = await connectAndAuth(daemon.sockPath, "sender", "s-tok");
    const reader = await connectAndAuth(daemon.sockPath, "reader", "r-tok");

    const sendResult = await sendAndWait(sender, {
      type: "send_message",
      to: "reader",
      content: "Hello from test utils!",
    });
    expect(sendResult.queued).toBe(true);

    const readResult = await sendAndWait(reader, { type: "read_messages" });
    expect(readResult.messages).toHaveLength(1);
    expect(readResult.messages[0].content).toBe("Hello from test utils!");
    expect(readResult.messages[0].from).toBe("sender");

    sender.destroy();
    reader.destroy();
  });
});
