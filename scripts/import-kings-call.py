#!/usr/bin/env python3
"""Import referenced recovered data without changing or publishing the research source.

The default source is a sibling project. --source also accepts a moved full project.
Outputs are intentionally gitignored. There is no downloader or official-service call.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import xml.etree.ElementTree as ET
from collections import defaultdict

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = "5254333315581813739"


def read(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def safe_source(root: Path, relative: str) -> Path:
    path = (root / relative).resolve()
    if not path.is_relative_to(root):
        raise ValueError(f"Source escaped the recovered project: {relative}")
    return path


def write_json(path: Path, data) -> str:
    payload = (json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
    digest = hashlib.sha256(payload).hexdigest()
    if path.exists() and path.read_bytes() == payload:
        return digest
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as file:
        file.write(payload)
        temp = file.name
    os.replace(temp, path)
    return digest


def number(value):
    try:
        result = float(value)
        return int(result) if result.is_integer() else result
    except (TypeError, ValueError):
        return value


def rows(config):
    result = []
    for index, row in enumerate(config.get("records", [])):
        if "values" not in row:
            result.append({"_row": f'{config["id"]}:record:{index}', "_value": row})
        else:
            result.append(dict(row["values"], _row=row["id"], _tag=row.get("tag"),
                               _path=row.get("node_path")))
    return result


def run(source: Path, target: Path, resources: str):
    source = source.resolve()
    target = target.resolve()
    if target.is_relative_to(source) or source.is_relative_to(target):
        raise ValueError("Source and output must be disjoint directories")
    handoff = source / "client-handoff"
    manifest = read(handoff / "manifest.json")
    if manifest["source_manifest"] != MANIFEST:
        raise ValueError("Different recovered version: choose/adapt explicitly before importing")
    required = ["START_HERE.md", "NEXT_SESSION.md", "coverage.json", "unresolved.json"]
    for name in required:
        if not (handoff / name).is_file():
            raise FileNotFoundError(f"Full handoff is required: {name}")
    if not (source / manifest["locators"]["asar_extracted"]).is_dir():
        raise FileNotFoundError("The lightweight review archive is insufficient; use the full project")
    table_index = read(handoff / "data/configs/index.json")["records"]
    tables = {}
    data = {}
    failures = []
    for item in table_index:
        if not item.get("data_path") or item["parse_status"] in ["binary_inventory_only", "missing_extraction"]:
            continue
        config = read(safe_source(source, item["data_path"]))
        key = f'{item["scope"]}:{item["logical_path"].lower()}'
        if key in tables:
            raise ValueError(f"Duplicate config identity: {key}")
        normalized = rows(config)
        file = f'tables/{item["scope"]}/{item["config_id"].split(":")[1]}.json'
        digest = write_json(target / file, {"id": item["config_id"], "scope": item["scope"],
            "logicalPath": item["logical_path"], "sourceManifest": MANIFEST, "rows": normalized})
        tables[key] = {"id": item["config_id"], "path": file, "rows": len(normalized), "sha256": digest,
                       "source": item["data_path"], "sourceHash": item.get("sha256"),
                       "parseStatus": item["parse_status"]}
        data[key] = normalized

    def table(scope, path):
        return data.get(f"{scope}:{path.lower()}", [])

    def by_id(scope, path, key="ID"):
        return {str(number(row.get(key))): row for row in table(scope, path)
                if isinstance(number(row.get(key)), (float, int))}

    assets = {item["id"]: item for item in read(handoff / "data/assets.json")["records"]}
    file_assets = {str(item.get("container_path", "")).replace("\\", "/").lower().removeprefix("game/"): item["id"]
                   for item in assets.values() if item.get("kind") == "file"}
    animations = read(handoff / "data/animations.json")["records"]
    models = {item["id"]: item for item in animations if item.get("kind") == "model"}
    # MonsterConfig.animateitem points into main items.xml.  Keep that source
    # boundary explicit: actorItems/media models with a coincidentally equal
    # name must never be selected for a main monster.
    main_models_by_name = defaultdict(list)
    actor_models_by_name = defaultdict(list)
    for model in models.values():
        if model.get("raw", {}).get("source") == "analysis-copy/embedded-resource-library/Resources_xml5.xml":
            main_models_by_name[str(model.get("name", "")).strip()].append(model)
        if model.get("raw", {}).get("source") == "analysis-copy/embedded-resource-library/Resources_xml640.xml":
            actor_models_by_name[str(model.get("name", "")).strip()].append(model)
    timelines = {item["id"]: item for item in animations if item.get("kind") == "swf_timeline"}
    timeline_by_asset = {(item.get("container_path"), item.get("character_id")): item
                         for item in timelines.values()}
    timeline_by_symbol = defaultdict(list)
    for timeline in timelines.values():
        container = str(timeline.get("container_path", "")).replace("\\", "/").lower()
        for symbol in timeline.get("symbol_names", []):
            timeline_by_symbol[(container, str(symbol).casefold())].append(timeline)

    # Resources_xml5 magicitem effects refer to numeric `animatename` values.
    # Resources_xml13 is the source mapping from those values to an exact SWF
    # path and exported symbol. Link that already-indexed SWF timeline here;
    # no SWF extraction or heuristic same-name fallback is involved.
    particle_xml = source / "analysis-copy/embedded-resource-library/Resources_xml13.xml"
    particle_emitters = {}
    if particle_xml.is_file():
        particle_root = ET.parse(particle_xml).getroot()
        for particle_list in particle_root.findall(".//list"):
            relative = str(particle_list.get("file", "")).replace("\\", "/").lstrip("/")
            container = f"game/{relative}".lower()
            for emitter in particle_list.findall(".//emitter"):
                emitter_id = str(emitter.get("id", ""))
                rules = {str(rule.get("name", "")): str(rule.get("value", ""))
                         for rule in emitter.findall(".//rule")}
                particle_emitters[emitter_id] = {
                    "container": container, "symbol": str(emitter.get("name", "")), "rules": rules}
    else:
        failures.append({"kind": "particle_config", "id": "Resources_xml13.xml",
                         "reason": "source mapping absent"})

    for model in models.values():
        raw_model = model.get("raw", {})
        if (raw_model.get("source") != "analysis-copy/embedded-resource-library/Resources_xml5.xml"
                or raw_model.get("tag") != "magicitem"):
            continue
        linked = 0
        for status in model.get("statuses", []):
            animate_name = str(status.get("raw", {}).get("animatename", ""))
            if not animate_name:
                continue
            emitter = particle_emitters.get(animate_name)
            if not emitter:
                continue
            candidates = timeline_by_symbol.get((emitter["container"], emitter["symbol"].casefold()), [])
            if len(candidates) != 1:
                continue
            status["timeline_id"] = candidates[0]["id"]
            frame_rule = emitter["rules"].get("framerate", "").split(",", 1)[0]
            try:
                particle_framerate = float(frame_rule)
            except ValueError:
                particle_framerate = 0
            if particle_framerate > 0:
                status["particle_framerate"] = particle_framerate
            status["particle_source"] = {
                "config": "analysis-copy/embedded-resource-library/Resources_xml13.xml",
                "animatename": animate_name,
                "container": emitter["container"],
                "symbol": emitter["symbol"],
            }
            linked += 1
        if linked:
            model["status"] = "linked_particle_timelines"
            model["path_match"] = "particle_animatename_exact"
    wanted = set()
    ui_background = file_assets.get("background.jpg")
    if ui_background:
        wanted.add(ui_background)
    used_models = set()
    used_timelines = set()
    scopes = {}
    all_cards = read(handoff / "data/cards.json")["records"]
    all_maps = read(handoff / "data/maps.json")["records"]
    all_skills = read(handoff / "data/effects.json")["records"]
    for scope in ["main", "media"]:
        card_defs = by_id(scope, "embeddata/scp/card.xml")
        monster_defs = by_id(scope, "embeddata/scp/monster.xml")
        skill_defs = by_id(scope, "embeddata/scp/skill.xml")
        cards = {}
        for item in all_cards:
            if item["scope"] != scope:
                continue
            key = str(item["card_id"])
            raw = card_defs.get(key)
            if raw is None:
                failures.append({"kind": "card_config", "id": item["id"], "reason": "missing scoped row"})
                continue
            art = item.get("art", {}).get("asset_ids", [])
            mids = item.get("model", {}).get("model_ids", [])
            wanted.update(art)
            used_models.update(mids)
            source_model_resolution = item.get("model", {}).get("resolution")
            cards[key] = {"id": f"{scope}:card:{key}", "sourceId": item["id"], "raw": raw,
                          "art": art, "models": mids, "artResolution": item.get("art", {}).get("resolution"),
                          "modelResolution": source_model_resolution,
                          "sourceModels": list(mids), "sourceModelResolution": source_model_resolution}
        maps = {}
        for item in all_maps:
            if item["scope"] != scope:
                continue
            wanted.update(item.get("background_asset_ids", []))
            wanted.update(item.get("sound", {}).get("asset_ids", []))
            detail = next((v for k, v in data.items()
                if k == f'{scope}:{str(item.get("map_file", "")).lower()}'), [])
            maps[str(item["map_id"])] = {**item, "layoutRows": detail}
        skills = {}
        for item in all_skills:
            if item["scope"] != scope:
                continue
            used_models.update(item.get("visual_model_ids", []))
            for sound in item.get("sounds", []):
                wanted.update(sound.get("asset_ids", []))
            skills[str(item["skill_id"])] = {"id": f'{scope}:skill:{item["skill_id"]}',
                "sourceId": item["id"], "raw": skill_defs.get(str(item["skill_id"])),
                "soundAssets": [aid for sound in item.get("sounds", []) for aid in sound.get("asset_ids", [])],
                "visualModels": item.get("visual_model_ids", []), "effects": item.get("gameplay_effects", [])}
        scenes = []
        for key, records in data.items():
            if not key.startswith(f"{scope}:embeddata/scp/scene/"):
                continue
            header = next((r for r in records if r.get("_tag") == "Scene"), None)
            if header is not None:
                background = file_assets.get(str(header.get("background", "")).replace("\\", "/").lower())
                if background:
                    wanted.add(background)
                scenes.append({"id": f'{scope}:scene:{header.get("id")}', "logicalPath": key.split(":", 1)[1],
                               "header": header, "nodes": records})
        monster_models = {}
        actor_models = {}
        if scope == "main":
            for monster_id, monster in monster_defs.items():
                requested_name = str(monster.get("animateitem", ""))
                candidates = main_models_by_name.get(requested_name.strip(), [])
                if not candidates:
                    monster_models[monster_id] = {"modelId": None, "modelName": requested_name,
                                                   "resolution": "unmatched_main_items"}
                    continue

                # Duplicated names exist in the source XML.  Prefer the candidate
                # whose linked status symbols actually begin with that animateitem
                # name; otherwise retain the first source-order candidate and make
                # the ambiguity visible in the catalog/report.
                needle = requested_name.strip().casefold()
                def candidate_score(candidate):
                    statuses = candidate.get("statuses", [])
                    linked = sum(bool(status.get("timeline_id")) for status in statuses)
                    named = sum(str(status.get("raw", {}).get("file", "")).casefold().startswith(needle)
                                for status in statuses)
                    return named, linked
                ranked = sorted(candidates, key=candidate_score, reverse=True)
                best = ranked[0]
                tied = [candidate for candidate in ranked if candidate_score(candidate) == candidate_score(best)]
                resolution = "exact_unique" if len(candidates) == 1 else (
                    "exact_ranked" if len(tied) == 1 else "exact_duplicate_source_order")
                if requested_name != requested_name.strip() and resolution == "exact_unique":
                    resolution = "trimmed_unique"
                monster_models[monster_id] = {"modelId": best["id"], "modelName": best["name"],
                                               "resolution": resolution,
                                               "candidateIds": [candidate["id"] for candidate in candidates]}
                used_models.add(best["id"])

            # cards.json records the source extractor's earlier model decision.
            # The runtime resolves summon visuals through the newer, scoped
            # monsterModels map above. Keep both facts: preserve the source
            # decision in sourceModels/sourceModelResolution and expose the
            # actual runtime model on each summon card.
            for card in cards.values():
                raw_monster_id = card.get("raw", {}).get("MonsterID")
                try:
                    monster_id = str(int(raw_monster_id))
                except (TypeError, ValueError):
                    continue
                link = monster_models.get(monster_id)
                if not link or not link.get("modelId"):
                    continue
                card["models"] = [link["modelId"]]
                card["modelResolution"] = link["resolution"]

            # ActorViewHelper.createDefaultAnimateObject chooses the default
            # component IDs below. Resolve those IDs through main actor.xml and
            # then into main actorItems.xml models. A default actor consists of
            # independent body and weapon timelines, rendered in source order.
            actor_rows = table("main", "embeddata/scp/actor.xml")
            actor_names = {}
            component_names = {}
            component_models = {}
            for row in actor_rows:
                path = str(row.get("_path", ""))
                actor_match = re.search(r"/actoritem\[(\d+)\]", path)
                if not actor_match:
                    continue
                actor_index = int(actor_match.group(1))
                if row.get("_tag") == "actoritem":
                    actor_names[actor_index] = str(row.get("name", ""))
                    continue
                component_match = re.search(r"/component\[(\d+)\]", path)
                if not component_match:
                    continue
                component_index = int(component_match.group(1))
                if row.get("_tag") == "component":
                    component_names[(actor_index, component_index)] = str(row.get("name", ""))
                elif row.get("_tag") == "model":
                    component_models[(actor_index, component_index, str(row.get("id")))] = str(row.get("name", ""))

            profession_component_ids = {1: ("100", "101"), 2: ("200", "201"),
                                        3: ("300", "301"), 4: ("400", "401")}
            for sex, actor_name in [(0, "female"), (1, "male")]:
                actor_index = next((index for index, name in actor_names.items() if name == actor_name), None)
                if actor_index is None:
                    continue
                component_index_by_name = {name: index for (owner, index), name in component_names.items()
                                           if owner == actor_index}
                for profession, (body_id, weapon_id) in profession_component_ids.items():
                    layer_names = []
                    for component_name, component_id in [("body", body_id), ("weapon", weapon_id)]:
                        component_index = component_index_by_name.get(component_name)
                        if component_index is None:
                            continue
                        layer_name = component_models.get((actor_index, component_index, component_id))
                        if layer_name:
                            layer_names.append(layer_name)
                    layer_ids = []
                    unresolved_layers = []
                    for layer_name in layer_names:
                        candidates = actor_models_by_name.get(layer_name, [])
                        if len(candidates) == 1:
                            layer_ids.append(candidates[0]["id"])
                            used_models.add(candidates[0]["id"])
                        else:
                            unresolved_layers.append({"name": layer_name, "candidates": [c["id"] for c in candidates]})
                    actor_models[f"{profession}:{sex}"] = {
                        "profession": profession, "sex": sex, "sexName": actor_name,
                        "layerNames": layer_names, "modelIds": layer_ids,
                        "resolution": "actor_xml_exact" if len(layer_ids) == 2 and not unresolved_layers
                                      else "actor_layers_incomplete",
                        "unresolvedLayers": unresolved_layers,
                    }

        scopes[scope] = {"cards": cards, "monsters": monster_defs, "monsterModels": monster_models,
                         "actorModels": actor_models, "skills": skills,
                         "maps": maps, "scenes": scenes,
                         "effects": by_id(scope, "embeddata/scp/effect.xml", "EffectID"),
                         "statuses": by_id(scope, "embeddata/scp/status.xml"),
                         "areas": by_id(scope, "embeddata/scp/area.xml")}

    for mid in used_models:
        model = models.get(mid)
        if model is None:
            failures.append({"kind": "model", "id": mid, "reason": "model absent"})
            continue
        for status in model.get("statuses", []):
            if status.get("timeline_id"):
                used_timelines.add(status["timeline_id"])
            if status.get("asset_id"):
                wanted.add(status["asset_id"])
    queue = list(used_timelines)
    seen = set()
    while queue:
        tid = queue.pop()
        if tid in seen:
            continue
        seen.add(tid)
        timeline = timelines.get(tid)
        if timeline is None:
            failures.append({"kind": "timeline", "id": tid, "reason": "timeline absent"})
            continue
        for op in timeline.get("controls", []):
            aid = op.get("asset_id")
            if aid:
                wanted.add(aid)
            child = timeline_by_asset.get((timeline.get("container_path"), op.get("character_id")))
            if child and child["id"] not in seen:
                queue.append(child["id"])

    # A SWF shape is frequently only a rectangular bitmap-filled frame.  The
    # timeline points at the shape while the loadable PNG lives one dependency
    # further down.  Preserve the bounds/fill metadata and import those existing
    # converted bitmaps instead of re-extracting or mass-rasterising SWFs.
    dependency_queue = list(wanted)
    dependency_seen = set()
    while dependency_queue:
        aid = dependency_queue.pop()
        if aid in dependency_seen:
            continue
        dependency_seen.add(aid)
        asset = assets.get(aid)
        if not asset:
            continue
        for fill in asset.get("initial_fill_styles", []):
            bitmap_id = fill.get("bitmap_asset_id")
            if bitmap_id and bitmap_id not in wanted:
                wanted.add(bitmap_id)
                dependency_queue.append(bitmap_id)

    imported = {}
    copy_count = 0
    for aid in sorted(wanted):
        asset = assets.get(aid)
        if asset is None:
            failures.append({"kind": "asset", "id": aid, "reason": "asset absent"})
            continue
        src_rel = asset.get("converted_path")
        if not src_rel and (asset.get("format", "").lower() in ["jpg", "jpeg", "png", "mp3", "wav", "ogg"]):
            src_rel = asset.get("path") or asset.get("content_path")
        entry = {"id": aid, "kind": asset.get("kind"), "width": asset.get("width"),
                 "height": asset.get("height"), "container": asset.get("container_path"),
                 "characterId": asset.get("character_id"), "source": src_rel,
                 "sourceHash": asset.get("content_sha256"), "path": None,
                 "fileStatus": "pending" if src_rel else "descriptor_only",
                 "boundsPx": asset.get("bounds_px"),
                 "fillStyles": asset.get("initial_fill_styles", [])}
        if src_rel:
            src = safe_source(source, src_rel)
            if not src.is_file():
                failures.append({"kind": "asset_file", "id": aid, "reason": src_rel})
                entry["fileStatus"] = "source_missing"
            else:
                suffix = src.suffix.lower()
                allowed = resources == "all" or (resources == "images" and suffix in [".png", ".jpg", ".jpeg"])
                dest_rel = f'images/{aid.split(":")[1]}{suffix}'
                dest = target / dest_rel
                if not dest.resolve().is_relative_to(target):
                    raise ValueError(f"Asset output escaped destination: {dest_rel}")
                same = (dest.exists() and dest.stat().st_size == src.stat().st_size
                        and dest.stat().st_mtime_ns == src.stat().st_mtime_ns)
                if allowed:
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    if not same:
                        temp = dest.with_suffix(dest.suffix + ".tmp")
                        shutil.copy2(src, temp)
                        os.replace(temp, dest)
                        copy_count += 1
                # Metadata-only runs retain already valid imported files.
                if allowed or same:
                    entry["path"] = dest_rel
                    entry["fileStatus"] = "available"
        imported[aid] = entry

    catalog = {"version": 1, "sourceManifest": MANIFEST, "activeScope": "main", "scopes": scopes,
               "ui": {"backgroundAssetId": ui_background},
               "tables": tables, "assets": imported,
               "models": {mid: models[mid] for mid in sorted(used_models) if mid in models},
               "timelines": {tid: timelines[tid] for tid in sorted(seen) if tid in timelines},
               "layout": read(handoff / "data/battle-layout.json")["records"][0]}
    digest = write_json(target / "catalog.json", catalog)
    summary = {"version": 1, "sourceManifest": MANIFEST, "activeScope": "main",
               "catalogHash": digest, "resourcesMode": resources,
               "scopes": {scope: {key: len(value) for key, value in values.items()}
                          for scope, values in scopes.items()},
               "tables": len(tables), "referencedAssets": len(imported),
               "copiedThisRun": copy_count, "availableAssetFiles": sum(bool(v["path"]) for v in imported.values()),
               "conversionRequiredAssets": sum(v["fileStatus"] == "conversion_required" for v in imported.values()),
               "descriptorOnlyAssets": sum(v["fileStatus"] == "descriptor_only" for v in imported.values()),
               "models": len(catalog["models"]), "timelines": len(catalog["timelines"]),
               "unresolved": failures,
               "sourceGaps": {scope: {
                   "unmatchedCardArt": sum(card["artResolution"] != "matched" for card in part["cards"].values()),
                   "unmatchedCardModels": sum(card["modelResolution"] == "unmatched" for card in part["cards"].values()),
                   "cardsWithoutModelReference": sum(card["modelResolution"] == "no_reference" for card in part["cards"].values()),
                   "sourceUnmatchedCardModels": sum(card["sourceModelResolution"] == "unmatched" for card in part["cards"].values()),
                   "sourceCardsWithoutModelReference": sum(card["sourceModelResolution"] == "no_reference" for card in part["cards"].values()),
                   "mapsWithoutLayout": sum(not game_map["layoutRows"] for game_map in part["maps"].values()),
                   "unmatchedMonsterModels": sum(link.get("modelId") is None
                                                  for link in part["monsterModels"].values()),
                   "ambiguousMonsterModels": sum(link.get("resolution") == "exact_duplicate_source_order"
                                                  for link in part["monsterModels"].values()),
                   "incompleteActorModels": sum(link.get("resolution") != "actor_xml_exact"
                                                for link in part["actorModels"].values()),
               } for scope, part in scopes.items()},
               "runtimeValidated": False}
    write_json(target / "import-report.json", summary)
    print(json.dumps({k: v for k, v in summary.items() if k != "unresolved"}, ensure_ascii=False, indent=2))
    print(f"Import errors: {len(failures)}; details: {target / 'import-report.json'}")
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path,
                        default=Path(os.environ.get("KINGS_CALL_SOURCE", ROOT.parent / "KingsCall-原版客户端逆向研究")))
    parser.add_argument("--output", type=Path, default=ROOT / "cocos-client/assets/resources/recovered")
    parser.add_argument("--resources", choices=["none", "images", "all"], default="all")
    args = parser.parse_args()
    result = run(args.source, args.output, args.resources)
    if result["unresolved"]:
        raise SystemExit(2)
