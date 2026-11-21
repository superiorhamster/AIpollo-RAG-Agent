"""Verify timeout configuration against the installed Docling version."""

import unittest
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import patch

from docling.datamodel.base_models import ConversionStatus, InputFormat

from app.conversion import converter, parse_pdf
from rag_runtime import RuntimeBudgets
from rag_http import ApiError


class ParserDeadline(unittest.TestCase):
    def test_docling_recognizes_the_document_deadline(self):
        options = converter.format_to_options[InputFormat.PDF].pipeline_options
        self.assertEqual(options.document_timeout, RuntimeBudgets.from_env().parse)

    def test_partial_conversion_is_not_published_as_a_complete_source(self):
        with patch.object(converter, "convert", return_value=SimpleNamespace(status=ConversionStatus.PARTIAL_SUCCESS, has_timeout_errors=lambda: False)):
            with self.assertRaises(ApiError) as caught:
                parse_pdf(BytesIO(b"%PDF-synthetic"))
        self.assertEqual(caught.exception.status_code, 422)
        self.assertEqual(caught.exception.detail["code"], "parse_failed")



class SentenceGeometry(unittest.TestCase):
    def test_keeps_pdf_bytes_when_docling_closes_stream(self):
        from io import BytesIO
        from unittest.mock import MagicMock, patch
        from app import conversion
        from rag_index import IndexedChunk

        data = b"synthetic input"
        result = MagicMock(status=conversion.ConversionStatus.SUCCESS)
        result.has_timeout_errors.return_value = False

        def convert(stream, **kwargs):
            stream.stream.close()
            return result

        pdf = MagicMock()
        with patch.dict("os.environ", {"INDEX_SENTENCE_CITATIONS": "true"}), \
                patch.object(conversion.converter, "convert", side_effect=convert), \
                patch.object(conversion.pypdfium2, "PdfDocument", return_value=pdf) as open_pdf, \
                patch.object(conversion, "blocks", return_value=[IndexedChunk(page=1, text="A.")]):
            conversion.parse_pdf(BytesIO(data))
        open_pdf.assert_called_once_with(data)

    def test_fragments_preserve_legacy_split_and_page_fallback(self):
        from app.chunking import normalized, passage_spans, passages
        from app.segment_geometry import fragment_segments, sentence_spans

        raw = "Version 2.1 is ready.\n\n" + ("one word " * 190) + "ends here. Last sentence."
        text = normalized(raw)
        parts = list(passage_spans(text))
        self.assertEqual([text[a:b] for a, b in parts], list(passages(raw)))
        sentences = list(sentence_spans(text))
        self.assertEqual(text[sentences[0][0]:sentences[0][1]], "Version 2.1 is ready.")
        self.assertEqual(len(sentences), 3)
        spans = [fragment_segments(text, sentences, a, b, 1, None, {}, 1) for a, b in parts]
        self.assertTrue(all(spans))
        self.assertEqual(sum(seg.partial for block in spans for seg in block), 2)
        self.assertTrue(all(seg.precision == "page" and not seg.rects for block in spans for seg in block))

if __name__ == "__main__":
    unittest.main()
