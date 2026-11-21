"""Execute the portable numeric rules from the delivered MQL5 source.

This does not replace compiling the full EA in MetaEditor or a broker demo test.
Run: python3 src/test/bridge-ea-rules.test.py
"""
import pathlib
import re
import subprocess
import tempfile
import unittest

SOURCE = pathlib.Path(__file__).resolve().parents[1] / 'mt5/AurumPulse_Bridge_EA_v19.mq5'


class BridgeRules(unittest.TestCase):
    def test_selected_auto_market_gate(self):
        source = SOURCE.read_text()
        rule = re.search(r'bool SelectedAutoMarket\([^}]+\}', source)
        self.assertIsNotNone(rule)
        if rule is None:
            return
        known = re.search(r'bool KnownMarket\([^}]+\}', source)
        self.assertIsNotNone(known)
        if known is None:
            return
        program = '#include <cassert>\n#include <string>\nusing string=std::string;\nint StringFind(string a,string b){auto n=a.find(b);return n==string::npos?-1:(int)n;}\n'
        program += rule.group() + '\n' + known.group() + '''
int main(){
 assert(SelectedAutoMarket(true,"EURUSD","EURUSD,USDCHF"));
 assert(SelectedAutoMarket(true,"USDCHF","EURUSD,USDCHF"));
 assert(!SelectedAutoMarket(true,"XAUUSD","EURUSD,USDCHF"));
 assert(!SelectedAutoMarket(false,"EURUSD","EURUSD,USDCHF"));
 assert(!SelectedAutoMarket(true,"USD","EURUSD,USDCHF"));
 assert(KnownMarket("XAUUSD") && KnownMarket("EURUSD") && KnownMarket("GBPUSD") && KnownMarket("USDJPY") && KnownMarket("USDCHF"));
 assert(KnownMarket("BTCUSD"));
 assert(SelectedAutoMarket(true,"BTCUSD","EURUSD,BTCUSD"));
 assert(!SelectedAutoMarket(false,"BTCUSD","BTCUSD"));
 assert(!SelectedAutoMarket(true,"BTCUSD","XAUUSD"));
 assert(!KnownMarket("USTECm") && !KnownMarket("USTEC_x100m"));
}
'''
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder)
            (path / 'selection.cpp').write_text(program)
            subprocess.run(['g++', str(path / 'selection.cpp'), '-o', str(path / 'selection')], check=True)
            subprocess.run([str(path / 'selection')], check=True)

    def test_fixed_lot_and_two_usd_exit(self):
        source = SOURCE.read_text()
        constants = '\n'.join(re.findall(
            r'const double (?:FIXED_LOT|MAX_LOT|PROFIT_TARGET_USD|LOSS_LIMIT_USD) = [^;]+;', source))
        lot_rule = re.search(r'double LotForConfidence\([^\n]+', source).group() + '\n' + re.search(r'bool LotAllowed\([^}]+\}', source).group()
        target_rule = re.search(r'double LotSteps\([^}]+\}', source).group() + '\n' + re.search(r'bool TargetReached\([^}]+\}', source).group()
        loss_rule = re.search(r'bool LossHit\([^}]+\}', source).group()
        buy = re.search(r'trade\.Buy\([^;]+?\)', source).group()
        sell = re.search(r'trade\.Sell\([^;]+?\)', source).group()
        program = '''#include <cmath>
#include <cassert>
#define MathAbs std::abs
#define MathRound std::round
#define MathMax std::fmax
''' + constants + '\n' + lot_rule + '\n' + target_rule + '\n' + loss_rule + '''
struct Trade {
  bool Buy(double lot,const char*,double,double sl,double tp,const char*) {
    assert(lot>=0.01 && lot<=0.05); assert(sl==0); assert(tp==0); return true;
  }
  bool Sell(double lot,const char* s,double p,double sl,double tp,const char* c) {
    return Buy(lot,s,p,sl,tp,c);
  }
};
int main() {
  Trade trade;
  const char* symbol="XAUUSDm"; const char* comment="AP3 test"; double lot=0.02;
''' + buy + ';\n' + sell + ';\n' + '''
  assert(FIXED_LOT == 0.01);
  assert(LotAllowed(0.01,0.01,100,0.01));
  assert(!LotAllowed(0.01,0.1,100,0.1));
  assert(!LotAllowed(0.01,0.01,100,0.02));
  assert(!LotAllowed(0.01,0.01,100,0));
  assert(LotForConfidence(70)==0.01); assert(LotForConfidence(75)==0.02); assert(LotForConfidence(85)==0.03);
  assert(!TargetReached(-10,0.01));
  assert(!TargetReached(1.99,0.01));
  assert(TargetReached(2.00,0.01));
  assert(TargetReached(2.01,0.01)); assert(!TargetReached(1.00,0.01));
  assert(LOSS_LIMIT_USD == 3.00);
  assert(LossHit(-3.00,0.01));
  assert(LossHit(-3.01,0.01));
  assert(LossHit(-10,0.01));
  assert(!LossHit(-2.99,0.01));
  assert(!LossHit(0,0.01));
  assert(LossHit(-6,0.02)); assert(!LossHit(-5.9,0.02)); assert(LossHit(-15,0.05)); assert(TargetReached(4,0.02)); assert(!TargetReached(3.9,0.02));
}
'''
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder)
            (path / 'rules.cpp').write_text(program)
            subprocess.run(['g++', str(path / 'rules.cpp'), '-o', str(path / 'rules')], check=True)
            subprocess.run([str(path / 'rules')], check=True)


if __name__ == '__main__':
    unittest.main()
def test_resolves_any_suffix_symbol():
    s = SOURCE.read_text()
    assert 'SymbolsTotal(false)' in s and 'StringFind(up, want)' in s

def test_gold_spread_limit_in_price_not_points():
    s = SOURCE.read_text()
    assert 'MaxGoldSpreadPrice = 0.45' in s and 'SYMBOL_POINT) > MaxGoldSpread' not in s

def test_v9_max_profit_and_hedge():
    s = SOURCE.read_text()
    assert 'MAX_PROFIT_USD = 9.00' in s and 'MaxProfitHit(net, plot)' in s and 'LossHit(net, plot)' in s and 'AllowHedge' in s

def test_v12_pending_orders_and_lot_scaling():
    s = SOURCE.read_text()
    for t in ['ORDER_TYPE_BUY_LIMIT','ORDER_TYPE_SELL_LIMIT','ORDER_TYPE_BUY_STOP,','ORDER_TYPE_SELL_STOP,','ORDER_TYPE_BUY_STOP_LIMIT','ORDER_TYPE_SELL_STOP_LIMIT']:
        assert t in s
    assert 'BalancePerStep = 500' in s and 'MaxLotPerStep = 0.05' in s and 'MaxProfitFor(' in s

def test_v14_multi_positions_and_self_learning():
    s = SOURCE.read_text()
    assert 'trade.Buy(FIXED_LOT,symbol' in s and 'trade.Sell(FIXED_LOT,symbol' in s
    assert 'MathRound(lot/FIXED_LOT)' in s
    assert '"My Requirements.txt"' in s and 'AurumPulse_journal.csv' in s
    assert 'UpdatedLossPressure' in s and 'AurumPulse_mistakes.txt' in s and 'w/n<0.40' in s

def test_v17_sessions_and_pullback():
    s = SOURCE.read_text()
    assert 'signal?v=3' in s and 'sigSession[si]=="rollover"' in s and 'sigKind[si]=="pullback"' in s
