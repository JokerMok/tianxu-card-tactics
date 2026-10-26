#!/usr/bin/env python3
"""Build a bounded chapter-one atlas batch without modifying source assets.

The batch descriptor owns identity and sizing decisions.  This module owns only
repeatable sheet extraction, atlas registration, and common-frame trimming.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import io
import json
import math
import os
from collections import deque
from pathlib import Path
from statistics import median
from typing import Any, Iterable

from PIL import Image, ImageChops, ImageFilter


ROOT = Path(__file__).resolve().parents[2]
ACTIONS = ("stand", "walk", "atk", "hit", "die")
PROFILE_BASE = {
    "ground": (256, (128, 220), 42),
    "mounted": (320, (160, 280), 84),
    "flying": (256, (128, 220), 42),
    "wisp": (256, (128, 220), 42),
}


class BatchError(ValueError):
    """A source or descriptor violates the deliberately narrow batch contract."""


def _json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise BatchError(f"expected a JSON object: {path}")
    return value


def _path(value: str, *, base: Path = ROOT) -> Path:
    path = Path(value)
    return path.resolve() if path.is_absolute() else (base / path).resolve()


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _component_box(component: Iterable[int], width: int) -> tuple[int, int, int, int]:
    points = list(component)
    xs = [point % width for point in points]
    ys = [point // width for point in points]
    return min(xs), min(ys), max(xs) + 1, max(ys) + 1


def alpha_components(image: Image.Image, threshold: int = 40) -> list[list[int]]:
    """Return four-connected alpha components as flattened pixel indices."""
    width, height = image.size
    mask = bytearray(
        image.getchannel("A").point(lambda value: 255 if value > threshold else 0).tobytes()
    )
    components: list[list[int]] = []
    for seed in range(width * height):
        if not mask[seed]:
            continue
        mask[seed] = 0
        queue = deque([seed])
        component: list[int] = []
        while queue:
            point = queue.popleft()
            component.append(point)
            x = point % width
            neighbours = (point - width, point + width)
            if x:
                neighbours += (point - 1,)
            if x + 1 < width:
                neighbours += (point + 1,)
            for neighbour in neighbours:
                if 0 <= neighbour < width * height and mask[neighbour]:
                    mask[neighbour] = 0
                    queue.append(neighbour)
        components.append(component)
    return components


def _box_distance(left: tuple[int, int, int, int], right: tuple[int, int, int, int]) -> int:
    dx = max(left[0] - right[2], right[0] - left[2], 0)
    dy = max(left[1] - right[3], right[1] - left[3], 0)
    return dx * dx + dy * dy


def extract_pose_components(
    image: Image.Image,
    *,
    min_part_pixels: int = 500,
    min_body_pixels: int = 2500,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Find exactly 30 bodies and attach only smaller eligible components.

    A touching pair is one body and a detached large weapon is an extra body;
    both intentionally fail the count instead of being cut heuristically.
    """
    if min_part_pixels <= 0 or min_body_pixels <= min_part_pixels:
        raise BatchError("minBodyPixels must be greater than minPartPixels > 0")
    width, _ = image.size
    all_components = alpha_components(image)
    bodies = [component for component in all_components if len(component) >= min_body_pixels]
    parts = [
        component
        for component in all_components
        if min_part_pixels <= len(component) < min_body_pixels
    ]
    ignored = [component for component in all_components if len(component) < min_part_pixels]
    if len(bodies) != 30:
        raise BatchError(
            "expected 30 separate body silhouettes; "
            f"found {len(bodies)} at minBodyPixels={min_body_pixels} "
            "(missing/touching poses or a detached part above the threshold)"
        )
    records = [
        {
            "body": body,
            "pixels": list(body),
            "bodyBox": _component_box(body, width),
            "attachedParts": 0,
        }
        for body in bodies
    ]
    for part in parts:
        part_box = _component_box(part, width)
        target = min(records, key=lambda record: _box_distance(part_box, record["bodyBox"]))
        target["pixels"].extend(part)
        target["attachedParts"] += 1
    for record in records:
        record["poseBox"] = _component_box(record["pixels"], width)
    return records, {
        "components": len(all_components),
        "bodies": len(bodies),
        "attachedParts": len(parts),
        "ignoredParts": len(ignored),
        "ignoredPixels": sum(map(len, ignored)),
    }


def _ordered_rows(
    records: list[dict[str, Any]], source_width: int, source_height: int
) -> list[list[dict[str, Any]]]:
    # Detached ground shadows participate in the foot line, while body centres
    # remain the safer signal for source-column ordering.
    records = sorted(records, key=lambda record: record["poseBox"][3])
    rows: list[list[dict[str, Any]]] = []
    for row_index in range(5):
        row = sorted(
            records[row_index * 6 : (row_index + 1) * 6],
            key=lambda record: (record["bodyBox"][0] + record["bodyBox"][2]) / 2,
        )
        if len(row) != 6:
            raise BatchError(f"row {row_index} does not contain six poses")
        # Each ordered body must belong to its source column.  This catches a
        # merged/missing pose that happens to leave the global count at 30.
        for column, record in enumerate(row):
            centre = (record["bodyBox"][0] + record["bodyBox"][2]) / 2
            expected_left = column * source_width / 6
            expected_right = (column + 1) * source_width / 6
            if not expected_left <= centre < expected_right:
                nominal_rows = [0, 0, 0, 0, 0]
                for candidate in records:
                    box = candidate["bodyBox"]
                    centre_y = (box[1] + box[3]) / 2
                    nominal_rows[min(4, int(centre_y * 5 / source_height))] += 1
                raise BatchError(
                    f"pose grid is not 5x6: row {row_index} pose {column} has centre "
                    f"{centre:.1f} outside column bounds [{expected_left:.1f}, "
                    f"{expected_right:.1f}); bodyBox={record['bodyBox']}; "
                    f"poseBox={record['poseBox']}; nominalRowCounts={nominal_rows}. "
                    "Repair touching/missing source poses or adjust a justified body threshold; "
                    "the packer will not split at a grid boundary"
                )
        rows.append(row)
    return rows


def _selected_piece(image: Image.Image, pixels: list[int]) -> tuple[Image.Image, tuple[int, int, int, int]]:
    width, height = image.size
    mask = bytearray(width * height)
    for point in pixels:
        mask[point] = 255
    # One pixel recovers low-alpha antialiasing around the >40 topology mask.
    selection = Image.frombytes("L", image.size, bytes(mask)).filter(ImageFilter.MaxFilter(3))
    selection = ImageChops.multiply(selection, image.getchannel("A"))
    bounds = selection.getbbox()
    if bounds is None:
        raise BatchError("selected pose unexpectedly has no alpha")
    isolated = image.copy()
    isolated.putalpha(selection)
    return isolated.crop(bounds), bounds


def build_model_atlas(source: Image.Image, model: dict[str, Any]) -> tuple[Image.Image, dict[str, Any], dict[str, Any]]:
    """Extract a 6x5 source sheet into a registered, untrimmed atlas."""
    source = source.convert("RGBA")
    profile = model.get("profile", "ground")
    if profile not in PROFILE_BASE:
        raise BatchError(f"unsupported profile {profile!r}")
    display_height = float(model["displayHeight"])
    body_height = float(model["bodyHeight"])
    cue_seconds = float(model.get("cueSeconds", 0.375))
    if min(display_height, body_height, cue_seconds) <= 0:
        raise BatchError("displayHeight, bodyHeight, and cueSeconds must be positive")
    min_part = int(model.get("minPartPixels", 500))
    min_body = int(model.get("minBodyPixels", 2500))
    records, component_metrics = extract_pose_components(
        source, min_part_pixels=min_part, min_body_pixels=min_body
    )
    source_width, source_height = source.size
    rows = _ordered_rows(records, source_width, source_height)
    standing_height = median(
        record["bodyBox"][3] - record["bodyBox"][1] for record in rows[0]
    )
    canonical_frame, canonical_foot, mount_offset = PROFILE_BASE[profile]
    target_body_pixels = canonical_frame * body_height / display_height
    scale = target_body_pixels / standing_height
    row_grounds = [
        median(_component_box(record["pixels"], source_width)[3] for record in row)
        for row in rows
    ]

    prepared: list[dict[str, Any]] = []
    for row_index, row in enumerate(rows):
        for column, record in enumerate(row):
            piece, bounds = _selected_piece(source, record["pixels"])
            size = (
                max(1, round(piece.width * scale)),
                max(1, round(piece.height * scale)),
            )
            piece = piece.resize(size, Image.Resampling.LANCZOS)
            source_anchor = ((column + 0.5) * source_width / 6, row_grounds[row_index])
            offset = (
                round((bounds[0] - source_anchor[0]) * scale),
                round((bounds[1] - source_anchor[1]) * scale),
            )
            prepared.append(
                {
                    "row": row_index,
                    "column": column,
                    "piece": piece,
                    "bounds": bounds,
                    "sourceAnchor": source_anchor,
                    "offset": offset,
                    "attachedParts": record["attachedParts"],
                }
            )

    padding = 4
    min_x = min(canonical_foot[0] + item["offset"][0] for item in prepared)
    min_y = min(canonical_foot[1] + item["offset"][1] for item in prepared)
    shift_x = max(0, padding - min_x)
    shift_y = max(0, padding - min_y)
    foot = (canonical_foot[0] + shift_x, canonical_foot[1] + shift_y)
    max_x = max(foot[0] + item["offset"][0] + item["piece"].width for item in prepared)
    max_y = max(foot[1] + item["offset"][1] + item["piece"].height for item in prepared)
    frame = max(canonical_frame, math.ceil(max_x + padding), math.ceil(max_y + padding))
    atlas = Image.new("RGBA", (frame * 6, frame * 5))
    frame_records: list[dict[str, Any]] = []
    for item in prepared:
        x = foot[0] + item["offset"][0]
        y = foot[1] + item["offset"][1]
        if x < 0 or y < 0 or x + item["piece"].width > frame or y + item["piece"].height > frame:
            raise BatchError(f"internal frame sizing error for {model['key']} pose")
        atlas.alpha_composite(item["piece"], (item["column"] * frame + x, item["row"] * frame + y))
        frame_records.append(
            {
                "action": ACTIONS[item["row"]],
                "frame": item["row"] * 6 + item["column"],
                "sourceAnchor": list(item["sourceAnchor"]),
                "alphaBounds": list(item["bounds"]),
                "runtimePosition": [x, y],
                "attachedParts": item["attachedParts"],
            }
        )
    display_size = display_height * frame / canonical_frame
    mount = (foot[0], foot[1] - mount_offset)
    spec = {
        "atlas": "",
        "frameSize": [frame, frame],
        "columns": 6,
        "frameCount": 30,
        "displaySize": [display_size, display_size],
        "foot": list(foot),
        "mount": list(mount),
        "origin": [0, -32],
        "nameOffsetY": model["nameOffsetY"],
        "clips": {
            "stand": {"start": 0, "count": 6, "fps": 8, "loop": True},
            "walk": {
                "start": 6,
                "count": 6,
                "fps": 16.666666666666668 if profile == "mounted" else 13.333333333333334,
                "loop": True,
            },
            "atk": {
                "start": 12,
                "count": 6,
                "fps": 3 / cue_seconds,
                "cueFrame": 3,
                "loop": False,
            },
            "hit": {"start": 18, "count": 6, "fps": 20, "loop": False},
            "die": {"start": 24, "count": 6, "fps": 7.5, "loop": False},
        },
    }
    registration = {
        "sourceSize": list(source.size),
        "componentMetrics": component_metrics,
        "thresholds": {"alpha": 40, "minPartPixels": min_part, "minBodyPixels": min_body},
        "standingBodyMedianPixels": standing_height,
        "targetBodyPixels": target_body_pixels,
        "scale": scale,
        "canonicalFrame": canonical_frame,
        "intermediateFrame": frame,
        "rowGrounds": row_grounds,
        "intermediateFixedAnchors": {
            "foot": list(foot),
            "mount": list(mount),
            "origin": [0, -32],
        },
        "frames": frame_records,
    }
    return atlas, spec, registration


def common_crop_atlas(
    atlas: Image.Image,
    frame_size: tuple[int, int],
    columns: int,
    frame_count: int,
    *,
    padding: int = 2,
) -> tuple[Image.Image, tuple[int, int, int, int]]:
    """Crop every frame by one common alpha rectangle.

    Empty frames remain empty.  A wholly empty atlas uses a deterministic 1x1
    crop so callers can still account for and register it.
    """
    atlas = atlas.convert("RGBA")
    frame_width, frame_height = map(int, frame_size)
    if frame_width <= 0 or frame_height <= 0 or columns <= 0 or frame_count <= 0:
        raise BatchError("frame dimensions, columns, and frameCount must be positive")
    rows = math.ceil(frame_count / columns)
    if atlas.width < columns * frame_width or atlas.height < rows * frame_height:
        raise BatchError(
            f"atlas {atlas.size} is smaller than its {columns}x{rows} frame grid {frame_size}"
        )
    union: tuple[int, int, int, int] | None = None
    frames: list[Image.Image] = []
    for index in range(frame_count):
        column, row = index % columns, index // columns
        frame = atlas.crop(
            (
                column * frame_width,
                row * frame_height,
                (column + 1) * frame_width,
                (row + 1) * frame_height,
            )
        )
        frames.append(frame)
        bounds = frame.getchannel("A").getbbox()
        if bounds is not None:
            union = bounds if union is None else (
                min(union[0], bounds[0]),
                min(union[1], bounds[1]),
                max(union[2], bounds[2]),
                max(union[3], bounds[3]),
            )
    if union is None:
        crop = (0, 0, 1, 1)
    else:
        crop = (
            max(0, union[0] - padding),
            max(0, union[1] - padding),
            min(frame_width, union[2] + padding),
            min(frame_height, union[3] + padding),
        )
    crop_width, crop_height = crop[2] - crop[0], crop[3] - crop[1]
    output = Image.new("RGBA", (crop_width * columns, crop_height * rows))
    for index, frame in enumerate(frames):
        output.paste(frame.crop(crop), ((index % columns) * crop_width, (index // columns) * crop_height))
    return output, crop


def apply_common_crop(spec: dict[str, Any], crop: tuple[int, int, int, int]) -> dict[str, Any]:
    """Adjust geometry so trimming preserves every pixel's world transform."""
    result = copy.deepcopy(spec)
    old_width, old_height = result["frameSize"]
    crop_width, crop_height = crop[2] - crop[0], crop[3] - crop[1]
    result["frameSize"] = [crop_width, crop_height]
    result["displaySize"] = [
        result["displaySize"][0] * crop_width / old_width,
        result["displaySize"][1] * crop_height / old_height,
    ]
    result["foot"] = [result["foot"][0] - crop[0], result["foot"][1] - crop[1]]
    if "mount" in result:
        result["mount"] = [result["mount"][0] - crop[0], result["mount"][1] - crop[1]]
    return result


def _png_bytes(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def _safe_stem(value: str) -> str:
    stem = Path(value).stem
    cleaned = "".join(character if character.isalnum() or character in "-_" else "-" for character in stem)
    return cleaned.strip("-") or "atlas"


def _validate_descriptor(batch: dict[str, Any]) -> None:
    required = ("sourceDir", "outputDir", "baseManifest", "id", "models", "existingModels")
    missing = [key for key in required if key not in batch]
    if missing:
        raise BatchError(f"batch descriptor missing: {', '.join(missing)}")
    if not isinstance(batch["models"], list) or not isinstance(batch["existingModels"], list):
        raise BatchError("models and existingModels must be arrays")
    seen_keys: set[str] = set()
    seen_monsters: set[int] = set()
    for model in batch["models"]:
        for key in ("key", "modelId", "monsterId", "source", "displayHeight", "bodyHeight", "nameOffsetY", "profile"):
            if key not in model:
                raise BatchError(f"new model missing {key}")
        if model["key"] in seen_keys or int(model["monsterId"]) in seen_monsters:
            raise BatchError("new model keys and monsterIds must be unique")
        seen_keys.add(model["key"])
        seen_monsters.add(int(model["monsterId"]))


def produce(batch_path: Path, *, root: Path = ROOT) -> dict[str, Any]:
    batch_path = batch_path.resolve()
    batch = _json(batch_path)
    _validate_descriptor(batch)
    use_webp = batch.get('format', 'png') == 'webp-lossless'
    if batch.get('format', 'png') not in ('png', 'webp-lossless'):
        raise BatchError('format must be png or webp-lossless')
    source_dir = _path(batch["sourceDir"], base=root)
    output_dir = _path(batch["outputDir"], base=root)
    base_manifest_path = _path(batch["baseManifest"], base=root)
    base_dir = base_manifest_path.parent
    manifest = copy.deepcopy(_json(base_manifest_path))
    manifest["id"] = batch["id"]
    # UI resources stay immutable; paths are made correct relative to the new manifest.
    for image_spec in manifest.get("images", {}).values():
        resolved = (base_dir / image_spec["file"]).resolve()
        if not resolved.is_file():
            raise BatchError(f"inherited image is missing: {resolved}")
        image_spec["file"] = Path(os.path.relpath(resolved, output_dir)).as_posix()

    sources: dict[str, dict[str, Any]] = {}
    unit_sources: dict[str, str] = {}
    for unit_key, spec in manifest["units"].items():
        resolved = (base_dir / spec["atlas"]).resolve()
        source_key = f"file:{resolved}"
        sources.setdefault(
            source_key,
            {"image": Image.open(resolved).convert("RGBA"), "path": resolved, "stem": resolved.stem},
        )
        unit_sources[unit_key] = source_key

    registration: dict[str, Any] = {
        "id": batch["id"],
        "baseManifest": batch["baseManifest"],
        "models": {},
        "atlases": {},
        "retouches": {},
    }

    for retouch in batch.get("retouches", []):
        unit_key = f"main:monster:{int(retouch['monsterId'])}"
        if unit_key not in manifest["units"]:
            raise BatchError(f"retouch target is absent from base manifest: {unit_key}")
        path = (source_dir / retouch["atlas"]).resolve()
        data = path.read_bytes()
        source_key = f"retouch:{unit_key}:{_sha256(data)}"
        sources[source_key] = {
            "image": Image.open(io.BytesIO(data)).convert("RGBA"),
            "path": path,
            "stem": retouch.get("key", path.stem),
        }
        original_key = unit_sources[unit_key]
        # Explicit aliases of this exact inherited atlas share its material
        # revision too. Do not keep a second texture for the same source model.
        for alias in unit_sources:
            if unit_sources[alias] == original_key:
                unit_sources[alias] = source_key
        registration["retouches"][unit_key] = {"source": retouch["atlas"], "sourceSha256": _sha256(data)}

    for model in batch["models"]:
        unit_key = f"main:monster:{int(model['monsterId'])}"
        if unit_key in manifest["units"]:
            raise BatchError(f"new identity would overwrite an inherited unit: {unit_key}")
        source_path = (source_dir / model["source"]).resolve()
        source_data = source_path.read_bytes()
        source_image = Image.open(io.BytesIO(source_data)).convert("RGBA")
        try:
            atlas, spec, model_registration = build_model_atlas(source_image, model)
        except BatchError as error:
            raise BatchError(
                f"model {model['key']!r} from {model['source']!r}: {error}"
            ) from error
        source_key = f"generated:{model['key']}:{_sha256(source_data)}"
        sources[source_key] = {"image": atlas, "path": source_path, "stem": model["key"]}
        manifest["units"][unit_key] = spec
        unit_sources[unit_key] = source_key
        model_registration.update(
            {
                "modelId": model["modelId"],
                "monsterId": int(model["monsterId"]),
                "source": model["source"],
                "sourceSha256": _sha256(source_data),
            }
        )
        registration["models"][model["key"]] = model_registration

    # One source atlas can serve aliases.  All aliases must describe the same grid.
    grouped_units: dict[str, list[str]] = {}
    for unit_key, source_key in unit_sources.items():
        grouped_units.setdefault(source_key, []).append(unit_key)

    costs: dict[str, Any] = {"id": batch["id"], "atlases": {}, "totals": {}}
    total_png = total_download = total_rgba = total_source_rgba = 0
    # Reaching this point proves that every new source model can be extracted.
    # Create output storage only after that validation has succeeded.
    output_dir.mkdir(parents=True, exist_ok=True)
    for source_key, unit_keys in grouped_units.items():
        reference = manifest["units"][unit_keys[0]]
        geometry = (tuple(reference["frameSize"]), int(reference["columns"]), int(reference["frameCount"]))
        for unit_key in unit_keys[1:]:
            spec = manifest["units"][unit_key]
            candidate = (tuple(spec["frameSize"]), int(spec["columns"]), int(spec["frameCount"]))
            if candidate != geometry:
                raise BatchError(f"shared atlas has conflicting frame geometry: {unit_keys}")
        source_record = sources[source_key]
        image = source_record["image"]
        cropped, crop = common_crop_atlas(image, *geometry)
        png_reference = _png_bytes(cropped)
        png = png_reference
        if use_webp:
            buffer = io.BytesIO()
            cropped.save(buffer, format='WEBP', lossless=True, method=6, exact=True)
            png = buffer.getvalue()
            decoded = Image.open(io.BytesIO(png)).convert('RGBA')
            if ImageChops.difference(cropped.getchannel('A'), decoded.getchannel('A')).getbbox():
                raise BatchError('lossless WebP changed alpha')
            diff = ImageChops.difference(cropped.convert('RGB'), decoded.convert('RGB'))
            visible = cropped.getchannel('A').point(lambda v: 255 if v else 0).convert('RGB')
            if ImageChops.multiply(diff, visible).getbbox():
                raise BatchError('lossless WebP changed visible RGB')
        digest = _sha256(png)
        filename = f"{_safe_stem(source_record['stem'])}-{digest[:12]}.{'webp' if use_webp else 'png'}"
        output_path = output_dir / filename
        if output_path.exists():
            if output_path.read_bytes() != png:
                raise BatchError(f"hash-named output collision: {output_path}")
        else:
            output_path.write_bytes(png)
        for unit_key in unit_keys:
            updated = apply_common_crop(manifest["units"][unit_key], crop)
            updated["atlas"] = filename
            manifest["units"][unit_key] = updated
        source_rgba = image.width * image.height * 4
        output_rgba = cropped.width * cropped.height * 4
        atlas_record = {
            "file": filename,
            "sha256": digest,
            "source": Path(os.path.relpath(source_record["path"], root)).as_posix(),
            "sourceSha256": _sha256(source_record["path"].read_bytes()),
            "units": unit_keys,
            "sourceAtlasSize": list(image.size),
            "outputAtlasSize": list(cropped.size),
            "sourceFrameSize": list(geometry[0]),
            "trimRect": list(crop),
            "outputFrameSize": [crop[2] - crop[0], crop[3] - crop[1]],
            "fixedAnchors": {
                unit_key: {
                    "foot": manifest["units"][unit_key]["foot"],
                    "mount": manifest["units"][unit_key].get("mount"),
                    "origin": manifest["units"][unit_key].get("origin"),
                }
                for unit_key in unit_keys
            },
            "metrics": {
                "pngBytes": len(png_reference),
                "downloadBytes": len(png),
                "encoding": 'webp-lossless' if use_webp else 'png',
                "visiblePixelsExact": True,
                "sourceEstimatedRgbaBytes": source_rgba,
                "estimatedRgbaBytes": output_rgba,
                "rgbaReductionBytes": source_rgba - output_rgba,
                "rgbaReductionRatio": 1 - output_rgba / source_rgba,
            },
        }
        registration["atlases"][filename] = atlas_record
        for model_key, model_record in registration["models"].items():
            model_unit = f"main:monster:{model_record['monsterId']}"
            if model_unit in unit_keys:
                model_record["trimRect"] = list(crop)
                model_record["fixedAnchors"] = atlas_record["fixedAnchors"][model_unit]
                model_record["metrics"] = atlas_record["metrics"]
        costs["atlases"][filename] = atlas_record["metrics"]
        total_png += len(png_reference)
        total_download += len(png)
        total_rgba += output_rgba
        total_source_rgba += source_rgba

    model_map: dict[str, str] = {}
    for item in [*batch["existingModels"], *batch["models"]]:
        model_key = f"main:{item['modelId']}"
        unit_key = f"main:monster:{int(item['monsterId'])}"
        if unit_key not in manifest["units"]:
            raise BatchError(f"model mapping references absent unit: {unit_key}")
        if model_key in model_map and model_map[model_key] != unit_key:
            raise BatchError(f"model maps to multiple monsters: {model_key}")
        model_map[model_key] = unit_key
    manifest["models"] = model_map
    costs["totals"] = {
        "uniqueAtlases": len(grouped_units),
        "pngBytes": total_png,
        "downloadBytes": total_download,
        "sourceEstimatedRgbaBytes": total_source_rgba,
        "estimatedRgbaBytes": total_rgba,
        "rgbaReductionBytes": total_source_rgba - total_rgba,
        "rgbaReductionRatio": 1 - total_rgba / total_source_rgba,
    }

    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (source_dir / "registration.json").write_text(
        json.dumps(registration, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (source_dir / "costs.json").write_text(
        json.dumps(costs, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return {
        "manifest": str(output_dir / "manifest.json"),
        "registration": str(source_dir / "registration.json"),
        "costs": str(source_dir / "costs.json"),
        "units": len(manifest["units"]),
        "models": len(model_map),
        "atlases": len(grouped_units),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batch", required=True, type=Path, help="chapter-one batch descriptor JSON")
    arguments = parser.parse_args()
    print(json.dumps(produce(arguments.batch), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
