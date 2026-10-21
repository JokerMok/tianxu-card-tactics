#!/usr/bin/env python3
"""Render a rebuildable original-resource/layout reference as standalone HTML.

This deliberately does not claim to be an original-client screenshot.  Home is
composed from the recovered FairyGUI display tree; the other boards place only
already-converted original rasters at coordinates evidenced by the cited AS3.
No ActionScript, SWF timeline, controller animation, or server behavior runs.
"""

from __future__ import annotations

import base64
import html
import json
import mimetypes
from pathlib import Path
from typing import Any


PROJECT = Path(__file__).resolve().parents[1]
RESOURCE_ROOT = PROJECT / "cocos-client/assets/resources/recovered"
CATALOG_PATH = RESOURCE_ROOT / "original-ui.json"
OUTPUT = PROJECT / ".local/corrections/proof-20261021/source-reference.html"


def esc(value: Any) -> str:
    return html.escape(str(value), quote=True)


class SourceReference:
    def __init__(self, catalog: dict[str, Any]) -> None:
        self.catalog = catalog
        self.fgui = catalog["fairygui"]
        self.data_uri_cache: dict[Path, str] = {}

    def data_uri(self, relative: str | None) -> str | None:
        if not relative:
            return None
        path = RESOURCE_ROOT / relative
        if not path.is_file():
            return None
        if path not in self.data_uri_cache:
            mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            encoded = base64.b64encode(path.read_bytes()).decode("ascii")
            self.data_uri_cache[path] = f"data:{mime};base64,{encoded}"
        return self.data_uri_cache[path]

    def fgui_image(self, uri: str) -> dict[str, Any] | None:
        if not uri.startswith("ui://") or len(uri) < 13:
            return None
        return self.fgui["images"].get(f"{uri[5:13]}:{uri[13:]}")

    def skin(self, name: str) -> dict[str, Any] | None:
        source = self.catalog["skins"].get(name)
        return source if source and source.get("file") else None

    def image_box(self, relative: str, x: float, y: float, width: float, height: float,
                  label: str, opacity: float = 1.0, extra_class: str = "") -> str:
        uri = self.data_uri(relative)
        if not uri:
            return self.placeholder(x, y, width, height, f"缺失：{label}")
        return (
            f'<div class="asset {esc(extra_class)}" style="left:{x:g}px;top:{y:g}px;'
            f'width:{width:g}px;height:{height:g}px;opacity:{opacity:g}" title="{esc(label)}">'
            f'<img src="{uri}" alt="{esc(label)}"></div>'
        )

    def skin_box(self, name: str, x: float, y: float, width: float | None = None,
                 height: float | None = None, label: str | None = None, opacity: float = 1.0) -> str:
        skin = self.skin(name)
        if not skin:
            return self.placeholder(x, y, width or 100, height or 40, f"未取得位图：{name}")
        return self.image_box(
            skin["file"], x, y, width or skin.get("width") or 100,
            height or skin.get("height") or 40,
            label or f"skin {name} · {skin.get('container', '')}", opacity,
        )

    @staticmethod
    def placeholder(x: float, y: float, width: float, height: float, label: str) -> str:
        return (f'<div class="placeholder" style="left:{x:g}px;top:{y:g}px;width:{width:g}px;'
                f'height:{height:g}px" title="{esc(label)}"><span>{esc(label)}</span></div>')

    @staticmethod
    def tag(text: str, x: float, y: float, width: float | None = None) -> str:
        width_style = f"width:{width:g}px;" if width else ""
        return f'<div class="tag" style="left:{x:g}px;top:{y:g}px;{width_style}">{esc(text)}</div>'

    @staticmethod
    def pair(value: str | None, fallback: tuple[float, float] = (0, 0)) -> tuple[float, float]:
        if not value:
            return fallback
        try:
            values = value.split(",")[:2]
            return float(values[0]), float(values[1])
        except (ValueError, IndexError):
            return fallback

    def component_key(self, value: str) -> str:
        if value in self.fgui["components"]:
            return value
        return self.fgui["aliases"][value]

    @staticmethod
    def controllers(component: dict[str, Any]) -> dict[str, str]:
        return {item["attributes"].get("name", ""): item["attributes"].get("selected", "0")
                for item in component.get("controllers", [])}

    def gear_visible(self, element: dict[str, Any], controllers: dict[str, str]) -> bool:
        if element.get("attributes", {}).get("visible") == "false":
            return False
        for item in element.get("children", []):
            if item.get("kind") != "gearDisplay":
                continue
            attributes = item.get("attributes", {})
            selected = controllers.get(attributes.get("controller", ""))
            pages = [part for part in attributes.get("pages", "").split(",") if part]
            if selected is not None and selected not in pages:
                return False
        return True

    def home_component(self, value: str, x: float = 0, y: float = 0,
                       width: float | None = None, height: float | None = None,
                       settings: list[dict[str, Any]] | None = None, depth: int = 0) -> str:
        key = self.component_key(value)
        component = self.fgui["components"][key]
        design_width, design_height = component["size"]
        width = width if width is not None else design_width
        height = height if height is not None else design_height
        controllers = self.controllers(component)
        children = component.get("children", [])
        by_id = {item.get("id"): item for item in children if item.get("id")}
        visible_cache: dict[str, bool] = {}

        def visible(item: dict[str, Any], visiting: set[str] | None = None) -> bool:
            item_id = item.get("id", "")
            if item_id in visible_cache:
                return visible_cache[item_id]
            result = self.gear_visible(item, controllers)
            group_id = item.get("attributes", {}).get("group")
            visiting = set(visiting or ())
            if result and group_id and group_id in by_id and group_id not in visiting:
                visiting.add(group_id)
                result = visible(by_id[group_id], visiting)
            visible_cache[item_id] = result
            return result

        overrides: dict[str, tuple[str, str]] = {}
        for item in settings or []:
            if item.get("kind") == "property":
                attributes = item.get("attributes", {})
                overrides[attributes.get("target", "")] = (
                    attributes.get("propertyId", ""), attributes.get("value", ""))

        content: list[str] = []
        for child in children:
            if child.get("kind") == "group" or not visible(child):
                continue
            attributes = child.get("attributes", {})
            child_x, child_y = child.get("xy") or self.pair(attributes.get("xy"))
            child_width = child_height = None
            if child.get("size"):
                child_width, child_height = child["size"]
            kind = child.get("kind", "")
            source_package = attributes.get("pkg") or component["packageId"]
            source_id = attributes.get("src")
            dependency = f"{source_package}:{source_id}" if source_id else None
            image = self.fgui["images"].get(dependency) if dependency else None
            dependency_component = self.fgui["components"].get(dependency) if dependency else None
            if child_width is None or child_height is None:
                natural = image and image.get("size") or dependency_component and dependency_component.get("size") or [0, 0]
                child_width, child_height = natural
            for relation in child.get("children", []):
                if relation.get("kind") != "relation" or relation.get("attributes", {}).get("target"):
                    continue
                pairs = relation["attributes"].get("sidePair", "").split(",")
                if "width-width" in pairs:
                    child_width += width - design_width
                if "height-height" in pairs:
                    child_height += height - design_height

            override = overrides.get(child.get("name", "")) or overrides.get(child.get("id", ""))
            title = f"{component['package']}/{component['name']} · {child.get('name') or child.get('id')} · {kind}"
            if kind == "component" and dependency_component and depth < 12:
                content.append(self.home_component(dependency, child_x, child_y, child_width, child_height,
                                                   child.get("children"), depth + 1))
            elif kind == "image" and image:
                if override and override[0] == "1":
                    image = self.fgui_image(override[1]) or image
                content.append(self.image_box(image["file"], child_x, child_y, child_width, child_height, title))
            elif kind == "loader":
                image = self.fgui_image(attributes.get("url", ""))
                if override and override[0] == "1":
                    image = self.fgui_image(override[1]) or image
                if image:
                    if attributes.get("autoSize") == "true":
                        child_width, child_height = image["size"]
                    content.append(self.image_box(image["file"], child_x, child_y, child_width, child_height, title))
                else:
                    content.append(self.placeholder(child_x, child_y, child_width, child_height, title))
            elif kind in {"text", "richtext"}:
                text = override[1] if override and override[0] == "0" else attributes.get("text", "")
                color = attributes.get("color", "#e8d4aa")
                align = attributes.get("align", "left")
                content.append(
                    f'<div class="fgui-text" style="left:{child_x:g}px;top:{child_y:g}px;'
                    f'width:{child_width:g}px;height:{child_height:g}px;color:{esc(color)};'
                    f'font-size:{float(attributes.get("fontSize", 14)):g}px;text-align:{esc(align)}" '
                    f'title="{esc(title)}">{esc(text)}</div>')
            elif kind == "graph" and attributes.get("fillColor") not in (None, "#00000000"):
                content.append(f'<div class="graph" style="left:{child_x:g}px;top:{child_y:g}px;'
                               f'width:{child_width:g}px;height:{child_height:g}px;'
                               f'background:{esc(attributes.get("fillColor", "transparent"))}" title="{esc(title)}"></div>')
        overflow = "hidden" if component.get("attributes", {}).get("overflow") == "hidden" else "visible"
        return (f'<div class="fgui-component" style="left:{x:g}px;top:{y:g}px;width:{width:g}px;'
                f'height:{height:g}px;overflow:{overflow}" title="{esc(component["source"])}">'
                f'{"".join(content)}</div>')

    def frame(self, title: str, source: str, limitation: str, content: str) -> str:
        return f"""
        <section class="screen-section">
          <div class="screen-heading"><h2>{esc(title)}</h2><p><b>来源：</b>{esc(source)}</p>
          <p><b>静态边界：</b>{esc(limitation)}</p></div>
          <div class="stage-wrap"><div class="stage">{content}</div></div>
        </section>"""

    def map_board(self) -> str:
        content = [self.skin_box("kphcbj_1_2", 280, 20, 777, 513),
                   self.skin_box("worldmap-background-1", 298, 56, 740, 441)]
        landmarks = [
            (1, 293.3, 3.35, 194, 193), (2, 136.85, 7.85, 187, 125),
            (3, 0, 44.35, 315, 201), (4, 247.85, 88.4, 155, 177),
            (5, 422.75, 1.35, 241, 251), (6, 387.85, 195.85, 193, 166),
            (7, 275.8, 204.3, 194, 198), (8, 72.85, 199.3, 292, 248),
            (9, 387.85, 313, 188, 130), (10, 505.95, 235.8, 196, 193),
        ]
        for scene, left, top, width, height in landmarks:
            content.append(self.skin_box(f"worldmap-region-{scene}", 298 + left, 56 + top, width, height,
                                         f"worldmap.swf 地标 {scene}"))
        content.append(self.skin_box("btditu", 280 + (777 - 44) / 2, 28))
        content.append(self.tag("WorldMapWnd (280,20) · content 740×450", 286, 540, 520))
        return "".join(content)

    def card_deck_board(self) -> str:
        ox, oy = 160, 30
        content = [self.skin_box("kpbjbeijing", ox, oy + 18, 144, 501),
                   self.skin_box("KaPaiBianJi", ox + 145, oy + 17, 767, 515),
                   self.skin_box("ajkptj", ox + 6, oy + 462, 133, 33)]
        for side_x in (ox + 195, ox + 547):
            for index in range(9):
                x = side_x + (index % 3) * 100
                y = oy + 74 + (index // 3) * 143
                content.append(self.skin_box("paibei", x + 7, y, 85, 116, "Hand/Card cell paibei"))
        content.extend([self.tag("卡组区 · x=195", ox + 195, oy + 52, 260),
                        self.tag("卡库区 · x=547", ox + 547, oy + 52, 260),
                        self.tag("CardEditWnd 922×540 · source (160,0)", ox, 574, 420)])
        return "".join(content)

    def package_board(self) -> str:
        ox, oy = 240, 40
        content = [self.skin_box("zbbj_1", ox, oy, 660, 399), self.skin_box("btrenwu", ox + 304, oy + 7)]
        for index, name in enumerate(("bqbb_l", "bqzl", "bqzq")):
            content.append(self.skin_box(name, ox - 32, oy + 52 + index * 82, 32, 79))
        for row in range(5):
            for col in range(6):
                content.append(self.skin_box("wupingezi", ox + 337 + col * 48, oy + 87 + row * 48, 45, 45,
                                             "PackagePane item slot"))
        content.append(self.tag("PackageWnd source (240,40) · equipment/package state", ox, 470, 520))
        return "".join(content)

    def smithy_board(self) -> str:
        ox, oy = 240, 40
        content = [self.skin_box("ckxiao", ox, oy, 709, 443), self.skin_box("tiejiangpu", ox + 309, oy + 6)]
        for index, name in enumerate(("bqqh_l", "bqhc", "bqdz")):
            content.append(self.skin_box(name, ox - 32, oy + 55 + index * 82, 32, 79))
        for row in range(3):
            for col in range(4):
                content.append(self.skin_box("qianghuagezi_1", ox + 416 + col * 48, oy + 122 + row * 48, 43, 43,
                                             "Smithy strengthen slot"))
        content.append(self.tag("SmithyWnd source (240,40) · tab/pane logic not executed", ox, 500, 560))
        return "".join(content)

    def battle_board(self) -> str:
        content = [self.skin_box("zdjm_1", 344, 454, 849, 146), self.skin_box("battlechat", 0, 454, 351, 146),
                   self.skin_box("hhjs_1", 1049, 553, 139, 35), self.skin_box("tg_1", 320, 23, 50, 35),
                   self.skin_box("zdsy_1", 1090, 8, 50, 35), self.skin_box("zjtuichu", 1049, 510, 139, 35)]
        for index in range(7):
            content.append(self.skin_box("paibei", 457 + index * 90, 470, 85, 116, "HandCardPane card back"))
        content.extend([self.tag("BattleWnd 1200×600", 12, 12, 220),
                        self.tag("HandCardPane: card x=457+n×90, y=470", 450, 438, 400)])
        return "".join(content)

    def result_board(self) -> str:
        content = [self.skin_box("shengliPVE", 0, 0, 1200, 600), self.skin_box("pvpwin", 136, 134, 295, 63),
                   self.skin_box("ajshengwangjiangli", 52, 550, 90, 33),
                   self.skin_box("ajjihousai_1", 170, 553, 95, 30)]
        for x, label in ((410, "奖励倍率"), (599, "经验"), (799, "银币")):
            content.append(self.tag(label, x, 305, 130))
        content.extend([self.tag("卡牌奖励位置 (509,111)", 509, 111, 190),
                        self.tag("PVEResultCountWnd · source static positions", 430, 560, 360)])
        return "".join(content)

    def document(self) -> str:
        sections = [
            self.frame("Home · FairyGUI 显示树重组",
                       "analysis-copy/fui/Home/11z920.xml 及 original-ui.json 递归依赖闭包",
                       "按默认 controller 与 XML 坐标显示；未执行 transition、列表滚动、按钮交互和服务端状态。",
                       self.home_component("Home/HomeWnd")),
            self.frame("World Map · 原地图图块静态组合",
                       "WorldMapWnd.as:58-70；worldmap.swf 已解析 root timeline；WorldMapWindow.ts 的已核坐标表",
                       "显示位图首帧；未执行 hover/按下帧、解锁判断、提示与地图切换。", self.map_board()),
            self.frame("Card Deck · 卡牌编辑来源布局",
                       "CardEditWnd.as:25-62；CardManagerBook.as:51-99；HandCardPane.as:257-260",
                       "仅摆放原窗口、槽位与卡背；未填入卡牌数据、拖放、筛选、分页或保存逻辑。", self.card_deck_board()),
            self.frame("Package · 背包来源布局",
                       "PackageWnd.as:29-60；PackagePane 及 renwubeibao.swf 已转换位图",
                       "展示装备/背包静态状态示意；未执行分页、装备切换、出售、tooltip 和服务数据。", self.package_board()),
            self.frame("Smithy · 铁匠铺来源布局",
                       "SmithyWnd.as:23-55；lianjintiejiang.swf 与通用窗口原图",
                       "展示强化页静态资源；未执行强化、合成、消耗、成功率或结果动画。", self.smithy_board()),
            self.frame("Battle HUD · 战斗底部界面来源布局",
                       "BattleWnd.as:112-223；HandCardPane.as:257-260；ui_step1.swf 已转换位图",
                       "仅摆放 HUD 原图与卡背；未执行单位、手牌抬升、hover、回合倒计时、战斗事件和动画。", self.battle_board()),
            self.frame("Result · PVE 结算来源布局",
                       "PVEResultCountWnd.as:46-172；ui_step1.swf 已转换位图",
                       "展示胜利背景与已确认坐标；奖励数值、卡牌、倍率和计数动画均未执行。", self.result_board()),
        ]
        return f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>原资源与布局静态参考</title><style>
:root{{--paper:#efe9da;--ink:#211c16;--muted:#6d6458;--line:#b8ab98;--stage:#111816}}
*{{box-sizing:border-box}} body{{margin:0;background:var(--paper);color:var(--ink);font-family:"PingFang SC","Microsoft YaHei",sans-serif}}
header{{padding:34px 5vw 28px;border-bottom:2px solid var(--ink);background:#f7f2e7;position:sticky;top:0;z-index:100}}
header h1{{margin:0 0 8px;font-size:32px;letter-spacing:.04em}} header p{{margin:4px 0;color:var(--muted)}}
main{{padding:30px 4vw 80px;display:grid;gap:38px}} .screen-section{{background:#faf7ef;border:1px solid var(--line);box-shadow:0 8px 26px #3d33251a}}
.screen-heading{{padding:18px 22px 14px;border-bottom:1px solid var(--line)}} .screen-heading h2{{margin:0 0 8px;font-size:21px}}
.screen-heading p{{margin:4px 0;color:var(--muted);font-size:13px;line-height:1.55}}
.stage-wrap{{overflow:auto;padding:20px;background:#d9d0bf}} .stage{{position:relative;width:1200px;height:600px;background:var(--stage);overflow:hidden;box-shadow:0 0 0 1px #000}}
.asset,.fgui-component,.fgui-text,.graph,.placeholder,.tag{{position:absolute}} .asset img{{display:block;width:100%;height:100%;object-fit:fill}}
.asset:hover{{outline:2px solid #ffe676;z-index:90!important}} .fgui-component{{pointer-events:auto}}
.fgui-text{{line-height:1.25;overflow:hidden;text-shadow:0 1px 1px #000;white-space:pre-wrap}}
.placeholder{{border:1px dashed #d98b73;background:#462d2b88;color:#ffd9ca;display:flex;align-items:center;justify-content:center;text-align:center;font-size:11px;padding:4px}}
.tag{{z-index:95;background:#101718d9;color:#f6e6b9;border:1px solid #d9bf7c;padding:4px 7px;font-size:11px;line-height:1.2;pointer-events:none}}
.graph{{opacity:.45}} @media(max-width:1300px){{header{{position:static}}}}
</style></head><body><header><h1>原资源与布局静态参考 · 非原游戏运行截图</h1>
<p>用途：与真实 Cocos 画面并排核对原资源、设计坐标和显示层级。所有画面均由已取得的 XML、AS3 静态证据和已转换原位图重组。</p>
<p>这里没有运行原客户端，也没有补画、生成或混入自制 runtime 截图；动态行为缺口逐页标明。</p></header>
<main>{''.join(sections)}</main></body></html>"""


def main() -> None:
    if not CATALOG_PATH.is_file():
        raise SystemExit(f"Missing {CATALOG_PATH}; run scripts/import-original-ui.py first")
    catalog = json.loads(CATALOG_PATH.read_text())
    output = SourceReference(catalog).document()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(output)
    print(json.dumps({"output": str(OUTPUT), "bytes": OUTPUT.stat().st_size,
                      "screens": 7}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
