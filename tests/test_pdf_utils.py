from __future__ import annotations

import base64
import unittest
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory

from pypdf import PdfReader, PdfWriter

from opencrab_starter.pdf_utils import pdf_reader_source


class PdfUtilsTests(unittest.TestCase):
    @staticmethod
    def sample_pdf() -> bytes:
        output = BytesIO()
        writer = PdfWriter()
        writer.add_blank_page(width=100, height=100)
        writer.write(output)
        return output.getvalue()

    def test_regular_pdf_uses_original_path(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "sample.pdf"
            path.write_bytes(self.sample_pdf())

            source = pdf_reader_source(path)

        self.assertEqual(source, str(path))

    def test_base64_pdf_is_decoded_for_reader(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "encoded.pdf"
            path.write_bytes(base64.b64encode(self.sample_pdf()))

            reader = PdfReader(pdf_reader_source(path))

        self.assertEqual(len(reader.pages), 1)


if __name__ == "__main__":
    unittest.main()
