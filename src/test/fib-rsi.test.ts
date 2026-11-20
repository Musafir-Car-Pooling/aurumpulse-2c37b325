import { describe, expect, it } from "vitest";
import { fibLevels, fibSetup, rsiBias, rsiDivergence, type Candle } from "@/lib/signal-engine";
import { positionsForConfidence } from "@/lib/mt5";
const bar = (c: number, i: number): Candle => ({ c, h: c + 0.2, l: c - 0.2, time: i });
describe("Fibonacci", () => {
  it("up-swing levels from 100 to 200", () => {
    const f = fibLevels(200, 100, "up");
    expect(f.l382).toBeCloseTo(161.8); expect(f.l500).toBe(150); expect(f.l618).toBeCloseTo(138.2); expect(f.l786).toBeCloseTo(121.4); expect(f.e1618).toBeCloseTo(261.8);
  });
  it("golden-zone bounce in an up-swing is a strong buy", () => {
    const up = Array.from({ length: 20 }, (_, i) => bar(100 + i * 5, i));          // 100 -> 195
    const back = [...Array.from({ length: 8 }, (_, i) => bar(190 - i * 6, 20 + i)), bar(139, 28)];  // pull back to ~139
    const r = fibSetup([...up, ...back, bar(141, 30)]);
    expect(r?.swing).toBe("up"); expect(r?.score).toBe(2);
  });
  it("break below 78.6% cancels the setup", () => {
    const up = Array.from({ length: 20 }, (_, i) => bar(100 + i * 5, i));
    const r = fibSetup([...up, bar(110, 20), bar(112, 21)]);
    expect(r?.score).toBe(0);
  });
});
describe("RSI", () => {
  it("trend-aware bands", () => {
    expect(rsiBias(35, true)).toBe(1); expect(rsiBias(85, true)).toBe(-1);
    expect(rsiBias(65, false)).toBe(-1); expect(rsiBias(15, false)).toBe(1);
  });
  it("bullish divergence: lower price low, higher RSI low", () => {
    const fall = Array.from({ length: 60 }, (_, i) => 200 - i);                 // steady fall
    const crash = [130, 125, 128, 131, 133, 134, 135];                          // sharp first low
    const drift = [134, 133, 132, 131.5, 131, 130.5, 130, 129.5, 129, 128.5, 128, 127.5, 127, 126.5, 126, 125.5, 125.2, 124.9, 124.6, 124.4, 124.6, 125];
    expect(rsiDivergence([...fall, ...crash, ...drift])).toBe(1);
  });
});
describe("0.01 positions instead of big lots", () => {
  it("1/2/3/5 positions at USD 500, doubled at USD 1000", () => {
    expect(positionsForConfidence(70)).toBe(1); expect(positionsForConfidence(75)).toBe(2);
    expect(positionsForConfidence(85)).toBe(3); expect(positionsForConfidence(90)).toBe(5);
    expect(positionsForConfidence(90, 1000)).toBe(10);
  });
});
