//+------------------------------------------------------------------+
//| AurumPulse Bridge EA v15 Pro - 0.01 multi-positions, self-learning |
//| Fixed 0.01 lots. No SL, no TP. Holds while live app signal is      |
//| strong, otherwise closes at USD 2+. Closes automatically at USD 3  |
//| loss. Gold (XAUUSD) uses stricter hold rules and a spread filter.  |
//| Receives orders from the app; does not generate its own signals.  |
//| Use ONE copy of this EA per account. Test on demo first.           |
//+------------------------------------------------------------------+
#property strict
#property version "15.00"
#include <Trade/Trade.mqh>

input string AppUrl = "https://aurumpulse.lovable.app";
input string ConnectKey = ""; // App > Connect MT5 > Generate connect key
input string SymbolSuffix = "m";
input string SymbolPrefix = "";
input int PollSeconds = 3;
input int SignalCheckSeconds = 15;      // live analysis refresh for open trades
input int MaxTradesPerPair = 10;        // total 0.01 bot positions per pair (stacked + hedge)
input double DailyProfitTargetUSD = 0;  // stop new entries after this daily profit; 0 = off
input bool SelfLearning = true;         // loss evidence adjusts confirmation and exposure; no timed cooldown or daily loss stop
input bool AllowHedge = true;           // opposite-direction entries while a trade is open (hedging accounts)
input int MinEntryGapSeconds = 30;      // minimum time between two entries on the same pair
input double BalancePerStep = 500;      // every USD 500 of balance ...
input double MaxLotPerStep = 0.05;      // ... allows up to 0.05 lot on the strongest signal
input bool UsePendingOrders = true;     // XAUUSD: place limit / stop / stop-limit orders at support & resistance
input int PendingRefreshMinutes = 15;   // re-place pending orders with fresh levels
input double MaxGoldSpreadPrice = 1.00;  // skip XAUUSD entry when spread (ask-bid in price, e.g. $1.00) is wider; 0 = off

const double FIXED_LOT = 0.01;   // base lot
const double MAX_LOT = 0.05;     // tier lot at USD 500 balance (scaled by balance)
const double PROFIT_TARGET_USD = 2.00;
const double LOSS_LIMIT_USD = 3.00;
const double MAX_PROFIT_USD = 9.00;
const double GIVEBACK = 0.40;
const ulong BRIDGE_MAGIC = 777101;
const string COMMENT_PREFIX = "AP4 ";
CTrade trade;
string lastStatus = "Starting...";
string baseUrl;
string reportBodies[];

bool IsOurPosition() {
   return (ulong)PositionGetInteger(POSITION_MAGIC) == BRIDGE_MAGIC
      && StringFind(PositionGetString(POSITION_COMMENT), COMMENT_PREFIX) == 0;
}

bool Tradable(string sym) {
   return SymbolSelect(sym, true) && SymbolInfoInteger(sym, SYMBOL_TRADE_MODE) != SYMBOL_TRADE_MODE_DISABLED;
}

// Finds the broker symbol for an app market: exact/suffix inputs first, then ANY
// broker symbol that starts with the market name (XAUUSDm, XAUUSD.n, XAUUSD+, ...).
string Resolve(string base) {
   string candidates[4];
   candidates[0] = SymbolPrefix + base + SymbolSuffix;
   candidates[1] = base + SymbolSuffix;
   candidates[2] = base;
   candidates[3] = SymbolPrefix + base;
   for(int i=0; i<4; i++)
      if(Tradable(candidates[i])) return candidates[i];
   string best = "";
   string want = base; StringToUpper(want);
   int total = SymbolsTotal(false);
   for(int j=0; j<total; j++) {
      string name = SymbolName(j, false);
      string up = name; StringToUpper(up);
      int at = StringFind(up, want);
      if(at < 0 || at > StringLen(SymbolPrefix)) continue;   // name must start with market (optional prefix)
      if(!Tradable(name)) continue;
      if(best == "" || StringLen(name) < StringLen(best)) best = name;  // closest match wins
   }
   return best;
}

// Signal strength -> tier lot at USD 500: <75% 0.01, 75%+ 0.02, 85%+ 0.03, 90%+ 0.05 (mirrors lotForConfidence in the app).
double LotForConfidence(int conf) { return conf >= 90 ? 0.05 : conf >= 85 ? 0.03 : conf >= 75 ? 0.02 : FIXED_LOT; }
// Scales the tier lot by balance: USD 500 -> x1, USD 1000 -> x2. Never above 0.05 per USD 500.
double ScaledLot(string symbol, double tierLot) {
   double steps = MathMax(1.0, AccountInfoDouble(ACCOUNT_BALANCE)/MathMax(1.0,BalancePerStep));
   double lot = MathMin(tierLot*steps, MaxLotPerStep*steps);
   double step = SymbolInfoDouble(symbol,SYMBOL_VOLUME_STEP); if(step<=0) step=0.01;
   lot = MathFloor(lot/step+0.0000001)*step;
   lot = MathMax(lot, SymbolInfoDouble(symbol,SYMBOL_VOLUME_MIN));
   return MathMin(lot, SymbolInfoDouble(symbol,SYMBOL_VOLUME_MAX));
}
// Max hold profit grows with lot: 0.01 -> USD 9, 0.02 -> USD 18, 0.05 -> USD 45.
double MaxProfitFor(double lot) { return MAX_PROFIT_USD * MathMax(1.0, lot/0.01); }

bool LotAllowed(double lot, double minimum, double maximum, double step) {
   if(step <= 0 || lot < minimum-0.00000001 || lot > maximum+0.00000001) return false;
   double units = lot / step;
   return MathAbs(units - MathRound(units)) < 0.00000001;
}

bool ExactLotAllowed(string symbol, double lot) {
   return LotAllowed(lot,SymbolInfoDouble(symbol,SYMBOL_VOLUME_MIN),
      SymbolInfoDouble(symbol,SYMBOL_VOLUME_MAX),SymbolInfoDouble(symbol,SYMBOL_VOLUME_STEP));
}

// Risk scales with lot: per 0.01 lot USD 2 min profit and USD 3 loss (0.02 = 4 / 6, 0.05 = 10 / 15).
double LotSteps(double lot) { return MathMax(1.0, MathRound(lot/0.01)); }
bool TargetReached(double net, double lot) { return net >= PROFIT_TARGET_USD*LotSteps(lot); }
bool LossHit(double net, double lot) { return net <= -LOSS_LIMIT_USD*LotSteps(lot); }
bool MaxProfitHit(double net, double lot) { return net >= MaxProfitFor(lot); }

// Mirrors holdDecision() in the app: 0=wait target, 1=hold, 2=close.
int HoldDecision(bool buy, bool gold, double profit, double peak, double lot,
                 bool haveSig, string dir, int conf, string trend, bool fresh) {
   if(LossHit(profit, lot) || MaxProfitHit(profit, lot)) return 2;
   if(!TargetReached(profit, lot)) return 0;
   double tgt = PROFIT_TARGET_USD*LotSteps(lot);
   string side = buy ? "BUY" : "SELL";
   if(!haveSig || !fresh || dir != side) return 2;
   bool trendOk = trend == (buy ? "bull" : "bear");
   if(conf < (gold ? 70 : 60) || (gold && !trendOk)) return 2;
   if(peak > tgt && profit <= MathMax(tgt, peak*(1.0-GIVEBACK))) return 2;
   return 1;
}

bool TradingAllowed() {
   return TerminalInfoInteger(TERMINAL_TRADE_ALLOWED)
      && MQLInfoInteger(MQL_TRADE_ALLOWED)
      && AccountInfoInteger(ACCOUNT_TRADE_ALLOWED)
      && AccountInfoInteger(ACCOUNT_TRADE_EXPERT);
}

int netFailures = 0;

string Http(string method, string path, string body, int &code) {
   char data[], result[];
   string headers = "x-ap-key: " + ConnectKey + "\r\nContent-Type: application/json\r\n";
   string responseHeaders;
   if(body != "") {
      int length = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8);
      if(length > 0) ArrayResize(data, length-1);
   }
   // Transient terminal errors (e.g. 1003 while the terminal is busy) clear
   // on retry; only persistent failures reach the status line.
   for(int attempt=0; attempt<3; attempt++) {
      ResetLastError();
      // Bounded network delay; profit exits run before and after polling.
      code = WebRequest(method, baseUrl+path, headers, 3000, data, result, responseHeaders);
      if(code != -1) { netFailures=0; return CharArrayToString(result, 0, -1, CP_UTF8); }
      int error = GetLastError();
      if(error == 4014) { lastStatus = "Add app URL to Allow WebRequest"; return ""; }
      if(attempt < 2) Sleep(300);
   }
   netFailures++;
   if(netFailures >= 3) lastStatus = "Network unavailable - retrying";
   return "";
}

string JsonEscape(string value) {
   StringReplace(value, "\\", "\\\\");
   StringReplace(value, "\"", "\\\"");
   StringReplace(value, "\r", " ");
   StringReplace(value, "\n", " ");
   StringReplace(value, "\t", " ");
   return value;
}

void QueueReport(string id, bool ok, string ticket, double price, string error) {
   string body = "{\"id\":\"" + id + "\",\"ok\":" + (ok ? "true" : "false");
   if(ok) body += ",\"ticket\":\""+ticket+"\",\"price\":"+DoubleToString(price,8);
   else body += ",\"error\":\""+JsonEscape(StringSubstr(error,0,180))+"\"";
   int count = ArraySize(reportBodies);
   ArrayResize(reportBodies, count+1);
   reportBodies[count] = body+"}";
}

void FlushReport() {
   int count = ArraySize(reportBodies);
   if(count == 0) return;
   int code;
   Http("POST", "/api/public/mt5/report", reportBodies[0], code);
   if(code != 200) return; // Retry next timer, never repeat the entry.
   for(int i=1; i<count; i++) reportBodies[i-1] = reportBodies[i];
   ArrayResize(reportBodies, count-1);
}

string OrderMarker(string id) {
   return "AP4."+IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN))+"."+id;
}

bool ValidId(string id) {
   if(StringLen(id) != 36) return false;
   for(int i=0; i<36; i++) {
      ushort ch = StringGetCharacter(id,i);
      if(i==8 || i==13 || i==18 || i==23) { if(ch!=45) return false; }
      else if(!((ch>=48 && ch<=57) || (ch>=97 && ch<=102))) return false;
   }
   return true;
}

bool KnownMarket(string market) {
   return market=="XAUUSD" || market=="USTECm" || market=="USTEC_x100m"
      || market=="EURUSD" || market=="GBPUSD" || market=="USDJPY";
}

// Cached live signal per market from the app.
string sigMarket[]; string sigDir[]; int sigConf[]; string sigTrend[]; bool sigFresh[]; ulong sigAt[]; double sigSup[]; double sigRes[]; string sigScalp[]; int sigScalpConf[];
int SigIndex(string m) {
   for(int i=0;i<ArraySize(sigMarket);i++) if(sigMarket[i]==m) return i;
   int n=ArraySize(sigMarket);
   ArrayResize(sigMarket,n+1); ArrayResize(sigDir,n+1); ArrayResize(sigConf,n+1);
   ArrayResize(sigTrend,n+1); ArrayResize(sigFresh,n+1); ArrayResize(sigAt,n+1); ArrayResize(sigSup,n+1); ArrayResize(sigRes,n+1); ArrayResize(sigScalp,n+1); ArrayResize(sigScalpConf,n+1);
   sigMarket[n]=m; sigDir[n]=""; sigConf[n]=0; sigTrend[n]=""; sigFresh[n]=false; sigAt[n]=0; sigSup[n]=0; sigRes[n]=0; sigScalp[n]="WAIT"; sigScalpConf[n]=0;
   return n;
}
bool LiveSignal(string market, int &idx) {
   idx = SigIndex(market);
   ulong now = GetTickCount64();
   if(sigAt[idx]==0 || now-sigAt[idx] >= (ulong)MathMax(5,SignalCheckSeconds)*1000) {
      int code; string r = Http("GET","/api/public/mt5/signal?v=2&market="+market,"",code);
      sigAt[idx]=now;
      StringTrimLeft(r); StringTrimRight(r);
      string f[];
      int nf = code==200 ? StringSplit(r,'|',f) : 0;
      if(nf>=4) {
         sigDir[idx]=f[0]; sigConf[idx]=(int)StringToInteger(f[1]); sigTrend[idx]=f[2]; sigFresh[idx]=f[3]=="1";
         if(nf>=6) { sigSup[idx]=StringToDouble(f[4]); sigRes[idx]=StringToDouble(f[5]); }
         if(nf>=8) { sigScalp[idx]=f[6]; sigScalpConf[idx]=(int)StringToInteger(f[7]); }
      } else if(code==200) { sigDir[idx]="NONE"; sigFresh[idx]=false; }
      else return sigDir[idx]!=""; // network issue: keep last known signal
   }
   return sigDir[idx]!="" && sigDir[idx]!="NONE";
}


void Execute(string id, string market, string direction, double appLot) {
   if(!ValidId(id) || !KnownMarket(market) || (direction!="BUY" && direction!="SELL")) {
      lastStatus = "Invalid order response"; return;
   }
   string marker = OrderMarker(id);
   if(GlobalVariableCheck(marker)) { QueueReport(id,false,"",0,"Already handled by this EA"); lastStatus="Already handled - waiting for next signal"; return; }
   string symbol = Resolve(market);
   if(symbol=="") { QueueReport(id,false,"",0,"Broker symbol not found"); return; }
   if(!TradingAllowed()) { QueueReport(id,false,"",0,"Enable Algo Trading"); return; }
   int si=-1; bool hs = LiveSignal(market, si);
   // Tier lot from the app (signal strength), scaled by account balance (0.05 max per USD 500).
   double tier = (appLot>=FIXED_LOT-0.000001 && appLot<=MAX_LOT+0.000001) ? appLot
      : (hs && sigDir[si]==direction) ? LotForConfidence(sigConf[si]) : FIXED_LOT;
   double lot = ScaledLot(symbol, tier);
   if(!ExactLotAllowed(symbol, lot)) lot = FIXED_LOT;
   if(!ExactLotAllowed(symbol, lot)) {
      QueueReport(id,false,"",0,"Broker does not support exact 0.01 lot; no larger lot will be used"); return;
   }
   // Netting merges same-symbol trades, including manual ones. Never merge.
   if(AccountInfoInteger(ACCOUNT_MARGIN_MODE)!=ACCOUNT_MARGIN_MODE_RETAIL_HEDGING && PositionSelect(symbol)) {
      QueueReport(id,false,"",0,"Existing netting position; entry skipped to avoid merging trades"); return;
   }
   MqlTick tick;
   if(!SymbolInfoTick(symbol,tick) || tick.ask<=0 || tick.bid<=0) {
      QueueReport(id,false,"",0,"No live broker quote"); return;
   }
   if(market=="XAUUSD" && MaxGoldSpreadPrice > 0 && (tick.ask-tick.bid) > MaxGoldSpreadPrice) {
      QueueReport(id,false,"",0,"Gold spread "+DoubleToString(tick.ask-tick.bid,2)+" wider than "+DoubleToString(MaxGoldSpreadPrice,2)+"; entry skipped"); return;
   }
   // Multi-entry: stack same-direction trades and hedge opposite ones, up to MaxTradesPerPair.
   int mine=0; bool opposite=false; datetime newest=0;
   for(int p=PositionsTotal()-1; p>=0; p--)
      if(PositionGetTicket(p)>0 && IsOurPosition() && PositionGetString(POSITION_SYMBOL)==symbol) {
         mine++;
         bool b = PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_BUY;
         if(b != (direction=="BUY")) opposite=true;
         datetime t=(datetime)PositionGetInteger(POSITION_TIME); if(t>newest) newest=t;
      }
   if(mine >= MaxTradesPerPair) { QueueReport(id,false,"",0,"Max "+IntegerToString(MaxTradesPerPair)+" bot trades open on this pair"); return; }
   if(opposite && !AllowHedge) { QueueReport(id,false,"",0,"Hedging disabled in EA inputs"); return; }
   if(newest>0 && TimeCurrent()-newest < MinEntryGapSeconds) { QueueReport(id,false,"",0,"Entry gap: last trade under "+IntegerToString(MinEntryGapSeconds)+"s ago"); return; }
   if(!trade.SetTypeFillingBySymbol(symbol)) { QueueReport(id,false,"",0,"Unsupported filling mode"); return; }
   // Reserve before sending to avoid repeating this order after a restart.
   // An interrupted send is deliberately NOT retried automatically.
   if(GlobalVariableSet(marker,(double)TimeLocal())==0) {
      QueueReport(id,false,"",0,"Cannot save duplicate-prevention marker"); return;
   }
   GlobalVariablesFlush();
   string comment = COMMENT_PREFIX+market+" "+StringSubstr(id,0,8);
   // v15: strength = several 0.01 positions, never one big lot.
   int want = (int)MathMax(1, MathRound(lot/FIXED_LOT));
   string why = "";
   int allowed = DisciplineAllows(direction, want, why);
   if(allowed<=0) { QueueReport(id,false,"",0,why); lastStatus=why; return; }
   if(!AdaptEntry(symbol,market,direction,si,hs,allowed,why)) { QueueReport(id,false,"",0,why); lastStatus=why; return; }
   allowed = MathMin(allowed, MaxTradesPerPair-mine);
   int opened=0; ulong firstTicket=0; double firstPrice=0; string lastErr="";
   for(int k=0;k<allowed;k++) {
      bool sent = direction=="BUY"
         ? trade.Buy(FIXED_LOT,symbol,0,0,0,comment)
         : trade.Sell(FIXED_LOT,symbol,0,0,0,comment);
      uint retcode = trade.ResultRetcode();
      if(sent && (retcode==TRADE_RETCODE_DONE || retcode==TRADE_RETCODE_DONE_PARTIAL)) {
         opened++;
         ulong entryDeal=trade.ResultDeal();
         if(entryDeal>0 && HistoryDealSelect(entryDeal)) SaveEntry((ulong)HistoryDealGetInteger(entryDeal,DEAL_POSITION_ID),market,direction,si,tick.ask-tick.bid);
         if(firstTicket==0) {
            firstTicket = trade.ResultOrder();
            ulong deal = trade.ResultDeal();
            if(deal>0 && HistoryDealSelect(deal)) firstTicket=(ulong)HistoryDealGetInteger(deal,DEAL_POSITION_ID);
            firstPrice = trade.ResultPrice();
         }
      } else { lastErr = trade.ResultRetcodeDescription(); break; } // never retry a failed send
   }
   if(opened>0) {
      QueueReport(id,true,IntegerToString((long)firstTicket),firstPrice,"");
      lastStatus = direction+" "+symbol+" "+IntegerToString(opened)+" x 0.01 positions - USD 2..9 each";
   } else { CountFailure(lastErr); QueueReport(id,false,"",0,lastErr==""?"Entry failed":lastErr); lastStatus="Entry failed: "+lastErr; }
}

// ---------- Evidence-based adaptation: no daily loss stop or timed cooldown ----------
string LearnKey(string suffix) { return "AP15."+IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN))+"."+suffix; }
double GV(string n){ string k=LearnKey(n); return GlobalVariableCheck(k)?GlobalVariableGet(k):0; }
void SetLearn(string n,double v) { GlobalVariableSet(LearnKey(n),v); }
string Session(datetime t) { MqlDateTime m; TimeToStruct(t,m); int h=m.hour; return h>=12&&h<17?"NewYork":h>=7&&h<12?"London":"Asia"; }
string Context(string market,string dir,string trend) { return market+"."+Session(TimeGMT())+"."+dir+"."+trend; }
int LearningThreshold(double recentLoss,double n,double wins) {
   return (int)MathMin(85,60+5*recentLoss+((n>=10 && wins/n<0.40)?10:0));
}
int LearningPositions(int want,double recentLoss,double n,double wins) {
   return recentLoss>0 || (n>=10 && wins/n<0.40) ? 1 : want;
}
bool CandleConfirmed(bool buy,double open,double close,double previous) {
   return buy ? close>open && close>previous : close<open && close<previous;
}
double UpdatedLossPressure(double old,bool loss) { return loss ? MathMin(3,old+1) : MathMax(0,old-0.5); }
int DisciplineAllows(string dir,int want,string &why) {
   if(DailyProfitTargetUSD>0 && TodayProfit()>=DailyProfitTargetUSD) { why="Daily profit target reached"; return 0; }
   return want; // Loss amount / loss streak NEVER starts a timer or a daily entry lock.
}
double TodayProfit() {
   MqlDateTime t; TimeToStruct(TimeCurrent(),t); t.hour=0; t.min=0; t.sec=0;
   if(!HistorySelect(StructToTime(t),TimeCurrent())) return 0;
   double p=0;
   for(int i=HistoryDealsTotal()-1;i>=0;i--) {
      ulong d=HistoryDealGetTicket(i);
      if((ulong)HistoryDealGetInteger(d,DEAL_MAGIC)!=BRIDGE_MAGIC) continue;
      p+=HistoryDealGetDouble(d,DEAL_PROFIT)+HistoryDealGetDouble(d,DEAL_COMMISSION)+HistoryDealGetDouble(d,DEAL_SWAP)+HistoryDealGetDouble(d,DEAL_FEE);
   }
   return p;
}
bool AdaptEntry(string symbol,string market,string dir,int si,bool have,int &want,string &why) {
   if(!SelfLearning) return true;
   if(!have || !sigFresh[si] || GetTickCount64()-sigAt[si]>60000) { why="Learning: fresh app confirmation unavailable"; return false; }
   bool main=sigDir[si]==dir, scalp=sigScalp[si]==dir;
   int conf=main?sigConf[si]:scalp?sigScalpConf[si]:0;
   if(!main && !scalp) { why="Learning: app no longer confirms this entry direction"; return false; }
   string c=Context(market,dir,sigTrend[si]);
   double pressure=GV(c+".pressure"), n=GV(c+".n"), w=GV(c+".w");
   bool weak=n>=10 && w/n<0.40;
   if(pressure<=0 && !weak) return true;
   int need=LearningThreshold(pressure,n,w);
   want=LearningPositions(want,pressure,n,w);
   if(conf<need) { why="Adapted setup needs "+IntegerToString(need)+"% app confirmation (no cooldown)"; return false; }
   // Broker candles only validate the app's direction; never generate a new signal.
   MqlRates bars[]; ArraySetAsSeries(bars,true);
   if(CopyRates(symbol,PERIOD_M5,1,2,bars)!=2 || !CandleConfirmed(dir=="BUY",bars[0].open,bars[0].close,bars[1].close)) {
      why="Adapted setup: closed M5 candle has not confirmed app direction"; return false;
   }
   return true;
}
void SaveEntry(ulong pos,string market,string dir,int si,double spread) {
   string k="pos."+IntegerToString((long)pos);
   if(GV(k+".saved")>0) return;
   string trend=si>=0?sigTrend[si]:"unknown";
   SetLearn(k+".saved",1); SetLearn(k+".trend",trend=="bull"?1:trend=="bear"?-1:0);
   SetLearn(k+".conf",si>=0?(sigDir[si]==dir?sigConf[si]:sigScalpConf[si]):0);
   SetLearn(k+".spread",spread); SetLearn(k+".gmt",(double)TimeGMT());
   SetLearn(k+".scalp",si>=0 && sigDir[si]!=dir?1:0);
   GlobalVariablesFlush();
}
void CountFailure(string err) {
   string k = StringFind(err,"pread")>=0 ? "spread" : StringFind(err,"equote")>=0 ? "requote" : StringFind(err,"oney")>=0 ? "margin" : "other";
   SetLearn("f."+k,GV("f."+k)+1);
}
string LossEvidence(double minutes,double spread,bool against,bool flipped,double peak) {
   string r="Observed loss; cause unproven.";
   if(minutes<5) r+=" Fast loss (<5 min): possible premature entry; require closed M5 confirmation.";
   if(spread>0.5) r+=" Entry spread >0.50: execution cost may contribute; review broker costs.";
   if(against) r+=" Countertrend entry: retracement may have failed; require stronger scalp confirmation.";
   if(flipped) r+=" Cached app direction changed: possible regime shift; reassess next fresh signal.";
   if(peak>=2) r+=" Previously USD 2+ profitable: review hold/giveback behavior.";
   return r;
}
void OnTradeTransaction(const MqlTradeTransaction &tr,const MqlTradeRequest &rq,const MqlTradeResult &rs) {
   if(tr.type!=TRADE_TRANSACTION_DEAL_ADD || !HistoryDealSelect(tr.deal)) return;
   if((ulong)HistoryDealGetInteger(tr.deal,DEAL_MAGIC)!=BRIDGE_MAGIC) return;
   long entry=HistoryDealGetInteger(tr.deal,DEAL_ENTRY);
   ulong pos=(ulong)HistoryDealGetInteger(tr.deal,DEAL_POSITION_ID);
   string symbol=HistoryDealGetString(tr.deal,DEAL_SYMBOL);
   if(entry==DEAL_ENTRY_IN) {
      // Pending fills capture broker spread and last known app context at fill.
      string market=MarketOf(HistoryDealGetString(tr.deal,DEAL_COMMENT));
      if(!KnownMarket(market)) return;
      int si=SigIndex(market); string dir=HistoryDealGetInteger(tr.deal,DEAL_TYPE)==DEAL_TYPE_BUY?"BUY":"SELL";
      SaveEntry(pos,market,dir,si,SymbolInfoDouble(symbol,SYMBOL_ASK)-SymbolInfoDouble(symbol,SYMBOL_BID)); return;
   }
   if(entry!=DEAL_ENTRY_OUT && entry!=DEAL_ENTRY_OUT_BY) return;
   // Account for the whole position only after all partial fills have closed.
   for(int i=PositionsTotal()-1;i>=0;i--) if(PositionGetTicket(i)>0 && (ulong)PositionGetInteger(POSITION_IDENTIFIER)==pos) return;
   string done="done."+IntegerToString((long)pos); if(GV(done)>0) return;
   datetime closed=(datetime)HistoryDealGetInteger(tr.deal,DEAL_TIME), opened=closed;
   if(!HistorySelectByPosition(pos)) return;
   double p=0; string dir="", market="";
   for(int i=0;i<HistoryDealsTotal();i++) {
      ulong d=HistoryDealGetTicket(i);
      p+=HistoryDealGetDouble(d,DEAL_PROFIT)+HistoryDealGetDouble(d,DEAL_COMMISSION)+HistoryDealGetDouble(d,DEAL_SWAP)+HistoryDealGetDouble(d,DEAL_FEE);
      if(HistoryDealGetInteger(d,DEAL_ENTRY)==DEAL_ENTRY_IN && dir=="") {
         opened=(datetime)HistoryDealGetInteger(d,DEAL_TIME);
         dir=HistoryDealGetInteger(d,DEAL_TYPE)==DEAL_TYPE_BUY?"BUY":"SELL";
         market=MarketOf(HistoryDealGetString(d,DEAL_COMMENT));
      }
   }
   if(dir=="" || !KnownMarket(market)) return;
   SetLearn(done,1);
   string k="pos."+IntegerToString((long)pos); bool known=GV(k+".saved")>0;
   double trend=GV(k+".trend"); string trendName=trend>0?"bull":trend<0?"bear":"neutral";
   string ses=known?Session((datetime)GV(k+".gmt")):"unknown";
   string c=market+"."+ses+"."+dir+"."+trendName;
   SetLearn(c+".n",GV(c+".n")+1); if(p>0) SetLearn(c+".w",GV(c+".w")+1);
   SetLearn(c+".p",GV(c+".p")+p);
   if(p!=0) SetLearn(c+".pressure",UpdatedLossPressure(GV(c+".pressure"),p<0));
   SetLearn("trades",GV("trades")+1);
   double minutes=(closed-opened)/60.0;
   int si=SigIndex(market); bool against=(dir=="BUY" && trend<0)||(dir=="SELL" && trend>0);
   bool flipped=sigFresh[si] && GetTickCount64()-sigAt[si]<60000 && sigDir[si]!=dir && sigScalp[si]!=dir;
   string evidence=p<0?LossEvidence(minutes,GV(k+".spread"),against,flipped,GV(k+".peak")):"Winning/flat position; gradually relax this setup's loss pressure.";
   if(!known) evidence+=" Entry context missing: do not infer an exact cause.";
   int f=FileOpen("AurumPulse_journal.csv",FILE_READ|FILE_WRITE|FILE_CSV|FILE_ANSI,',');
   if(f!=INVALID_HANDLE) {
      if(FileSize(f)==0) FileWrite(f,"closed","symbol","direction","session","minutes_open","net_usd");
      FileSeek(f,0,SEEK_END); FileWrite(f,TimeToString(closed),symbol,dir,ses,DoubleToString(minutes,2),DoubleToString(p,2)); FileClose(f);
   }
   if(p<0) {
      f=FileOpen("AurumPulse_mistakes.txt",FILE_READ|FILE_WRITE|FILE_TXT|FILE_ANSI);
      if(f!=INVALID_HANDLE) {
         FileSeek(f,0,SEEK_END);
         FileWriteString(f,TimeToString(closed)+" | position "+IntegerToString((long)pos)+" | "+c+" | net "+DoubleToString(p,2)+" | entry confidence "+DoubleToString(GV(k+".conf"),0)+" | spread "+DoubleToString(GV(k+".spread"),3)+" | "+evidence+" Next matching setup: 1 x 0.01, needs "+IntegerToString(LearningThreshold(GV(c+".pressure"),GV(c+".n"),GV(c+".w")))+"% and closed M5 confirmation.\r\n"); FileClose(f);
      } else Print("Cannot save mistake log: ",GetLastError());
   }
   SetLearn("revision",GV("revision")+1);
   if(p<0) DeletePending(symbol); // Cancel pre-loss orders so they cannot bypass the new confirmation.
   GlobalVariablesFlush(); WriteRequirements(); // every closed position, not only every 20 trades
}
void WriteRequirements() {
   int f=FileOpen("My Requirements.txt",FILE_WRITE|FILE_TXT|FILE_ANSI);
   if(f==INVALID_HANDLE) { Print("Cannot write My Requirements: ",GetLastError()); return; }
   FileWriteString(f,"AurumPulse Bridge v15 - My Requirements\r\nUpdated: "+TimeToString(TimeCurrent())+"\r\n");
   FileWriteString(f,"No 5% daily loss stop. No 30-minute cooldown after three losses. Fresh valid setups may trade immediately.\r\nLearning "+(SelfLearning?"ON":"OFF")+". Losses adjust only the affected market/session/direction/trend, not every strategy.\r\n");
   FileWriteString(f,"== Evidence-based adjustments ==\r\n");
   string markets[6]={"XAUUSD","USTECm","USTEC_x100m","EURUSD","GBPUSD","USDJPY"};
   string ses[3]={"Asia","London","NewYork"}, dirs[2]={"BUY","SELL"}, trends[3]={"bull","bear","neutral"};
   for(int m=0;m<6;m++) for(int i=0;i<3;i++) for(int j=0;j<2;j++) for(int t=0;t<3;t++) {
      string c=markets[m]+"."+ses[i]+"."+dirs[j]+"."+trends[t]; double n=GV(c+".n"), w=GV(c+".w"), pressure=GV(c+".pressure");
      if(n==0) continue;
      FileWriteString(f,c+": "+DoubleToString(n,0)+" positions, win "+DoubleToString(100*w/n,1)+"%, net "+DoubleToString(GV(c+".p"),2)+". "+(pressure>0 || (n>=10 && w/n<0.40)?"ADJUST: 1 x 0.01, confidence "+IntegerToString(LearningThreshold(pressure,n,w))+"% + closed M5 candle confirmation.":"Normal app-confirmed sizing.")+"\r\n");
   }
   FileWriteString(f,"\r\n== Each recorded loss: observations, suspected mistake, next adjustment ==\r\n");
   int log=FileOpen("AurumPulse_mistakes.txt",FILE_READ|FILE_TXT|FILE_ANSI);
   if(log!=INVALID_HANDLE) { while(!FileIsEnding(log)) FileWriteString(f,FileReadString(log)+"\r\n"); FileClose(log); }
   else FileWriteString(f,"No recorded loss evidence yet.\r\n");
   FileWriteString(f,"\r\nRules unchanged: 0.01 positions; USD 2+ exit, up to USD 9 if strong; USD 3 loss per 0.01. No SL/TP.\r\nReview needs: failed retracement, premature entry, spread/execution costs and profit giveback where evidence exists. These are hypotheses, not proven causes.\r\nThe bot adjusts confirmation/exposure, not its own source code. Send this file for reviewed code updates. Losses can recur; no guaranteed profit. Removing daily loss protection increases cumulative risk.\r\n");
   FileClose(f);
}

// Include already charged entry commission/fees in the open trade target.
// Future exit charges/slippage cannot be known before the closing deal.
bool NetProfit(ulong identifier, double floating, double swap, double &net) {
   if(!HistorySelectByPosition(identifier)) return false;
   net = floating + swap;
   int count = HistoryDealsTotal();
   for(int i=0; i<count; i++) {
      ulong deal = HistoryDealGetTicket(i);
      if(deal==0) continue;
      net += HistoryDealGetDouble(deal,DEAL_COMMISSION)+HistoryDealGetDouble(deal,DEAL_FEE);
   }
   return true;
}

string MarketOf(string comment) {
   string rest = StringSubstr(comment, StringLen(COMMENT_PREFIX));
   int sp = StringFind(rest, " ");
   return sp>0 ? StringSubstr(rest,0,sp) : "";
}

bool NearWall(string symbol, bool buy, double sup, double res) {
   double px = buy ? SymbolInfoDouble(symbol,SYMBOL_BID) : SymbolInfoDouble(symbol,SYMBOL_ASK);
   if(px<=0 || sup<=0 || res<=sup) return false;
   double zone = (res-sup)*0.10;
   return buy ? res-px <= zone : px-sup <= zone;
}

string PeakName(ulong ticket) { return "AP4.peak."+IntegerToString((long)ticket); }
string holdInfo = "";

void ManagePositions() {
   if(!TradingAllowed()) return;
   holdInfo = "";
   for(int i=PositionsTotal()-1; i>=0; i--) {
      ulong ticket = PositionGetTicket(i);
      if(ticket==0 || !IsOurPosition()) continue;
      string symbol = PositionGetString(POSITION_SYMBOL);
      string market = MarketOf(PositionGetString(POSITION_COMMENT));
      bool buy = PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_BUY;
      ulong identifier = (ulong)PositionGetInteger(POSITION_IDENTIFIER);
      double net;
      if(!NetProfit(identifier,PositionGetDouble(POSITION_PROFIT),PositionGetDouble(POSITION_SWAP),net)) continue;
      string pk = PeakName(ticket);
      double peak = GlobalVariableCheck(pk) ? GlobalVariableGet(pk) : net;
      if(net > peak) { peak = net; GlobalVariableSet(pk,peak); }
      SetLearn("pos."+IntegerToString((long)identifier)+".peak",peak);
      int decision = 0, idx = -1; bool have = false;
      double plot = PositionGetDouble(POSITION_VOLUME);
      if(LossHit(net, plot) || MaxProfitHit(net, plot)) decision = 2; // hard exits: no signal check needed
      else if(TargetReached(net, plot)) {
         have = LiveSignal(market, idx);
         decision = HoldDecision(buy, market=="XAUUSD", net, peak, plot, have,
            have?sigDir[idx]:"", have?sigConf[idx]:0, have?sigTrend[idx]:"", have && sigFresh[idx]);
         // Wise exit: in profit and price reached the next resistance (BUY) / support (SELL) -> take it now.
         if(decision==1 && have && NearWall(symbol, buy, sigSup[idx], sigRes[idx])) decision = 2;
      }
      string state = LossHit(net, plot) ? "CLOSE - USD "+DoubleToString(LOSS_LIMIT_USD*LotSteps(plot),0)+" loss limit" : MaxProfitHit(net, plot) ? "CLOSE - USD "+DoubleToString(MaxProfitFor(plot),0)+" max profit"
         : decision==0 ? "waiting for USD "+DoubleToString(PROFIT_TARGET_USD*LotSteps(plot),0) : decision==1 ? "HOLD - signal strong (max USD "+DoubleToString(MaxProfitFor(plot),0)+")" : "CLOSE - USD 2+ profit";
      holdInfo += "\n"+symbol+(buy?" BUY":" SELL")+" "+DoubleToString(plot,2)+" | P/L "+DoubleToString(net,2)+" | peak "+DoubleToString(peak,2)
         +" | "+state+(have?" | live "+sigDir[idx]+" "+IntegerToString(sigConf[idx])+"%":"");
      if(decision!=2) continue;
      if(!trade.SetTypeFillingBySymbol(symbol)) continue;
      bool sent = trade.PositionClose(ticket);
      if(sent && trade.ResultRetcode()==TRADE_RETCODE_DONE) {
         GlobalVariableDel(pk);
         lastStatus="Closed "+symbol+" at USD "+DoubleToString(net,2)+" - waiting for next signal";
      } else lastStatus="Close pending/failed: "+trade.ResultRetcodeDescription();
   }
}

void CloseProfitable() { ManagePositions(); }

void Poll() {
   if(!TradingAllowed()) { lastStatus="Enable Algo Trading"; return; }
   int code;
   string response = Http("GET","/api/public/mt5/poll?v=2","",code);
   if(code==401) { lastStatus="Key rejected - generate a new key in app"; return; }
   if(code!=200) { if(code>0) lastStatus="App error "+IntegerToString(code); return; }
   StringTrimLeft(response); StringTrimRight(response);
   if(response=="NONE") return;
   string fields[];
   int count = StringSplit(response,'|',fields);
   // Uses the app lot (0.01-0.03); ignores SL, TP1 and TP2 (always 0 / 0).
   if(count==7 || count==4) Execute(fields[0],fields[1],fields[2],StringToDouble(fields[3]));
   else lastStatus="Unexpected app response";
}

int OnInit() {
   // USD cent accounts (USC) are NOT USD accounts. Refuse rather than
   // silently interpreting one cent or another currency as one dollar.
   if(AccountInfoString(ACCOUNT_CURRENCY)!="USD") {
      Alert("AurumPulse v15 requires a USD account for its USD 2 target / USD 3 loss limit. Account currency: ",AccountInfoString(ACCOUNT_CURRENCY));
      return INIT_PARAMETERS_INCORRECT;
   }
   if(StringLen(ConnectKey)!=51 || StringSubstr(ConnectKey,0,3)!="ap_") {
      Alert("Paste your connect key from AurumPulse > Connect MT5 into Inputs.");
      return INIT_PARAMETERS_INCORRECT;
   }
   baseUrl = AppUrl;
   StringTrimLeft(baseUrl); StringTrimRight(baseUrl);
   while(StringLen(baseUrl)>0 && StringSubstr(baseUrl,StringLen(baseUrl)-1)=="/") baseUrl=StringSubstr(baseUrl,0,StringLen(baseUrl)-1);
   if(StringFind(baseUrl,"https://")!=0) { Alert("Use the HTTPS app address."); return INIT_PARAMETERS_INCORRECT; }
   trade.SetExpertMagicNumber(BRIDGE_MAGIC);
   trade.SetDeviationInPoints(50);
   trade.SetAsyncMode(false);
   if(!EventSetTimer(1)) return INIT_FAILED;
   WriteRequirements();
   lastStatus="Connected - waiting for a new app order";
   return INIT_SUCCEEDED;
}

// ---- Pending orders at support / resistance (XAUUSD) ----
bool IsOurOrder() {
   return (ulong)OrderGetInteger(ORDER_MAGIC)==BRIDGE_MAGIC && StringFind(OrderGetString(ORDER_COMMENT),COMMENT_PREFIX)==0;
}
void DeletePending(string symbol) {
   for(int i=OrdersTotal()-1;i>=0;i--) {
      ulong t=OrderGetTicket(i);
      if(t>0 && IsOurOrder() && OrderGetString(ORDER_SYMBOL)==symbol) trade.OrderDelete(t);
   }
}
bool PlacePending(string symbol, ENUM_ORDER_TYPE type, double lot, double price, double limit, string tag) {
   int digits=(int)SymbolInfoInteger(symbol,SYMBOL_DIGITS);
   double pt=SymbolInfoDouble(symbol,SYMBOL_POINT);
   double minDist=(SymbolInfoInteger(symbol,SYMBOL_TRADE_STOPS_LEVEL)+5)*pt;
   double bid=SymbolInfoDouble(symbol,SYMBOL_BID), ask=SymbolInfoDouble(symbol,SYMBOL_ASK);
   price=NormalizeDouble(price,digits); limit=NormalizeDouble(limit,digits);
   bool below = type==ORDER_TYPE_BUY_LIMIT || type==ORDER_TYPE_SELL_STOP || type==ORDER_TYPE_SELL_STOP_LIMIT;
   if(below ? price > bid-minDist : price < ask+minDist) return false; // level too close or wrong side
   datetime exp = TimeCurrent()+PendingRefreshMinutes*60+60;
   return trade.OrderOpen(symbol,type,lot,limit,price,0,0,ORDER_TIME_SPECIFIED,exp,COMMENT_PREFIX+"XAUUSD "+tag);
}
string pendInfo = "";
void ManagePending() {
   if(!UsePendingOrders || !TradingAllowed()) return;
   static ulong lastRun=0; static string lastDir=""; static double lastRevision=-1;
   int idx=-1; bool have=LiveSignal("XAUUSD",idx);
   string dir = have && sigFresh[idx] ? sigDir[idx] : "";
   ulong now=GetTickCount64();
   double revision=GV("revision");
   if(lastRun!=0 && dir==lastDir && revision==lastRevision && now-lastRun < (ulong)MathMax(1,PendingRefreshMinutes)*60000) return;
   string symbol=Resolve("XAUUSD"); if(symbol=="") return;
   DeletePending(symbol); lastRun=now; lastDir=dir; lastRevision=revision; pendInfo="";
   if(dir!="BUY" && dir!="SELL") { pendInfo="\nPending: none (signal WAIT)"; return; }
   double sup=sigSup[idx], res=sigRes[idx];
   if(sup<=0 || res<=sup) return;
   int allowed=3; string why="";
   if(DisciplineAllows(dir,allowed,why)<=0 || !AdaptEntry(symbol,"XAUUSD",dir,idx,have,allowed,why)) { lastRun=0; pendInfo="\nPending: "+why; return; }
   double gap=(res-sup)*0.10, lot=FIXED_LOT; // pending orders: one 0.01 position each
   if(!ExactLotAllowed(symbol,lot)) lot=FIXED_LOT;
   int n=0;
   if(dir=="BUY") {
      if(n<allowed && PlacePending(symbol,ORDER_TYPE_BUY_LIMIT,lot,sup+gap*0.2,0,"BuyLimit")) n++;            // buy the dip at support
      if(n<allowed && PlacePending(symbol,ORDER_TYPE_BUY_STOP,lot,res+gap,0,"BuyStop")) n++;                 // breakout above resistance
      if(n<allowed && PlacePending(symbol,ORDER_TYPE_BUY_STOP_LIMIT,lot,res+gap,res+gap*0.3,"BuyStopLim")) n++; // breakout then retest
   } else {
      if(n<allowed && PlacePending(symbol,ORDER_TYPE_SELL_LIMIT,lot,res-gap*0.2,0,"SellLimit")) n++;         // sell the rally at resistance
      if(n<allowed && PlacePending(symbol,ORDER_TYPE_SELL_STOP,lot,sup-gap,0,"SellStop")) n++;               // breakdown below support
      if(n<allowed && PlacePending(symbol,ORDER_TYPE_SELL_STOP_LIMIT,lot,sup-gap,sup-gap*0.3,"SellStopLim")) n++; // breakdown then retest
   }
   pendInfo="\nPending "+dir+": "+IntegerToString(n)+" orders "+DoubleToString(lot,2)+" lot | S "+DoubleToString(sup,2)+" R "+DoubleToString(res,2);
}

void OnDeinit(const int reason) { WriteRequirements(); EventKillTimer(); Comment(""); }
void OnTick() { CloseProfitable(); }
void OnTimer() {
   CloseProfitable();
   // Never reenter just because a trade closed. Only a new app order enters.
   static ulong lastPoll = 0;
   ulong now = GetTickCount64();
   if(now-lastPoll >= (ulong)MathMax(1,PollSeconds)*1000) {
      lastPoll=now;
      FlushReport();
      CloseProfitable();
      Poll();
      static datetime lastReq=0; if(TimeCurrent()-lastReq>=86400 || lastReq==0) { if(lastReq!=0) WriteRequirements(); lastReq=TimeCurrent(); }
      ManagePending();
      CloseProfitable();
   }
   Comment("AurumPulse Bridge v15 Pro - 0.01 multi-positions + self-learning\nStatus: ",lastStatus,
      "\nPositions per USD 500 (each 0.01): 1 / 2 (75%+) / 3 (85%+) / 5 (90%+) | SL/TP none | today P/L "+DoubleToString(TodayProfit(),2)+" | learning "+(SelfLearning?"on":"off"),
      "\nREMINDER: each position closes USD 2+, holds to USD 9 if signal strong, closes at USD 3 loss | report: MQL5/Files/My Requirements.txt | max "+IntegerToString(MaxTradesPerPair)+" trades/pair, hedge "+(AllowHedge?"on":"off")+"",
      "\nAuto Trade ON in app = XAUUSD live signals enter | OFF = Take entry now only",
      holdInfo, pendInfo,
      "\nLoss limit USD 3 per 0.01 lot (0.02=6, 0.05=15). Keep MT5 online. Allow WebRequest: ",baseUrl);
}
