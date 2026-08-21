import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const toolRoot = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(toolRoot, '../../..');

const childVerifiers = Object.freeze([
  {
    id: 'T326',
    name: 'stability',
    file: path.join(clientRoot, 'tools', 'release', 'stability', 'verify-stability.mjs'),
    conclusionMarkers: [
      'T326 stability rehearsal: PASS',
      'T326 conclusion: release gate is green',
    ],
  },
  {
    id: 'T327',
    name: 'performance rehearsal',
    file: path.join(clientRoot, 'tools', 'release', 'perf', 'verify-perf.mjs'),
    conclusionMarkers: [
      'T327 production contract: PASS',
      'T327 verifier: PASS',
      'release decision remains BLOCKED',
    ],
  },
  {
    id: 'T328',
    name: 'security',
    file: path.join(clientRoot, 'tools', 'release', 'security', 'verify-security.mjs'),
    conclusionMarkers: [
      'T328 real release security contracts: PASS',
      'T328 conclusion: release security rehearsal PASS',
    ],
  },
  {
    id: 'T329',
    name: 'recovery',
    file: path.join(clientRoot, 'tools', 'release', 'recovery', 'verify-recovery.mjs'),
    conclusionMarkers: [
      'T329 SaveSchema recovery: PASS',
      'T329 conclusion: release recovery rehearsal PASS',
    ],
  },
]);

const performanceEvidence = Object.freeze({
  manifest: path.join(clientRoot, 'assets', 'a0-manifest.json'),
  runtimeArtifact: path.join(clientRoot, 'test-artifacts', 'BattleA0-performance.json'),
  contractFixture: path.join(clientRoot, 'tools', 'release', 'perf', 'samples', 'pass-raw-frame-times.json'),
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readRegularFile(filePath, label) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    throw new Error(`${label} cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(filePath, label) {
  const source = readRegularFile(filePath, label);
  if (source.trim().length === 0) throw new Error(`${label} must not be empty`);
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function formatExitCode(result) {
  if (result.status !== null) return String(result.status);
  if (result.signal) return `signal ${result.signal}`;
  return 'unknown';
}

function tail(text, maxLines = 4) {
  const lines = text.trim().split('\n').filter(Boolean);
  return lines.slice(-maxLines).join(' | ') || '(no output)';
}

function runChildVerifier(child) {
  let result;
  try {
    result = spawnSync(process.execPath, ['--experimental-strip-types', child.file], {
      cwd: clientRoot,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      timeout: 180_000,
    });
  } catch (error) {
    return {
      ...child,
      status: null,
      signal: null,
      output: '',
      passed: false,
      failure: `could not start verifier: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  const missingMarkers = child.conclusionMarkers.filter((marker) => !output.includes(marker));
  const passed = result.status === 0 && missingMarkers.length === 0;
  const failure = passed
    ? null
    : [
      result.status === 0 ? null : `exit code ${formatExitCode(result)}`,
      missingMarkers.length > 0 ? `missing evidence markers: ${missingMarkers.join(', ')}` : null,
      result.error ? `process error: ${result.error.message}` : null,
      result.status !== 0 ? `last output: ${tail(output)}` : null,
    ].filter(Boolean).join('; ');

  return {
    ...child,
    status: result.status,
    signal: result.signal,
    output,
    passed,
    failure,
  };
}

function assessPerformanceEvidence() {
  const evidence = {
    passed: false,
    reasons: [],
    observations: [],
  };

  try {
    const manifest = readJson(performanceEvidence.manifest, 'real A0 performance manifest');
    const artifact = readJson(performanceEvidence.runtimeArtifact, 'real BattleA0 performance artifact');
    const fixture = readJson(performanceEvidence.contractFixture, 'T327 pass sample');

    if (!isRecord(manifest.stress)) evidence.reasons.push('real A0 manifest has no stress contract');
    const minimumFps = manifest.stress?.minimumFps;
    const maximumP95FrameTimeMs = manifest.stress?.maximumP95FrameTimeMs;
    if (!Number.isFinite(minimumFps) || !Number.isFinite(maximumP95FrameTimeMs)) {
      evidence.reasons.push('real A0 manifest performance thresholds are missing or invalid');
    }

    const final = isRecord(artifact.final) ? artifact.final : null;
    const canvas = isRecord(artifact.canvas) ? artifact.canvas : null;
    const stressSample = isRecord(artifact.stressFrameSample) ? artifact.stressFrameSample : null;

    evidence.observations.push(`artifact headless=${String(artifact.headless)}`);
    evidence.observations.push(`artMode=${String(final?.artMode)}`);
    evidence.observations.push(`previewPoseAssets=${String(final?.previewPoseAssets)}`);
    evidence.observations.push(`artIntegrationComplete=${String(final?.artIntegrationComplete)}`);
    evidence.observations.push(`absolutePerformancePass=${String(artifact.absolutePerformancePass)}`);
    evidence.observations.push(`stress FPS=${typeof stressSample?.fps === 'number' ? stressSample.fps.toFixed(3) : String(stressSample?.fps)}`);
    evidence.observations.push(`stress P95=${typeof stressSample?.p95FrameTimeMs === 'number' ? stressSample.p95FrameTimeMs.toFixed(3) : String(stressSample?.p95FrameTimeMs)}ms`);
    evidence.observations.push(`thresholds FPS>=${String(minimumFps)}, P95<=${String(maximumP95FrameTimeMs)}ms`);
    evidence.observations.push(`pass sample evidenceClass=${String(fixture.evidenceClass)}`);

    if (fixture.evidenceClass !== 'contract-rehearsal-fixture') {
      evidence.reasons.push('T327 passing sample is not explicitly marked as a contract rehearsal fixture');
    }
    if (artifact.headless !== false) evidence.reasons.push(`real runtime artifact is headless=${String(artifact.headless)}; formal evidence requires headless=false`);
    if (!canvas || canvas.width !== 1920 || canvas.height !== 1080 || canvas.bufferWidth !== 1920 || canvas.bufferHeight !== 1080) {
      evidence.reasons.push('real runtime artifact does not prove a 1920x1080 device-resolution canvas');
    }
    if (!final || final.stressMode !== true || final.activeUnits !== manifest.stress?.units) {
      evidence.reasons.push(`real runtime artifact does not prove the ${String(manifest.stress?.units)}-unit stress state`);
    }
    if (!final || final.artMode !== 'formal-runtime' || final.previewPoseAssets !== 0 || final.artIntegrationComplete !== true) {
      evidence.reasons.push(`real runtime artifact uses non-formal assets (artMode=${String(final?.artMode)}, previewPoseAssets=${String(final?.previewPoseAssets)}, artIntegrationComplete=${String(final?.artIntegrationComplete)})`);
    }
    if (artifact.absolutePerformancePass !== true) evidence.reasons.push('real runtime artifact absolutePerformancePass is not true');
    if (!stressSample || !Number.isFinite(stressSample.fps) || stressSample.fps < minimumFps) {
      evidence.reasons.push(`real stress FPS is below the formal threshold (${String(stressSample?.fps)} < ${String(minimumFps)})`);
    }
    if (!stressSample || !Number.isFinite(stressSample.p95FrameTimeMs) || stressSample.p95FrameTimeMs > maximumP95FrameTimeMs) {
      evidence.reasons.push(`real stress P95 exceeds the formal threshold (${String(stressSample?.p95FrameTimeMs)} > ${String(maximumP95FrameTimeMs)}ms)`);
    }

    evidence.passed = evidence.reasons.length === 0;
    return evidence;
  } catch (error) {
    evidence.reasons.push(error instanceof Error ? error.message : String(error));
    return evidence;
  }
}

function printChildEvidence(result) {
  console.log(`\n=== ${result.id} ${result.name}: child verifier exit ${formatExitCode(result)} ===`);
  console.log(result.output || '(no output)');
  if (!result.passed) console.log(`child gate: BLOCKED (${result.failure})`);
}

function printRollback() {
  console.log('\nT265 rollback: stop release; preserve this verifier, final report, child outputs, and failure evidence; run git revert <T265 commit SHA>; rerun the specified T265 command; only after a real GREEN result may the coordinator update the shared ledger. If worktree restoration is required and there are no parallel changes, use git restore --source=<T265 commit SHA>^ -- cocos-client/tools/release/final documentation/release/final.');
}

function main() {
  const childResults = childVerifiers.map(runChildVerifier);
  childResults.forEach(printChildEvidence);

  const performanceResult = childResults.find(({ id }) => id === 'T327');
  assert(performanceResult, 'T327 child verifier result must exist');
  const performance = assessPerformanceEvidence();
  console.log(`\nT265 T326 stability gate: ${childResults.find(({ id }) => id === 'T326').passed ? 'PASS' : 'BLOCKED'}`);
  console.log(`T265 T328 security gate: ${childResults.find(({ id }) => id === 'T328').passed ? 'PASS' : 'BLOCKED'}`);
  console.log(`T265 T329 recovery gate: ${childResults.find(({ id }) => id === 'T329').passed ? 'PASS' : 'BLOCKED'}`);
  console.log(`T327 verifier result: ${performanceResult.passed ? 'PASS (rehearsal assertions completed)' : 'BLOCKED (child verifier did not complete)'}`);
  console.log(`T327 formal performance gate: ${performance.passed ? 'PASS' : 'BLOCKED'}`);
  console.log(`T327 formal evidence: ${performance.observations.join('; ')}`);

  const blockers = [];
  childResults.filter(({ id }) => id !== 'T327').forEach(({ id, failure, passed }) => {
    if (!passed) blockers.push(`${id}: ${failure}`);
  });
  if (!performanceResult.passed) blockers.push(`T327 verifier: ${performanceResult.failure}`);
  blockers.push(...performance.reasons.map((reason) => `T327 formal performance: ${reason}`));

  const allGatesPassed = childResults.every(({ passed }) => passed) && performance.passed;
  if (allGatesPassed) {
    console.log('\nT265 final release gate: GREEN (stability, performance, security, and recovery are all backed by real passing evidence)');
    return;
  }

  console.log('\nT265 final release gate: BLOCKED');
  console.log(`T265 blocking gaps: ${blockers.join(' | ')}`);
  printRollback();
  process.exitCode = 1;
}

main();
