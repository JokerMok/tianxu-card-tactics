#!/usr/bin/env python3
"""Import the verified original UI subset without modifying the source archive.

The output is deliberately local/ignored.  FairyGUI XML is copied as structured
data, while only referenced raster files and already-converted legacy bitmaps are
copied into the Cocos resources tree.  No SWF is decoded by this script.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import xml.etree.ElementTree as ET
from collections import defaultdict, deque
from pathlib import Path
from typing import Any

MANIFEST = "5254333315581813739"
DEFAULT_ROOTS = (
    "Home/HomeWnd",
    "Login/LoginWnd",
    "Login/CreateActorWnd",
    "Login/ServerListWnd",
    # Source-owned advanced growth windows.  These are mounted directly by
    # AdvancedGrowthWindows instead of being approximated with generic tiles.
    "MagicJar/MagicJarWnd",
    "PassPort/PassPortWnd",
    "Pet/PetWnd",
    "Town/TownSelectModelWnd",
)
LEGACY_PREFIXES = (
    "analysis-copy/decompiled-main/scripts/com/strongwind/ui/GamePackageUI/PackageUI/",
    "analysis-copy/decompiled-main/scripts/com/strongwind/ui/GamePackageUI/CardEditUI/",
    "analysis-copy/decompiled-main/scripts/com/strongwind/ui/smithy/",
    "analysis-copy/decompiled-main/scripts/com/strongwind/ui/result/",
    "analysis-copy/decompiled-main/scripts/com/strongwind/ui/map/",
    "analysis-copy/decompiled-main/scripts/com/strongwind/ui/pathpoint/",
    "analysis-copy/decompiled-main/scripts/com/strongwind/ui/battle/",
    "analysis-copy/decompiled-main/scripts/com/strongwind/ui/SystemSetWnd.as",
    "analysis-copy/decompiled-main/scripts/com/strongwind/ui/custom/NMiniPopWnd.as",
    "analysis-copy/decompiled-main/scripts/com/strongwind/ui/CItemViewBox.as",
    "analysis-copy/decompiled-main/scripts/com/strongwind/ui/item/ItemPane.as",
    "analysis-copy/decompiled-main/scripts/com/strongwind/ui/card/",
    "analysis-copy/decompiled-main/scripts/com/strongwind/ui/mail/",
    "analysis-copy/decompiled-main/scripts/com/strongwind/ui/task/",
    "analysis-copy/decompiled-main/scripts/com/strongwind/ui/friends/",
    # Room list cells and player-seat controls live beside the room package,
    # not under ui/room/.  Scan the exact source-owned directories so their
    # pvppve symbols are included in the generated skin catalog.
    "analysis-copy/decompiled-main/scripts/com/strongwind/ui/GamePackageUI/RoomListPane.as",
    "analysis-copy/decompiled-main/scripts/com/strongwind/ui/GamePackageUI/PvERoomInfoListCell.as",
    "analysis-copy/decompiled-main/scripts/com/strongwind/ui/GamePackageUI/PvPRoomInfoListCell.as",
    "analysis-copy/decompiled-main/scripts/com/strongwind/ui/GamePackageUI/RoomUI/",
    "analysis-copy/decompiled-main/scripts/com/strongwind/ui/GamePackageUI/UserInfoUI/",
    "analysis-copy/decompiled-main/scripts/com/strongwind/ui/room/",
    # RankListCell owns the selected-row skin literal.  Keep it explicit even
    # though the broader ranking directory is scanned below.
    "analysis-copy/decompiled-main/scripts/com/strongwind/ui/ranking/RankListCell.as",
    "analysis-copy/decompiled-main/scripts/com/strongwind/ui/ranking/",
    "analysis-copy/decompiled-main/scripts/com/strongwind/ui/zone/",
    "analysis-copy/decompiled-main/scripts/com/strongwind/ui/shop/TradeCityWnd.as",
    "analysis-copy/decompiled-main/scripts/com/strongwind/ui/MagicCardShopPackage/",
    "analysis-copy/decompiled-main/scripts/com/strongwind/ui/SuperShop/",
    "analysis-copy/decompiled-main/scripts/com/strongwind/ui/reputation/",
    "analysis-copy/decompiled-main/scripts/com/strongwind/ui/activities/",
    "analysis-copy/decompiled-main/scripts/com/strongwind/ui/timedActivity/",
    "analysis-copy/decompiled-main/scripts/com/strongwind/ui/summonWorld/",
    "analysis-copy/decompiled-main/scripts/com/strongwind/ui/town/",
    "analysis-copy/decompiled-main/scripts/com/strongwind/ui/forbiddenLand/",
    "analysis-copy/decompiled-main/scripts/com/strongwind/ui/DaTingJieMian/TrialShopWnd.as",
    "analysis-copy/decompiled-main/scripts/com/strongwind/ui/holdonPort/",
    "analysis-copy/decompiled-main/scripts/com/strongwind/ui/cityWar/",
    "analysis-copy/decompiled-main/scripts/com/strongwind/ui/jingjisai/",
)
LEGACY_ENTRY_NAMES = {"PackageWnd", "CardEditWnd", "SmithyWnd", "BattleResultWnd",
                      "PVEResultCountWnd", "PVPResultCountWnd", "WorldWarResultWnd",
                      "WorldMapWnd", "SencePane", "PathPointPane"}

# The SWF world maps expose their landmark buttons as nested shapes rather than
# named converted bitmaps.  These exact character IDs are read from the parsed
# worldmap/worldmap2 timelines; copying their already-verified raster payloads
# preserves the original map art without evaluating ActionScript or SWF code.
EXPLICIT_LEGACY_ASSETS = {
    # BtnFactory type 1 appends `_1`; NButtonWithShiftOffset presses by scaling
    # that same bitmap.  `_2` is retained for callers which explicitly request
    # the alternate source state.
    "ajda_1": ("game/data/img/ui/ui_step1.swf", 168),
    "ajda_2": ("game/data/img/ui/ui_0.swf", 87),
    "worldmap-background-1": ("game/data/maps/worldmap.swf", 1),
    "worldmap-region-1": ("game/data/maps/worldmap.swf", 21),
    "worldmap-region-2": ("game/data/maps/worldmap.swf", 15),
    "worldmap-region-3": ("game/data/maps/worldmap.swf", 9),
    "worldmap-region-4": ("game/data/maps/worldmap.swf", 3),
    "worldmap-region-5": ("game/data/maps/worldmap.swf", 27),
    "worldmap-region-6": ("game/data/maps/worldmap.swf", 33),
    "worldmap-region-7": ("game/data/maps/worldmap.swf", 39),
    "worldmap-region-8": ("game/data/maps/worldmap.swf", 45),
    "worldmap-region-9": ("game/data/maps/worldmap.swf", 57),
    "worldmap-region-10": ("game/data/maps/worldmap.swf", 51),
    "worldmap-background-2": ("game/data/maps/worldmap2.swf", 11),
    "worldmap-region-11": ("game/data/maps/worldmap2.swf", 38),
    "worldmap-region-12": ("game/data/maps/worldmap2.swf", 44),
    "worldmap-region-13": ("game/data/maps/worldmap2.swf", 56),
    "worldmap-region-14": ("game/data/maps/worldmap2.swf", 50),
    "worldmap-region-15": ("game/data/maps/worldmap2.swf", 31),
    "worldmap-region-16": ("game/data/maps/worldmap2.swf", 25),
    "worldmap-region-17": ("game/data/maps/worldmap2.swf", 19),
    "worldmap-region-18": ("game/data/maps/worldmap2.swf", 13),
    "worldmap-region-19": ("game/data/maps/worldmap2.swf", 4),
    "scene-trigger-go": ("game/data/img/ui/ui_step1.swf", 748),
    "scene-trigger-blue": ("game/data/img/ui/ui_step1.swf", 783),
    "scene-trigger-red": ("game/data/img/ui/ui_step1.swf", 800),
    # TradeCityWnd loads kapaishangcheng.swf and registers the composite
    # `tradecitywnd` control.  Its converted full-screen raster is the named
    # 1200x600 zhengpingbeijing timeline character.
    "tradecitywnd": ("game/data/img/ui/kapaishangcheng.swf", 12),
}


def pair(value: str | None) -> list[float] | None:
    if not value:
        return None
    try:
        return [float(part) for part in value.split(",", 1)]
    except ValueError:
        return None


def source_ref(path: Path, source: Path) -> str:
    return path.relative_to(source).as_posix()


def safe_name(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", value)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def slim_element(element: ET.Element) -> dict[str, Any]:
    result: dict[str, Any] = {"kind": element.tag, "attributes": dict(element.attrib)}
    if element.get("id") is not None:
        result["id"] = element.get("id")
    if element.get("name") is not None:
        result["name"] = element.get("name")
    if pair(element.get("xy")) is not None:
        result["xy"] = pair(element.get("xy"))
    if pair(element.get("size")) is not None:
        result["size"] = pair(element.get("size"))
    children = [slim_element(child) for child in element]
    if children:
        result["children"] = children
    return result


def parse_packages(fui_root: Path) -> tuple[dict[str, dict[str, Any]], dict[str, str]]:
    packages: dict[str, dict[str, Any]] = {}
    by_name: dict[str, str] = {}
    for package_file in sorted(fui_root.glob("*/package.xml")):
        root = ET.parse(package_file).getroot()
        package_id = root.get("id", "")
        package_name = root.get("name", package_file.parent.name)
        resources: dict[str, Any] = {}
        aliases: dict[str, str] = {}
        resources_root = root.find("resources")
        if resources_root is None:
            continue
        for item in resources_root:
            resource = dict(item.attrib)
            resource["kind"] = item.tag
            resource["source"] = source_ref(package_file, fui_root.parent.parent)
            resources[resource["id"]] = resource
            aliases[resource.get("name", resource["id"])] = resource["id"]
        packages[package_id] = {
            "id": package_id, "name": package_name, "directory": package_file.parent,
            "source": source_ref(package_file, fui_root.parent.parent),
            "attributes": dict(root.attrib), "resources": resources, "aliases": aliases,
        }
        by_name[package_name] = package_id
    return packages, by_name


def parse_ui_uri(uri: str) -> tuple[str, str] | None:
    match = re.fullmatch(r"ui://([a-zA-Z0-9]{8})(.+)", uri)
    return (match.group(1), match.group(2)) if match else None


def import_fairygui(source: Path, output: Path, roots: tuple[str, ...]) -> dict[str, Any]:
    fui_root = source / "analysis-copy/fui"
    packages, by_name = parse_packages(fui_root)
    queue: deque[tuple[str, str]] = deque()
    root_keys: list[str] = []
    for root in roots:
        package_name, alias = root.split("/", 1)
        package_id = by_name.get(package_name)
        if not package_id:
            raise SystemExit(f"Unknown FairyGUI package: {package_name}")
        resource_id = packages[package_id]["aliases"].get(alias, alias)
        queue.append((package_id, resource_id))
        root_keys.append(f"{package_id}:{resource_id}")

    components: dict[str, Any] = {}
    images: dict[str, Any] = {}
    missing: list[dict[str, str]] = []
    visited: set[str] = set()

    def enqueue(package_id: str, resource_id: str, owner: str) -> None:
        package = packages.get(package_id)
        resource = package and package["resources"].get(resource_id)
        if not resource:
            missing.append({"owner": owner, "packageId": package_id, "resourceId": resource_id})
            return
        key = f"{package_id}:{resource_id}"
        if resource["kind"] == "component":
            queue.append((package_id, resource_id))
        elif resource["kind"] in {"image", "atlas"} and key not in images:
            filename = resource.get("file")
            if not filename:
                missing.append({"owner": owner, "packageId": package_id, "resourceId": resource_id})
                return
            src = package["directory"] / filename
            if not src.is_file():
                missing.append({"owner": owner, "packageId": package_id, "resourceId": resource_id})
                return
            rel = Path("original-ui/images") / safe_name(package["name"]) / f"{resource_id}{src.suffix.lower()}"
            dest = output / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest)
            images[key] = {
                "id": resource_id, "packageId": package_id, "package": package["name"],
                "name": resource.get("name"), "size": pair(resource.get("size")),
                "scale": resource.get("scale"), "scale9grid": pair(resource.get("scale9grid")),
                "source": source_ref(src, source),
                "resourcePath": rel.with_suffix("").as_posix(), "file": rel.as_posix(),
                "sha256": sha256(src),
            }

    while queue:
        package_id, component_id = queue.popleft()
        key = f"{package_id}:{component_id}"
        if key in visited:
            continue
        visited.add(key)
        package = packages.get(package_id)
        resource = package and package["resources"].get(component_id)
        if not resource or resource["kind"] != "component":
            missing.append({"owner": key, "packageId": package_id, "resourceId": component_id})
            continue
        xml_file = package["directory"] / f"{component_id}.xml"
        if not xml_file.is_file():
            missing.append({"owner": key, "packageId": package_id, "resourceId": component_id})
            continue
        xml_root = ET.parse(xml_file).getroot()
        display = xml_root.find("displayList")
        children = [slim_element(child) for child in display] if display is not None else []
        components[key] = {
            "key": key, "id": component_id, "name": resource.get("name"),
            "packageId": package_id, "package": package["name"],
            "size": pair(resource.get("size")) or pair(xml_root.get("size")),
            "attributes": dict(xml_root.attrib), "children": children,
            "controllers": [slim_element(item) for item in xml_root.findall("controller")],
            "relations": [slim_element(item) for item in xml_root.findall("relation")],
            "transitions": [slim_element(item) for item in xml_root.findall("transition")],
            "settings": [slim_element(item) for item in xml_root
                         if item.tag not in {"displayList", "controller", "relation", "transition"}],
            "source": source_ref(xml_file, source),
        }
        for element in xml_root.iter():
            referenced_package = element.get("pkg") or package_id
            referenced_id = element.get("src")
            if referenced_id:
                enqueue(referenced_package, referenced_id, key)
            for value in element.attrib.values():
                # Rich-text image tags terminate the URI at `[`; do not fold
                # the closing `[/img]` markup into the FairyGUI resource id.
                for package_ref, resource_ref in re.findall(r"ui://([a-zA-Z0-9]{8})([^|,\s\[\]]+)", value):
                    enqueue(package_ref, resource_ref, key)

    public_aliases: dict[str, str] = {}
    for key, component in components.items():
        public_aliases[f'{component["package"]}/{component["name"]}'] = key
        public_aliases[component["name"]] = key
        public_aliases[component["id"]] = key
        public_aliases[f'ui://{component["packageId"]}{component["id"]}'] = key
    return {"roots": root_keys, "aliases": public_aliases, "components": components,
            "images": images, "missingReferences": missing}


def legacy_records(source: Path, output: Path) -> dict[str, Any]:
    screens_data = json.loads((source / "client-handoff/data/screens.json").read_text())
    assets_data = json.loads((source / "client-handoff/data/assets.json").read_text())
    records = [row for row in screens_data["records"]
               if any(str(row.get("source_path", "")).startswith(prefix) for prefix in LEGACY_PREFIXES)]
    source_files: list[tuple[Path, dict[str, Any]]] = [
        (source / row["source_path"], row) for row in records
    ]
    known_paths = {path.resolve() for path, _ in source_files}
    # Utility classes such as CardUtils and CItemViewBox are not classified as
    # screens, yet they own runtime-selected skin names.  Scan the allowlisted
    # AS3 paths directly so those literals are not silently omitted.
    for prefix in LEGACY_PREFIXES:
        candidate = source / prefix
        paths = sorted(candidate.rglob("*.as")) if candidate.is_dir() else [candidate]
        for path in paths:
            if path.is_file() and path.resolve() not in known_paths:
                source_files.append((path, {"id": source_ref(path, source)}))
                known_paths.add(path.resolve())
    literal_owners: dict[str, set[str]] = defaultdict(set)
    swf_owners: dict[str, set[str]] = defaultdict(set)
    for path, record in source_files:
        if not path.is_file():
            continue
        text = path.read_text(errors="replace")
        owner = record["id"]
        for literal in re.findall(r'"((?:\\.|[^"\\])*)"', text):
            if 0 < len(literal) <= 100:
                literal_owners[literal].add(owner)
        for swf in re.findall(r'"([^"\r\n]+\.swf)"', text, re.I):
            swf_owners[swf.replace("\\", "/").lower()].add(owner)

    by_symbol: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for asset in assets_data["records"]:
        if not asset.get("converted_path"):
            continue
        for symbol in asset.get("symbol_names", []):
            by_symbol[str(symbol)].append(asset)

    skin_map: dict[str, Any] = {}
    for name in sorted(literal_owners):
        candidates = by_symbol.get(name, [])
        if not candidates:
            continue
        owners = literal_owners[name]
        narrowed = []
        for asset in candidates:
            container = str(asset.get("container_path", "")).replace("\\", "/").lower()
            if any(container.endswith(swf) or swf.endswith(container.removeprefix("game/"))
                   for swf, swf_record_owners in swf_owners.items() if owners & swf_record_owners):
                narrowed.append(asset)
        choices = narrowed or candidates
        resolution = "resource_array_exact" if len(narrowed) == 1 else (
            "symbol_unique" if len(candidates) == 1 else "ambiguous_symbol")
        entries = []
        for index, asset in enumerate(choices):
            converted = source / asset["converted_path"]
            if not converted.is_file():
                continue
            suffix = converted.suffix.lower() or ".png"
            rel = Path("original-ui/legacy") / f"{safe_name(name)}-{index}{suffix}"
            dest = output / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(converted, dest)
            entries.append({
                "assetId": asset["id"], "container": asset.get("container_path"),
                "characterId": asset.get("character_id"), "source": asset.get("converted_path"),
                "resourcePath": rel.with_suffix("").as_posix(),
                "file": rel.as_posix(),
                "width": asset.get("width"), "height": asset.get("height"),
                "sha256": sha256(converted),
            })
        if entries:
            skin_map[name] = {"name": name, "resolution": resolution,
                              "owners": sorted(owners), "candidates": entries}

    by_container_character = {
        (str(asset.get("container_path", "")).replace("\\", "/").lower(),
         int(asset.get("character_id", -1))): asset
        for asset in assets_data["records"] if asset.get("converted_path")
    }
    for name, (container, character_id) in EXPLICIT_LEGACY_ASSETS.items():
        asset = by_container_character.get((container.lower(), character_id))
        if not asset:
            raise SystemExit(f"Missing explicit original UI asset: {container}#{character_id}")
        converted = source / asset["converted_path"]
        if not converted.is_file():
            raise SystemExit(f"Missing converted original UI bitmap: {converted}")
        suffix = converted.suffix.lower() or ".png"
        rel = Path("original-ui/legacy") / f"{safe_name(name)}{suffix}"
        dest = output / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(converted, dest)
        skin_map[name] = {
            "name": name, "resolution": "timeline_character_exact",
            "owners": [f"{container}#{character_id}"],
            "candidates": [{
                "assetId": asset["id"], "container": asset.get("container_path"),
                "characterId": asset.get("character_id"), "source": asset.get("converted_path"),
                "resourcePath": rel.with_suffix("").as_posix(), "file": rel.as_posix(),
                "width": asset.get("width"), "height": asset.get("height"),
                "sha256": sha256(converted),
            }],
        }

    compact = []
    for row in records:
        compact.append({key: row.get(key) for key in (
            "id", "name", "fqcn", "source_path", "screen_kind", "surface_role", "extends",
            "coordinate_space", "fields", "child_mounts", "layout_operations", "interactions",
            "state_transitions", "literal_asset_refs", "unresolved", "asset_ids")})
    aliases = {row["name"]: row["id"] for row in compact if row["name"] in LEGACY_ENTRY_NAMES}
    return {"aliases": aliases, "screens": compact, "skins": skin_map,
            "note": "Dynamic AS3 expressions are preserved in screen records and are not evaluated."}


def main() -> None:
    project = Path(__file__).resolve().parents[1]
    default_source = Path(os.environ.get("KINGS_CALL_SOURCE", project.parent / "KingsCall-原版客户端逆向研究"))
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=default_source)
    parser.add_argument("--output", type=Path,
                        default=project / "cocos-client/assets/resources/recovered")
    parser.add_argument("--root", action="append", dest="roots")
    args = parser.parse_args()
    source = args.source.resolve()
    output = args.output.resolve()
    if not (source / "client-handoff/data/screens.json").is_file():
        raise SystemExit(f"Invalid source root: {source}")
    output.mkdir(parents=True, exist_ok=True)
    fairygui = import_fairygui(source, output, tuple(args.roots or DEFAULT_ROOTS))
    legacy = legacy_records(source, output)
    # Simple stable lookup used by the hand-built AS3 layout adapter.  Ambiguous
    # symbols intentionally omit `path`; callers can select a documented variant
    # by container rather than silently taking the wrong SWF definition.
    skins = {}
    for name, record in legacy["skins"].items():
        variants = {f'{item["container"]}#{item["characterId"]}': item
                    for item in record["candidates"]}
        skin = {"name": name, "resolution": record["resolution"], "variants": variants,
                "owners": record["owners"]}
        if len(record["candidates"]) == 1:
            chosen = record["candidates"][0]
            skin.update({"path": chosen["resourcePath"], "width": chosen["width"],
                         "height": chosen["height"], "sourceId": chosen["assetId"],
                         "container": chosen["container"], "file": chosen["file"]})
        skins[name] = skin
    catalog = {
        "version": 1, "sourceManifest": MANIFEST,
        "coordinateSystem": {"source": "top-left, x right, y down", "designSize": [1200, 600]},
        "fairygui": fairygui, "legacy": legacy, "skins": skins,
    }
    catalog_path = output / "original-ui.json"
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({
        "catalog": str(catalog_path),
        "components": len(catalog["fairygui"]["components"]),
        "fguiImages": len(catalog["fairygui"]["images"]),
        "legacyScreens": len(catalog["legacy"]["screens"]),
        "legacySkins": len(catalog["legacy"]["skins"]),
        "missingReferences": len(catalog["fairygui"]["missingReferences"]),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
