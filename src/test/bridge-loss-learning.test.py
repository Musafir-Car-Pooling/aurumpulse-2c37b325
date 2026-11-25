"""Execute the delivered EA's portable rules; full MetaEditor compilation is separate."""
import pathlib
import re
import subprocess
import tempfile
import unittest

SOURCE = pathlib.Path(__file__).resolve().parents[1] / 'mt5/AurumPulse_Bridge_EA_v20.mq5'


class LossLearningRules(unittest.TestCase):
    def run_discipline(self, assertions):
        source = SOURCE.read_text()
        start = source.index('int DisciplineAllows(')
        end = source.index('\n}', start) + 2
        program = '#include <cassert>\n#include <string>\nusing string=std::string;\ndouble DailyProfitTargetUSD=0;\ndouble TodayProfit(){return -1000;}\n'
        program += source[start:end] + '\nint main(){string why;' + assertions + '}\n'
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder)
            (path / 'discipline.cpp').write_text(program)
            subprocess.run(['g++', str(path / 'discipline.cpp'), '-o', str(path / 'discipline')], check=True)
            subprocess.run([str(path / 'discipline')], check=True)

    def test_five_percent_daily_loss_does_not_stop_entries(self):
        self.run_discipline('assert(DisciplineAllows("BUY",5,why)==5);')

    def test_three_losses_do_not_start_thirty_minute_cooldown(self):
        self.run_discipline('for(int losses=1;losses<=3;losses++) assert(DisciplineAllows("SELL",5,why)==5);')

    def test_learning_adjustments_and_loss_evidence(self):
        source = SOURCE.read_text()
        names = ['LearningThreshold', 'LearningPositions', 'CandleConfirmed',
                 'UpdatedLossPressure', 'DisciplineAllows', 'LossEvidence']
        rules = []
        for name in names:
            match = re.search(r'(?:int|double|bool|string) ' + name + r'\([^\n]+', source)
            self.assertIsNotNone(match, name)
            if match is None:
                return
            start = source.index('{', match.start())
            depth = 1
            end = start + 1
            while depth and end < len(source):
                if source[end] == '{':
                    depth += 1
                elif source[end] == '}':
                    depth -= 1
                end += 1
            rules.append(source[match.start():end])
        program = r'''
#include <algorithm>
#include <cassert>
#include <string>
using string = std::string;
#define MathMin std::min<double>
#define MathMax std::max<double>
double DailyProfitTargetUSD=0;
double TodayProfit() { return -1000; } // >5% loss on a $500 account
''' + '\n'.join(rules) + r'''
int main() {
  string why;
  assert(DisciplineAllows("BUY",5,why)==5); // daily loss does not lock entries
  double pressure=0;
  for(int losses=0;losses<3;losses++) pressure=UpdatedLossPressure(pressure,true);
  assert(pressure==3);
  assert(DisciplineAllows("SELL",5,why)==5); // no timer after 3 losses
  assert(LearningPositions(5,pressure,3,0)==1); // reduce exposure, do not stop
  assert(LearningThreshold(pressure,3,0)==75);
  assert(LearningThreshold(1,1,0)==65); // adapts after the very first loss
  assert(LearningThreshold(3,10,3)==85); // poor sample strengthens confirmation
  assert(LearningPositions(5,0,10,3)==1);
  assert(LearningPositions(5,0,10,8)==5); // unrelated/recovered setup stays normal
  assert(UpdatedLossPressure(3,false)==2.5); // gradual recovery on wins
  assert(UpdatedLossPressure(0,false)==0);
  assert(CandleConfirmed(true,100,102,101));
  assert(!CandleConfirmed(true,100,99,101));
  assert(CandleConfirmed(false,102,100,101));
  assert(!CandleConfirmed(false,100,102,101));
  assert(!CandleConfirmed(true,100,100,99)); // doji is not confirmation
  auto evidence=LossEvidence(2,0.8,true,true,2.4);
  assert(evidence.find("cause unproven")!=string::npos);
  assert(evidence.find("premature entry")!=string::npos);
  assert(evidence.find("Entry spread >0.50")!=string::npos);
  assert(evidence.find("retracement may have failed")!=string::npos);
  assert(evidence.find("possible regime shift")!=string::npos);
  assert(evidence.find("review hold/giveback")!=string::npos);
  auto ordinary=LossEvidence(20,0.2,false,false,1);
  assert(ordinary.find("premature entry")==string::npos);
  assert(ordinary.find("Entry spread")==string::npos);
}
'''
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder)
            (path / 'rules.cpp').write_text(program)
            subprocess.run(['g++', '-std=c++17', str(path / 'rules.cpp'), '-o', str(path / 'rules')], check=True)
            subprocess.run([str(path / 'rules')], check=True)


if __name__ == '__main__':
    unittest.main()