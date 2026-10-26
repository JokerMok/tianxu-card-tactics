"""Package only a manifest and its referenced art; never includes a game DB or source archive."""
from pathlib import Path
import argparse, hashlib, json, urllib.request, zipfile

p = argparse.ArgumentParser()
p.add_argument('--manifest', required=True)
p.add_argument('--output', required=True)
p.add_argument('--record', required=True)
p.add_argument('--verify-url', help='Local QA art root, e.g. http://127.0.0.1:7440/art/')
args = p.parse_args()
root = Path(__file__).resolve().parents[2]
resources = (root / 'cocos-client/assets/resources').resolve()
manifest = (root / args.manifest).resolve()
data = json.loads(manifest.read_text())
files = {manifest}
for group in ('images', 'units'):
    for item in data[group].values():
        name = item.get('file') or item.get('atlas')
        if name:
            file = (manifest.parent / name).resolve()
            if not file.is_relative_to(resources / 'art-samples'):
                raise ValueError('Reference escapes art directory: ' + name)
            files.add(file)
out = (root / args.output).resolve()
out.parent.mkdir(parents=True, exist_ok=True)
records = []
with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED) as z:
    for file in sorted(files):
        payload = file.read_bytes()
        relative = str(file.relative_to(resources))
        record = {'file': relative, 'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()}
        if args.verify_url:
            http_path = str(file.relative_to(resources / 'art-samples'))
            with urllib.request.urlopen(args.verify_url.rstrip('/') + '/' + http_path) as response:
                assert response.status == 200
                assert response.read() == payload, 'HTTP source mismatch: ' + relative
                record['httpContentType'] = response.headers.get('Content-Type')
                if file.suffix == '.webp':
                    assert record['httpContentType'].split(';')[0] == 'image/webp'
        z.writestr(relative, payload)
        records.append(record)
result = {'pack': data['id'], 'files': records, 'fileCount': len(records),
          'compressedPackageBytes': out.stat().st_size,
          'packageSha256': hashlib.sha256(out.read_bytes()).hexdigest(),
          'scope': 'Runtime art only; raw source, review media, accounts, DB, logs excluded'}
record_path = root / args.record
record_path.parent.mkdir(parents=True, exist_ok=True)
record_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({k:v for k,v in result.items() if k != 'files'}, ensure_ascii=False))
