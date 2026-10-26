"""Register generated material edits onto the unchanged production pose alpha.

Creative editing is performed by the built-in image tool. This technical step
locks original frame order, geometry, alpha, feet and event timing; edited RGB
is aligned inside each original silhouette, never accepted as new animation.
"""
from pathlib import Path
import json
from PIL import Image, ImageEnhance, ImageChops

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'art-source/chapter1-production'


def prepare():
    records = {}
    for key, saturation in [('ogre-destroyer', .55), ('ogre-marauder', .9)]:
        original = Image.open(ROOT / f'art-source/chapter1-batch3/{key}-atlas.png').convert('RGBA')
        edited = Image.open(SOURCE / f'{key}-material-source.png').convert('RGBA')
        target = Image.new('RGBA', original.size)
        frames = []
        for row in range(5):
            for col in range(6):
                old_box = (col*256, row*256, (col+1)*256, (row+1)*256)
                new_box = tuple(round(x) for x in (col*edited.width/6, row*edited.height/5,
                                                 (col+1)*edited.width/6, (row+1)*edited.height/5))
                old = original.crop(old_box)
                new = edited.crop(new_box)
                a = old.getchannel('A').point(lambda v: 255 if v > 40 else 0).getbbox()
                b = new.getchannel('A').point(lambda v: 255 if v > 40 else 0).getbbox()
                if not a or not b:
                    raise ValueError(f'{key}: missing material frame {row}/{col}')
                layer = Image.new('RGBA', old.size)
                layer.paste(new.crop(b).resize((a[2]-a[0], a[3]-a[1]), Image.Resampling.LANCZOS), a[:2])
                base = ImageEnhance.Color(old.convert('RGB')).enhance(saturation)
                rgb = Image.composite(layer.convert('RGB'), base, layer.getchannel('A'))
                rgb.putalpha(old.getchannel('A'))
                assert ImageChops.difference(rgb.getchannel('A'), old.getchannel('A')).getbbox() is None
                target.paste(rgb, old_box[:2])
                frames.append({'frame': row*6+col, 'originalBounds': a, 'materialBounds': b})
        target.save(SOURCE / f'{key}-material-atlas.png', optimize=True)
        records[key] = {'frames': frames, 'originalAlphaExactlyPreserved': True,
                        'timingAndPosesUnchanged': True,
                        'processing': 'generated RGB material aligned per existing pose; source alpha retained exactly'}
    (SOURCE / 'material-registration.json').write_text(json.dumps(records, ensure_ascii=False, indent=2)+'\n')


if __name__ == '__main__':
    prepare()
