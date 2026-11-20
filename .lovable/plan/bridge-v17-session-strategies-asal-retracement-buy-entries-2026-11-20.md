# Bridge v17: Session strategies + asal retracement BUY entries

## Jo check kiya (pichle 2 din, XAUUSD)
- Kul XAUUSD orders: **sab SELL, BUY aik bhi nahi** (91 SELL executed, baqi expire/failed).
- Abhi ka scan: trend SELL 80%, 5m retracement signal bhi SELL 64%.
- **Asal wajah:** 5m "retracement" signal zyada tar trend wale indicators par chalta hai (EMA9/21, VWAP, MACD). Downtrend mein ye khud neeche rehte hain, is liye BUY ke liye +5 score kabhi nahi banta. Yaani bot ko bounce "dikhta" hi nahi.
- Doosri rukawat: EA ka "closed M5 candle has not confirmed" filter (36 entries) aur purana cooldown (20 entries) bhi entries rok rahe the.

## Kya banayenge

### 1. Naya Retracement (pullback) detector — dono taraf
SELL trend ke andar BUY tab banega jab ye 3 cheezein ek saath hon:
- Price recent 5m low se kam az kam ~0.5×ATR upar bounce kare (asal reversal shuru).
- Bullish trigger: hammer/engulfing/dragonfly, ya 5m CHoCH up, ya RSI 30–35 se upar cross.
- Price support / Fib 61.8–78.6 / liquidity sweep low ke paas ho.
Uptrend mein bilkul ulta SELL. EMA/VWAP jaise trend indicators is detector mein vote nahi karenge.

### 2. Bounce khatam → wapas SELL ("trend resume")
BUY retracement ke baad jab price drop ke 50–61.8% Fib ya 5m EMA21 / resistance par rejection candle (shooting star, bearish engulfing, CHoCH down) de, to foran trend direction SELL entry. Uptrend mein mirror.

### 3. Session ke hisaab se strategy
```text
Asian  (00-07 UTC): range/mean-reversion — S/R aur z-score par fade, breakouts ignore, sirf 1x0.01, chhota target ($2/0.01, hold nahi)
London (07-12 UTC): pehle 90 min liquidity-sweep reversal (Asian high/low ka fakeout), phir breakout + trend follow
Overlap(12-16 UTC): trend + pullback dono, full position size, $9/0.01 tak hold allowed
NY late(16-21 UTC): trend continuation, retracement entries zyada strict
Rollover(21-24 UTC): nayi entries band (spread wide)
```
Signal engine har result ke saath `session` aur `strategy` naam bhejega; Bot status box mein dikhega.

### 4. Exits
- Retracement (counter-trend) trade: $2 per 0.01 par foran close, hold nahi.
- Trend trade: pehle wale rules (min $2, strong ho to $9/0.01, breakeven + trailing, $3/0.01 loss).

### 5. Rukawatein hatana
- Retracement entry ke liye EA ka M5 "confirm" filter khud trigger hi hai, is liye dobara block nahi karega.
- Auto queue: trend aur retracement dono direction alag alag dedup (BUY ko SELL ki pending entry nahi rokegi) — confirm karke theek.

## Technical details
- `src/lib/signal-engine.ts`: `sessionOf(now)` + per-session weights; `detectPullback(m5, trend, atr)`; `detectResume(m5, trend)`; `analyzeScalp` returns `{direction, kind: "pullback"|"resume"|"range", session}`.
- `src/lib/mt5.ts`: `autoEntries` adds kind/session; `holdDecision` gets `kind` — counter-trend never HOLDs.
- `signalLine` v3 adds `kind|session`; `/api/public/mt5/signal` supports `v=3`.
- Scan job + `refreshAutoTrade` queue the new kinds; order signal JSON carries `kind`.
- New `src/mt5/AurumPulse_Bridge_EA_v17.mq5`: session profile, kind-aware exit, rollover block, skip M5 re-confirm for pullback; Files copy.
- `mt5.tsx`: Bot status shows session + strategy; setup text v17.
- Tests: pullback BUY inside SELL trend from synthetic candles, resume SELL after bounce, session mapping, counter-trend no-hold; update python EA tests to v17.

## Hadein
Live market/MT5 compile mein test nahi hoga; bounce detect hone ke bawajood kuch BUY loss mein ja sakti hain. Pehle demo par chalayein, aur app republish karni hogi.
