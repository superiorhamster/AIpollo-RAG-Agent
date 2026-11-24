import unittest
from formula_quality import evaluate


class FormulaGate(unittest.TestCase):
    def test_lost_indices_units_coordinates_and_unreviewed_corpus_stay_disabled(self):
        manifest={'version':1,'reviewed_by':'reviewer','cases':[{'id':'test','family':'index','page':2,'formula':'aᵢ = x²','units':['m²']} ]}
        good={'page':2,'text':'aᵢ = x²; units m²','region':[.1,.2,.5,.3]}
        self.assertTrue(evaluate(manifest,[good])['inspector_enabled'])
        for changed in [{**good,'text':'ai = x2; units m2'},{**good,'text':'aᵢ = x²'},
                        {**good,'region':None},{**good,'region':[.5,.2,.1,.3]},{**good,'page':1}]:
            self.assertFalse(evaluate(manifest,[changed])['inspector_enabled'])
        self.assertFalse(evaluate({**manifest,'reviewed_by':None},[good])['inspector_enabled'])


if __name__=='__main__':unittest.main()
