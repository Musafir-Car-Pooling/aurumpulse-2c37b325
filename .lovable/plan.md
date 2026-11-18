# AurumPulse Bridge EA v4: smart hold + $2 profit close

## Aap ko kya milega
- **Naya bot AurumPulse_Bridge_EA_v4.mq5** (aap ki Files mein, purana v3 bhi rahega).
- **Entry:** fixed 0.01 lot, koi SL/TP nahi. Entry sirf AurumPulse ke live BUY/SELL signal par hogi:
  - Auto Trade ON: har naye signal par khud entry (sab 6 pairs, XAUUSD priority).
  - Auto Trade OFF: sirf "Take entry now" dabane par entry.
- **Smart hold (live analysis):** bot har 15 second app se us pair ka taaza live signal mangta hai (wahi analysis jo Signal Now deta hai: EMA, RSI, MACD, ATR score).
  - Signal abhi bhi trade ki direction mein strong hai (score/confidence barh raha ya same) → trade **hold**, $2 par close nahi karega.
  - Signal kamzor ho gaya, WAIT ho gaya ya ulta ho gaya → profit $2+ hai to foran **close**.
  - Hold ke dauran agar profit peak se kaafi wapas girne lage (peak ka 40% giveback, kam se kam $2 bachay) → close, taake profit hath se na nikle.
- **XAUUSD special:** gold ke liye stricter hold rule (confidence 70%+ aur 1h trend same direction ho tabhi hold), aur spread zyada ho to entry skip.
- **Chart panel:** har trade ka status dikhayega: "HOLD — signal strong", "CLOSE at +$2", live profit, last signal.
- Same pair par ek waqt mein ek hi trade; naya entry sirf naye signal par.

## Zaroori warning
SL nahi hai, isliye agar market ulta chala jaye to loss barhta rahega — bot sirf profit side par close karta hai. Pehle demo account par test karein. Main MT5 mein compile/live test nahi kar sakta.

## Technical details
- New key-authenticated endpoint `/api/public/mt5/signal?market=XAUUSD` (same connect-key header as poll): returns `direction|confidence|score|trend1h|validUntil` from latest saved `market_scans` row (no fresh provider call; scanner already updates every minute). Revoked/unknown key → 401. No user data exposed.
- Pure helper `holdDecision(position, liveSignal, profit, peak, market)` in `src/lib/mt5.ts` mirrored in EA; tests: hold when same direction strong, close at >=$2 when WAIT/flip, giveback close, XAUUSD stricter threshold, never close below $2 by rule.
- EA v4: reuses v3 poll/report protocol, symbol suffix resolver, filling mode; adds per-position peak tracking, 15s signal check, spread filter, dashboard.
- Update Python EA rules test to v4 (0.01 lot, sl=0/tp=0, $2 target).
- Update memory "Bridge EA trade rules" to $2 + smart hold; AGENTS.md rule for the signal endpoint.
- Publish needed for the new endpoint on the live app.
