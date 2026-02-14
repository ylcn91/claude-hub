import { test, expect, describe } from "bun:test";
import { createLineParser, frameSend, generateRequestId } from "../src/daemon/framing";

describe("createLineParser", () => {
  test("parses valid JSON lines", () => {
    const messages: any[] = [];
    const parser = createLineParser((msg) => messages.push(msg));

    parser.feed('{"type":"hello"}\n');
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe("hello");
  });

  test("handles multiple messages in one chunk", () => {
    const messages: any[] = [];
    const parser = createLineParser((msg) => messages.push(msg));

    parser.feed('{"a":1}\n{"b":2}\n');
    expect(messages).toHaveLength(2);
    expect(messages[0].a).toBe(1);
    expect(messages[1].b).toBe(2);
  });

  test("buffers partial lines across chunks", () => {
    const messages: any[] = [];
    const parser = createLineParser((msg) => messages.push(msg));

    parser.feed('{"partial":');
    expect(messages).toHaveLength(0);

    parser.feed('"value"}\n');
    expect(messages).toHaveLength(1);
    expect(messages[0].partial).toBe("value");
  });

  test("skips empty lines", () => {
    const messages: any[] = [];
    const parser = createLineParser((msg) => messages.push(msg));

    parser.feed('\n\n{"ok":true}\n\n');
    expect(messages).toHaveLength(1);
    expect(messages[0].ok).toBe(true);
  });

  test("calls onError for invalid JSON", () => {
    const messages: any[] = [];
    const errors: { error: Error; rawLine: string }[] = [];
    const parser = createLineParser(
      (msg) => messages.push(msg),
      undefined,
      (error, rawLine) => errors.push({ error, rawLine }),
    );

    parser.feed('not-valid-json\n');
    expect(messages).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].rawLine).toBe("not-valid-json");
    expect(errors[0].error).toBeInstanceOf(Error);
  });

  test("continues parsing after invalid JSON", () => {
    const messages: any[] = [];
    const errors: { error: Error; rawLine: string }[] = [];
    const parser = createLineParser(
      (msg) => messages.push(msg),
      undefined,
      (error, rawLine) => errors.push({ error, rawLine }),
    );

    parser.feed('bad-line\n{"valid":true}\n');
    expect(errors).toHaveLength(1);
    expect(messages).toHaveLength(1);
    expect(messages[0].valid).toBe(true);
  });

  test("works without onError callback (backward compatible)", () => {
    const messages: any[] = [];
    const parser = createLineParser((msg) => messages.push(msg));

    // Should not throw, just console.warn
    parser.feed('invalid\n{"ok":true}\n');
    expect(messages).toHaveLength(1);
    expect(messages[0].ok).toBe(true);
  });

  test("applies validate function", () => {
    const messages: any[] = [];
    const parser = createLineParser(
      (msg) => messages.push(msg),
      (raw: any) => (raw.type === "keep" ? raw : null),
    );

    parser.feed('{"type":"keep","data":1}\n{"type":"drop","data":2}\n');
    expect(messages).toHaveLength(1);
    expect(messages[0].data).toBe(1);
  });
});

describe("frameSend", () => {
  test("produces newline-terminated JSON", () => {
    const result = frameSend({ type: "test", id: 1 });
    expect(result).toBe('{"type":"test","id":1}\n');
  });
});

describe("generateRequestId", () => {
  test("returns a UUID string", () => {
    const id = generateRequestId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  test("returns unique values", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateRequestId()));
    expect(ids.size).toBe(100);
  });
});
