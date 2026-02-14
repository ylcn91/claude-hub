import { test, expect, describe, beforeEach } from "bun:test";
import { registerMiscHandlers } from "../src/daemon/handlers/misc";
import type { HandlerContext } from "../src/daemon/handler-types";
import type { Socket } from "net";

function createMockContext(activityStore?: any): {
  ctx: HandlerContext;
  written: any[];
} {
  const written: any[] = [];
  const ctx: HandlerContext = {
    state: { activityStore } as any,
    safeWrite: (_socket: Socket, data: string) => {
      written.push(JSON.parse(data));
    },
    reply: (_msg: any, response: object) => {
      return JSON.stringify({ ...response, requestId: _msg.requestId });
    },
    getAccountName: () => "test-account",
  };
  return { ctx, written };
}

describe("query_activity handler", () => {
  const mockSocket = {} as Socket;

  test("returns error when activity store not enabled", () => {
    const { ctx, written } = createMockContext(undefined);
    const handlers = registerMiscHandlers(ctx);

    handlers.query_activity(mockSocket, {
      type: "query_activity",
      requestId: "req-1",
      activityType: "delegation_chain",
    });

    expect(written).toHaveLength(1);
    expect(written[0].type).toBe("error");
    expect(written[0].error).toBe("Activity store not enabled");
  });

  test("returns events from activity store", () => {
    const mockEvents = [
      {
        id: "evt-1",
        type: "delegation_chain",
        timestamp: "2026-01-01T00:00:00Z",
        account: "agent-a",
        metadata: { chain: ["agent-a", "agent-b"] },
      },
    ];
    const mockStore = {
      query: (opts: any) => {
        expect(opts.type).toBe("delegation_chain");
        expect(opts.limit).toBe(50);
        return mockEvents;
      },
    };
    const { ctx, written } = createMockContext(mockStore);
    const handlers = registerMiscHandlers(ctx);

    handlers.query_activity(mockSocket, {
      type: "query_activity",
      requestId: "req-2",
      activityType: "delegation_chain",
      limit: 50,
    });

    expect(written).toHaveLength(1);
    expect(written[0].type).toBe("result");
    expect(written[0].events).toEqual(mockEvents);
  });

  test("respects limit parameter", () => {
    let capturedLimit: number | undefined;
    const mockStore = {
      query: (opts: any) => {
        capturedLimit = opts.limit;
        return [];
      },
    };
    const { ctx } = createMockContext(mockStore);
    const handlers = registerMiscHandlers(ctx);

    handlers.query_activity(mockSocket, {
      type: "query_activity",
      requestId: "req-3",
      activityType: "task_created",
      limit: 10,
    });

    expect(capturedLimit).toBe(10);
  });

  test("defaults limit to 50 when not provided", () => {
    let capturedLimit: number | undefined;
    const mockStore = {
      query: (opts: any) => {
        capturedLimit = opts.limit;
        return [];
      },
    };
    const { ctx } = createMockContext(mockStore);
    const handlers = registerMiscHandlers(ctx);

    handlers.query_activity(mockSocket, {
      type: "query_activity",
      requestId: "req-4",
      activityType: "task_created",
    });

    expect(capturedLimit).toBe(50);
  });

  test("returns empty array for unknown activity type", () => {
    const mockStore = {
      query: () => [],
    };
    const { ctx, written } = createMockContext(mockStore);
    const handlers = registerMiscHandlers(ctx);

    handlers.query_activity(mockSocket, {
      type: "query_activity",
      requestId: "req-5",
      activityType: "nonexistent_type",
    });

    expect(written).toHaveLength(1);
    expect(written[0].type).toBe("result");
    expect(written[0].events).toEqual([]);
  });

  test("handles query errors gracefully", () => {
    const mockStore = {
      query: () => {
        throw new Error("DB connection failed");
      },
    };
    const { ctx, written } = createMockContext(mockStore);
    const handlers = registerMiscHandlers(ctx);

    handlers.query_activity(mockSocket, {
      type: "query_activity",
      requestId: "req-6",
      activityType: "delegation_chain",
    });

    expect(written).toHaveLength(1);
    expect(written[0].type).toBe("error");
    expect(written[0].error).toBe("DB connection failed");
  });

  test("passes optional filter parameters through", () => {
    let capturedOpts: any;
    const mockStore = {
      query: (opts: any) => {
        capturedOpts = opts;
        return [];
      },
    };
    const { ctx } = createMockContext(mockStore);
    const handlers = registerMiscHandlers(ctx);

    handlers.query_activity(mockSocket, {
      type: "query_activity",
      requestId: "req-7",
      activityType: "workflow_completed",
      account: "agent-a",
      workflowRunId: "wf-123",
      since: "2026-01-01T00:00:00Z",
      limit: 25,
    });

    expect(capturedOpts.type).toBe("workflow_completed");
    expect(capturedOpts.account).toBe("agent-a");
    expect(capturedOpts.workflowRunId).toBe("wf-123");
    expect(capturedOpts.since).toBe("2026-01-01T00:00:00Z");
    expect(capturedOpts.limit).toBe(25);
  });
});
