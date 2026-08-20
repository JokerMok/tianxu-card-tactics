import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PERFORMANCE_LIMITS,
  buildProductionScenario,
  createDeterministicPerformanceModel,
  validateE104SceneContract,
  validateGpuRunnerResult,
  validatePerformanceSample,
  validateProductionConfiguration,
  validateScenario,
  validateT251EffectsAudioContract,
} from '../assets/scripts/battle/performance/production-performance.ts';

const clientRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(clientRoot, '..');
const sceneRoot = path.join(clientRoot, 'assets/resources/art/battle/scenes/E104');
const effectsRoot = path.join(clientRoot, 'assets/resources/art/battle/effects');
const audioRoot = path.join(clientRoot, 'assets/resources/art/battle/audio');
const RUNNER_SCRIPT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.py', '.pyw', '.sh', '.bash', '.zsh', '.fish', '.ksh', '.csh', '.rb', '.pl', '.php', '.ps1']);
const RUNNER_INTERPRETER_PATTERN = /^(?:node|nodejs|python(?:\d+(?:\.\d+)*)?|sh|bash|zsh|dash|ksh|fish|csh|tcsh|pwsh|powershell|ruby|perl|php|deno|bun)$/i;
const RUNNER_LAUNCHER_PATTERN = /^(?:env|timeout|xargs|nohup|sudo)$/i;
const DEFAULT_RUNNER_SOURCE = path.join(clientRoot, 'assets/scripts/battle/performance/production-gpu-runner.swift');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function expectFailure(label, action, pattern) {
  assert.throws(action, pattern, `${label} must be rejected`);
  console.log(`  negative PASS: ${label}`);
}

// The runner protocol requires a compiled/direct executable that observes the live GPU
// and emits the documented JSON result. Interpreter and script paths are rejected because
// they can trivially print a forged JSON result without collecting GPU evidence.
function validateGpuRunnerExecutable(executable) {
  if (typeof executable !== 'string' || executable.length === 0) throw new Error('PRODUCTION_GPU_RUNNER must be a non-empty path');
  if (!path.isAbsolute(executable)) throw new Error('PRODUCTION_GPU_RUNNER must be an absolute path');

  let stat;
  try {
    stat = fs.lstatSync(executable);
  } catch (error) {
    throw new Error(`PRODUCTION_GPU_RUNNER must be a regular executable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('PRODUCTION_GPU_RUNNER must be a regular executable file, not a symlink');

  const extension = path.extname(executable).toLowerCase();
  if (RUNNER_SCRIPT_EXTENSIONS.has(extension)) throw new Error('PRODUCTION_GPU_RUNNER must not be a script file');

  const basename = path.basename(executable).replace(/\.(?:exe|cmd|bat)$/i, '');
  if (RUNNER_INTERPRETER_PATTERN.test(basename)) throw new Error('PRODUCTION_GPU_RUNNER must not be an interpreter executable');
  if (RUNNER_LAUNCHER_PATTERN.test(basename)) throw new Error('PRODUCTION_GPU_RUNNER must not be an interpreter launcher');
  if ((stat.mode & 0o111) === 0) throw new Error('PRODUCTION_GPU_RUNNER must be executable');

  const descriptor = fs.openSync(executable, 'r');
  const header = Buffer.alloc(2);
  try {
    fs.readSync(descriptor, header, 0, header.length, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  if (header.toString('ascii') === '#!') throw new Error('PRODUCTION_GPU_RUNNER must not be a shebang script');
}

function runContractCounterexamples(config, sceneContract, effectsContract, scenario) {
  const missingLayer = structuredClone(sceneContract);
  missingLayer.layers.pop();
  expectFailure('missing E104 layer', () => validateE104SceneContract(missingLayer, sceneRoot, repoRoot), /exactly six layers|exactly match the frozen JSON contract/);

  const tamperedScene = structuredClone(sceneContract);
  tamperedScene.layers[0].sourceRect.x += 1;
  expectFailure('tampered E104 in-memory scene contract', () => validateE104SceneContract(tamperedScene, sceneRoot, repoRoot), /exactly match the frozen JSON contract/);

  const tamperedOutputSize = structuredClone(sceneContract);
  tamperedOutputSize.layers[0].outputSize[0] += 1;
  expectFailure('tampered E104 output size', () => validateE104SceneContract(tamperedOutputSize, sceneRoot, repoRoot), /exactly match the frozen JSON contract/);

  const tamperedParallax = structuredClone(sceneContract);
  tamperedParallax.layers[0].parallax += 0.01;
  expectFailure('tampered E104 parallax', () => validateE104SceneContract(tamperedParallax, sceneRoot, repoRoot), /exactly match the frozen JSON contract/);

  const tamperedRoad = structuredClone(sceneContract);
  tamperedRoad.roadContract.laneCount += 1;
  expectFailure('tampered E104 road contract', () => validateE104SceneContract(tamperedRoad, sceneRoot, repoRoot), /exactly match the frozen JSON contract/);

  expectFailure('invalid FPS', () => validatePerformanceSample({ fps: PERFORMANCE_LIMITS.minFps - 0.01, p95FrameTimeMs: 18 }), /below 55/);
  expectFailure('P95 over threshold', () => validatePerformanceSample({ fps: 60, p95FrameTimeMs: PERFORMANCE_LIMITS.maxP95FrameTimeMs + 0.01 }), /exceeds 22/);

  const overBudget = { ...scenario, basicEffects: PERFORMANCE_LIMITS.basicEffects + 1 };
  expectFailure('effects over budget', () => validateScenario(overBudget), /exceed the production budget/);

  const loweredConfig = structuredClone(config);
  loweredConfig.stress.minimumFps = PERFORMANCE_LIMITS.minFps - 1;
  expectFailure('lowered production FPS threshold', () => validateProductionConfiguration(loweredConfig), /must remain 55/);

  const missingEffect = structuredClone(effectsContract);
  missingEffect.assets = missingEffect.assets.filter((asset) => asset.category !== 'death' || asset.kind !== 'effect');
  expectFailure('missing T251 effect asset', () => validateT251EffectsAudioContract(missingEffect, path.join(clientRoot, 'assets/resources'), effectsRoot, audioRoot), /exactly fourteen assets|must contain one effect and one audio|exactly match the frozen JSON contract/);

  const tamperedEffects = structuredClone(effectsContract);
  tamperedEffects.assets[0].runtime.anchor = 'tampered.mapping';
  expectFailure('tampered T251 in-memory effects contract', () => validateT251EffectsAudioContract(tamperedEffects, path.join(clientRoot, 'assets/resources'), effectsRoot, audioRoot), /exactly match the frozen JSON contract/);

  const tamperedCategory = structuredClone(effectsContract);
  tamperedCategory.assets[0].category = 'spell';
  expectFailure('tampered T251 asset category', () => validateT251EffectsAudioContract(tamperedCategory, path.join(clientRoot, 'assets/resources'), effectsRoot, audioRoot), /exactly match the frozen JSON contract/);

  expectFailure('relative GPU runner path', () => validateGpuRunnerExecutable('tools/gpu-runner'), /absolute path/);
  expectFailure('Node interpreter GPU runner', () => validateGpuRunnerExecutable(process.execPath), /interpreter executable/);
  expectFailure('JavaScript GPU runner script', () => validateGpuRunnerExecutable(import.meta.filename), /script file/);

  const runnerBase = {
    runtimeAvailable: true,
    renderer: 'gpu',
    gpuVendor: 'NVIDIA',
    gpuRenderer: 'NVIDIA GeForce RTX 4090',
    gpuDriverVersion: 'NVIDIA 555.42.02',
    gpuContextId: 'webgl2-context-01',
    gpuFeatureStatus: { webgl: 'hardware accelerated', webgl2: 'hardware accelerated' },
    gpuContextType: 'webgl2',
    width: scenario.resolution[0],
    height: scenario.resolution[1],
    units: scenario.units,
    sceneLayers: scenario.sceneLayers,
    basicEffects: scenario.basicEffects,
    audioFeedbacks: scenario.audioFeedbacks,
    sceneContractVersion: scenario.sceneContractVersion,
    effectsAudioContractVersion: scenario.effectsAudioContractVersion,
    frameTimesMs: Array.from({ length: 120 }, () => 16),
  };
  ['mock_gpu', 'fakeGPU', 'unknownGPU', 'software_gpu', 'SwiftShaderGPU', 'llvmpipe', 'virtualGPU', 'testGPU', 'dummyGPU'].forEach((placeholder) => {
    expectFailure(`placeholder GPU runner identity: ${placeholder}`, () => validateGpuRunnerResult({ ...runnerBase, gpuRenderer: placeholder }, scenario), /placeholder|recognized hardware/);
  });
  expectFailure('placeholder GPU runner driver', () => validateGpuRunnerResult({ ...runnerBase, gpuDriverVersion: 'software_gpu 1.0' }, scenario), /placeholder/);
  expectFailure('placeholder GPU runner context', () => validateGpuRunnerResult({ ...runnerBase, gpuContextId: 'unknownGPU-context' }, scenario), /placeholder/);
  expectFailure('GPU runner missing driver version', () => validateGpuRunnerResult({ ...runnerBase, gpuDriverVersion: undefined }, scenario), /gpuDriverVersion/);
  expectFailure('GPU runner missing context id', () => validateGpuRunnerResult({ ...runnerBase, gpuContextId: undefined }, scenario), /gpuContextId/);
  expectFailure('GPU runner non-WebGL2 context', () => validateGpuRunnerResult({ ...runnerBase, gpuContextType: 'webgl' }, scenario), /WebGL2/);
  expectFailure('GPU runner missing audio feedback count', () => validateGpuRunnerResult({ ...runnerBase, audioFeedbacks: undefined }, scenario), /audioFeedbacks/);
  expectFailure('software WebGL feature status', () => validateGpuRunnerResult({ ...runnerBase, gpuFeatureStatus: { webgl: 'unavailable_software', webgl2: 'enabled' } }, scenario), /enabled hardware path/);
}

function compileDefaultGpuRunner() {
  if (!fs.existsSync(DEFAULT_RUNNER_SOURCE)) throw new Error(`default GPU runner source does not exist: ${DEFAULT_RUNNER_SOURCE}`);
  const buildDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 't203-gpu-runner-'));
  const executable = path.join(buildDirectory, 'production-gpu-runner');
  try {
    const result = childProcess.spawnSync('/usr/bin/xcrun', ['swiftc', '-O', DEFAULT_RUNNER_SOURCE, '-o', executable], {
      cwd: clientRoot,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: 120_000,
    });
    if (result.error) throw new Error(`swiftc could not start: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`swiftc exited with code ${result.status}: ${(result.stderr || result.stdout || '').trim()}`);
    validateGpuRunnerExecutable(executable);
    return { executable, buildDirectory };
  } catch (error) {
    fs.rmSync(buildDirectory, { recursive: true, force: true });
    throw error;
  }
}

function runGpuRunner(scenario) {
  let executable;
  let buildDirectory;
  try {
    ({ executable, buildDirectory } = compileDefaultGpuRunner());
  } catch (error) {
    return { available: false, reason: `default native runner could not be compiled: ${error instanceof Error ? error.message : String(error)}` };
  }
  try {
    validateGpuRunnerExecutable(executable);
  } catch (error) {
    return { available: false, reason: error instanceof Error ? error.message : String(error) };
  }
  try {
    const result = childProcess.spawnSync(executable, [], {
      cwd: clientRoot,
      encoding: 'utf8',
      input: JSON.stringify(scenario),
      maxBuffer: 1024 * 1024,
      timeout: 300_000,
      env: { ...process.env, PRODUCTION_PERFORMANCE_SCENARIO: JSON.stringify(scenario) },
    });
    if (result.error) return { available: false, reason: `runner could not start: ${result.error.message}` };
    if (result.status !== 0) return { available: false, reason: `runner exited with code ${result.status}: ${(result.stderr || '').trim()}` };
    const output = (result.stdout || '').trim();
    if (!output) return { available: false, reason: 'runner produced no JSON result' };
    try {
      return { available: true, value: JSON.parse(output) };
    } catch {
      return { available: false, reason: 'runner output is not a JSON object' };
    }
  } finally {
    if (buildDirectory) fs.rmSync(buildDirectory, { recursive: true, force: true });
  }
}

function main() {
  const config = readJson(path.join(clientRoot, 'assets/a0-manifest.json'));
  const sceneContract = readJson(path.join(sceneRoot, 'scene-contract.json'));
  const effectsContract = readJson(path.join(effectsRoot, 'battle-effects-audio-contract.json'));

  validateProductionConfiguration(config);
  const scene = validateE104SceneContract(sceneContract, sceneRoot, repoRoot);
  const effects = validateT251EffectsAudioContract(effectsContract, path.join(clientRoot, 'assets/resources'), effectsRoot, audioRoot);
  const scenario = buildProductionScenario(config, scene, effects);
  const model = createDeterministicPerformanceModel(scenario);
  validatePerformanceSample(model);

  console.log(`T203 production contract: PASS (E104 ${scene.layerCount} layers; T251 ${effects.effectCount} effects/${effects.audioCount} audio)`);
  console.log(`T203 scenario: GPU ${scenario.resolution[0]}x${scenario.resolution[1]}, ${scenario.units} units, ${scenario.sceneLayers} layers, ${scenario.basicEffects} basic effects`);
  console.log(`T203 deterministic model: FPS ${model.fps}; P95 ${model.p95FrameTimeMs}ms; thresholds FPS >=${PERFORMANCE_LIMITS.minFps}, P95 <=${PERFORMANCE_LIMITS.maxP95FrameTimeMs}ms`);
  runContractCounterexamples(config, sceneContract, effectsContract, scenario);
  console.log('T203 contract/performance counterexamples: PASS');

  const runner = runGpuRunner(scenario);
  if (!runner.available) {
    console.error(`T203 runtime availability: FAIL (${runner.reason})`);
    console.error('T203 gate is not green: deterministic contract model is evidence only; a real GPU runner is required.');
    process.exitCode = 1;
    return;
  }
  try {
    const measured = validateGpuRunnerResult(runner.value, scenario);
    console.log(`T203 GPU runtime: PASS (${runner.value.gpuVendor} / ${runner.value.gpuRenderer})`);
    console.log(`T203 measured performance: FPS ${measured.fps}; P95 ${measured.p95FrameTimeMs}ms PASS`);
  } catch (error) {
    console.error(`T203 GPU runtime/performance: FAIL (${error instanceof Error ? error.message : String(error)})`);
    process.exitCode = 1;
  }
}

main();
