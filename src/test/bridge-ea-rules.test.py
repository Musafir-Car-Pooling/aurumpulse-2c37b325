"""Execute the portable numeric rules from the delivered MQL5 source.

This does not replace compiling the full EA in MetaEditor or a broker demo test.
Run: python3 src/test/bridge-ea-rules.test.py
"""
import pathlib
import re
import subprocess
import tempfile
import unittest

SOURCE = pathlib.Path('/mnt/documents/AurumPulse_Bridge_EA_v10.mq5')


class BridgeRules(unittest.TestCase):
    def test_fixed_lot_and_two_usd_exit(self):
        source = SOURCE.read_text()
        constants = '\n'.join(re.findall(
            r'const double (?:FIXED_LOT|MAX_LOT|PROFIT_TARGET_USD|LOSS_LIMIT_USD) = [^;]+;', source))
        lot_rule = re.search(r'double LotForConfidence\([^\n]+', source).group() + '\n' + re.search(r'bool LotAllowed\([^}]+\}', source).group()
        target_rule = re.search(r'bool TargetReached\([^}]+\}', source).group()
        loss_rule = re.search(r'bool LossHit\([^}]+\}', source).group()
        buy = re.search(r'trade\.Buy\([^;]+?\)', source).group()
        sell = re.search(r'trade\.Sell\([^;]+?\)', source).group()
        program = '''#include <cmath>
#include <cassert>
#define MathAbs std::abs
#define MathRound std::round
''' + constants + '\n' + lot_rule + '\n' + target_rule + '\n' + loss_rule + '''
struct Trade {
  bool Buy(double lot,const char*,double,double sl,double tp,const char*) {
    assert(lot>=0.01 && lot<=0.03); assert(sl==0); assert(tp==0); return true;
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
  assert(!TargetReached(-10));
  assert(!TargetReached(1.99));
  assert(TargetReached(2.00));
  assert(TargetReached(2.01)); assert(!TargetReached(1.00));
  assert(LOSS_LIMIT_USD == 3.00);
  assert(LossHit(-3.00));
  assert(LossHit(-3.01));
  assert(LossHit(-10));
  assert(!LossHit(-2.99));
  assert(!LossHit(0));
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
    assert 'MaxGoldSpreadPrice = 1.00' in s and 'SYMBOL_POINT) > MaxGoldSpread' not in s

def test_v9_max_profit_and_hedge():
    s = SOURCE.read_text()
    assert 'MAX_PROFIT_USD = 9.00' in s and 'MaxProfitHit(net)' in s and 'AllowHedge' in s
