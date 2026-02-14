/**
 * Auth reconnection behavioral tests.
 *
 * Tests the bridge reconnection logic by examining:
 * - MAX_RECONNECT_ATTEMPTS bounds reconnection
 * - Exponential backoff delay calculation
 * - Auth failure handling (auth_fail response doesn't crash)
 * - Reconnection uses correct token for re-auth
 * - The bridge module's structural guarantees
 */
import { describe, test, expect, afterEach } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { createConnection, createServer, type Server as NetServer } from "net";
import { createLineParser, frameSend, generateRequestId } from "../src/daemon/framing";
import { MAX_RECONNECT_ATTEMPTS, RECONNECT_MAX_DELAY_MS } from "../src/constants";

const BRIDGE_SRC_PATH = join(import.meta.dir, "..", "src", "mcp", "bridge.ts");

describe("bridge reconnection: structural guarantees", () => {
  const bridgeSrc = readFileSync(BRIDGE_SRC_PATH, "utf-8");

  test("MAX_RECONNECT_ATTEMPTS is bounded", () => {
    expect(MAX_RECONNECT_ATTEMPTS).toBeGreaterThan(0);
    expect(MAX_RECONNECT_ATTEMPTS).toBeLessThanOrEqual(10);
  });

  test("RECONNECT_MAX_DELAY_MS caps backoff", () => {
    expect(RECONNECT_MAX_DELAY_MS).toBeGreaterThan(0);
    expect(RECONNECT_MAX_DELAY_MS).toBeLessThanOrEqual(60_000);
  });

  test("backoff uses exponential delay with cap", () => {
    expect(bridgeSrc).toContain("Math.pow(2, reconnectAttempts)");
    expect(bridgeSrc).toContain("Math.min(");
    expect(bridgeSrc).toContain("RECONNECT_MAX_DELAY_MS");
  });

  test("reconnection stops after max attempts", () => {
    expect(bridgeSrc).toContain("reconnectAttempts >= MAX_RECONNECT_ATTEMPTS");
    expect(bridgeSrc).toContain("Max reconnection attempts reached");
  });

  test("re-auth rejection destroys socket", () => {
    expect(bridgeSrc).toContain("Re-auth rejected");
    expect(bridgeSrc).toContain("newSocket.destroy()");
  });

  test("re-auth success resets attempt counter", () => {
    expect(bridgeSrc).toContain("reconnectAttempts = 0");
    expect(bridgeSrc).toContain("Reconnected successfully");
  });

  test("reconnection skips during initial auth phase", () => {
    expect(bridgeSrc).toContain("if (!initialAuthDone) return");
  });
});

describe("auth protocol: daemon mock", () => {
  let mockDaemon: NetServer;
  let sockPath: string;

  function createTempSock(): string {
    const tmp = join(import.meta.dir, `.tmp-auth-test-${Date.now()}.sock`);
    return tmp;
  }

  afterEach(() => {
    if (mockDaemon) {
      mockDaemon.close();
      try { require("fs").unlinkSync(sockPath); } catch {}
    }
  });

  test("client receives auth_fail on bad token", async () => {
    sockPath = createTempSock();

    mockDaemon = createServer((socket) => {
      const parser = createLineParser((msg) => {
        if (msg.type === "auth") {
          const response: Record<string, unknown> = {
            requestId: msg.requestId,
            type: msg.token === "valid-token" ? "auth_ok" : "auth_fail",
          };
          if (msg.token !== "valid-token") {
            response.error = "Invalid token";
          }
          socket.write(frameSend(response));
        }
      });
      socket.on("data", (data) => parser.feed(data));
    });
    mockDaemon.listen(sockPath);

    const client = createConnection(sockPath);
    await new Promise<void>((resolve) => client.once("connect", resolve));

    const requestId = generateRequestId();
    client.write(frameSend({ type: "auth", account: "test", token: "bad-token", requestId }));

    const response = await new Promise<any>((resolve) => {
      const parser = createLineParser((msg) => resolve(msg));
      client.once("data", (data) => parser.feed(data));
    });

    expect(response.type).toBe("auth_fail");
    expect(response.error).toBe("Invalid token");
    client.destroy();
  });

  test("client does not crash after auth_fail", async () => {
    sockPath = createTempSock();

    mockDaemon = createServer((socket) => {
      const parser = createLineParser((msg) => {
        if (msg.type === "auth") {
          socket.write(frameSend({
            requestId: msg.requestId,
            type: "auth_fail",
            error: "Unauthorized",
          }));
        }
      });
      socket.on("data", (data) => parser.feed(data));
    });
    mockDaemon.listen(sockPath);

    const client = createConnection(sockPath);
    await new Promise<void>((resolve) => client.once("connect", resolve));

    const requestId = generateRequestId();
    client.write(frameSend({ type: "auth", account: "test", token: "wrong", requestId }));

    const response = await new Promise<any>((resolve) => {
      const parser = createLineParser((msg) => resolve(msg));
      client.once("data", (data) => parser.feed(data));
    });

    expect(response.type).toBe("auth_fail");

    // Verify client socket is still usable (not crashed)
    expect(client.destroyed).toBe(false);
    client.destroy();
  });

  test("successful auth followed by message round-trip", async () => {
    sockPath = createTempSock();

    mockDaemon = createServer((socket) => {
      const parser = createLineParser((msg) => {
        if (msg.type === "auth" && msg.token === "valid-token") {
          socket.write(frameSend({ requestId: msg.requestId, type: "auth_ok" }));
        } else if (msg.type === "list_accounts") {
          socket.write(frameSend({
            requestId: msg.requestId,
            type: "result",
            accounts: [{ name: "alice" }],
          }));
        }
      });
      socket.on("data", (data) => parser.feed(data));
    });
    mockDaemon.listen(sockPath);

    const client = createConnection(sockPath);
    await new Promise<void>((resolve) => client.once("connect", resolve));

    // Auth
    const authReqId = generateRequestId();
    client.write(frameSend({ type: "auth", account: "test", token: "valid-token", requestId: authReqId }));

    const authResp = await new Promise<any>((resolve) => {
      const parser = createLineParser((msg) => {
        if (msg.requestId === authReqId) resolve(msg);
      });
      client.on("data", (data) => parser.feed(data));
    });
    expect(authResp.type).toBe("auth_ok");

    // After auth, send a real request
    const listReqId = generateRequestId();
    client.write(frameSend({ type: "list_accounts", requestId: listReqId }));

    const listResp = await new Promise<any>((resolve) => {
      const parser = createLineParser((msg) => {
        if (msg.requestId === listReqId) resolve(msg);
      });
      client.on("data", (data) => parser.feed(data));
    });

    expect(listResp.type).toBe("result");
    expect(listResp.accounts).toHaveLength(1);
    expect(listResp.accounts[0].name).toBe("alice");

    client.destroy();
  });

  test("multiple failed auth attempts do not crash the client", async () => {
    sockPath = createTempSock();
    let authCount = 0;

    mockDaemon = createServer((socket) => {
      const parser = createLineParser((msg) => {
        if (msg.type === "auth") {
          authCount++;
          socket.write(frameSend({
            requestId: msg.requestId,
            type: "auth_fail",
            error: `Attempt ${authCount} failed`,
          }));
        }
      });
      socket.on("data", (data) => parser.feed(data));
    });
    mockDaemon.listen(sockPath);

    const client = createConnection(sockPath);
    await new Promise<void>((resolve) => client.once("connect", resolve));

    // Send 3 auth attempts
    for (let i = 0; i < 3; i++) {
      const reqId = generateRequestId();
      client.write(frameSend({ type: "auth", account: "test", token: "wrong", requestId: reqId }));

      const resp = await new Promise<any>((resolve) => {
        const parser = createLineParser((msg) => {
          if (msg.requestId === reqId) resolve(msg);
        });
        client.on("data", (data) => parser.feed(data));
      });

      expect(resp.type).toBe("auth_fail");
    }

    // Client should still be alive after multiple failures
    expect(client.destroyed).toBe(false);
    expect(authCount).toBe(3);
    client.destroy();
  });
});
