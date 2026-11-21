export const MARKETS = {
  XAUUSD: { name: "Gold", ticker: "GC=F", decimals: 2, currency: "USD", scale: 1 },
  EURUSD: { name: "Euro / US dollar", ticker: "EURUSD=X", decimals: 5, currency: "USD", scale: 1 },
  GBPUSD: { name: "Pound / US dollar", ticker: "GBPUSD=X", decimals: 5, currency: "USD", scale: 1 },
  USDJPY: { name: "US dollar / Yen", ticker: "JPY=X", decimals: 3, currency: "JPY", scale: 1 },
  USDCHF: { name: "US dollar / Swiss franc", ticker: "CHF=X", decimals: 5, currency: "CHF", scale: 1 },
} as const;
export type Market = keyof typeof MARKETS;
export const marketIds = Object.keys(MARKETS) as Market[];
export const price = (market: Market, value: number) => `${MARKETS[market].currency === "JPY" ? "¥" : MARKETS[market].currency === "CHF" ? "CHF " : "$"}${value.toFixed(MARKETS[market].decimals)}`;
export function directionForScore(score: number): "BUY" | "SELL" | "WAIT" {
  return score >= 4 ? "BUY" : score <= -4 ? "SELL" : "WAIT";
}
export function shouldAlert(direction: string, status: string, previous: string | null, previousUntil: number, now: number) {
  return status === "ready" && (direction === "BUY" || direction === "SELL") && (direction !== previous || previousUntil <= now);
}
export function isMarketClosed(_market: Market, now: Date) {
  const day = now.getUTCDay(), hour = now.getUTCHours();
  return day === 6 || (day === 5 && hour >= 21) || (day === 0 && hour < 22);
}
