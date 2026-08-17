import { describe, expect, it } from "vitest";
import { parseLogEnvelope } from "./routers/logs";

describe("parseLogEnvelope", () => {
  it("normalizes structured JSON logs, severity and ordering", () => {
    const logs = parseLogEnvelope({
      dados: {
        container: {
          log: [
            '{"timestamp":"2026-08-17T13:00:00Z","level":"INFO","fields":{"message":"Scanner started"}}',
            '{"timestamp":"2026-08-17T13:01:00Z","level":"ERROR","fields":{"message":"Order submission failed"}}',
          ].join("\n"),
        },
      },
    });

    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({
      timestamp: "2026-08-17T13:01:00Z",
      level: "ERROR",
      message: "Order submission failed",
    });
    expect(logs[1]).toMatchObject({ level: "INFO", message: "Scanner started" });
  });

  it("classifies unstructured failures and accepts unavailable payloads", () => {
    expect(parseLogEnvelope({ dados: { container: { log: "2026-08-17T13:02:00Z reconciliation retry required" } } })[0])
      .toMatchObject({ level: "WARN", timestamp: "2026-08-17T13:02:00Z" });
    expect(parseLogEnvelope({ dados: {} })).toEqual([]);
  });
});
