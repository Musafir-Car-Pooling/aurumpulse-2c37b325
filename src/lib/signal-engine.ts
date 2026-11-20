import { directionForScore, MARKETS, price, type Market } from "./markets";

export type Candle = { h: number; l: number; c: number; time: number };
export type SignalResult = {
  market: Market; time: string; dataTime: string; spot: number; direction: "BUY" | "SELL" | "WAIT";
  confidence: number; entry: number; stopLoss: number; tp1: number; tp2: number; validUntil: string;
  indicators: { name: string; value: string; bias: "bull" | "bear" | "neutral" }[];
  summary: string; support: number; resistance: number;
  scalp?: ScalpResult | null;
  fib?: FibSetup | null;
};
export type Session = "asian" | "london" | "overlap" | "ny" | "rollover";
export type ScalpKind = "pullback" | "resume" | "range" | "momentum";
export type ScalpResult = { direction: "BUY" | "SELL" | "WAIT"; confidence: number; retracement: boolean; reasons: string[]; kind?: ScalpKind; session?: Session };
const ema = (values: number[], period: number) => {
  const k = 2 / (period + 1), out: number[] = [];
  values.forEach((v, i) => out.push(i === 0 ? v : v * k + (out[i - 1] ?? v) * (1 - k)));
  return out;
};
const last = (values: number[], offset = 1) => {
  const value = values.at(-offset);
  if (value === undefined) throw new Error("Insufficient market history");
  return value;
};
const rsi = (values: number[], p = 14) => {
  let g = 0, l = 0;
  for (let i = 1; i < values.length; i++) {
    const d = (values[i] ?? 0) - (values[i - 1] ?? 0);
    if (i <= p) { g += Math.max(d, 0) / p; l += Math.max(-d, 0) / p; }
    else { g = (g * (p - 1) + Math.max(d, 0)) / p; l = (l * (p - 1) + Math.max(-d, 0)) / p; }
  }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
};
export function analyze(market: Market, m15: Candle[], h1: Candle[], spot: number, now: Date): SignalResult {
  if (m15.length < 32 || h1.length < 200 || !Number.isFinite(spot) || spot <= 0) throw new Error("Insufficient market history");
  const c15 = m15.map(x => x.c), c1h = h1.map(x => x.c), futLast = last(c15), basis = futLast - spot;
  const e9 = last(ema(c15, 9)), e21 = last(ema(c15, 21)), e50h = last(ema(c1h, 50)), e200h = last(ema(c1h, 200));
  const r15 = rsi(c15), r1h = rsi(c1h), slow = ema(c15, 26);
  const macd = ema(c15, 12).map((v, i) => v - (slow[i] ?? v)), sig = ema(macd, 9);
  const hist = last(macd) - last(sig), prevHist = last(macd, 2) - last(sig, 2);
  const trs = m15.slice(1).map((x, i) => Math.max(x.h - x.l, Math.abs(x.h - (m15[i]?.c ?? x.c)), Math.abs(x.l - (m15[i]?.c ?? x.c))));
  const atr = trs.slice(-14).reduce((a,b) => a + b, 0) / 14;
  const support = Math.min(...m15.slice(-32).map(x => x.l)) - basis, resistance = Math.max(...m15.slice(-32).map(x => x.h)) - basis;
  let score = 0;
  const indicators: SignalResult["indicators"] = [];
  const add = (name: string, value: string, s: number) => { score += s; indicators.push({name,value,bias: s > 0 ? "bull" : s < 0 ? "bear" : "neutral"}); };
  add("EMA 9/21 (15m)", e9 > e21 ? "Bullish cross" : "Bearish cross", e9 > e21 ? 2 : -2);
  add("EMA 50/200 (1h)", e50h > e200h ? "Uptrend" : "Downtrend", e50h > e200h ? 2 : -2);
  add("Price vs EMA50 (1h)", futLast > e50h ? "Above" : "Below", futLast > e50h ? 1 : -1);
  // RSI with trend-aware bands (uptrend 40-80, downtrend 20-60) and the 50 line for momentum.
  const upT = e50h > e200h;
  add("RSI 14 (15m)", `${r15.toFixed(1)} (${upT ? "40-80" : "20-60"} band)`, rsiBias(r15, upT)); add("RSI 14 (1h)", r1h.toFixed(1), rsiBias(r1h, upT));
  const div = rsiDivergence(c15);
  add("RSI divergence (15m)", div === 1 ? "Bullish divergence" : div === -1 ? "Bearish divergence" : "None", div * 2);
  add("MACD hist (15m)", `${hist.toFixed(MARKETS[market].decimals)} ${hist > prevHist ? "rising" : "falling"}`, (hist > 0 ? 1 : -1) + (hist > prevHist ? 1 : -1));
  add("ATR 14 (15m)", price(market, atr), 0);
  // Market structure: trending vs sideways (EMA21 slope over 8 bars compared with ATR).
  const e21s = ema(c15, 21), slope = last(e21s) - last(e21s, 9);
  const regime = Math.abs(slope) < atr * 0.5 ? "Sideways" : slope > 0 ? "Uptrend" : "Downtrend";
  add("Market structure (15m)", regime, regime === "Uptrend" ? 1 : regime === "Downtrend" ? -1 : 0);
  // Support / resistance: avoid buying into resistance or selling into support.
  const sp = spot, nearSup = sp - support < atr * 0.6, nearRes = resistance - sp < atr * 0.6;
  add("Support / resistance", nearSup && !nearRes ? "Near support" : nearRes && !nearSup ? "Near resistance" : "Mid range", nearSup && !nearRes ? 1 : nearRes && !nearSup ? -1 : 0);
  // Fibonacci on the real swing (direction-aware): golden zone 50-61.8% with a reaction, 78.6% break cancels.
  const fib = fibSetup(m15.slice(-60).map(x => ({ ...x, h: x.h - basis, l: x.l - basis, c: x.c - basis })));
  if (fib) add("Fibonacci", `${fib.swing === "up" ? "Up" : "Down"}-swing ${(fib.retr * 100).toFixed(1)}% · 61.8 ${price(market, fib.levels.l618)} · ext 161.8 ${price(market, fib.levels.e1618)}`, fib.score);
  // Liquidity sweep / manipulation: wick through the prior 20-bar extreme, then close back inside (stop hunt).
  const prev = m15.slice(-21, -1), lastBar = m15.at(-1);
  const pLo = Math.min(...prev.map(x => x.l)), pHi = Math.max(...prev.map(x => x.h));
  const pc = m15.at(-2)?.c ?? 0;
  const bullSweep = !!lastBar && lastBar.l < pLo && lastBar.c > pLo && lastBar.c > pc, bearSweep = !!lastBar && lastBar.h > pHi && lastBar.c < pHi && lastBar.c < pc;
  add("Liquidity sweep", bullSweep ? "Sell-side liquidity taken" : bearSweep ? "Buy-side liquidity taken" : "None", bullSweep ? 2 : bearSweep ? -2 : 0);
  // Candlestick patterns on the last closed 15m bars.
  const pat = candlePattern(m15);
  add("Candle pattern (15m)", pat.name, pat.score);
  // Ichimoku (1h, 9/26/52): above cloud with Tenkan >= Kijun = bull, below with Tenkan <= Kijun = bear.
  const ich = ichimoku(h1);
  if (ich) { const px = futLast, top = Math.max(ich.spanA, ich.spanB), bot = Math.min(ich.spanA, ich.spanB);
    const s = px > top && ich.tenkan >= ich.kijun ? 2 : px < bot && ich.tenkan <= ich.kijun ? -2 : 0;
    add("Ichimoku (1h)", s > 0 ? "Above cloud, Tenkan ≥ Kijun" : s < 0 ? "Below cloud, Tenkan ≤ Kijun" : "Inside cloud / mixed", s); }
  // Mean reversion: 20-bar z-score beyond ±2 favours a move back to the mean.
  const z = zScore(c15);
  add("Mean reversion z (15m)", z.toFixed(2), z <= -2 ? 2 : z >= 2 ? -2 : 0);
  // Retracement trade: counter-trend BUY in a downtrend (or SELL in an uptrend) when price is stretched into support/resistance with a reversal candle.
  const up = upT;
  const pullBuy = !up && r15 < 38 && nearSup && pat.score > 0, pullSell = up && r15 > 62 && nearRes && pat.score < 0;
  add("Retracement setup", pullBuy ? "Oversold bounce at support" : pullSell ? "Overbought rejection at resistance" : "None", pullBuy ? 4 : pullSell ? -4 : 0);
  // Sideways markets need a stronger score before giving BUY/SELL.
  if (regime === "Sideways") score = Math.trunc(score * 0.75);
  const direction = directionForScore(score), d = direction === "SELL" ? -1 : 1;
  const round = (n: number) => Number(n.toFixed(MARKETS[market].decimals));
  const confidence = Math.min(95, Math.round(50 + Math.abs(score) / 12 * 45));
  const summary = direction === "WAIT" ? `Mixed signals (score ${score}). ${MARKETS[market].name} is ranging between ${price(market, support)} and ${price(market, resistance)}. Wait for a break before entering.` : `${direction === "BUY" ? "Bullish" : "Bearish"} momentum (score ${score > 0 ? "+" : ""}${score}/12). Hourly trend is ${e50h > e200h ? "up" : "down"}, RSI ${r15.toFixed(0)}, MACD ${hist > 0 ? "positive" : "negative"}. Expected volatility ${price(market, atr)} per 15 min.`;
  const result: SignalResult = { market, time: now.toISOString(), dataTime: new Date((m15.at(-1)?.time ?? 0) * 1000).toISOString(), spot: round(spot), direction, confidence: direction === "WAIT" ? Math.min(confidence,55) : confidence, entry: round(spot), stopLoss: round(spot - d * atr * 1.5), tp1: round(spot + d * atr * 1.5), tp2: round(spot + d * atr * 3), validUntil: new Date(now.getTime() + 3600000).toISOString(), indicators, summary, support: round(support), resistance: round(resistance), fib };
  return result;
}
/** Detects doji, hammer, shooting star, engulfing and morning/evening-star style reversals. Positive = bullish. */
export function candlePattern(bars: Candle[]): { name: string; score: number } {
  const b = bars.at(-1), p = bars.at(-2);
  if (!b || !p) return { name: "None", score: 0 };
  const o = p.c, body = Math.abs(b.c - o), range = b.h - b.l || 1e-9;
  const upper = b.h - Math.max(b.c, o), lower = Math.min(b.c, o) - b.l;
  const po = bars.at(-3)?.c ?? p.c, pBody = p.c - po;
  if (b.c > o && pBody < 0 && b.c > po && body > Math.abs(pBody)) return { name: "Bullish engulfing", score: 2 };
  if (b.c < o && pBody > 0 && b.c < po && body > Math.abs(pBody)) return { name: "Bearish engulfing", score: -2 };
  if (lower >= body * 2 && upper <= range * 0.25 && body > 0) return { name: "Hammer", score: 2 };
  if (upper >= body * 2 && lower <= range * 0.25 && body > 0) return { name: "Shooting star", score: -2 };
  if (body <= range * 0.1) {
    if (lower > range * 0.6) return { name: "Dragonfly doji", score: 1 };
    if (upper > range * 0.6) return { name: "Gravestone doji", score: -1 };
    return { name: "Doji (indecision)", score: 0 };
  }
  return { name: "None", score: 0 };
}

/** Break of Structure: close beyond the prior 10-bar extreme. CHoCH when it is against the higher-timeframe trend. */
export function structureBreak(bars: Candle[], lookback = 10): 1 | -1 | 0 {
  const b = bars.at(-1), prior = bars.slice(-lookback - 1, -1);
  if (!b || prior.length < lookback) return 0;
  if (b.c > Math.max(...prior.map(x => x.h))) return 1;
  if (b.c < Math.min(...prior.map(x => x.l))) return -1;
  return 0;
}
/** Fair Value Gap: 3-candle imbalance (bar[-3] high below bar[-1] low = bullish). */
export function fairValueGap(bars: Candle[]): 1 | -1 | 0 {
  const a = bars.at(-3), c = bars.at(-1);
  if (!a || !c) return 0;
  return a.h < c.l ? 1 : a.l > c.h ? -1 : 0;
}
/** Order block: price returns into the last opposite candle before a strong (2x average range) move. */
export function orderBlock(bars: Candle[], lookback = 20): 1 | -1 | 0 {
  const last = bars.at(-1); if (!last || bars.length < lookback + 2) return 0;
  const seg = bars.slice(-lookback - 1, -1), avg = seg.reduce((a, x) => a + (x.h - x.l), 0) / seg.length;
  for (let i = seg.length - 1; i >= 1; i--) {
    const cur = seg[i]!, prev = seg[i - 1]!, move = cur.c - prev.c;
    if (Math.abs(move) < avg * 2) continue;
    const ob = prev; // candle before the displacement
    if (move > 0 && last.l <= ob.h && last.c >= ob.l) return 1;
    if (move < 0 && last.h >= ob.l && last.c <= ob.h) return -1;
    return 0;
  }
  return 0;
}
/** London (07-11 UTC) and New York (12-17 UTC) are active; Asia is quiet. */
export const sessionActive = (d: Date) => { const h = d.getUTCHours(); return h >= 7 && h < 17; };
/** Session map (UTC): Asian 00-07, London 07-12, London/NY overlap 12-16, NY late 16-21, rollover 21-24. */
export function sessionOf(d: Date): Session {
  const h = d.getUTCHours();
  return h < 7 ? "asian" : h < 12 ? "london" : h < 16 ? "overlap" : h < 21 ? "ny" : "rollover";
}
const avgRange = (bars: Candle[], n = 14) => { const seg = bars.slice(-n); return seg.reduce((a, x) => a + (x.h - x.l), 0) / (seg.length || 1); };
/** Counter-trend pullback: in a SELL trend, price bounced >= 0.5 ATR off the recent 5m low with a bullish trigger near a support/fib/sweep zone (mirror for BUY trend). Trend indicators do not vote. */
export function detectPullback(m5: Candle[], trend: "BUY" | "SELL" | "WAIT"): { direction: "BUY" | "SELL"; reasons: string[] } | null {
  if (trend === "WAIT" || m5.length < 30) return null;
  const up = trend === "SELL", seg = m5.slice(-24), atr = avgRange(m5), px = m5.at(-1)!.c, reasons: string[] = [];
  const lo = Math.min(...seg.map(x => x.l)), hi = Math.max(...seg.map(x => x.h));
  const bounce = up ? px - lo : hi - px;
  if (bounce < 0.5 * atr || bounce > 3 * atr) return null;
  reasons.push(`${up ? "Bounce" : "Drop"} ${(bounce / atr).toFixed(1)}x ATR from 5m ${up ? "low" : "high"}`);
  const c = m5.map(x => x.c), r = rsiSeries(c.slice(-40)), pat = candlePattern(m5), bos = structureBreak(m5, 6);
  const rsiCross = up ? r.slice(-6).some(v => v < 35) && r.at(-1)! > 35 : r.slice(-6).some(v => v > 65) && r.at(-1)! < 65;
  const trigger = (up ? pat.score > 0 : pat.score < 0) || bos === (up ? 1 : -1) || rsiCross;
  if (!trigger) return null;
  reasons.push(rsiCross ? `RSI ${up ? "crossed up 35" : "crossed down 65"}` : bos ? (up ? "5m CHoCH up" : "5m CHoCH down") : pat.name);
  const big = m5.slice(-60), bHi = Math.max(...big.map(x => x.h)), bLo = Math.min(...big.map(x => x.l)), rng = bHi - bLo || 1e-9;
  const extreme = up ? (lo - bLo) / rng : (bHi - hi) / rng; // 0 = at the big swing extreme
  const prior = m5.slice(-30, -6), swept = up ? lo < Math.min(...prior.map(x => x.l)) : hi > Math.max(...prior.map(x => x.h));
  const zone = extreme <= 0.215 || swept; // within fib 78.6-100% of the 60-bar swing, or a liquidity sweep
  if (!zone) return null;
  reasons.push(swept ? (up ? "Liquidity sweep of lows" : "Liquidity sweep of highs") : (up ? "At support / fib 78.6%+" : "At resistance / fib 78.6%+"));
  return { direction: up ? "BUY" : "SELL", reasons };
}
/** Trend resume: after a counter-trend bounce, a rejection at fib 50-61.8% of the last leg or the 5m EMA21 re-enters with the trend. */
export function detectResume(m5: Candle[], trend: "BUY" | "SELL" | "WAIT"): { direction: "BUY" | "SELL"; reasons: string[] } | null {
  if (trend === "WAIT" || m5.length < 30) return null;
  const down = trend === "SELL", seg = m5.slice(-30), px = m5.at(-1)!.c;
  const hi = Math.max(...seg.map(x => x.h)), lo = Math.min(...seg.map(x => x.l)), rng = hi - lo || 1e-9;
  const retr = down ? (px - lo) / rng : (hi - px) / rng;
  const e21 = last(ema(m5.map(x => x.c), 21)), atr = avgRange(m5);
  const atEma = Math.abs((down ? m5.at(-1)!.h : m5.at(-1)!.l) - e21) <= 0.3 * atr;
  if (!((retr >= 0.38 && retr <= 0.7) || atEma)) return null;
  const pat = candlePattern(m5), bos = structureBreak(m5, 6);
  const reject = down ? pat.score < 0 || bos === -1 : pat.score > 0 || bos === 1;
  if (!reject) return null;
  return { direction: down ? "SELL" : "BUY", reasons: [atEma ? "Rejection at 5m EMA21" : `Rejection at fib ${(retr * 100).toFixed(0)}%`, bos ? (down ? "5m CHoCH down" : "5m CHoCH up") : pat.name] };
}
/** 5-minute retracement / scalp engine with smart-money confirmations. Can BUY inside a downtrend (and SELL inside an uptrend). */
export function analyzeScalp(m5: Candle[], trend: "BUY" | "SELL" | "WAIT", now: Date): ScalpResult {
  if (m5.length < 50) return { direction: "WAIT", confidence: 50, retracement: false, reasons: ["Not enough 5m data"] };
  const session = sessionOf(now);
  if (session === "rollover") return { direction: "WAIT", confidence: 50, retracement: false, reasons: ["Rollover hours: no new entries (wide spread)"], kind: "range", session };
  const pb = detectPullback(m5, trend);
  if (pb && !(session === "ny" && pb.reasons.length < 3)) {
    const conf = session === "overlap" || session === "london" ? 78 : 72;
    return { direction: pb.direction, confidence: conf, retracement: true, reasons: [...pb.reasons, `Session: ${session}`], kind: "pullback", session };
  }
  const rs = session === "asian" ? null : detectResume(m5, trend);
  if (rs) return { direction: rs.direction, confidence: session === "overlap" ? 80 : 75, retracement: false, reasons: [...rs.reasons, `Session: ${session}`], kind: "resume", session };
  const c = m5.map(x => x.c), reasons: string[] = [];
  let score = 0;
  const add = (cond: boolean, s: number, why: string) => { if (cond) { score += s; reasons.push(why); } };
  const e9 = ema(c, 9), e21 = ema(c, 21);
  add(last(e9) > last(e21), 2, "5m EMA9 above EMA21"); add(last(e9) < last(e21), -2, "5m EMA9 below EMA21");
  add(last(e9) > last(e21) && last(e9, 3) <= last(e21, 3), 1, "Fresh bullish cross"); add(last(e9) < last(e21) && last(e9, 3) >= last(e21, 3), -1, "Fresh bearish cross");
  const r = rsi(c), rPrev = rsi(c.slice(0, -3));
  add(r > 40 && r < 70 && r > rPrev, 1, `RSI rising ${r.toFixed(0)}`); add(r < 60 && r > 30 && r < rPrev, -1, `RSI falling ${r.toFixed(0)}`);
  const slow = ema(c, 26), macd = ema(c, 12).map((v, i) => v - (slow[i] ?? v)), sg = ema(macd, 9);
  const h0 = last(macd) - last(sg), h1 = last(macd, 2) - last(sg, 2);
  add(h0 > h1, 1, "MACD turning up"); add(h0 < h1, -1, "MACD turning down");
  const dv = rsiDivergence(c); add(dv === 1, 2, "5m bullish RSI divergence"); add(dv === -1, -2, "5m bearish RSI divergence");
  const sfib = fibSetup(m5.slice(-60)); add(!!sfib && sfib.score > 0, 1, "5m Fibonacci golden zone (buy)"); add(!!sfib && sfib.score < 0, -1, "5m Fibonacci golden zone (sell)");
  const pat = candlePattern(m5); add(pat.score !== 0, pat.score, pat.name);
  const bos = structureBreak(m5); add(bos === 1, trend === "SELL" ? 2 : 2, trend === "SELL" ? "CHoCH up (bullish)" : "Break of structure up"); add(bos === -1, -2, trend === "BUY" ? "CHoCH down (bearish)" : "Break of structure down");
  const fvg = fairValueGap(m5); add(fvg === 1, 1, "Bullish fair value gap"); add(fvg === -1, -1, "Bearish fair value gap");
  const ob = orderBlock(m5); add(ob === 1, 2, "Bullish order block retest"); add(ob === -1, -2, "Bearish order block retest");
  const seg = m5.slice(-48), hi = Math.max(...seg.map(x => x.h)), lo = Math.min(...seg.map(x => x.l)), mid = (hi + lo) / 2, px = last(c);
  add(px < mid, 1, "Discount zone (below 50%)"); add(px > mid, -1, "Premium zone (above 50%)");
  const vwap = seg.reduce((a, x) => a + (x.h + x.l + x.c) / 3, 0) / seg.length;
  add(px > vwap, 1, "Above session VWAP"); add(px < vwap, -1, "Below session VWAP");
  const active = sessionActive(now);
  const direction = score >= 5 ? "BUY" : score <= -5 ? "SELL" : "WAIT";
  const confidence = Math.max(50, Math.min(95, Math.round(50 + Math.abs(score) / 12 * 45 + (active ? 5 : -5))));
  reasons.push(active ? "London/New York session" : "Asian session (lower confidence)");
  // Asian session: range/mean-reversion only -> fade the premium/discount extreme, ignore breakouts.
  const kind: ScalpKind = session === "asian" ? "range" : "momentum";
  const dir = session === "asian" ? (px < lo + (hi - lo) * 0.2 && score > 0 ? "BUY" : px > hi - (hi - lo) * 0.2 && score < 0 ? "SELL" : "WAIT") : direction;
  return { direction: dir, confidence: dir === "WAIT" ? Math.min(confidence, 55) : confidence, retracement: dir !== "WAIT" && trend !== "WAIT" && dir !== trend, reasons, kind, session };
}

export const rsiSeries = (values: number[], p = 14) => values.map((_, i) => i < p ? 50 : rsi(values.slice(0, i + 1), p));
/** Trend-aware RSI: uptrend band 40-80, downtrend band 20-60; 50 line gives momentum. */
export function rsiBias(v: number, uptrend: boolean): 1 | -1 | 0 {
  if (uptrend) return v > 80 ? -1 : v < 40 ? 1 : v > 50 ? 1 : 0;
  return v < 20 ? 1 : v > 60 ? -1 : v < 50 ? -1 : 0;
}
/** Regular divergence over the last 30 bars: price lower low + RSI higher low = bullish (and the mirror). */
export function rsiDivergence(closes: number[], window = 30): 1 | -1 | 0 {
  if (closes.length < window + 15) return 0;
  const r = rsiSeries(closes.slice(-(window + 60))).slice(-window), c = closes.slice(-window), half = Math.floor(window / 2);
  const a = c.slice(0, half), b = c.slice(half), ra = r.slice(0, half), rb = r.slice(half);
  const iMinA = a.indexOf(Math.min(...a)), iMinB = b.indexOf(Math.min(...b)), iMaxA = a.indexOf(Math.max(...a)), iMaxB = b.indexOf(Math.max(...b));
  if (b[iMinB]! < a[iMinA]! && rb[iMinB]! > ra[iMinA]! + 1) return 1;
  if (b[iMaxB]! > a[iMaxA]! && rb[iMaxB]! < ra[iMaxA]! - 1) return -1;
  return 0;
}
export type FibLevels = { l236: number; l382: number; l500: number; l618: number; l786: number; e1272: number; e1618: number };
export type FibSetup = { swing: "up" | "down"; high: number; low: number; retr: number; levels: FibLevels; score: 1 | -1 | 0 | 2 | -2 };
/** Fibonacci levels of a swing. For an up-swing retracements are measured down from the high; extensions project above it. */
export function fibLevels(high: number, low: number, swing: "up" | "down"): FibLevels {
  const r = high - low, f = (k: number) => swing === "up" ? high - r * k : low + r * k, e = (k: number) => swing === "up" ? low + r * k : high - r * k;
  return { l236: f(0.236), l382: f(0.382), l500: f(0.5), l618: f(0.618), l786: f(0.786), e1272: e(1.272), e1618: e(1.618) };
}
/** Finds the swing (lowest low / highest high) and scores a golden-zone (50-61.8%) reaction in the swing direction. */
export function fibSetup(bars: Candle[]): FibSetup | null {
  if (bars.length < 20) return null;
  let hi = 0, lo = 0;
  bars.forEach((b, i) => { if (b.h > bars[hi]!.h) hi = i; if (b.l < bars[lo]!.l) lo = i; });
  const high = bars[hi]!.h, low = bars[lo]!.l, range = high - low, px = bars.at(-1)!.c;
  if (range <= 0) return null;
  const swing = lo < hi ? "up" : "down", levels = fibLevels(high, low, swing);
  const retr = swing === "up" ? (high - px) / range : (px - low) / range;
  const prev = bars.at(-2)!.c, reacting = swing === "up" ? px > prev : px < prev;
  let score: FibSetup["score"] = 0;
  if (retr > 0.786) score = 0; // golden zone failed: setup cancelled
  else if (retr >= 0.5 && retr <= 0.618) score = reacting ? (swing === "up" ? 2 : -2) : (swing === "up" ? 1 : -1);
  else if (retr >= 0.382 && retr < 0.5) score = swing === "up" ? 1 : -1;
  return { swing, high, low, retr, levels, score };
}

/** Ichimoku lines on the bar 26 periods ago for the cloud (displaced spans) and current Tenkan/Kijun. */
export function ichimoku(bars: Candle[]) {
  if (bars.length < 78) return null;
  const mid = (seg: Candle[]) => (Math.max(...seg.map(x => x.h)) + Math.min(...seg.map(x => x.l))) / 2;
  const at = (end: number, n: number) => mid(bars.slice(end - n, end));
  const n = bars.length, d = n - 26;
  return { tenkan: at(n, 9), kijun: at(n, 26), spanA: (at(d, 9) + at(d, 26)) / 2, spanB: at(d, 52) };
}
/** Price distance from its own 20-bar mean in standard deviations. */
export function zScore(closes: number[], n = 20) {
  const seg = closes.slice(-n); if (seg.length < n) return 0;
  const m = seg.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(seg.reduce((a, b) => a + (b - m) ** 2, 0) / n);
  return sd === 0 ? 0 : ((seg.at(-1) ?? m) - m) / sd;
}
