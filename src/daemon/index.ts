import { startDaemon, stopDaemon } from "./server";
import { loadConfig } from "../config";

const config = await loadConfig();
const isSupervised = process.argv.includes("--supervised");
const { server, watchdog, sessionCleanupTimer } = await startDaemon({ features: config.features });

process.on("SIGINT", () => { stopDaemon(server, undefined, watchdog, sessionCleanupTimer); process.exit(0); });
process.on("SIGTERM", () => { stopDaemon(server, undefined, watchdog, sessionCleanupTimer); process.exit(0); });

console.log(`agentctl daemon started${isSupervised ? " (supervised)" : ""}`);
