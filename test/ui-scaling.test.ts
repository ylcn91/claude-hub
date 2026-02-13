import { describe, test, expect } from "bun:test";
import { filterAccounts } from "../src/services/account-filter";

describe("UI Scaling", () => {
  describe("filterAccounts", () => {
    const accounts = [
      { name: "claude-work", label: "Work" },
      { name: "claude-personal", label: "Personal" },
      { name: "claude-admin", label: "Admin" },
      { name: "claude-test", label: "Testing" },
      { name: "doksanbir", label: "Side project" },
    ];

    test("empty query returns all accounts", () => {
      const result = filterAccounts(accounts, "");
      expect(result).toHaveLength(5);
      expect(result).toEqual(accounts);
    });

    test("matches by name", () => {
      const result = filterAccounts(accounts, "admin");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("claude-admin");
    });

    test("matches by label", () => {
      const result = filterAccounts(accounts, "personal");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("claude-personal");
    });

    test("is case-insensitive", () => {
      const result = filterAccounts(accounts, "WORK");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("claude-work");
    });

    test("matches partial strings", () => {
      const result = filterAccounts(accounts, "claude");
      expect(result).toHaveLength(4);
    });

    test("returns empty array when no matches", () => {
      const result = filterAccounts(accounts, "nonexistent");
      expect(result).toHaveLength(0);
    });

    test("handles accounts without label property", () => {
      const noLabelAccounts = [
        { name: "claude-work" },
        { name: "claude-personal" },
      ];
      const result = filterAccounts(noLabelAccounts, "work");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("claude-work");
    });

    test("label match is also case-insensitive", () => {
      const result = filterAccounts(accounts, "TESTING");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("claude-test");
    });
  });

  describe("Dashboard scrolling logic", () => {
    const VISIBLE_WINDOW = 8;

    test("computes visible window for small list", () => {
      const totalAccounts = 5;
      const selectedIndex = 2;
      const scrollOffset = Math.max(
        0,
        Math.min(selectedIndex - Math.floor(VISIBLE_WINDOW / 2), totalAccounts - VISIBLE_WINDOW)
      );
      const startIndex = Math.max(0, scrollOffset);
      const endIndex = Math.min(totalAccounts, startIndex + VISIBLE_WINDOW);
      // With 5 accounts and window of 8, should show all
      expect(startIndex).toBe(0);
      expect(endIndex).toBe(5);
    });

    test("computes scroll indicators for large list", () => {
      const totalAccounts = 15;
      const selectedIndex = 7;
      const scrollOffset = Math.max(
        0,
        Math.min(selectedIndex - Math.floor(VISIBLE_WINDOW / 2), totalAccounts - VISIBLE_WINDOW)
      );
      const startIndex = Math.max(0, scrollOffset);
      const endIndex = Math.min(totalAccounts, startIndex + VISIBLE_WINDOW);
      const aboveCount = startIndex;
      const belowCount = totalAccounts - endIndex;

      // Selected at 7, window center at 4 -> offset = 3
      expect(startIndex).toBe(3);
      expect(endIndex).toBe(11);
      expect(aboveCount).toBe(3);
      expect(belowCount).toBe(4);
    });

    test("scroll stays at top when selectedIndex is 0", () => {
      const totalAccounts = 15;
      const selectedIndex = 0;
      const scrollOffset = Math.max(
        0,
        Math.min(selectedIndex - Math.floor(VISIBLE_WINDOW / 2), totalAccounts - VISIBLE_WINDOW)
      );
      const startIndex = Math.max(0, scrollOffset);
      const endIndex = Math.min(totalAccounts, startIndex + VISIBLE_WINDOW);
      const aboveCount = startIndex;
      const belowCount = totalAccounts - endIndex;

      expect(startIndex).toBe(0);
      expect(endIndex).toBe(8);
      expect(aboveCount).toBe(0);
      expect(belowCount).toBe(7);
    });

    test("scroll stays at bottom when selectedIndex is at end", () => {
      const totalAccounts = 15;
      const selectedIndex = 14;
      const scrollOffset = Math.max(
        0,
        Math.min(selectedIndex - Math.floor(VISIBLE_WINDOW / 2), totalAccounts - VISIBLE_WINDOW)
      );
      const startIndex = Math.max(0, scrollOffset);
      const endIndex = Math.min(totalAccounts, startIndex + VISIBLE_WINDOW);
      const aboveCount = startIndex;
      const belowCount = totalAccounts - endIndex;

      expect(startIndex).toBe(7);
      expect(endIndex).toBe(15);
      expect(aboveCount).toBe(7);
      expect(belowCount).toBe(0);
    });
  });

  describe("UsageDetail pagination logic", () => {
    test("selectedAccount clamps to valid range", () => {
      const accountsLength = 5;
      let selectedAccount = 0;

      // Move right
      selectedAccount = Math.min(accountsLength - 1, selectedAccount + 1);
      expect(selectedAccount).toBe(1);

      // Move to end
      selectedAccount = accountsLength - 1;
      selectedAccount = Math.min(accountsLength - 1, selectedAccount + 1);
      expect(selectedAccount).toBe(4);

      // Move left from start
      selectedAccount = 0;
      selectedAccount = Math.max(0, selectedAccount - 1);
      expect(selectedAccount).toBe(0);
    });

    test("formats page indicator correctly", () => {
      const selectedAccount = 2;
      const total = 10;
      const indicator = `${selectedAccount + 1}/${total}`;
      expect(indicator).toBe("3/10");
    });
  });
});
