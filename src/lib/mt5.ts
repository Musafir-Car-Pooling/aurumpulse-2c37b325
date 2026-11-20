export const ORDER_MAX_AGE_MS = 3 * 60 * 1000;

export async function hashKey(key: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");
}

export function newKey() {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return "ap_" + Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
}

/** A signal can be traded only when it's BUY/SELL and still inside its validity window. */
export function canTrade(s: { direction: string; validUntil: string } | null | undefined, now = Date.now()) {
  return !!s && (s.direction === "BUY" || s.direction === "SELL") && new Date(s.validUntil).getTime() > now;
}

type OrderRow = { id: string; market: string; direction: string; lot: number; signal: unknown };
export function pollLine(o: OrderRow, withLevels: boolean) {
  const base = `${o.id}|${o.market}|${o.direction}|${o.lot}`;
  if (!withLevels) return base;
  const s = (o.signal ?? {}) as { stopLoss?: unknown; tp1?: unknown; tp2?: unknown };
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return `${base}|${n(s.stopLoss)}|${n(s.tp1)}|${n(s.tp2)}`;
}

export function isStale(createdAt: string, now = Date.now()) {
  return now - new Date(createdAt).getTime() > ORDER_MAX_AGE_MS;
}

export const PROFIT_TARGET_USD = 2;
export const LOSS_LIMIT_USD = 3;
export type LiveSignal = { direction: string; confidence: number; trend1h: "bull" | "bear" | "neutral"; fresh: boolean };
export const MAX_PROFIT_USD = 9;
export const GIVEBACK = 0.4;
/** Max hold profit scales with lot: USD 9 per 0.01 lot (0.02 = 18, 0.05 = 45). */
/** Loss limit and min profit scale with lot: USD 3 / USD 2 per 0.01 lot. */
export const lotSteps = (lot: number) => Math.max(1, Math.round(lot / 0.01));
export const lossLimitFor = (lot: number) => LOSS_LIMIT_USD * lotSteps(lot);
export const profitTargetFor = (lot: number) => PROFIT_TARGET_USD * lotSteps(lot);
export const maxProfitFor = (lot: number) => MAX_PROFIT_USD * Math.max(1, Math.round(lot / 0.01));
/** Lot scales with balance: tier lot at USD 500, capped at 0.05 per USD 500. */
export const scaledLot = (tierLot: number, balance: number) => { const k = Math.max(1, balance / 500); return Math.floor(Math.min(tierLot * k, 0.05 * k) * 100 + 1e-7) / 100; };
/** v16 trailing: keep 60/70/80% of peak once it reaches 1x/2x/3x the target. */
export const retainFor = (peak: number, target: number) => peak >= 3 * target ? 0.8 : peak >= 2 * target ? 0.7 : 0.6;
/** Bridge v9: close at -$3; at $2+ hold only while the live signal is strong in the same direction (max $9, 40% giveback guard). */
export function holdDecision(side: "BUY" | "SELL", market: string, profit: number, peak: number, sig: LiveSignal | null, lot = 0.01, counterTrend = false): "CLOSE" | "HOLD" | "WAIT_TARGET" {
  const target = profitTargetFor(lot);
  if (profit <= -lossLimitFor(lot) || profit >= maxProfitFor(lot)) return "CLOSE";
  // v16 breakeven lock: after 60% of target, never let the trade turn into a loss.
  if (peak >= 0.6 * target && profit <= 0.05 * lotSteps(lot)) return "CLOSE";
  if (profit < target) return "WAIT_TARGET";
  // v17: counter-trend (retracement) trades bank the target immediately, never hold.
  if (counterTrend) return "CLOSE";
  const gold = market === "XAUUSD";
  const strong = !!sig && sig.fresh && sig.direction === side && sig.confidence >= (gold ? 70 : 60) && (!gold || sig.trend1h === (side === "BUY" ? "bull" : "bear"));
  if (!strong) return "CLOSE";
  if (peak > target && profit <= Math.max(target, peak * retainFor(peak, target))) return "CLOSE";
  return "HOLD";
}

type ScanResult = { direction?: string; support?: number; resistance?: number; scalp?: { direction: string; confidence: number; kind?: string; session?: string } | null; confidence?: number; validUntil?: string; indicators?: { name: string; bias: string }[] } | null;
/** Bridge v10 lot sizing from signal strength. */
export function lotForConfidence(confidence: number) {
  return confidence >= 90 ? 0.05 : confidence >= 85 ? 0.03 : confidence >= 75 ? 0.02 : 0.01;
}
export function signalLine(r: ScanResult, now = Date.now(), v2: boolean | 3 = false) {
  if (!r?.direction) return "NONE";
  const t = r.indicators?.find(i => i.name.startsWith("EMA 50/200"))?.bias ?? "neutral";
  const fresh = !!r.validUntil && new Date(r.validUntil).getTime() > now ? 1 : 0;
  const line = `${r.direction}|${r.confidence ?? 0}|${t}|${fresh}`;
  const l2 = `${line}|${r.support ?? 0}|${r.resistance ?? 0}|${r.scalp?.direction ?? "WAIT"}|${r.scalp?.confidence ?? 0}`;
  return v2 === 3 ? `${l2}|${r.scalp?.kind ?? "momentum"}|${r.scalp?.session ?? "none"}` : v2 ? l2 : line;
}

/** Picks the live gold entries for one scan: the trend signal, plus a retracement scalp when it points the other way (or the trend is WAIT). */
export function autoEntries(r: { direction: string; confidence: number; validUntil: string; scalp?: { direction: string; confidence: number; kind?: string; session?: string } | null } | null, now = Date.now()) {
  const out: { direction: "BUY" | "SELL"; confidence: number; kind: "trend" | "scalp"; setup?: string }[] = [];
  if (r?.scalp?.session === "rollover") return out;
  if (!r || new Date(r.validUntil).getTime() <= now) return out;
  if (r.direction === "BUY" || r.direction === "SELL") out.push({ direction: r.direction, confidence: r.confidence, kind: "trend" });
  const sc = r.scalp;
  if (sc && (sc.direction === "BUY" || sc.direction === "SELL") && sc.direction !== r.direction) out.push({ direction: sc.direction, confidence: sc.confidence, kind: "scalp", setup: sc.kind ?? "momentum" });
  return out;
}

/** v14: strength becomes several 0.01 positions instead of one big lot (1/2/3/5 per USD 500, scaled with balance). */
export function positionsForConfidence(confidence: number, balance = 500) {
  const base = Math.round(lotForConfidence(confidence) / 0.01);
  return Math.max(1, Math.floor(base * Math.max(1, balance / 500)));
}
