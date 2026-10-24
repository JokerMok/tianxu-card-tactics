#!/usr/bin/env python3
"""Draw the revision-2 UI skin from primitives. No generative model is used."""
from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "cocos-client/assets/resources/art-samples/v2"
SCALE = 3

QUALITY = [
    (151, 163, 158),  # worn iron
    (89, 193, 124),   # green
    (73, 151, 224),   # blue
    (163, 99, 225),   # violet
    (230, 151, 62),   # amber
    (229, 76, 67),    # mythic red
    (244, 211, 101),  # actual Quality 6 gold variant
]


def rgba(color: tuple[int, int, int], alpha: int = 255) -> tuple[int, int, int, int]:
    return (*color, alpha)


def mix(a: tuple[int, int, int], b: tuple[int, int, int], amount: float) -> tuple[int, int, int]:
    return tuple(round(x + (y - x) * amount) for x, y in zip(a, b))


def canvas(size: tuple[int, int]) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    image = Image.new("RGBA", (size[0] * SCALE, size[1] * SCALE), (0, 0, 0, 0))
    return image, ImageDraw.Draw(image)


def box(rect: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    return tuple(v * SCALE for v in rect)


def downsample(image: Image.Image, name: str) -> None:
    image.resize((image.width // SCALE, image.height // SCALE), Image.Resampling.LANCZOS).save(OUT / name)


def draw_card_frame(quality: int) -> None:
    image, draw = canvas((256, 352))
    accent = QUALITY[quality]
    dark = (10, 33, 32)
    metal = (37, 82, 76)
    light = (103, 151, 132)

    # Wide rails sit outside the content safe area; the inside remains transparent.
    for inset, width, color in [(4, 9, dark), (8, 5, metal), (12, 2, light), (15, 2, accent)]:
        draw.rounded_rectangle(box((inset, inset, 255 - inset, 351 - inset)), radius=12 * SCALE,
                               outline=rgba(color), width=width * SCALE)
    draw.rounded_rectangle(box((18, 19, 237, 333)), radius=8 * SCALE,
                           outline=rgba(mix(accent, (255, 240, 188), .3), 220), width=2 * SCALE)

    # Riveted corner plates stay clear of the top-left ready number and bottom stat circles.
    corners = [(10, 10), (222, 10), (10, 318), (222, 318)]
    for x, y in corners:
        draw.polygon([(x * SCALE, (y + 10) * SCALE), ((x + 10) * SCALE, y * SCALE),
                      ((x + 24) * SCALE, (y + 10) * SCALE), ((x + 10) * SCALE, (y + 24) * SCALE)],
                     fill=rgba(dark, 245), outline=rgba(accent))
        draw.ellipse(box((x + 8, y + 8, x + 13, y + 13)), fill=rgba((226, 205, 142)))

    # Quality is readable by both color and pip count (1..7), centered away from number safe zones.
    pip_count = quality + 1
    start_x = 128 - ((pip_count - 1) * 13) / 2
    for i in range(pip_count):
        x = start_x + i * 13
        draw.polygon([(x * SCALE, 9 * SCALE), ((x + 5) * SCALE, 14 * SCALE),
                      (x * SCALE, 19 * SCALE), ((x - 5) * SCALE, 14 * SCALE)],
                     fill=rgba(accent), outline=rgba(mix(accent, (255, 255, 255), .45)))
    downsample(image, f"quality-frame-{quality}.png")


def button_palette(kind: str, state: str) -> tuple[tuple[int, int, int], tuple[int, int, int], tuple[int, int, int]]:
    bases = {"primary": (31, 103, 75), "secondary": (29, 67, 64), "compact": (31, 72, 67)}
    accents = {"primary": (231, 190, 94), "secondary": (151, 184, 157), "compact": (181, 199, 173)}
    base, accent = bases[kind], accents[kind]
    if state == "selected":
        return mix(base, (88, 157, 112), .45), mix(base, (190, 225, 173), .42), (245, 214, 127)
    if state == "pressed":
        return mix(base, (0, 0, 0), .35), mix(base, (0, 0, 0), .18), mix(accent, (255, 255, 255), .12)
    if state == "disabled":
        return (35, 48, 47), (45, 60, 58), (101, 117, 112)
    return mix(base, (0, 0, 0), .18), base, accent


def draw_button(kind: str, state: str) -> None:
    image, draw = canvas((256, 56))
    top, bottom, accent = button_palette(kind, state)
    for y in range(56 * SCALE):
        amount = y / max(1, 55 * SCALE)
        draw.line([(0, y), (256 * SCALE, y)], fill=rgba(mix(top, bottom, amount)))
    draw.rounded_rectangle(box((2, 2, 253, 53)), radius=11 * SCALE,
                           outline=rgba((8, 26, 26), 250), width=4 * SCALE)
    draw.rounded_rectangle(box((7, 7, 248, 48)), radius=8 * SCALE,
                           outline=rgba(accent, 235), width=2 * SCALE)
    draw.line([(18 * SCALE, 11 * SCALE), (238 * SCALE, 11 * SCALE)],
              fill=rgba(mix(accent, (255, 255, 255), .45), 155), width=SCALE)
    # Angular end caps make the tiers feel like one metal system at every width.
    for x, flip in [(8, 1), (248, -1)]:
        draw.polygon([(x * SCALE, 28 * SCALE), ((x + 9 * flip) * SCALE, 18 * SCALE),
                      ((x + 9 * flip) * SCALE, 38 * SCALE)], fill=rgba(accent, 210))
    if state == "selected":
        draw.rounded_rectangle(box((3, 3, 252, 52)), radius=10 * SCALE, outline=(250, 219, 141, 255), width=3 * SCALE)
        draw.line([(30*SCALE, 44*SCALE), (226*SCALE,44*SCALE)], fill=(245,214,127,255), width=2*SCALE)
    if state == "disabled":
        for x in (14,24,232,242):
            draw.line([(x*SCALE,18*SCALE),((x-8)*SCALE,37*SCALE)],fill=(109,123,118,180),width=2*SCALE)
    if state == "pressed":
        draw.line([(24*SCALE,16*SCALE),(232*SCALE,16*SCALE)],fill=(4,15,13,255),width=4*SCALE)
        draw.rounded_rectangle(box((8, 8, 247, 49)), radius=7 * SCALE, fill=(0, 0, 0, 40))
    downsample(image, f"button-{kind}-{state}.png")


def draw_hud_icon(name: str) -> None:
    image, draw = canvas((48, 48))
    gold = rgba((231, 205, 139))
    green = rgba((35, 91, 77), 245)
    draw.ellipse(box((2, 2, 45, 45)), fill=green, outline=rgba((109, 154, 130)), width=2 * SCALE)
    if name == "draw":
        for dx, dy in [(5, 1), (2, 4), (0, 7)]:
            draw.rounded_rectangle(box((13 + dx, 10 + dy, 31 + dx, 34 + dy)), radius=2 * SCALE,
                                   fill=rgba((13, 39, 38)), outline=gold, width=2 * SCALE)
        draw.line([box((23, 18, 31, 26))[:2], box((23, 18, 31, 26))[2:]], fill=gold, width=2 * SCALE)
    elif name == "hand":
        for angle, x, y in [(-8, 10, 13), (0, 17, 9), (8, 24, 13)]:
            card = Image.new("RGBA", image.size, (0, 0, 0, 0)); cd = ImageDraw.Draw(card)
            cd.rounded_rectangle(box((x, y, x + 15, y + 23)), radius=2 * SCALE,
                                 fill=rgba((13, 39, 38)), outline=gold, width=2 * SCALE)
            if angle:
                card = card.rotate(angle, resample=Image.Resampling.BICUBIC, center=(24 * SCALE, 34 * SCALE))
            image.alpha_composite(card)
        draw = ImageDraw.Draw(image)
    else:  # graveyard
        draw.rounded_rectangle(box((14, 11, 34, 38)), radius=7 * SCALE, fill=rgba((13, 39, 38)),
                               outline=gold, width=2 * SCALE)
        draw.line([box((18, 21, 30, 21))[:2], box((18, 21, 30, 21))[2:]], fill=gold, width=2 * SCALE)
        draw.line([box((24, 16, 24, 28))[:2], box((24, 16, 24, 28))[2:]], fill=gold, width=2 * SCALE)
        draw.line([box((9, 39, 39, 39))[:2], box((9, 39, 39, 39))[2:]], fill=gold, width=2 * SCALE)
    downsample(image, f"hud-{name}.png")


def draw_control(name: str) -> None:
    image, draw = canvas((24, 24))
    draw.rounded_rectangle(box((1, 1, 22, 22)), radius=5 * SCALE, fill=rgba((27, 70, 64)),
                           outline=rgba((211, 181, 105)), width=2 * SCALE)
    ink = rgba((245, 231, 190))
    if name in {"plus", "minus"}:
        draw.line([box((6, 12, 18, 12))[:2], box((6, 12, 18, 12))[2:]], fill=ink, width=2 * SCALE)
        if name == "plus":
            draw.line([box((12, 6, 12, 18))[:2], box((12, 6, 12, 18))[2:]], fill=ink, width=2 * SCALE)
    else:
        draw.rounded_rectangle(box((7, 10, 17, 18)), radius=2 * SCALE, outline=rgba((151, 165, 158)), width=2 * SCALE)
        draw.arc(box((8, 4, 16, 14)), 180, 360, fill=rgba((151, 165, 158)), width=2 * SCALE)
    downsample(image, f"control-{name}.png")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for quality in range(7):
        draw_card_frame(quality)
    for kind in ("primary", "secondary", "compact"):
        for state in ("normal", "selected", "pressed", "disabled"):
            draw_button(kind, state)
    for name in ("draw", "hand", "graveyard"):
        draw_hud_icon(name)
    for name in ("plus", "minus", "locked"):
        draw_control(name)


if __name__ == "__main__":
    main()
