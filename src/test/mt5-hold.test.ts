import { describe, expect, it } from "vitest";
import { holdDecision, lotForConfidence, maxProfitFor, scaledLot, signalLine } from "@/lib/mt5";

const strong = { direction: "BUY", confidence: 80, trend1h: "bull" as const, fresh: true };
const weak = { ...strong, confidence: 50 };
describe("Bridge v9 exits", () => {
  it("waits below $2 profit", () => expect(holdDecision("BUY", "XAUUSD", 1.99, 1.99, strong)).toBe("WAIT_TARGET"));
  it("closes at $2 when signal is not strong", () => expect(holdDecision("BUY", "XAUUSD", 2, 2, weak)).toBe("CLOSE"));
  it("holds at $2+ when signal strong", () => expect(holdDecision("BUY", "XAUUSD", 4, 4, strong)).toBe("HOLD"));
  it("closes at $9 max profit even if strong", () => expect(holdDecision("BUY", "XAUUSD", 9, 9, strong)).toBe("CLOSE"));
  it("closes on 40% giveback from peak", () => expect(holdDecision("BUY", "XAUUSD", 4.5, 8, strong)).toBe("CLOSE"));
  it("closes at $3 loss", () => {
    expect(holdDecision("BUY", "XAUUSD", -3, 0, strong)).toBe("CLOSE");
    expect(holdDecision("BUY", "XAUUSD", -2.99, 0, null)).toBe("WAIT_TARGET");
  });
  it("signal line format", () => expect(signalLine({ direction: "SELL", confidence: 77, validUntil: "2026-01-01T01:00:00Z", indicators: [{ name: "EMA 50/200 (1h)", bias: "bear" }] }, Date.parse("2026-01-01T00:00:00Z"))).toBe("SELL|77|bear|1"));
  it("v2 signal line adds support and resistance", () => expect(signalLine({ direction: "BUY", confidence: 80, support: 10, resistance: 20, validUntil: "2026-01-01T01:00:00Z" }, Date.parse("2026-01-01T00:00:00Z"), true)).toBe("BUY|80|neutral|1|10|20"));
  it("lot grows with signal strength", () => {
    expect(lotForConfidence(70)).toBe(0.01);
    expect(lotForConfidence(75)).toBe(0.02);
    expect(lotForConfidence(85)).toBe(0.03);
    expect(lotForConfidence(90)).toBe(0.05);
  });
  it("max lot 0.05 at USD 500, scales with balance", () => {
    expect(scaledLot(0.05, 500)).toBe(0.05);
    expect(scaledLot(0.05, 1000)).toBe(0.1);
    expect(scaledLot(0.02, 500)).toBe(0.02);
    expect(scaledLot(0.01, 200)).toBe(0.01);
  });
  it("hold cap is USD 9 per 0.01 lot", () => {
    expect(maxProfitFor(0.01)).toBe(9); expect(maxProfitFor(0.02)).toBe(18); expect(maxProfitFor(0.05)).toBe(45);
    expect(holdDecision("BUY", "XAUUSD", 17, 17, strong, 0.02)).toBe("HOLD");
    expect(holdDecision("BUY", "XAUUSD", 18, 18, strong, 0.02)).toBe("CLOSE");
  });
});
