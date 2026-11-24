"""Personal annotation validation uses finite, bounded, allowlisted data."""
import unittest
from pydantic import ValidationError
from app.annotations import AnnotationInput

class AnnotationValidation(unittest.TestCase):
    def test_legacy_and_multiline(self):
        self.assertEqual(AnnotationInput(page=1,body=" note ").body,"note")
        value=AnnotationInput(page=2,regions=[(.1,.1,.5,.2),(.2,.3,.8,.4)])
        self.assertEqual(value.region,(.1,.1,.8,.4))

    def test_rejects_invalid_geometry_and_empty_content(self):
        for value in ({"page":0,"body":"note"},{"page":1,"body":" "},
                      {"page":1,"region":[.8,0,.2,1]},
                      {"page":1,"region":[0,0,float("inf"),1]},
                      {"page":1,"region":[0,0,1,1],"regions":[[0,0,1,1]]*129}):
            with self.subTest(value=str(value)[:50]), self.assertRaises(ValidationError):
                AnnotationInput.model_validate(value)

    def test_engine_snapshot_is_versioned_and_allowlisted(self):
        snapshot={"version":1,"subtype":"square","rect":{"x":0,"y":20,"width":30,"height":40}}
        self.assertEqual(AnnotationInput(page=1,region=(0,0,.1,.1),embedpdf=snapshot).embedpdf.version,1)
        for patch in ({"version":2},{"subtype":"stamp"},{"actions":{"JavaScript":"untrusted"}},
                      {"subtype":"highlight"},{"opacity":float("nan")},
                      {"rect":{"x":-1,"y":0,"width":2,"height":2}}):
            with self.subTest(patch=patch), self.assertRaises(ValidationError):
                AnnotationInput(page=1,region=(0,0,.1,.1),embedpdf={**snapshot,**patch})

if __name__=="__main__":
    unittest.main(verbosity=2)
