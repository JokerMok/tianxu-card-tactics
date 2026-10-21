#!/usr/bin/env python3
"""Link existing item table icon names to the original extracted JPGs (no download/decode)."""
from pathlib import Path
import hashlib
import json
import os
import shutil

project = Path(__file__).resolve().parents[1]
source = Path(os.environ.get('KINGS_CALL_SOURCE', project.parent / 'KingsCall-原版客户端逆向研究'))
output = project / 'cocos-client/assets/resources/recovered'
catalog = json.loads((output / 'catalog.json').read_text())
items = {}
for table in ('equipment', 'medicament', 'warrant'):
    metadata = catalog['tables'][f'main:embeddata/scp/{table}.xml']
    rows = json.loads((output / metadata['path']).read_text())['rows']
    for row in rows:
        identity = row.get('物品ID\n', row.get('物品ID'))
        if not isinstance(identity, int):
            continue
        item = {'id': f'main:item:{identity}', 'name': row.get('名字', ''), 'table': table,
                'description': row.get('描述', ''), 'quality': row.get('品质', 0),
                'slot': row.get('可装备位置1 无效填-1\n', -1),
                'sourceRow': row.get('_row'), 'sourceTable': metadata['path']}
        icon = row.get('物品栏图片_正常', row.get('物品栏图片_正常（ArticleID）'))
        if isinstance(icon, str) and '/' not in icon and '\\' not in icon:
            for ext in ('.jpg', '.png'):
                path = source / f'analysis-copy/asar/game/data/img/item/{icon}{ext}'
                if path.is_file():
                    relative = f'original-ui/items/{icon}{ext}'
                    dest = output / relative
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(path, dest)
                    item.update(icon=relative, iconSource=str(path.relative_to(source)),
                                iconSha256=hashlib.sha256(path.read_bytes()).hexdigest())
                    break
        # Source tables intentionally share the item ID namespace; match service lookup precedence.
        items.setdefault(item['id'], item)
# Local shop offers have no original item-table ID. Keep their source category
# artwork in the same import, rather than relying on an unimported URL.
categories = {}
for filename in ('kahelibao.jpg', 'shuijinglibao.jpg', 'yinbidaoju.jpg', 'qhs_1.jpg', 'cwdjinghua.jpg'):
    path = source / 'analysis-copy/asar/game/data/img/item' / filename
    if path.is_file():
        relative = f'original-ui/items/{filename}'
        dest = output / relative
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, dest)
        categories[filename] = {'icon': relative, 'iconSource': str(path.relative_to(source)),
                                'iconSha256': hashlib.sha256(path.read_bytes()).hexdigest()}
(output / 'item-ui.json').write_text(json.dumps({'version': 1, 'items': items, 'categories': categories}, ensure_ascii=False))
print(f'Item UI: {len(items)} source items; {sum("icon" in item for item in items.values())} original icon links')
