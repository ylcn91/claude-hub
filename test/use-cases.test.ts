import { test, expect, describe } from "bun:test";
import { loadDashboardData } from "../src/application/use-cases/load-dashboard-data";
import { loadUsageData } from "../src/application/use-cases/load-usage-data";
import { launchAccount } from "../src/application/use-cases/launch-account";

describe("loadDashboardData", () => {
  test("returns empty accounts for nonexistent config", async () => {
    const data = await loadDashboardData("/tmp/nonexistent-config-" + Date.now() + ".json");
    expect(data.accounts).toBeInstanceOf(Array);
    expect(data.accounts.length).toBe(0);
    expect(data.entireStatuses).toBeInstanceOf(Map);
    expect(data.unreadCounts).toBeInstanceOf(Map);
  });

  test("returns DashboardData shape", async () => {
    const data = await loadDashboardData("/tmp/nonexistent-config-" + Date.now() + ".json");
    expect(data).toHaveProperty("accounts");
    expect(data).toHaveProperty("entireStatuses");
    expect(data).toHaveProperty("unreadCounts");
  });
});

describe("loadUsageData", () => {
  test("returns empty array for nonexistent config", async () => {
    const data = await loadUsageData("/tmp/nonexistent-config-" + Date.now() + ".json");
    expect(data).toBeInstanceOf(Array);
    expect(data.length).toBe(0);
  });
});

describe("launchAccount", () => {
  test("returns error for nonexistent account", async () => {
    const result = await launchAccount("nonexistent-account-" + Date.now());
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
    expect(result.shellCmd).toBe("");
  });

  test("LaunchResult has correct shape on failure", async () => {
    const result = await launchAccount("fake-account");
    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("shellCmd");
    expect(result).toHaveProperty("error");
  });
});
