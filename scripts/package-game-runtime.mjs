import { createHash } from 'node:crypto';
import { copyFile, mkdir, open, readdir, readFile, realpath, rename, rm, stat, lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_POLICY = 'deploy/game/resource-manifest.json';

export function safeRelative(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0') || value.includes('\\')) {
    throw new Error(`Invalid runtime path: ${String(value)}`);
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value || path.posix.isAbsolute(value) || value === '..' || value.startsWith('../')) {
    throw new Error(`Runtime path escapes its source root: ${value}`);
  }
  return normalized;
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function regularFileWithin(sourceRoot, relative) {
  const clean = safeRelative(relative);
  const filename = path.resolve(sourceRoot, clean);
  if (!inside(sourceRoot, filename)) throw new Error(`Source path escapes repository: ${relative}`);
  const info = await lstat(filename);
  if (info.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in runtime packages: ${relative}`);
  if (!info.isFile()) throw new Error(`Runtime source is not a regular file: ${relative}`);
  const resolved = await realpath(filename);
  if (!inside(sourceRoot, resolved)) throw new Error(`Resolved source path escapes repository: ${relative}`);
  return { relative: clean, filename, size: info.size };
}

async function walkFiles(sourceRoot, relativeDirectory) {
  const directory = safeRelative(relativeDirectory);
  const absolute = path.resolve(sourceRoot, directory);
  if (!inside(sourceRoot, absolute)) throw new Error(`Directory escapes repository: ${relativeDirectory}`);
  const result = [];
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    const relative = path.posix.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in runtime packages: ${relative}`);
    if (entry.isDirectory()) result.push(...await walkFiles(sourceRoot, relative));
    else if (entry.isFile()) result.push(relative);
    else throw new Error(`Unsupported runtime source type: ${relative}`);
  }
  return result;
}

function stringsMatching(value, pattern, output = new Set()) {
  if (typeof value === 'string') {
    if (pattern.test(value)) output.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) stringsMatching(item, pattern, output);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) stringsMatching(item, pattern, output);
  }
  return output;
}

function catalogAssetPaths(catalog, scope) {
  const assetIds = stringsMatching({ scope: catalog.scopes?.[scope], ui: catalog.ui }, /^asset:/);
  const modelIds = stringsMatching(catalog.scopes?.[scope], /^model:/);
  const timelineIds = new Set();

  for (const modelId of modelIds) {
    const model = catalog.models?.[modelId];
    if (!model) continue;
    stringsMatching(model, /^asset:/, assetIds);
    stringsMatching(model, /^timeline:/, timelineIds);
  }

  for (const timelineId of timelineIds) {
    const timeline = catalog.timelines?.[timelineId];
    if (timeline) stringsMatching(timeline, /^asset:/, assetIds);
  }

  // Bitmap shapes can point at other imported bitmaps. Follow those links until
  // the set stops growing, rather than including every reverse-engineering asset.
  for (const assetId of assetIds) {
    const asset = catalog.assets?.[assetId];
    if (asset) stringsMatching(asset, /^asset:/, assetIds);
  }

  const paths = new Set();
  for (const assetId of assetIds) {
    const assetPath = catalog.assets?.[assetId]?.path;
    if (assetPath) paths.add(safeRelative(assetPath));
  }
  return paths;
}

async function loadPolicy(sourceRoot, policyRelative = DEFAULT_POLICY) {
  const policyFile = await regularFileWithin(sourceRoot, policyRelative);
  const policy = JSON.parse(await readFile(policyFile.filename, 'utf8'));
  if (policy.version !== 1) throw new Error(`Unsupported resource manifest version: ${policy.version}`);
  return policy;
}

function rejectSensitivePath(relative) {
  const lower = relative.toLowerCase();
  const name = path.posix.basename(lower);
  if (lower.startsWith('backend/data/') || lower.includes('/backend/data/')
      || ['.sqlite', '.sqlite3', '.db', '.pem', '.key'].some(extension => lower.endsWith(extension))
      || name === '.env' || name.startsWith('.env.')) {
    throw new Error(`Sensitive or mutable file is forbidden in runtime package: ${relative}`);
  }
}

export async function buildRuntimePlan(sourceRoot = SCRIPT_ROOT, policyRelative = DEFAULT_POLICY, { webDirectory } = {}) {
  sourceRoot = path.resolve(sourceRoot);
  const policy = await loadPolicy(sourceRoot, policyRelative);
  const paths = new Set(policy.fixedFiles.map(safeRelative));

  for (const relative of await walkFiles(sourceRoot, policy.backend.directory)) {
    if (relative.endsWith(policy.backend.extension) && !relative.endsWith(policy.backend.excludeSuffix)) paths.add(relative);
  }

  const webSource = safeRelative(webDirectory ?? policy.web.directory);
  const sourceOverrides = new Map();
  const webEntry = path.posix.join(webSource, policy.web.requiredEntry);
  await regularFileWithin(sourceRoot, webEntry);
  for (const relative of await walkFiles(sourceRoot, webSource)) {
    if (/\/(?:art-observe|art-record|player-profile)\.js$/.test(relative)) throw new Error(`Local diagnostics in release web: ${relative}`);
    if (/\.(?:js|html)$/.test(relative)) {
      const text = await readFile(path.resolve(sourceRoot,relative),'utf8');
      if (/(?:SharedRigAnimation|RigComparisonScene|rigExperimentMode|rigbench|art-observe\.js|art-record\.js|player-profile\.js)/.test(text)) throw new Error(`Experimental build cannot be released: ${relative}`);
    }
    const destination = path.posix.join(policy.web.directory, path.posix.relative(webSource, relative));
    paths.add(destination);
    sourceOverrides.set(destination, relative);
  }

  const contentDir = safeRelative(policy.content.directory);
  const catalogRelative = path.posix.join(contentDir, safeRelative(policy.content.catalog));
  paths.add(catalogRelative);
  for (const metadata of policy.content.metadata) paths.add(path.posix.join(contentDir, safeRelative(metadata)));
  const catalog = JSON.parse(await readFile(path.resolve(sourceRoot, catalogRelative), 'utf8'));

  for (const [key, table] of Object.entries(catalog.tables ?? {})) {
    if (key.startsWith(policy.content.tableScope)) paths.add(path.posix.join(contentDir, safeRelative(table.path)));
  }
  for (const assetPath of catalogAssetPaths(catalog, policy.content.assetScope)) {
    paths.add(path.posix.join(contentDir, assetPath));
  }
  if (policy.content.includeOriginalUiTree) {
    for (const relative of await walkFiles(sourceRoot, path.posix.join(contentDir, 'original-ui'))) paths.add(relative);
  }
  for (const file of policy.localization.files) {
    paths.add(path.posix.join(safeRelative(policy.localization.directory), safeRelative(file)));
  }
  for (const relative of await walkFiles(sourceRoot, policy.ui.directory)) paths.add(relative);

  if(policy.art)for(const file of policy.art.files)paths.add(path.posix.join(safeRelative(policy.art.directory),safeRelative(file)));

  const files = [];
  let bytes = 0;
  for (const relative of [...paths].sort()) {
    rejectSensitivePath(relative);
    if (/\/(?:experiments|rig-experiment)\//.test(relative)) throw new Error(`Experiment forbidden in runtime: ${relative}`);
    const file = await regularFileWithin(sourceRoot, sourceOverrides.get(relative) ?? relative);
    files.push({ ...file, relative });
    bytes += file.size;
  }
  return { sourceRoot, files, bytes, policyVersion: policy.version };
}

async function sha256(filename) {
  const handle = await open(filename, 'r');
  const hash = createHash('sha256');
  try {
    for await (const chunk of handle.readableWebStream()) hash.update(chunk);
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

export async function materializeRuntime(plan, output) {
  output = path.resolve(output);
  const parent = path.dirname(output);
  await mkdir(parent, { recursive: true });
  try {
    await stat(output);
    throw new Error(`Output already exists; choose a new directory: ${output}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temporary = `${output}.partial-${process.pid}-${Date.now()}`;
  await mkdir(temporary, { recursive: false });
  const manifest = { version: 1, createdAt: new Date().toISOString(), source: 'explicit-runtime-allowlist', files: [] };
  try {
    for (const file of plan.files) {
      const target = path.resolve(temporary, file.relative);
      if (!inside(temporary, target)) throw new Error(`Package target escapes output: ${file.relative}`);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(file.filename, target);
      const copied = await stat(target);
      manifest.files.push({ path: file.relative, bytes: copied.size, sha256: await sha256(target) });
    }
    const runtimePackage = {
      name: 'tianxu-game-runtime', private: true, type: 'module',
      engines: { node: '>=22.18' }, scripts: { start: 'node scripts/start-game.mjs' },
    };
    const packageFile = path.join(temporary, 'package.json');
    await writeFile(packageFile, `${JSON.stringify(runtimePackage, null, 2)}\n`);
    const packageStat = await stat(packageFile);
    manifest.files.push({ path: 'package.json', bytes: packageStat.size, sha256: await sha256(packageFile) });
    manifest.files.sort((left, right) => left.path.localeCompare(right.path));
    await writeFile(path.join(temporary, 'runtime-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await rename(temporary, output);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  return { output, manifest };
}

function parseArguments(argv) {
  const options = { dryRun: false, output: path.join(SCRIPT_ROOT, '.local/game-runtime'), sourceRoot: SCRIPT_ROOT };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--output') {
      const value = argv[++index];
      if (!value) throw new Error('--output requires a directory');
      options.output = path.resolve(value);
    } else if (argument === '--source-root') {
      const value = argv[++index];
      if (!value) throw new Error('--source-root requires a directory');
      options.sourceRoot = path.resolve(value);
    }
    else if (argument === '--web-root') options.webDirectory = safeRelative(argv[++index]);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const plan = await buildRuntimePlan(options.sourceRoot, DEFAULT_POLICY, { webDirectory: options.webDirectory });
  const summary = { files: plan.files.length, bytes: plan.bytes, mebibytes: Number((plan.bytes / 1048576).toFixed(1)) };
  if (options.dryRun) {
    console.log(JSON.stringify({ dryRun: true, ...summary }, null, 2));
    return;
  }
  const result = await materializeRuntime(plan, options.output);
  console.log(JSON.stringify({ dryRun: false, output: result.output, ...summary }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
