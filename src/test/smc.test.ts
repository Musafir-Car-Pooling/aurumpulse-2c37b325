import { describe, expect, it } from "vitest";
import { analyzeScalp, fairValueGap, structureBreak, type Candle } from "@/lib/signal-engine";
const bar = (c: number, i: number, w = 1): Candle => ({ c, h: c + w, l: c - w, time: i });
describe("smart money helpers", () => {
  it("detects break of structure up and down", () => {
    const flat = Array.from({ length: 11 }, (_, i) => bar(100, i));
    expect(structureBreak([...flat, bar(110, 12)])).toBe(1);
    expect(structureBreak([...flat, bar(90, 12)])).toBe(-1);
    expect(structureBreak([...flat, bar(100, 12)])).toBe(0);
  });
  it("detects fair value gaps", () => {
    expect(fairValueGap([bar(100, 0), bar(103, 1), bar(106, 2)])).toBe(1);
    expect(fairValueGap([bar(106, 0), bar(103, 1), bar(100, 2)])).toBe(-1);
  });
  it("gives a retracement BUY on a 5m bounce inside a SELL trend", () => {
    const down = Array.from({ length: 50 }, (_, i) => bar(200 - i * 0.5, i));
    const up = Array.from({ length: 12 }, (_, i) => bar(175 + i * 1.2, 50 + i));
    const r = analyzeScalp([...down, ...up], "SELL", new Date("2026-11-20T09:00:00Z"));
    expect(r.direction).toBe("BUY");
    expect(r.retracement).toBe(true);
  });
});
