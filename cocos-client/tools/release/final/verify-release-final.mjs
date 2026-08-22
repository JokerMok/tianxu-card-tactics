import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

const T327_FORMAL_GREEN_MARKER = 'T327 verifier: PASS (contract rehearsal and optional historical rejection sample retained; live formal performance gate accepted)';
const T327_PRODUCTION_CONTRACT_RE = /^T327 production contract: PASS(?: \(.+\))?$/m;
const T327_PASS_SAMPLE_RE = /^T327 pass sample: .+$/m;
const T327_LIVE_GPU_RE = /^T327 live GPU gate: PASS \(T203 exit code 0; GPU\/WebGL2 runtime ([^/;]+?) \/ ([^;]+?); FPS (\d+(?:\.\d+)?); P95 (\d+(?:\.\d+)?)ms\)$/m;
const T327_FORMAL_BLOCKED_MARKER = 'T327 formal performance gate: BLOCKED';
const T327_HISTORICAL_NOT_CONSULTED_MARKER = 'historical artifact was not consulted';
const T327_GREEN_MARKER_RES = Object.freeze([
  /^T327 live GPU gate: PASS\b/m,
  /^T327 verifier: PASS\b/m,
  /^T327 formal performance gate: (?:PASS|GREEN)\b/m,
  /^T327 final release gate: GREEN\b/m,
]);

function formatExitCode(result) {
  if (result.status !== null) return String(result.status);
  if (result.signal) return `signal ${result.signal}`;
  return 'unknown';
}

function tail(text, maxLines = 4) {
  const lines = text.trim().split('\n').filter(Boolean);
  return lines.slice(-maxLines).join(' | ') || '(no output)';
}

function hasT327GreenMarker(output) {
  return T327_GREEN_MARKER_RES.some((marker) => marker.test(output));
}

function parseT327ChildResult(result) {
  const output = result.output ?? '';
  const reasons = [];
  const contractPass = T327_PRODUCTION_CONTRACT_RE.test(output);
  const passSample = T327_PASS_SAMPLE_RE.test(output);
  const liveMatch = T327_LIVE_GPU_RE.exec(output);
  const formalGreen = output.includes(T327_FORMAL_GREEN_MARKER);
  const blocked = output.includes(T327_FORMAL_BLOCKED_MARKER);
  const historicalNotConsulted = output.includes(T327_HISTORICAL_NOT_CONSULTED_MARKER);
  const greenMarker = hasT327GreenMarker(output);

  if (result.status === 0) {
    if (!contractPass) reasons.push('missing exact T327 production contract PASS marker');
    if (!liveMatch) reasons.push('missing exact T327 live GPU gate PASS marker');
    if (!formalGreen) reasons.push('missing exact T327 formal GREEN verifier marker');
    if (greenMarker && !liveMatch) reasons.push('T327 GREEN text is not backed by the exact live GPU PASS line');
    if (liveMatch) {
      const gpuVendor = liveMatch[1].trim();
      const gpuRenderer = liveMatch[2].trim();
      const fps = Number(liveMatch[3]);
      const p95FrameTimeMs = Number(liveMatch[4]);
      if (gpuVendor.length === 0 || gpuRenderer.length === 0) reasons.push('T327 live GPU PASS marker has an empty vendor or renderer');
      if (!Number.isFinite(fps) || fps < 55) reasons.push(`T327 live FPS is below the formal threshold (${String(fps)} < 55)`);
      if (!Number.isFinite(p95FrameTimeMs) || p95FrameTimeMs > 22) reasons.push(`T327 live P95 exceeds the formal threshold (${String(p95FrameTimeMs)} > 22ms)`);
    }
    if (reasons.length === 0) {
      return {
        passed: true,
        rehearsalPassed: true,
        formalPassed: true,
        classification: 'GREEN',
        failure: null,
        observations: `GPU/WebGL2 runtime ${liveMatch[1].trim()} / ${liveMatch[2].trim()}; FPS ${liveMatch[3]}; P95 ${liveMatch[4]}ms`,
      };
    }
    return {
      passed: false,
      rehearsalPassed: false,
      formalPassed: false,
      classification: 'ABNORMAL',
      failure: reasons.join('; '),
      observations: '',
    };
  }

  if (result.status !== null && result.status !== 0
    && contractPass && passSample && blocked && historicalNotConsulted && !greenMarker) {
    return {
      passed: false,
      rehearsalPassed: true,
      formalPassed: false,
      classification: 'REHEARSAL_PASS_FORMAL_BLOCKED',
      failure: `expected raw exit code ${formatExitCode(result)} with T327 formal performance gate BLOCKED; historical artifact was not consulted`,
      observations: `raw exit code ${formatExitCode(result)}; contract and pass-sample rehearsal completed; formal performance BLOCKED`,
    };
  }

  if (result.status === null) reasons.push(`T327 verifier did not exit normally (${formatExitCode(result)})`);
  else reasons.push(`T327 verifier exited with code ${formatExitCode(result)}`);
  if (!contractPass) reasons.push('missing exact T327 production contract PASS marker');
  if (!passSample) reasons.push('missing T327 pass sample marker');
  if (!blocked) reasons.push('missing T327 formal performance gate BLOCKED marker');
  if (!historicalNotConsulted) reasons.push('missing historical artifact was not consulted marker');
  if (greenMarker) reasons.push('unexpected T327 live GPU PASS/GREEN marker on nonzero exit');
  return {
    passed: false,
    rehearsalPassed: false,
    formalPassed: false,
    classification: 'ABNORMAL',
    failure: reasons.join('; '),
    observations: '',
  };
}

function expectT327Abnormal(label, result) {
  const parsed = parseT327ChildResult(result);
  if (parsed.classification !== 'ABNORMAL' || parsed.passed || parsed.formalPassed) {
    throw new Error(`${label} was accepted unexpectedly`);
  }
  console.log(`  negative PASS: ${label}`);
}

function runT327ParserCounterexamples() {
  const blockedOutput = [
    'T327 production contract: PASS (E104 6 layers; T251 7 effects/7 audio)',
    'T327 pass sample: 120 raw frames; FPS 61.350; P95 16.300ms PASS',
    'T327 verifier: FAIL (T327 formal performance gate: BLOCKED (T203 live GPU verifier exited with code 1; historical artifact was not consulted',
  ].join('\n');
  expectT327Abnormal('missing T327 BLOCKED marker', {
    status: 1,
    output: blockedOutput.replace(T327_FORMAL_BLOCKED_MARKER, 'T327 formal performance gate: UNKNOWN'),
  });
  expectT327Abnormal('forged T327 live GPU PASS on nonzero exit', {
    status: 1,
    output: `${blockedOutput}\nT327 live GPU gate: PASS (T203 exit code 0; GPU/WebGL2 runtime FakeVendor / FakeRenderer; FPS 60; P95 18ms)`,
  });
  expectT327Abnormal('formal-runtime or historical artifact substituted for live evidence', {
    status: 0,
    output: [
      'T327 production contract: PASS (E104 6 layers; T251 7 effects/7 audio)',
      'T327 pass sample: 120 raw frames; FPS 61.350; P95 16.300ms PASS',
      'historical artifact: formal-runtime; GPU Vendor FakeVendor; FPS 60; P95 18ms',
    ].join('\n'),
  });
  console.log('T327 parser counterexamples: PASS (missing BLOCKED marker, forged live PASS, historical/formal-runtime substitution)');
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
      ...(child.id === 'T327' ? {
        rehearsalPassed: false,
        formalPassed: false,
        classification: 'ABNORMAL',
        observations: '',
      } : {}),
    };
  }

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (child.id === 'T327') {
    return {
      ...child,
      status: result.status,
      signal: result.signal,
      output,
      ...parseT327ChildResult({ ...result, output }),
    };
  }
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

function printChildEvidence(result) {
  console.log(`\n=== ${result.id} ${result.name}: child verifier exit ${formatExitCode(result)} ===`);
  console.log(result.output || '(no output)');
  if (result.id === 'T327' && result.rehearsalPassed && !result.formalPassed) {
    console.log(`child gate: rehearsal PASS; formal performance BLOCKED (${result.failure})`);
  } else if (!result.passed) {
    console.log(`child gate: BLOCKED (${result.failure})`);
  }
}

function printRollback() {
  console.log('\nT265 rollback: stop release; preserve this verifier, final report, child outputs, and failure evidence; after merge run git revert -m 1 <T265 merge SHA (parent baseline 8161b9489798b342a4c4e920fb6b763a74b4a110)>; rerun the specified T265 command; only after a real GREEN result may the coordinator update the shared ledger. If worktree restoration is required and there are no parallel changes, use git restore --source=<T265 merge SHA>^ -- cocos-client/tools/release/final documentation/release/final.');
}

function main() {
  runT327ParserCounterexamples();
  const childResults = childVerifiers.map(runChildVerifier);
  childResults.forEach(printChildEvidence);

  const performanceResult = childResults.find(({ id }) => id === 'T327');
  assert(performanceResult, 'T327 child verifier result must exist');
  console.log(`\nT265 T326 stability gate: ${childResults.find(({ id }) => id === 'T326').passed ? 'PASS' : 'BLOCKED'}`);
  console.log(`T265 T328 security gate: ${childResults.find(({ id }) => id === 'T328').passed ? 'PASS' : 'BLOCKED'}`);
  console.log(`T265 T329 recovery gate: ${childResults.find(({ id }) => id === 'T329').passed ? 'PASS' : 'BLOCKED'}`);
  console.log(`T327 rehearsal: ${performanceResult.rehearsalPassed ? 'PASS (contract completed)' : 'BLOCKED (child output was incomplete or abnormal)'}`);
  console.log(`T327 formal performance gate: ${performanceResult.formalPassed ? 'PASS' : 'BLOCKED'}`);
  if (performanceResult.observations) console.log(`T327 raw child evidence: ${performanceResult.observations}`);

  const blockers = [];
  childResults.filter(({ id }) => id !== 'T327').forEach(({ id, failure, passed }) => {
    if (!passed) blockers.push(`${id}: ${failure}`);
  });
  if (!performanceResult.rehearsalPassed) blockers.push(`T327 rehearsal: ${performanceResult.failure}`);
  if (!performanceResult.formalPassed) blockers.push(`T327 formal performance: ${performanceResult.failure}`);

  const allGatesPassed = childResults.every(({ passed }) => passed);
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
