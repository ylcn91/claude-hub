/**
 * NDJSON line parser - buffers incoming data and emits complete JSON messages.
 * Handles TCP chunking: partial messages, concatenated messages, etc.
 *
 * When a `validate` function is provided, each parsed JSON object is passed
 * through it before calling onMessage.  If validation returns null the
 * message is silently dropped (the validator is expected to log/warn).
 *
 * When an `onError` callback is provided, JSON parse failures are reported
 * through it instead of only logging to console.warn.  The parser continues
 * processing subsequent lines regardless of errors.
 */
export function createLineParser(
  onMessage: (msg: any) => void,
  validate?: (raw: unknown) => any | null,
  onError?: (error: Error, rawLine: string) => void,
): { feed(chunk: Buffer | string): void } {
  let buffer = "";
  return {
    feed(chunk: Buffer | string) {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop()!; // last element is incomplete (or empty)
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const json = JSON.parse(trimmed);
          if (validate) {
            const validated = validate(json);
            if (validated !== null) {
              onMessage(validated);
            }
          } else {
            onMessage(json);
          }
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          if (onError) {
            onError(error, trimmed);
          }
          console.warn("[framing] invalid JSON line:", trimmed.substring(0, 100));
        }
      }
    }
  };
}

export function generateRequestId(): string {
  return crypto.randomUUID();
}

export function frameSend(msg: object): string {
  return JSON.stringify(msg) + "\n";
}
