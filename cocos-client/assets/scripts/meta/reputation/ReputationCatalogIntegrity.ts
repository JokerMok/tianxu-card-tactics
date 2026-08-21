import { REPUTATION_CATALOG_DATA, type ReputationCatalogData } from './ReputationCatalogData.ts';
import type { ReputationCatalogConfig } from './Reputation.ts';

export const EXPECTED_REPUTATION_TRACK_COUNT = 11 as const;
export const EXPECTED_REPUTATION_LEVEL_COUNT = 44 as const;
export const EXPECTED_REPUTATION_RELATION_COUNT = 49 as const;

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonical(value: ReputationCatalogConfig): string {
  return JSON.stringify({
    schemaVersion: value.schemaVersion,
    tracks: [...value.tracks].map((track) => ({
      id: track.id,
      subjectType: track.subjectType,
      subjectId: track.subjectId,
      sourceId: track.sourceId,
      levels: [...track.levels].map((level) => ({
        level: level.level,
        threshold: level.threshold,
        rewardIds: [...level.rewardIds].sort(compare),
        battleModifier: { ...level.battleModifier },
      })),
    })).sort((left, right) => compare(left.id, right.id)),
    relations: [...value.relations].map((relation) => ({ ...relation }))
      .sort((left, right) => compare(left.sourceFactionId, right.sourceFactionId)
        || compare(left.targetFactionId, right.targetFactionId)),
  });
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function reputationCatalogDigest(value: ReputationCatalogConfig): string {
  return fnv1a(canonical(value));
}

// Literal on purpose: changing production records requires an intentional digest update.
export const REPUTATION_PRODUCTION_DIGEST = 'b7567330' as const;

export interface ReputationCatalogSkeleton {
  readonly trackIds: readonly string[];
  readonly levelsByTrack: Readonly<Record<string, readonly number[]>>;
  readonly relationKeys: readonly string[];
}

export const REPUTATION_PRODUCTION_SKELETON: ReputationCatalogSkeleton = Object.freeze({
  trackIds: Object.freeze([...REPUTATION_CATALOG_DATA.tracks].map((track) => track.id).sort(compare)),
  levelsByTrack: Object.freeze(Object.fromEntries(
    [...REPUTATION_CATALOG_DATA.tracks].sort((left, right) => compare(left.id, right.id))
      .map((track) => [track.id, Object.freeze(track.levels.map((level) => level.level))]),
  )),
  relationKeys: Object.freeze([...REPUTATION_CATALOG_DATA.relations]
    .map((relation) => `${relation.sourceFactionId}->${relation.targetFactionId}`)
    .sort(compare)),
});

export interface ReputationCatalogDiff {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
}

function skeletonOf(value: ReputationCatalogConfig): ReputationCatalogSkeleton {
  return {
    trackIds: [...value.tracks].map((track) => track.id).sort(compare),
    levelsByTrack: Object.fromEntries([...value.tracks].sort((left, right) => compare(left.id, right.id))
      .map((track) => [track.id, track.levels.map((level) => level.level)])),
    relationKeys: [...value.relations]
      .map((relation) => `${relation.sourceFactionId}->${relation.targetFactionId}`)
      .sort(compare),
  };
}

function listDiff(expected: readonly string[], actual: readonly string[]): { added: string[]; removed: string[] } {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  return {
    added: actual.filter((item) => !expectedSet.has(item)),
    removed: expected.filter((item) => !actualSet.has(item)),
  };
}

export function diffReputationCatalogData(
  expected: ReputationCatalogConfig,
  actual: ReputationCatalogConfig,
): ReputationCatalogDiff {
  const expectedSkeleton = skeletonOf(expected);
  const actualSkeleton = skeletonOf(actual);
  const trackDiff = listDiff(expectedSkeleton.trackIds, actualSkeleton.trackIds);
  const relationDiff = listDiff(expectedSkeleton.relationKeys, actualSkeleton.relationKeys);
  const changed: string[] = [];
  const expectedTracks = new Map(expected.tracks.map((track) => [track.id, JSON.stringify(track)]));
  const actualTracks = new Map(actual.tracks.map((track) => [track.id, JSON.stringify(track)]));
  for (const trackId of expectedSkeleton.trackIds) {
    if (expectedTracks.has(trackId) && actualTracks.has(trackId) && expectedTracks.get(trackId) !== actualTracks.get(trackId)) {
      changed.push(`track:${trackId}`);
    }
  }
  const expectedRelations = new Map(expected.relations.map((relation) => [
    `${relation.sourceFactionId}->${relation.targetFactionId}`, JSON.stringify(relation),
  ]));
  const actualRelations = new Map(actual.relations.map((relation) => [
    `${relation.sourceFactionId}->${relation.targetFactionId}`, JSON.stringify(relation),
  ]));
  for (const relationKey of expectedSkeleton.relationKeys) {
    if (expectedRelations.has(relationKey) && actualRelations.has(relationKey)
      && expectedRelations.get(relationKey) !== actualRelations.get(relationKey)) {
      changed.push(`relation:${relationKey}`);
    }
  }
  return Object.freeze({
    added: Object.freeze([...trackDiff.added, ...relationDiff.added].sort(compare)),
    removed: Object.freeze([...trackDiff.removed, ...relationDiff.removed].sort(compare)),
    changed: Object.freeze(changed.sort(compare)),
  });
}

export function assertReputationCatalogSkeleton(value: ReputationCatalogConfig): void {
  const actual = skeletonOf(value);
  if (JSON.stringify(actual) !== JSON.stringify(REPUTATION_PRODUCTION_SKELETON)) {
    const diff = diffReputationCatalogData(REPUTATION_CATALOG_DATA, value);
    throw new Error(`reputation catalog skeleton mismatch: +${diff.added.join(',')} -${diff.removed.join(',')} ~${diff.changed.join(',')}`);
  }
}

export function assertReputationProductionIntegrity(data: ReputationCatalogData): void {
  if (data.tracks.length !== EXPECTED_REPUTATION_TRACK_COUNT
    || data.tracks.reduce((count, track) => count + track.levels.length, 0) !== EXPECTED_REPUTATION_LEVEL_COUNT
    || data.relations.length !== EXPECTED_REPUTATION_RELATION_COUNT) {
    throw new Error('reputation production catalog count mismatch');
  }
  if (reputationCatalogDigest(data) !== REPUTATION_PRODUCTION_DIGEST) {
    throw new Error('reputation production catalog integrity digest mismatch');
  }
  assertReputationCatalogSkeleton(data);
}
