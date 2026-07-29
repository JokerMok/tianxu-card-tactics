import type { Status, Unit } from '../types/index.ts';

export type StackRule = 'REFRESH' | 'REPLACE' | 'ADD_VALUE';
export type TickTiming = 'ROUND_START' | 'ROUND_END' | 'ACTION_START' | 'ACTION_END';

export interface StatusInput {
  readonly id: string;
  readonly kind: string;
  readonly sourceId?: string;
  readonly stacks?: number;
  readonly remainingRounds?: number;
  readonly value?: number;
}

export interface StatusPolicy {
  readonly stackRule?: StackRule;
  readonly maxStacks?: number;
  readonly tickTiming?: TickTiming;
  readonly immuneKinds?: readonly string[];
}

export interface StatusResult {
  readonly unit: Unit;
  readonly applied: boolean;
}

function statusUnit(unit: Unit, statuses: readonly Status[]): Unit {
  return { ...unit, statuses: [...statuses] };
}

export function hasStatus(unit: Unit, kind: string): boolean {
  return unit.statuses.some((status) => status.kind === kind && status.stacks > 0);
}

export function applyStatus(unit: Unit, input: StatusInput, policy: StatusPolicy = {}): StatusResult {
  if (policy.immuneKinds?.includes(input.kind)) return { unit, applied: false };
  const stacks = input.stacks ?? 1;
  if (!Number.isSafeInteger(stacks) || stacks <= 0) throw new Error('status stacks are invalid');
  const maxStacks = policy.maxStacks ?? Number.MAX_SAFE_INTEGER;
  const existingIndex = unit.statuses.findIndex((status) => status.kind === input.kind);
  if (existingIndex < 0) {
    return { unit: statusUnit(unit, [...unit.statuses, { ...input, stacks }]), applied: true };
  }
  const existing = unit.statuses[existingIndex];
  const rule = policy.stackRule ?? 'REPLACE';
  const nextStacks = rule === 'ADD_VALUE' ? Math.min(maxStacks, existing.stacks + stacks) : Math.min(maxStacks, stacks);
  const next: Status = rule === 'REFRESH'
    ? { ...existing, remainingRounds: input.remainingRounds ?? existing.remainingRounds, value: input.value ?? existing.value }
    : { ...existing, ...input, stacks: nextStacks };
  const statuses = [...unit.statuses];
  statuses[existingIndex] = next;
  return { unit: statusUnit(unit, statuses), applied: true };
}

export function tickStatuses(unit: Unit, timing: TickTiming, policies: Readonly<Record<string, StatusPolicy>> = {}): Unit {
  const statuses = unit.statuses
    .map((status) => {
      const policy = policies[status.kind];
      if (policy?.tickTiming && policy.tickTiming !== timing) return status;
      return { ...status, remainingRounds: status.remainingRounds === undefined || status.remainingRounds <= 0
        ? status.remainingRounds : status.remainingRounds - 1 };
    })
    .filter((status) => status.remainingRounds === undefined || status.remainingRounds > 0);
  return statusUnit(unit, statuses);
}

export function removeStatus(unit: Unit, kind: string): Unit {
  return statusUnit(unit, unit.statuses.filter((status) => status.kind !== kind));
}

export function consumeBarrier(unit: Unit, amount: number): { readonly unit: Unit; readonly absorbed: number; readonly remaining: number } {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('barrier amount is invalid');
  let remaining = amount;
  let absorbed = 0;
  const statuses = unit.statuses.map((status) => {
    if (status.kind !== 'BARRIER' || remaining === 0) return status;
    const shield = status.value ?? status.stacks;
    const used = Math.min(shield, remaining);
    remaining -= used;
    absorbed += used;
    return { ...status, value: shield - used, stacks: shield - used > 0 ? status.stacks : 0 };
  }).filter((status) => status.kind !== 'BARRIER' || (status.value ?? status.stacks) > 0);
  return { unit: statusUnit(unit, statuses), absorbed, remaining };
}
