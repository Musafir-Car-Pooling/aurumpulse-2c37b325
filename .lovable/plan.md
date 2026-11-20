# AurumPulse Bridge v13: dono taraf entries, lot ke hisaab se loss, institutional logic

## Data se kya mila (pichle 2 din, XAUUSD)
- App ne gold par sirf SELL signals diye: 33 executed, 61 expired, 57 failed, aur ek bhi BUY nahi. Wajah ye hai ke BUY ka faisla 15m/1h trend indicators karte hain, aur gold neeche ke trend mein hai.
- Retracement BUY wala rule bohat sakht hai: RSI 38 se neeche, support ke paas, aur bullish candle, teeno ek saath chahiye. Is liye oopar ki taraf retracement par BUY kabhi nahi bana.
- Bohat saare orders "expired" aur "failed" hue. Inki asal wajah abhi confirm nahi, is liye ye pehla step hai.

## Kya banega

1. **Expired/failed orders ki jaanch aur fix**: har failed order ki wajah (max trades, entry gap, spread, broker error) dekh kar rules theek karna, taake har live signal par entry ho sake.
2. **Loss limit lot ke saath**: har 0.01 lot par $3 (0.02 = $6, 0.05 = $15). $2 profit target bhi isi hisaab se barhega (0.02 = $4). Hold cap pehle ki tarah $9 per 0.01.
3. **Alag 5-minute "retracement/scalp" signal**: bara trend SELL ho aur price upar retrace kare (5m EMA 9/21 cross up, RSI 40 se upar ja raha ho, bullish candle, MACD upar mur raha ho), to BUY scalp signal. Ulta uptrend ke andar neeche retracement par SELL scalp. Auto trade dono signals par entry lega: trend aur retracement.
4. **Institutional (smart money) logic signal engine mein**:
   - Market structure: Break of Structure (BOS) aur Change of Character (CHoCH).
   - Order blocks: aakhri ulti candle jahan se bara move shuru hua, us zone par entry.
   - Fair Value Gap (FVG): 3-candle imbalance zone par retest entry.
   - Premium/Discount: Fibonacci 50% se neeche BUY, upar SELL ko tarjeeh.
   - Liquidity sweep + displacement candle confirmation (pehle se mojood rule ko behtar karna).
   - Session filter: London aur New York session mein zyada confidence, Asian range mein kam.
   - VWAP: session VWAP ke upar/neeche bias.
5. **Har live signal par entry**: jab bhi naya signal aaye (trend ya scalp), ya direction badle, nayi entry queue ho. EA ki limits rahengi: ek pair par max trades aur entries ke beech gap.
6. **Connect MT5 page par "Bot status" box**: aakhri signal (trend + scalp), aakhri entry, aur entry na hone ki wajah saaf likhi hui.
7. **Bridge EA v13**: lot ke hisaab se loss/target, scalp orders ki pehchan, aur pending orders scalp levels ke saath.

## Technical details
- `src/lib/signal-engine.ts`: `analyzeScalp(m5, trend)` aur SMC helpers (`structureBreak`, `orderBlock`, `fairValueGap`, `sessionBias`, `vwap`), sab pure functions with tests.
- `src/lib/market-data.ts`: XAUUSD ke liye 5m candles fetch karna; scan result mein `scalp` field.
- `queue_auto_orders` aur scan job: trend ya scalp signal par queue; dedup sirf pending/sent order par.
- `src/lib/mt5.ts`: `lossLimitFor(lot)=3*lot/0.01`, `profitTargetFor(lot)=2*lot/0.01`, `holdDecision` mein inka istemal; v2 signal line mein scalp direction.
- Tests: lot ke hisaab se loss/target, scalp BUY in downtrend retracement, BOS/FVG/order block detection.
- Memory update: lot-scaled loss limit.

## Note
Koi bhi bot har trade jeetne ki guarantee nahi deta. Zyada entries aur bara lot risk barhate hain. Pehle demo par test karein.
