import assert from 'node:assert/strict';
import { TimeService } from './TimeService.ts';

const at = Date.parse('2026-01-05T00:00:00.000Z');
const service = new TimeService({ now: () => at }, 'Asia/Shanghai');
assert.equal(service.dayKey(), '2026-01-05');
assert.equal(service.weekKey(), '2026-W02');
assert.equal(service.offlineDurationMs(at - 5000), 5000);
assert.equal(service.offlineDurationMs(at + 1), 0);
assert.equal(service.offlineDurationMs(at - 100_000_000), 86_400_000);
const sunday = new TimeService({ now: () => Date.parse('2026-01-11T15:59:59.000Z') }, 'Asia/Shanghai');
const monday = new TimeService({ now: () => Date.parse('2026-01-11T16:00:00.000Z') }, 'Asia/Shanghai');
assert.notEqual(sunday.weekKey(), monday.weekKey());
assert.equal(new TimeService({ now: () => Date.parse('2024-12-30T16:00:00.000Z') }, 'Asia/Shanghai').weekKey(), '2025-W01');
assert.equal(new TimeService({ now: () => Date.parse('2025-12-29T16:00:00.000Z') }, 'Asia/Shanghai').weekKey(), '2026-W01');
console.log('T016 time service PASS: injectable clock, timezone day/week boundaries and offline clamp');
