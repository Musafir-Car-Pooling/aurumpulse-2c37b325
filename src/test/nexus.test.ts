import { describe, expect, it } from "vitest";
import { ichimoku, zScore } from "@/lib/signal-engine";
describe("Nexus indicators", () => {
  it("z-score flags 2+ std stretch", () => {
    expect(zScore([...Array(19).fill(10), 10])).toBe(0);
    expect(zScore([...Array(19).fill(10), 20])).toBeGreaterThan(2);
  });
  it("ichimoku tenkan above kijun in a rising market", () => {
    const bars = Array.from({ length: 100 }, (_, i) => ({ h: i + 1, l: i, c: i + 0.5, time: i }));
    const r = ichimoku(bars)!;
    expect(r.tenkan).toBeGreaterThan(r.kijun);
    expect(99.5).toBeGreaterThan(Math.max(r.spanA, r.spanB));
  });
});
