# AurumPulse Bridge v14: sahi Fibonacci + RSI, 0.01 ki kai positions, khud seekhne wala bot

## Abhi ki halat (code check kiya)
- **RSI**: Wilder ka tareeqa (14 period) sahi laga hua hai. Kami ye hai ke sirf 70/30 aur 55/45 ki hadein dekhi jati hain. Divergence (price naya low, RSI naya low nahi) nahi pakri jati.
- **Fibonacci**: sirf ek check hai: price pichle 32 candles ki range mein 38.2%–61.8% par hai ya nahi. Ye nahi dekha jata ke swing upar ka tha ya neeche ka. 50%, 61.8% (golden zone) aur 78.6% levels par bounce ki tasdeeq nahi hoti, aur targets ke liye Fibonacci extension (127.2% / 161.8%) istemal nahi hote.
- **Lot**: strong signal par ek hi bari position (0.02/0.03/0.05) khulti hai.

## Kya banega

1. **Fibonacci sahi tareeqe se**
   - Asal swing high/low pehchaan kar swing ki direction tay karna (upar wala swing ya neeche wala).
   - Levels: 23.6, 38.2, 50, 61.8, 78.6%. Golden zone (50–61.8%) mein bounce candle ho to mazboot entry.
   - 78.6% toot jaye to setup cancel.
   - Extension 127.2% / 161.8% ko profit zone ke taur par dikhana, aur bot is zone ke qareeb profit wala trade foran close kare.
   - App ke signal card par Fibonacci levels dikhana.
2. **RSI mukammal**
   - Bullish/bearish divergence (15m aur 5m par).
   - RSI 50 line cross se momentum ki tasdeeq.
   - Trend ke hisaab se hadein: uptrend mein 40–80, downtrend mein 20–60.
3. **0.01 ki kai positions, bari lot nahi**
   - Strong signal par 0.02 ki jagah 0.01 ki 2 positions, 0.03 ki jagah 3, aur 0.05 ki jagah 5 positions, sab ek hi waqt par.
   - Har position ke apne rules: $2 target, $3 loss, aur strong signal par $9 tak hold.
   - Balance barhne par positions ki tadaad barhegi (har $500 par max 5).
   - Ek pair par kul positions ki had input se tay hogi (default 10).
4. **Risk aur money management (discipline)**
   - Daily loss limit: default balance ka 5%. Had poori ho to bot us din nayi entry nahi lega.
   - Lagataar 3 loss hon to 30 minute ka break, aur agli entries sirf 1 position ki.
   - Daily profit target poora ho to bot entries rok sakta hai (input se on/off).
5. **Khud seekhne wala bot (weakness journal)**
   - Har band trade ka record: direction, trend ya retracement, session, ghanta, nateeja, aur kitni der khuli rahi.
   - Har roz aur har 20 trades ke baad bot khud kamzoriyan likhega, jaise:
     - "Asian session mein loss zyada hain"
     - "Retracement BUY ka win rate 35% hai"
     - "Spread ki wajah se entries ruk rahi hain"
     - "$3 loss bohat jaldi lag raha hai"
   - Har kamzori ke saath bot ki tajweez bhi hogi.
   - **Khud ko adjust karna:** jis qism ki entry (session, direction, ya trend/retracement) ka win rate 40% se kam ho, us par bot khud zyada confidence mangega ya entry kam karega. Ye settings MT5 mein save rehti hain.
   - Ye sab **"My Requirements.txt"** file mein likha jayega. Sath mein ek trade journal file bhi banegi.
6. **Bridge EA v14** mein upar ki sari cheezein. Connect MT5 page ki likhai bhi update hogi.

## Zaroori hadein (MT5 ki taraf se)
- MT5 kisi EA ko `MQL5/Experts` folder mein file likhne nahi deta. Bot sirf `MQL5/Files` folder mein likh sakta hai. Is liye file **MQL5/Files/My Requirements.txt** mein banegi (MT5 → File → Open Data Folder → MQL5 → Files).
- EA apna code khud nahi badal sakta. "Khud upgrade" ka matlab hai ke bot apni settings khud adjust karega: confidence ki had, positions ki tadaad, aur kaun se session/direction band karne hain. Code mein jo badlav chahiye, wo file mein likha hoga. Aap wo file mujhe bhej dein, main us ke mutabiq agla version bana doonga.

## Technical details
- `src/lib/signal-engine.ts`: `fibLevels(swing)`, `swingPoints(bars)`, `rsiDivergence(closes, rsiSeries)`, aur trend ke hisaab se RSI ki hadein; analyze/analyzeScalp mein inka istemal; result mein `fib` field.
- `src/lib/mt5.ts`: `positionsForConfidence(conf, balance)` jo 0.01 positions ki tadaad deta hai (1/2/3/5 per $500).
- Order mein `lot` hi bheja jayega; EA usay `round(lot/0.01)` positions mein baant dega. Is ke liye database mein koi tabdeeli nahi chahiye.
- EA v14:
  - Execute mein loop jo `N x 0.01` positions kholta hai.
  - Per-position limits fixed 0.01 ke hisaab se.
  - `Journal()` OnTradeTransaction (DEAL_ENTRY_OUT) par CSV `AurumPulse_journal.csv` mein likhega.
  - `AnalyzeWeakness()` har 20 trades aur har roz "My Requirements.txt" ko FileOpen(FILE_WRITE|FILE_TXT) se dobara likhega.
  - Adaptive settings GlobalVariables mein save hongi.
  - Daily loss/consecutive loss guard.
- Tests:
  - Fibonacci levels aur golden zone.
  - Bullish/bearish RSI divergence.
  - Positions ki tadaad: $500 par 1/2/3/5, aur $1000 par double.
  - Python EA test jo per-0.01 position rules aur journal/requirements file ka naam check karega.
- Memory update: 0.01 ki kai positions wala rule.
