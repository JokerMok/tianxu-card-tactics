"""Read-only report for the named chapter-three isolated ordinary-play database."""
from pathlib import Path
import collections, json, sqlite3

ROOT = Path(__file__).resolve().parents[2]
LOCAL = ROOT / '.local/chapter3-normal'
OUT = ROOT / 'documentation/chapter3-normal/evidence'
OUT.mkdir(parents=True, exist_ok=True)
initial = json.loads((LOCAL / 'initial-state.json').read_text())
actor_id = initial['actor']['id']
db = sqlite3.connect('file:' + str(LOCAL / 'game.sqlite') + '?mode=ro', uri=True)
world = json.loads(db.execute('SELECT json FROM game_world WHERE id=1').fetchone()[0])
actor = world['characters'][actor_id]
catalog = json.loads((ROOT / 'cocos-client/assets/resources/recovered/catalog.json').read_text())['scopes']['main']
zh = json.loads((ROOT / 'cocos-client/assets/resources/localization/game-zh.json').read_text())
art = json.loads((ROOT / 'cocos-client/assets/resources/art-samples/v5/manifest.json').read_text())
grind_ids = {json.loads(line)['id'] for line in (LOCAL / 'http-progression.jsonl').read_text().splitlines()}
grind_ids.update(b['id'] for b in json.loads((ROOT / 'documentation/player-experience/evidence/normal-level5.json').read_text())['battles'])
models, records, missing = {}, [], set()
for battle in world['battles'].values():
    if actor_id not in battle['participants'] or battle.get('level', {}).get('sceneId') not in ['main:scene:1','main:scene:2','main:scene:3']:
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
            'nonGrindBattles': set(), 'nonGrindNodes':set(), 'scenes': set(), 'newArt': ('main:' + model in art['models'] or 'main:monster:' + str(monster) in art['units'])})
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
        row['scenes'].add(battle['level']['sceneId'])
        if battle['id'] not in grind_ids:
            row['nonGrindBattles'].add(battle['id'])
            row['nonGrindNodes'].add(node)
    settlements = db.execute('SELECT reward FROM settlements WHERE battle_id=? AND actor_id=?', (battle['id'], actor_id)).fetchall()
    records.append({'id': battle['id'], 'node': node, 'trigger': battle['level']['triggerId'], 'scene':battle['level']['sceneId'], 'settled': battle['settled'], 'turn': battle['state']['turn'],
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
    row['nonGrindBattleCount'] = len(row['nonGrindBattles'])
    row['nodeCount'] = len(row['nodes'])
    row['sceneCount'] = len(row['scenes'])
    rows.append(row)
rows.sort(key=lambda r: (-r['nonGrindBattleCount'], -len(r['nonGrindNodes']), -r['sceneCount'], -r['battleCount'], r['modelId']))
summary = {'scope': 'Actual ordinary chapters 1-3 in one isolated continuation, including formal HTTP repeat progression. No GM, fixtures, forced seeds or level edits. Counts are observations, not probabilities; HTTP and Cocos evidence are distinguished in README.',
    'before': {k: initial['actor'][k] for k in ['level', 'xp', 'cards', 'deck', 'currencies', 'progress','inventory']},
    'after': {k: actor[k] for k in ['level', 'xp', 'cards', 'deck', 'currencies', 'progress','inventory']}, 'battles': [record for record in records if record['scene']=='main:scene:3']}
(OUT / 'normal-path.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
(OUT / 'observed-art.json').write_text(json.dumps({'scope': summary['scope'], 'battleCount': len(records), 'rows': rows,
    'unresolvedMappings': [{'node':node,'monsterId':monster} for node,monster in sorted(missing)],
    'nextPriority': [r for r in rows if not r['newArt'] and 'unit' in r['roles']][:6],
    'priorityBoundary':'Primary ordering uses non-grind battles and distinct non-grind nodes, then observed chapters; the 28 current and 6 prior HTTP grind battles are reported separately, never treated as natural encounter frequency.',
    'fixedHeroBoundary': 'Fixed enemy heroes are reported separately from random troops; original player hero layers occur throughout and were already shortlisted.'}, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'battles': [(r['node'], r['turn'], (r['rewards'] or {}).get('won')) for r in records],
    'observedModels': len(rows), 'oldModels': sum(not r['newArt'] for r in rows)}, ensure_ascii=False))
