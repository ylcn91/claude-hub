import { startDaemon, stopDaemon } from "./server";
import { loadConfig } from "../config";

const config = await loadConfig();
const { server } = startDaemon({ features: config.features });

process.on("SIGINT", () => { stopDaemon(server); process.exit(0); });
process.on("SIGTERM", () => { stopDaemon(server); process.exit(0); });

console.log("Claude Hub daemon started");
