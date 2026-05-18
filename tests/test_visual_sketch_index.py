from __future__ import annotations

import shutil
import unittest
import uuid
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw

from scripts.visual_sketch_index import compute_features, extract_image_file, find_style


def sample_sketch_bytes() -> bytes:
    image = Image.new("RGB", (220, 220), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((70, 35, 150, 180), outline="black", width=3)
    draw.line((70, 70, 35, 115), fill="black", width=3)
    draw.line((150, 70, 185, 115), fill="black", width=3)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


class VisualSketchIndexTests(unittest.TestCase):
    def test_find_style_from_path_text(self) -> None:
        self.assertEqual(find_style("TP/271730054 sketch.png"), "271730054")

    def test_compute_features_returns_normalized_vector(self) -> None:
        features = compute_features(sample_sketch_bytes())
        self.assertIsNotNone(features)
        assert features is not None
        self.assertGreater(features.ink_density, 0)
        self.assertGreater(len(features.vector), 100)

    def test_extract_image_file_keeps_style_context(self) -> None:
        temp_root = Path.cwd() / ".test_tmp"
        temp_root.mkdir(exist_ok=True)
        root = temp_root / f"visual_{uuid.uuid4().hex}"
        root.mkdir()
        try:
            path = root / "Talbots" / "271730054 sketch.png"
            path.parent.mkdir()
            path.write_bytes(sample_sketch_bytes())
            records = extract_image_file(path, root)
        finally:
            shutil.rmtree(root, ignore_errors=True)
        self.assertEqual(records[0].style_no, "271730054")
        self.assertEqual(records[0].source, "image_file")


if __name__ == "__main__":
    unittest.main()
