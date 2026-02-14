import { test, expect, describe } from "bun:test";
import { createLineParser, generateRequestId, frameSend } from "../src/daemon/framing";

describe("createLineParser", () => {
  test("parses single complete message", () => {
    const messages: any[] = [];
    const parser = createLineParser((msg) => messages.push(msg));
    parser.feed('{"type":"hello"}\n');
    expect(messages).toEqual([{ type: "hello" }]);
  });

  test("handles chunked message split across feeds", () => {
    const messages: any[] = [];
    const parser = createLineParser((msg) => messages.push(msg));
    parser.feed('{"type":');
    parser.feed('"hello"}\n');
    expect(messages).toEqual([{ type: "hello" }]);
  });

  test("handles multiple messages in single chunk", () => {
    const messages: any[] = [];
    const parser = createLineParser((msg) => messages.push(msg));
    parser.feed('{"a":1}\n{"b":2}\n{"c":3}\n');
    expect(messages).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  test("ignores empty lines", () => {
    const messages: any[] = [];
    const parser = createLineParser((msg) => messages.push(msg));
    parser.feed('\n\n{"type":"ok"}\n\n');
    expect(messages).toEqual([{ type: "ok" }]);
  });

  test("skips invalid JSON without crashing", () => {
    const messages: any[] = [];
    const parser = createLineParser((msg) => messages.push(msg));
    parser.feed('not json\n{"valid":true}\nbroken{}\n');
    expect(messages).toEqual([{ valid: true }]);
  });

  test("handles message with no trailing newline (buffered)", () => {
    const messages: any[] = [];
    const parser = createLineParser((msg) => messages.push(msg));
    parser.feed('{"buffered":true}');
    // No newline yet, so nothing emitted
    expect(messages).toEqual([]);
    // Now send the newline
    parser.feed('\n');
    expect(messages).toEqual([{ buffered: true }]);
  });

  test("handles Buffer input", () => {
    const messages: any[] = [];
    const parser = createLineParser((msg) => messages.push(msg));
    parser.feed(Buffer.from('{"buf":true}\n'));
    expect(messages).toEqual([{ buf: true }]);
  });

  test("handles multiple chunks completing one message", () => {
    const messages: any[] = [];
    const parser = createLineParser((msg) => messages.push(msg));
    parser.feed('{"ke');
    parser.feed('y":"va');
    parser.feed('lue"}\n');
    expect(messages).toEqual([{ key: "value" }]);
  });
});

describe("generateRequestId", () => {
  test("returns unique IDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateRequestId());
    }
    expect(ids.size).toBe(100);
  });

  test("returns valid UUID format", () => {
    const id = generateRequestId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("frameSend", () => {
  test("appends newline", () => {
    const result = frameSend({ type: "test" });
    expect(result.endsWith("\n")).toBe(true);
  });

  test("produces valid JSON", () => {
    const result = frameSend({ type: "test", data: [1, 2, 3] });
    const parsed = JSON.parse(result.trim());
    expect(parsed).toEqual({ type: "test", data: [1, 2, 3] });
  });

  test("does not contain embedded newlines", () => {
    const result = frameSend({ msg: "hello\nworld" });
    // The JSON string should escape the newline, so split by \n should give [json, ""]
    const lines = result.split("\n");
    expect(lines.length).toBe(2);
    expect(lines[1]).toBe("");
  });
});
