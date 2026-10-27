"""Read-only report for the named chapter-two isolated ordinary-play database."""
from pathlib import Path
import collections, json, sqlite3

ROOT = Path(__file__).resolve().parents[2]
LOCAL = ROOT / '.local/chapter2-normal'
OUT = ROOT / 'documentation/chapter2-normal/evidence'
OUT.mkdir(parents=True, exist_ok=True)
initial = json.loads((LOCAL / 'initial-state.json').read_text())
actor_id = initial['actor']['id']
db = sqlite3.connect('file:' + str(LOCAL / 'game.sqlite') + '?mode=ro', uri=True)
world = json.loads(db.execute('SELECT json FROM game_world WHERE id=1').fetchone()[0])
actor = world['characters'][actor_id]
catalog = json.loads((ROOT / 'cocos-client/assets/resources/recovered/catalog.json').read_text())['scopes']['main']
zh = json.loads((ROOT / 'cocos-client/assets/resources/localization/game-zh.json').read_text())
art = json.loads((ROOT / 'cocos-client/assets/resources/art-samples/v5/manifest.json').read_text())
models, records, missing = {}, [], set()
for battle in world['battles'].values():
    if actor_id not in battle['participants'] or battle.get('level', {}).get('sceneId') != 'main:scene:2':
        continue
    node = battle['level']['nodeId']
    states = [battle.get('entryState', {}), battle['state']]
    observed = {}
    for state in states:
        units = list(state.get('units', []))
        for event in state.get('events', []):
            units += [event[key] for key in ['actorView', 'targetView'] if isinstance(event.get(key), dict)]
        for unit in units:
            monster = unit.get('monsterId')
            if not monster:
                continue  # Player hero uses separate actor layers, not a pawn atlas.
            model = catalog.get('monsterModels', {}).get(str(monster), {}).get('modelId')
            if not model:
                missing.add((node, monster))
                continue
            role = 'fixed-enemy-hero' if unit.get('flags', {}).get('hero') else 'unit'
            observed[(unit['id'], model)] = (unit, monster, model, role)
    for unit, monster, model, role in observed.values():
        key = model
        card = unit.get('cardId', '')
        original = catalog['monsters'].get(str(monster), {}).get('Name', '')
        name = zh.get('cards', {}).get(card, {}).get('name', original)
        row = models.setdefault(key, {'modelId': model, 'roles': set(), 'roleBattles': collections.defaultdict(set), 'roleInstances': collections.Counter(), 'monsterIds': set(), 'cardIds': set(), 'names': set(), 'originalNames': set(), 'nodes': set(), 'battles': set(), 'instances': 0,
            'newArt': ('main:' + model in art['models'] or 'main:monster:' + str(monster) in art['units'])})
        row['monsterIds'].add(monster)
        row['roles'].add(role)
        row['roleBattles'][role].add(battle['id'])
        row['roleInstances'][role] += 1
        if card.startswith('main:card:'):
            row['cardIds'].add(card)
        row['names'].add(name)
        row['originalNames'].add(original)
        row['nodes'].add(node)
        row['battles'].add(battle['id'])
        row['instances'] += 1
    settlements = db.execute('SELECT reward FROM settlements WHERE battle_id=? AND actor_id=?', (battle['id'], actor_id)).fetchall()
    records.append({'id': battle['id'], 'node': node, 'trigger': battle['level']['triggerId'], 'settled': battle['settled'], 'turn': battle['state']['turn'],
        'playerDeck': next(p['deck'] for p in battle['entryState']['players'] if p['id'] == actor_id),
        'enemyHeroes': [{k: p[k] for k in ['monsterId', 'name', 'hp', 'attack'] if k in p} for p in battle['entryState']['players'] if p['team'] == 1],
        'rewards': battle['rewards'].get(actor_id), 'settlementCount': len(settlements),
        'eventTypes': dict(collections.Counter(e['type'] for e in battle['state']['events']))})
db.close()
rows = []
for value in models.values():
    row = {k: sorted(v) if isinstance(v, set) else v for k, v in value.items()}
    row['roleBattles'] = {k:sorted(v) for k,v in value['roleBattles'].items()}
    row['battleCount'] = len(row['battles'])
    rows.append(row)
rows.sort(key=lambda r: (-r['battleCount'], -r['instances'], r['modelId']))
summary = {'scope': 'Actual ordinary chapter-two battles in one isolated continuation; no GM, fixtures, forced seeds or level edits. Counts are observations, not random-pool probabilities.',
    'before': {k: initial['actor'][k] for k in ['level', 'xp', 'cards', 'deck', 'currencies', 'progress']},
    'after': {k: actor[k] for k in ['level', 'xp', 'cards', 'deck', 'currencies', 'progress']}, 'battles': records}
(OUT / 'normal-path.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
(OUT / 'observed-art.json').write_text(json.dumps({'scope': summary['scope'], 'battleCount': len(records), 'rows': rows,
    'unresolvedMappings': [{'node':node,'monsterId':monster} for node,monster in sorted(missing)],
    'nextPriority': [r for r in rows if not r['newArt'] and 'unit' in r['roles']][:6],
    'fixedHeroBoundary': 'Fixed enemy heroes are reported separately from random troops; original player hero layers occur throughout and were already shortlisted.'}, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'battles': [(r['node'], r['turn'], (r['rewards'] or {}).get('won')) for r in records],
    'observedModels': len(rows), 'oldModels': sum(not r['newArt'] for r in rows)}, ensure_ascii=False))
