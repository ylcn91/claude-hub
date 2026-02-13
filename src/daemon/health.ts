import type { DaemonState } from "./state";
import { Socket } from "node:net";
import { existsSync } from "node:fs";
import { createLineParser, frameSend } from "./framing";

export interface HealthStatus {
  pid: number;
  uptime: number;          // milliseconds
  startedAt: string;
  connectedAccounts: number;
  messageStoreOk: boolean;
  socketResponsive: boolean;
  memoryUsageMb: number;
}

export function getHealthStatus(state: DaemonState, startedAt: string): HealthStatus {
  let messageStoreOk = true;
  try {
    state.countUnread("__healthcheck__");
  } catch {
    messageStoreOk = false;
  }

  return {
    pid: process.pid,
    uptime: Date.now() - new Date(startedAt).getTime(),
    startedAt,
    connectedAccounts: state.getConnectedAccounts().length,
    messageStoreOk,
    socketResponsive: true,  // caller overrides if needed
    memoryUsageMb: Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100,
  };
}

export function selfTest(sockPath: string): Promise<boolean> {
  // Pre-check: if socket file doesn't exist, skip connection attempt
  if (!existsSync(sockPath)) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    let resolved = false;
    const done = (result: boolean) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      resolve(result);
    };

    const socket = new Socket();

    const timeout = setTimeout(() => {
      socket.destroy();
      done(false);
    }, 3000);

    socket.on("error", () => {
      done(false);
    });

    const parser = createLineParser((msg: any) => {
      if (msg.type === "pong") {
        socket.destroy();
        done(true);
      }
    });

    socket.on("connect", () => {
      // Ping is allowed without auth (daemon permits it for health checks)
      socket.write(frameSend({ type: "ping", requestId: "healthcheck" }));
    });

    socket.on("data", (chunk: Buffer) => parser.feed(chunk));

    socket.connect(sockPath);
  });
}
