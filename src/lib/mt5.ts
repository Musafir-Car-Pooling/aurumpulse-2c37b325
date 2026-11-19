export const ORDER_MAX_AGE_MS = 2 * 60 * 1000;

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
/** Quick exit (Bridge v8): closes at -$3 loss or at $2+ profit; never holds a winning trade. */
export function holdDecision(_side: "BUY" | "SELL", _market: string, profit: number, _peak: number, _sig: LiveSignal | null): "CLOSE" | "WAIT_TARGET" {
  if (profit <= -LOSS_LIMIT_USD || profit >= PROFIT_TARGET_USD) return "CLOSE";
  return "WAIT_TARGET";
}

type ScanResult = { direction?: string; confidence?: number; validUntil?: string; indicators?: { name: string; bias: string }[] } | null;
export function signalLine(r: ScanResult, now = Date.now()) {
  if (!r?.direction) return "NONE";
  const t = r.indicators?.find(i => i.name.startsWith("EMA 50/200"))?.bias ?? "neutral";
  const fresh = !!r.validUntil && new Date(r.validUntil).getTime() > now ? 1 : 0;
  return `${r.direction}|${r.confidence ?? 0}|${t}|${fresh}`;
}
