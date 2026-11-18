import { describe, expect, it } from "vitest";
import { holdDecision, signalLine } from "@/lib/mt5";

const strong = { direction: "BUY", confidence: 80, trend1h: "bull" as const, fresh: true };
describe("Bridge v5 smart hold", () => {
  it("never closes below $2", () => expect(holdDecision("BUY", "XAUUSD", 1.99, 1.99, null)).toBe("WAIT_TARGET"));
  it("always closes at $3 loss, even with a strong signal", () => {
    expect(holdDecision("BUY", "XAUUSD", -3, 0.5, strong)).toBe("CLOSE");
    expect(holdDecision("SELL", "EURUSD", -3.01, 0, strong)).toBe("CLOSE");
    expect(holdDecision("BUY", "XAUUSD", -2.99, 0, null)).toBe("WAIT_TARGET");
  });
  it("holds at $2+ while live signal is strong same direction", () => expect(holdDecision("BUY", "XAUUSD", 2.5, 2.5, strong)).toBe("HOLD"));
  it("closes at $2+ when signal turns WAIT", () => expect(holdDecision("BUY", "XAUUSD", 2.1, 2.1, { ...strong, direction: "WAIT" })).toBe("CLOSE"));
  it("closes at $2+ when signal flips", () => expect(holdDecision("SELL", "EURUSD", 2, 2, strong)).toBe("CLOSE"));
  it("closes after 40% giveback from peak", () => expect(holdDecision("BUY", "XAUUSD", 5.9, 10, strong)).toBe("CLOSE"));
  it("XAUUSD needs 70% confidence and 1h trend to hold", () => {
    expect(holdDecision("BUY", "XAUUSD", 3, 3, { ...strong, confidence: 65 })).toBe("CLOSE");
    expect(holdDecision("BUY", "EURUSD", 3, 3, { ...strong, confidence: 65 })).toBe("HOLD");
    expect(holdDecision("BUY", "XAUUSD", 3, 3, { ...strong, trend1h: "bear" })).toBe("CLOSE");
  });
  it("signal line format", () => expect(signalLine({ direction: "SELL", confidence: 77, validUntil: "2026-01-01T01:00:00Z", indicators: [{ name: "EMA 50/200 (1h)", bias: "bear" }] }, Date.parse("2026-01-01T00:00:00Z"))).toBe("SELL|77|bear|1"));
});
