import { describe, expect, it } from "vitest";
import { detectPullback, detectResume, sessionOf, type Candle } from "@/lib/signal-engine";
import { autoEntries, holdDecision } from "@/lib/mt5";

const bar = (c: number, h = c + 0.5, l = c - 0.5, i = 0): Candle => ({ c, h, l, time: i });
// Steady downtrend of 50 bars then a sweep low and strong bullish bounce.
function sellThenBounce(): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < 50; i++) out.push(bar(100 - i * 0.5, 100 - i * 0.5 + 0.5, 100 - i * 0.5 - 0.5, i));
  out.push(bar(74.5, 75, 72, 50)); // sweep below
  out.push(bar(74, 74.6, 73.5, 51));
  out.push(bar(75, 75.2, 73.8, 52)); // bullish engulfing bounce
  return out;
}
describe("v17 sessions", () => {
  it("maps UTC hours to sessions", () => {
    expect(sessionOf(new Date("2026-01-01T03:00:00Z"))).toBe("asian");
    expect(sessionOf(new Date("2026-01-01T08:00:00Z"))).toBe("london");
    expect(sessionOf(new Date("2026-01-01T13:00:00Z"))).toBe("overlap");
    expect(sessionOf(new Date("2026-01-01T18:00:00Z"))).toBe("ny");
    expect(sessionOf(new Date("2026-01-01T22:00:00Z"))).toBe("rollover");
  });
  it("no auto entries during rollover", () => {
    const until = new Date(Date.now() + 60000).toISOString();
    expect(autoEntries({ direction: "SELL", confidence: 80, validUntil: until, scalp: { direction: "WAIT", confidence: 50, session: "rollover" } })).toHaveLength(0);
  });
});
describe("v17 pullback BUY inside SELL trend", () => {
  it("detects the bounce BUY", () => expect(detectPullback(sellThenBounce(), "SELL")?.direction).toBe("BUY"));
  it("no BUY without a bounce", () => {
    const flat = sellThenBounce().slice(0, 50);
    expect(detectPullback(flat, "SELL")).toBeNull();
  });
  it("resume SELL on rejection after the bounce", () => {
    const b = sellThenBounce();
    b.push(bar(80, 80.5, 76, 53), bar(83, 83.5, 79.5, 54), bar(81, 84, 80.5, 55)); // rejection at fib, bearish engulf-ish
    b.push(bar(80.8, 82, 80.7, 56)); // shooting star
    expect(detectResume(b, "SELL")?.direction).toBe("SELL");
  });
  it("counter-trend trades close at the target, never hold", () => {
    const strong = { direction: "BUY", confidence: 90, trend1h: "bull" as const, fresh: true };
    expect(holdDecision("BUY", "XAUUSD", 2.1, 2.1, strong, 0.01, true)).toBe("CLOSE");
    expect(holdDecision("BUY", "XAUUSD", 1.5, 1.5, strong, 0.01, true)).toBe("WAIT_TARGET");
  });
});
