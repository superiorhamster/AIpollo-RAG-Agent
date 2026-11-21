"""Verify timeout configuration against the installed Docling version."""

import unittest
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import patch

from docling.datamodel.base_models import ConversionStatus, InputFormat

from app.main import converter, parse_pdf
from rag_http import ApiError


class ParserDeadline(unittest.TestCase):
    def test_docling_recognizes_the_document_deadline(self):
        options = converter.format_to_options[InputFormat.PDF].pipeline_options
        self.assertEqual(options.document_timeout, 110)

    def test_partial_conversion_is_not_published_as_a_complete_source(self):
        with patch.object(converter, "convert", return_value=SimpleNamespace(status=ConversionStatus.PARTIAL_SUCCESS)):
            with self.assertRaises(ApiError) as caught:
                parse_pdf(BytesIO(b"%PDF-synthetic"))
        self.assertEqual(caught.exception.status_code, 422)
        self.assertEqual(caught.exception.detail["code"], "parse_failed")


if __name__ == "__main__":
    unittest.main()
