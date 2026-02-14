import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { createConnection } from "net";
import { startDaemon, stopDaemon } from "../src/daemon/server";
import type { DaemonState } from "../src/daemon/state";
import type { Server } from "net";

const TEST_DIR = join(import.meta.dir, ".test-count-unread");
let dbCounter = 0;
function uniqueDbPath(dir: string): string {
  return join(dir, `test-${++dbCounter}-${Date.now()}.db`);
}

describe("count_unread handler", () => {
  let server: Server;
  let state: DaemonState;
  let sockPath: string;
  const originalHubDir = process.env.AGENTCTL_DIR;

  beforeEach(() => {
    process.env.AGENTCTL_DIR = TEST_DIR;
    mkdirSync(join(TEST_DIR, "tokens"), { recursive: true });
    writeFileSync(join(TEST_DIR, "tokens", "alice.token"), "alice-secret");
    writeFileSync(join(TEST_DIR, "tokens", "bob.token"), "bob-secret");

    const result = startDaemon({
      dbPath: uniqueDbPath(TEST_DIR),
      sockPath: join(TEST_DIR, `count-unread-${Date.now()}.sock`),
    });
    server = result.server;
    state = result.state;
    sockPath = result.sockPath;
  });

  afterEach(() => {
    process.env.AGENTCTL_DIR = originalHubDir;
    try { state.close(); } catch {}
    try { stopDaemon(server, sockPath); } catch {}
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  function connectAndAuth(account: string, token: string): Promise<ReturnType<typeof createConnection>> {
    return new Promise((resolve, reject) => {
      const client = createConnection(sockPath, () => {
        client.write(JSON.stringify({ type: "auth", account, token }) + "\n");
      });
      client.once("data", (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "auth_ok") resolve(client);
        else { client.destroy(); reject(new Error(`Auth failed: ${msg.error}`)); }
      });
      client.on("error", reject);
    });
  }

  function sendAndReceive(client: ReturnType<typeof createConnection>, msg: object): Promise<any> {
    return new Promise((resolve) => {
      client.once("data", (data) => resolve(JSON.parse(data.toString())));
      client.write(JSON.stringify(msg) + "\n");
    });
  }

  test("count_unread returns count without marking read", async () => {
    await Bun.sleep(50);

    const alice = await connectAndAuth("alice", "alice-secret");
    const bob = await connectAndAuth("bob", "bob-secret");

    // Alice sends 3 messages to Bob
    await sendAndReceive(alice, { type: "send_message", to: "bob", content: "msg1" });
    await sendAndReceive(alice, { type: "send_message", to: "bob", content: "msg2" });
    await sendAndReceive(alice, { type: "send_message", to: "bob", content: "msg3" });

    // Bob counts unread — should be 3
    const countResult = await sendAndReceive(bob, { type: "count_unread" });
    expect(countResult.count).toBe(3);

    // Count again — still 3 (non-destructive)
    const countResult2 = await sendAndReceive(bob, { type: "count_unread" });
    expect(countResult2.count).toBe(3);

    // Now read_messages — marks them read
    const readResult = await sendAndReceive(bob, { type: "read_messages" });
    expect(readResult.messages).toHaveLength(3);

    // Count after read — should be 0
    const countResult3 = await sendAndReceive(bob, { type: "count_unread" });
    expect(countResult3.count).toBe(0);

    alice.destroy();
    bob.destroy();
  });

  test("sockPath isolation: two daemons coexist", async () => {
    // Start a second daemon with a different sockPath
    const sockPath2 = join(TEST_DIR, `isolated-${Date.now()}.sock`);
    const result2 = startDaemon({
      dbPath: uniqueDbPath(TEST_DIR),
      sockPath: sockPath2,
    });

    await Bun.sleep(50);

    // Both daemons should be reachable
    const connected1 = await new Promise<boolean>((resolve) => {
      const client = createConnection(sockPath, () => { client.destroy(); resolve(true); });
      client.on("error", () => resolve(false));
    });
    const connected2 = await new Promise<boolean>((resolve) => {
      const client = createConnection(sockPath2, () => { client.destroy(); resolve(true); });
      client.on("error", () => resolve(false));
    });

    expect(connected1).toBe(true);
    expect(connected2).toBe(true);

    result2.state.close();
    stopDaemon(result2.server, sockPath2);
  });
});
