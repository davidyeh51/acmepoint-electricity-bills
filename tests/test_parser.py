import json,unittest
from pathlib import Path
from bill_system.parser import parse_bill_text
class ParserRegressionTests(unittest.TestCase):
    def test_real_layout_regressions(self):
        fixtures=json.loads((Path(__file__).parent/'bill-fixtures.json').read_text('utf-8'))
        for fixture in fixtures:
            with self.subTest(fixture=fixture['name']):
                data=parse_bill_text(fixture['text'],fixture.get('filename','test.pdf'))
                for key,value in fixture['expected'].items():
                    self.assertEqual(data.get(key),value,(key,data.get('parse_warnings')))
if __name__=='__main__':unittest.main()
