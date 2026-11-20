import { describe, expect, it } from "vitest";
import { candlePattern, type Candle } from "@/lib/signal-engine";
const c = (o: number, h: number, l: number, cl: number): Candle[] => [{ c: o, h: o, l: o, time: 0 }, { c: o, h: o, l: o, time: 1 }, { c: cl, h, l, time: 2 }];
describe("candle patterns", () => {
  it("hammer is bullish", () => expect(candlePattern(c(100, 100.6, 97, 100.5))).toEqual({ name: "Hammer", score: 2 }));
  it("shooting star is bearish", () => expect(candlePattern(c(100, 103, 99.4, 99.5))).toEqual({ name: "Shooting star", score: -2 }));
  it("doji is indecision", () => expect(candlePattern(c(100, 101, 99, 100.05)).name).toBe("Doji (indecision)"));
  it("bullish engulfing", () => expect(candlePattern([{ c: 102, h: 102, l: 102, time: 0 }, { c: 101, h: 102, l: 101, time: 1 }, { c: 103, h: 103, l: 100.9, time: 2 }]).name).toBe("Bullish engulfing"));
});
