#!/usr/bin/env python3
"""Focused tests for common-frame atlas trimming."""

from __future__ import annotations

import importlib.util
import math
import unittest
from pathlib import Path

from PIL import Image


MODULE_PATH = Path(__file__).with_name("produce-batch.py")
SPEC = importlib.util.spec_from_file_location("produce_batch", MODULE_PATH)
assert SPEC and SPEC.loader
produce_batch = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(produce_batch)


def world_position(pixel: tuple[int, int], spec: dict) -> tuple[float, float]:
    return (
        (pixel[0] - spec["foot"][0]) * spec["displaySize"][0] / spec["frameSize"][0],
        (pixel[1] - spec["foot"][1]) * spec["displaySize"][1] / spec["frameSize"][1],
    )


class CommonCropTests(unittest.TestCase):
    def test_sparse_frames_preserve_pixel_world_transform_and_reduce_rgba(self) -> None:
        atlas = Image.new("RGBA", (20, 8))
        atlas.putpixel((3, 2), (255, 10, 20, 255))
        atlas.putpixel((10 + 7, 5), (5, 240, 30, 128))
        original = {
            "frameSize": [10, 8],
            "displaySize": [100, 64],
            "foot": [5, 7],
            "mount": [5, 3],
        }
        cropped, rect = produce_batch.common_crop_atlas(atlas, (10, 8), 2, 2, padding=1)
        adjusted = produce_batch.apply_common_crop(original, rect)

        self.assertEqual(rect, (2, 1, 9, 7))
        self.assertEqual(cropped.size, (14, 6))
        self.assertLess(cropped.width * cropped.height * 4, atlas.width * atlas.height * 4)
        for pixel in ((3, 2), (7, 5), (5, 7)):
            before = world_position(pixel, original)
            after = world_position((pixel[0] - rect[0], pixel[1] - rect[1]), adjusted)
            self.assertTrue(math.isclose(before[0], after[0]))
            self.assertTrue(math.isclose(before[1], after[1]))
        self.assertEqual(adjusted["foot"], [3, 6])
        self.assertEqual(adjusted["mount"], [3, 2])

    def test_transparent_frame_remains_supported_in_mixed_atlas(self) -> None:
        atlas = Image.new("RGBA", (12, 4))
        atlas.putpixel((1, 1), (255, 255, 255, 255))
        atlas.putpixel((8 + 2, 2), (255, 255, 255, 255))
        cropped, rect = produce_batch.common_crop_atlas(atlas, (4, 4), 3, 3, padding=0)
        width = rect[2] - rect[0]
        middle = cropped.crop((width, 0, width * 2, cropped.height))
        self.assertIsNone(middle.getchannel("A").getbbox())

    def test_wholly_transparent_atlas_has_deterministic_minimum_crop(self) -> None:
        atlas = Image.new("RGBA", (15, 12))
        cropped, rect = produce_batch.common_crop_atlas(atlas, (5, 6), 3, 6)
        self.assertEqual(rect, (0, 0, 1, 1))
        self.assertEqual(cropped.size, (3, 2))
        self.assertIsNone(cropped.getchannel("A").getbbox())


if __name__ == "__main__":
    unittest.main()
