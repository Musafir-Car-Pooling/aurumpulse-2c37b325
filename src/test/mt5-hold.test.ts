import { describe, expect, it } from "vitest";
import { holdDecision, signalLine } from "@/lib/mt5";

const strong = { direction: "BUY", confidence: 80, trend1h: "bull" as const, fresh: true };
describe("Bridge v8 quick close", () => {
  it("keeps the trade open below $2 profit", () => expect(holdDecision("BUY", "XAUUSD", 1.99, 1.99, strong)).toBe("WAIT_TARGET"));
  it("closes at $2 profit even with a strong signal", () => expect(holdDecision("BUY", "XAUUSD", 2, 2, strong)).toBe("CLOSE"));
  it("closes at $2.4 profit", () => expect(holdDecision("SELL", "XAUUSD", 2.4, 2.4, strong)).toBe("CLOSE"));
  it("closes at $3 loss", () => {
    expect(holdDecision("BUY", "XAUUSD", -3, 0, strong)).toBe("CLOSE");
    expect(holdDecision("BUY", "XAUUSD", -2.99, 0, null)).toBe("WAIT_TARGET");
  });
  it("signal line format", () => expect(signalLine({ direction: "SELL", confidence: 77, validUntil: "2026-01-01T01:00:00Z", indicators: [{ name: "EMA 50/200 (1h)", bias: "bear" }] }, Date.parse("2026-01-01T00:00:00Z"))).toBe("SELL|77|bear|1"));
});
