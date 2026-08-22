import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const toolRoot = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(toolRoot, '../../..');
const repoRoot = path.resolve(clientRoot, '..');
const sceneRoot = path.join(clientRoot, 'assets/resources/art/battle/scenes/E104');
const effectsRoot = path.join(clientRoot, 'assets/resources/art/battle/effects');
const audioRoot = path.join(clientRoot, 'assets/resources/art/battle/audio');

const manifestPath = path.join(clientRoot, 'assets/a0-manifest.json');
const performanceSourcePath = path.join(clientRoot, 'assets/scripts/battle/performance/production-performance.ts');
const sceneContractPath = path.join(sceneRoot, 'scene-contract.json');
const effectsContractPath = path.join(effectsRoot, 'battle-effects-audio-contract.json');
const runtimeArtifactPath = path.join(clientRoot, 'test-artifacts/BattleA0-performance.json');
const passSamplePath = path.join(toolRoot, 'samples/pass-raw-frame-times.json');
const t203VerifierPath = path.join(clientRoot, 'tools/verify-production-performance.mjs');

function fail(message) {
  throw new Error(message);
}

function requireRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function requireFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${label} must be a finite number`);
  return value;
}

function readRegularFile(filePath, label) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    fail(`${label} cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${label} must be a regular file`);
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(filePath, label) {
  const text = readRegularFile(filePath, label);
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function expectFailure(label, action, expectedMessage) {
  try {
    action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.match(message, expectedMessage, `${label} returned an unexpected rejection`);
    console.log(`  negative PASS: ${label}`);
    return;
  }
  fail(`${label} was accepted unexpectedly`);
}

function scenarioFields(scenario) {
  return {
    renderer: scenario.renderer,
    width: scenario.resolution[0],
    height: scenario.resolution[1],
    units: scenario.units,
    sceneLayers: scenario.sceneLayers,
    basicEffects: scenario.basicEffects,
    audioFeedbacks: scenario.audioFeedbacks,
    sceneContractVersion: scenario.sceneContractVersion,
    effectsAudioContractVersion: scenario.effectsAudioContractVersion,
  };
}

function calculateFrameMetrics(frameTimesMs, label) {
  if (!Array.isArray(frameTimesMs) || frameTimesMs.length < 120) {
    fail(`${label}.frameTimesMs must contain at least 120 raw samples`);
  }
  const values = frameTimesMs.map((value, index) => {
    const frameTimeMs = requireFiniteNumber(value, `${label}.frameTimesMs[${index}]`);
    if (frameTimeMs <= 0) fail(`${label}.frameTimesMs[${index}] must be greater than zero`);
    return frameTimeMs;
  });
  const sorted = [...values].sort((left, right) => left - right);
  const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  const averageFrameTimeMs = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    fps: 1000 / averageFrameTimeMs,
    p95FrameTimeMs: sorted[p95Index],
    sampleCount: values.length,
  };
}

function validatePassSample(sample, scenario, performance) {
  const value = requireRecord(sample, 'pass sample');
  if (value.kind !== 'raw-frame-time-sample') fail('pass sample kind is invalid');
  if (value.evidenceClass !== 'contract-rehearsal-fixture') fail('pass sample evidence class must be explicit');
  const expectedFields = scenarioFields(scenario);
  Object.entries(expectedFields).forEach(([field, expected]) => {
    if (value[field] !== expected) fail(`pass sample ${field} does not match the production scenario`);
  });
  const gate = requireRecord(value.gate, 'pass sample gate');
  if (gate.minimumFps !== performance.PERFORMANCE_LIMITS.minFps || gate.maximumP95FrameTimeMs !== performance.PERFORMANCE_LIMITS.maxP95FrameTimeMs) {
    fail('pass sample gate does not match the production thresholds');
  }
  const metrics = calculateFrameMetrics(value.frameTimesMs, 'pass sample');
  performance.validatePerformanceSample(metrics);
  return metrics;
}

function validateReleaseArtifact(artifact, scenario, performance) {
  const value = requireRecord(artifact, 'runtime performance artifact');
  if (value.headless !== false) fail('runtime performance artifact must be a headful run');
  const canvas = requireRecord(value.canvas, 'runtime performance artifact canvas');
  if (canvas.width !== scenario.resolution[0] || canvas.height !== scenario.resolution[1] || canvas.bufferWidth !== scenario.resolution[0] || canvas.bufferHeight !== scenario.resolution[1]) {
    fail('runtime performance artifact canvas must be 1920x1080 at device resolution');
  }
  const final = requireRecord(value.final, 'runtime performance artifact final state');
  if (final.stressMode !== true || final.activeUnits !== scenario.units) fail('runtime performance artifact does not contain the 24-unit stress state');
  if (final.artMode !== 'formal-runtime' || final.previewPoseAssets !== 0 || final.artIntegrationComplete !== true) {
    fail('runtime performance artifact must use formal runtime assets, not preview poses');
  }
  if (value.absolutePerformancePass !== true) fail('runtime performance artifact absolute performance gate is not passing');
  const stressSample = requireRecord(value.stressFrameSample, 'runtime performance artifact stress sample');
  performance.validatePerformanceSample(stressSample);
  return stressSample;
}

function blockFormalPerformanceGate(message) {
  fail(`T327 formal performance gate: BLOCKED (${message})`);
}

function validateT203LiveEvidence(output, scenario, performance) {
  const contractMatch = output.match(/^T203 production contract: PASS \(E104 (\d+) layers; T251 (\d+) effects\/(\d+) audio\)$/m);
  if (!contractMatch) fail('T203 live evidence is missing the production contract PASS marker');
  const contractFields = contractMatch.slice(1).map(Number);
  if (contractFields[0] !== scenario.sceneLayers || contractFields[1] !== scenario.basicEffects || contractFields[2] !== scenario.audioFeedbacks) {
    fail('T203 live evidence production contract does not match the required scene/effects/audio contract');
  }

  const scenarioMatch = output.match(/^T203 scenario: GPU (\d+)x(\d+), (\d+) units, (\d+) layers, (\d+) basic effects$/m);
  if (!scenarioMatch) fail('T203 live evidence is missing the GPU production scenario marker');
  const scenarioFieldsFromOutput = scenarioMatch.slice(1).map(Number);
  const expectedScenarioFields = [
    scenario.resolution[0],
    scenario.resolution[1],
    scenario.units,
    scenario.sceneLayers,
    scenario.basicEffects,
  ];
  if (scenarioFieldsFromOutput.some((value, index) => value !== expectedScenarioFields[index])) {
    fail('T203 live evidence scenario does not match the required 1920x1080 GPU production scenario');
  }

  // T203 owns the live WebGL2/formal-runtime checks; T327 consumes only its exact success lines.
  const runtimeMatch = output.match(/^T203 GPU runtime: PASS \((.+) \/ (.+)\)$/m);
  if (!runtimeMatch) fail('T203 live evidence is missing the GPU runtime PASS marker');
  const gpuVendor = runtimeMatch[1].trim();
  const gpuRenderer = runtimeMatch[2].trim();
  if (gpuVendor.length === 0 || gpuRenderer.length === 0) fail('T203 live GPU evidence must include GPU vendor and renderer');

  const performanceMatch = output.match(/^T203 measured performance: FPS (\d+(?:\.\d+)?); P95 (\d+(?:\.\d+)?)ms PASS$/m);
  if (!performanceMatch) fail('T203 live evidence is missing the measured FPS/P95 PASS marker');
  const fps = Number(performanceMatch[1]);
  const p95FrameTimeMs = Number(performanceMatch[2]);
  if (!Number.isFinite(fps) || fps < performance.PERFORMANCE_LIMITS.minFps) {
    fail(`T203 live FPS evidence is below ${performance.PERFORMANCE_LIMITS.minFps}`);
  }
  if (!Number.isFinite(p95FrameTimeMs) || p95FrameTimeMs > performance.PERFORMANCE_LIMITS.maxP95FrameTimeMs) {
    fail(`T203 live P95 evidence exceeds ${performance.PERFORMANCE_LIMITS.maxP95FrameTimeMs}`);
  }
  return { gpuVendor, gpuRenderer, fps, p95FrameTimeMs };
}

function runT203LiveGate(scenario, performance) {
  let result;
  try {
    result = childProcess.spawnSync(process.execPath, ['--experimental-strip-types', t203VerifierPath], {
      cwd: clientRoot,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      timeout: 360_000,
      env: { ...process.env },
    });
  } catch (error) {
    blockFormalPerformanceGate(`T203 live GPU verifier could not start: ${error instanceof Error ? error.message : String(error)}`);
  }

  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  const output = `${stdout}\n${stderr}`;
  if (result.error) {
    blockFormalPerformanceGate(`T203 live GPU verifier could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = output.trim().split('\n').slice(-10).join('\n');
    blockFormalPerformanceGate(`T203 live GPU verifier exited with code ${result.status ?? 'unknown'}; historical artifact was not consulted${detail ? `\n${detail}` : ''}`);
  }
  try {
    return validateT203LiveEvidence(output, scenario, performance);
  } catch (error) {
    blockFormalPerformanceGate(`T203 live evidence is incomplete: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function runLiveEvidenceCounterexamples(scenario, performance) {
  const runtimeSuccessLine = 'T203 GPU runtime: PASS (Apple / ANGLE Metal Renderer: Apple M5 Pro)';
  const performanceSuccessLine = 'T203 measured performance: FPS 60; P95 18ms PASS';
  const validOutput = [
    `T203 production contract: PASS (E104 ${scenario.sceneLayers} layers; T251 ${scenario.basicEffects} effects/${scenario.audioFeedbacks} audio)`,
    `T203 scenario: GPU ${scenario.resolution[0]}x${scenario.resolution[1]}, ${scenario.units} units, ${scenario.sceneLayers} layers, ${scenario.basicEffects} basic effects`,
    runtimeSuccessLine,
    performanceSuccessLine,
  ].join('\n');
  expectFailure('missing T203 live GPU runtime PASS evidence', () => validateT203LiveEvidence(validOutput.replace(`${runtimeSuccessLine}\n`, ''), scenario, performance), /GPU runtime PASS/);
  expectFailure('missing T203 live FPS/P95 PASS evidence', () => validateT203LiveEvidence(validOutput.replace(performanceSuccessLine, ''), scenario, performance), /FPS\/P95 PASS/);
  expectFailure('T203 GPU success text inside a negative PASS line', () => validateT203LiveEvidence(validOutput.replace(`${runtimeSuccessLine}\n`, '  negative PASS: T203 GPU runtime: PASS (fake / fake)\n'), scenario, performance), /GPU runtime PASS/);
  expectFailure('T203 measured success text inside a negative PASS line', () => validateT203LiveEvidence(validOutput.replace(performanceSuccessLine, '  negative PASS: T203 measured performance: FPS 60; P95 18ms PASS'), scenario, performance), /FPS\/P95 PASS/);
  expectFailure('T203 live FPS below release threshold', () => validateT203LiveEvidence(validOutput.replace('FPS 60', 'FPS 54.99'), scenario, performance), /below 55/);
  expectFailure('T203 live P95 above release threshold', () => validateT203LiveEvidence(validOutput.replace('P95 18ms', 'P95 22.01ms'), scenario, performance), /exceeds 22/);
}

function assertExpectedFailureArtifact(artifact, performance) {
  const value = requireRecord(artifact, 'real failure artifact');
  const final = requireRecord(value.final, 'real failure artifact final state');
  const stressSample = requireRecord(value.stressFrameSample, 'real failure artifact stress sample');
  const reasons = [];
  if (value.headless === true) reasons.push('headless');
  if (final.artMode === 'preview-pose' || final.previewPoseAssets > 0 || final.artIntegrationComplete !== true) reasons.push('preview assets');
  if (stressSample.fps < performance.PERFORMANCE_LIMITS.minFps || stressSample.p95FrameTimeMs > performance.PERFORMANCE_LIMITS.maxP95FrameTimeMs) reasons.push('absolute performance budget');
  if (value.absolutePerformancePass !== true) reasons.push('absolutePerformancePass=false');
  if (reasons.length === 0) fail('real failure artifact no longer contains a failing release condition');
  return { reasons, stressSample };
}

function inspectOptionalHistoricalArtifact(scenario, performance) {
  let runtimeArtifact;
  try {
    runtimeArtifact = readJson(runtimeArtifactPath, 'optional historical BattleA0 performance artifact');
  } catch (error) {
    console.log(`T327 historical failure sample: SKIPPED (${error instanceof Error ? error.message : String(error)})`);
    return;
  }

  let expectedFailure;
  try {
    expectedFailure = assertExpectedFailureArtifact(runtimeArtifact, performance);
  } catch (error) {
    console.log(`T327 historical failure sample: SKIPPED (not the retained headless/preview rejection shape: ${error instanceof Error ? error.message : String(error)})`);
    return;
  }

  let rejectionMessage = '';
  try {
    validateReleaseArtifact(runtimeArtifact, scenario, performance);
  } catch (error) {
    rejectionMessage = error instanceof Error ? error.message : String(error);
  }
  if (!rejectionMessage) fail('retained historical headless/preview artifact was accepted unexpectedly');
  console.log(`  negative PASS: real BattleA0 headless/preview artifact`);
  console.log(`T327 historical failure sample: ${expectedFailure.stressSample.fps.toFixed(3)} FPS; P95 ${expectedFailure.stressSample.p95FrameTimeMs.toFixed(3)}ms; rejected (${expectedFailure.reasons.join(', ')})`);
}

async function main() {
  const performance = await import(pathToFileURL(performanceSourcePath).href);
  const sourceText = readRegularFile(performanceSourcePath, 'production performance source');
  assert.match(sourceText, /PERFORMANCE_LIMITS/, 'production performance source must define the formal limits');

  const config = readJson(manifestPath, 'A0 production manifest');
  const sceneContract = readJson(sceneContractPath, 'E104 scene contract');
  const effectsContract = readJson(effectsContractPath, 'T251 effects/audio contract');
  performance.validateProductionConfiguration(config);
  const scene = performance.validateE104SceneContract(sceneContract, sceneRoot, repoRoot);
  const effects = performance.validateT251EffectsAudioContract(effectsContract, path.join(clientRoot, 'assets/resources'), effectsRoot, audioRoot);
  const scenario = performance.buildProductionScenario(config, scene, effects);
  performance.validateScenario(scenario);
  const model = performance.createDeterministicPerformanceModel(scenario);
  performance.validatePerformanceSample(model);

  const passSample = readJson(passSamplePath, 'T327 pass sample');
  const passMetrics = validatePassSample(passSample, scenario, performance);
  console.log(`T327 production contract: PASS (E104 ${scene.layerCount} layers; T251 ${effects.effectCount} effects/${effects.audioCount} audio)`);
  console.log(`T327 scenario: GPU ${scenario.resolution[0]}x${scenario.resolution[1]}, ${scenario.units} units, ${scenario.sceneLayers} layers, ${scenario.basicEffects} effects/${scenario.audioFeedbacks} audio`);
  console.log(`T327 deterministic contract model: FPS ${model.fps}; P95 ${model.p95FrameTimeMs}ms`);
  console.log(`T327 pass sample: ${passMetrics.sampleCount} raw frames; FPS ${passMetrics.fps.toFixed(3)}; P95 ${passMetrics.p95FrameTimeMs.toFixed(3)}ms PASS`);

  expectFailure('missing pass sample file', () => readJson(path.join(toolRoot, 'samples/does-not-exist.json'), 'missing pass sample'), /cannot be read|ENOENT/);
  const missingThreshold = structuredClone(config);
  delete missingThreshold.stress.maximumP95FrameTimeMs;
  expectFailure('missing production P95 threshold', () => performance.validateProductionConfiguration(missingThreshold), /maximum P95 frame time/);
  const illegalRenderer = { ...scenario, renderer: 'software' };
  expectFailure('illegal software renderer', () => performance.validateScenario(illegalRenderer), /GPU rendering/);
  expectFailure('FPS below release threshold', () => performance.validatePerformanceSample({ fps: performance.PERFORMANCE_LIMITS.minFps - 0.01, p95FrameTimeMs: 18 }), /below 55/);
  expectFailure('P95 above release threshold', () => performance.validatePerformanceSample({ fps: 60, p95FrameTimeMs: performance.PERFORMANCE_LIMITS.maxP95FrameTimeMs + 0.01 }), /exceeds 22/);
  expectFailure('short raw frame sample', () => validatePassSample({ ...passSample, frameTimesMs: passSample.frameTimesMs.slice(0, 119) }, scenario, performance), /at least 120 raw samples/);
  runLiveEvidenceCounterexamples(scenario, performance);

  const liveEvidence = runT203LiveGate(scenario, performance);
  console.log(`T327 live GPU gate: PASS (T203 exit code 0; GPU/WebGL2 runtime ${liveEvidence.gpuVendor} / ${liveEvidence.gpuRenderer}; FPS ${liveEvidence.fps}; P95 ${liveEvidence.p95FrameTimeMs}ms)`);
  inspectOptionalHistoricalArtifact(scenario, performance);
  console.log('T327 counterexamples: PASS (missing file, missing field, illegal renderer, FPS/P95 bounds, short raw sample, missing/invalid live GPU and measured FPS/P95 success lines)');
  console.log('T327 verifier: PASS (contract rehearsal and optional historical rejection sample retained; live formal performance gate accepted)');
}

main().catch((error) => {
  console.error(`T327 verifier: FAIL (${error instanceof Error ? error.message : String(error)})`);
  process.exitCode = 1;
});
