import { REPUTATION_CATALOG_DATA } from './ReputationCatalogData.ts';
import {
  assertReputationProductionIntegrity,
  assertReputationCatalogSkeleton,
  EXPECTED_REPUTATION_TRACK_COUNT,
  EXPECTED_REPUTATION_RELATION_COUNT,
} from './ReputationCatalogIntegrity.ts';
import {
  createReputationCatalog,
  ReputationError,
  REPUTATION_FACTIONS,
  REPUTATION_PROFESSIONS,
  REPUTATION_RACES,
  type ReputationCatalogConfig,
} from './Reputation.ts';

export interface ReputationMetadataAuthority {
  readonly units: readonly unknown[] | { readonly units: readonly unknown[] };
  readonly professions: readonly unknown[] | { readonly professions: readonly unknown[] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function rows(value: readonly unknown[] | { readonly units?: readonly unknown[]; readonly professions?: readonly unknown[] }, key: 'units' | 'professions'): readonly unknown[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value) && Array.isArray(value[key])) return value[key];
  throw new ReputationError('INVALID_METADATA', `reputation metadata must contain a ${key} array`);
}

function enabledRows(value: readonly unknown[] | { readonly units?: readonly unknown[]; readonly professions?: readonly unknown[] }, key: 'units' | 'professions'): readonly Record<string, unknown>[] {
  const result = rows(value, key).filter((row) => isRecord(row) && row.enabled !== false) as Record<string, unknown>[];
  if (result.length === 0) throw new ReputationError('INVALID_METADATA', `${key} metadata is empty`);
  return result;
}

function assertUniqueIds(records: readonly Record<string, unknown>[], key: 'units' | 'professions'): void {
  const ids = new Set<string>();
  records.forEach((record, index) => {
    if (typeof record.id !== 'string' || record.id.length === 0) {
      throw new ReputationError('INVALID_METADATA', `${key}[${index}].id is invalid`);
    }
    if (ids.has(record.id)) throw new ReputationError('INVALID_METADATA', `duplicate ${key} ID: ${record.id}`);
    ids.add(record.id);
  });
}

export function validateReputationCrossTable(
  metadata: ReputationMetadataAuthority,
  data: ReputationCatalogConfig = REPUTATION_CATALOG_DATA,
): void {
  const units = enabledRows(metadata.units, 'units');
  const professions = enabledRows(metadata.professions, 'professions');
  assertUniqueIds(units, 'units');
  assertUniqueIds(professions, 'professions');

  const races = new Set<string>();
  for (const [index, unit] of units.entries()) {
    if (typeof unit.race !== 'string' || !REPUTATION_RACES.includes(unit.race as (typeof REPUTATION_RACES)[number])) {
      throw new ReputationError('INVALID_METADATA', `units[${index}].race is not a reputation race`);
    }
    if (typeof unit.politicalFaction !== 'string' || !REPUTATION_FACTIONS.includes(unit.politicalFaction as (typeof REPUTATION_FACTIONS)[number])) {
      throw new ReputationError('INVALID_METADATA', `units[${index}].politicalFaction is not a known faction`);
    }
    races.add(unit.race);
  }
  for (const race of REPUTATION_RACES) {
    if (!races.has(race)) throw new ReputationError('UNKNOWN_SOURCE', `no enabled unit provides race reputation source: ${race}`);
  }

  const professionIds = new Set(professions.map((profession) => profession.id));
  for (const professionId of REPUTATION_PROFESSIONS) {
    if (!professionIds.has(professionId)) throw new ReputationError('UNKNOWN_SOURCE', `missing enabled profession reputation source: ${professionId}`);
  }
  if (professions.length !== REPUTATION_PROFESSIONS.length
    || professions.filter((profession) => REPUTATION_PROFESSIONS.includes(profession.id as (typeof REPUTATION_PROFESSIONS)[number])).length !== REPUTATION_PROFESSIONS.length) {
    throw new ReputationError('INVALID_METADATA', 'profession metadata contains an unexpected reputation profession');
  }

  if (data.tracks.length !== EXPECTED_REPUTATION_TRACK_COUNT || data.relations.length !== EXPECTED_REPUTATION_RELATION_COUNT) {
    throw new ReputationError('INVALID_CONFIG', 'reputation production table counts are incomplete');
  }
  const raceTrackSources = new Set(data.tracks.filter((track) => track.subjectType === 'RACE').map((track) => track.sourceId));
  const professionTrackSources = new Set(data.tracks.filter((track) => track.subjectType === 'PROFESSION').map((track) => track.sourceId));
  if (raceTrackSources.size !== REPUTATION_RACES.length || REPUTATION_RACES.some((race) => !raceTrackSources.has(race))) {
    throw new ReputationError('INVALID_CONFIG', 'reputation config must contain exactly one track for each race');
  }
  if (professionTrackSources.size !== REPUTATION_PROFESSIONS.length
    || REPUTATION_PROFESSIONS.some((professionId) => !professionTrackSources.has(professionId))) {
    throw new ReputationError('INVALID_CONFIG', 'reputation config must contain exactly one track for each profession');
  }
  for (const track of data.tracks) {
    if (track.subjectType === 'RACE') {
      if (track.subjectId !== track.sourceId || !races.has(track.sourceId)) {
        throw new ReputationError('UNKNOWN_SOURCE', `reputation track ${track.id} does not bind to an enabled unit race`);
      }
    } else if (track.subjectId !== track.sourceId || !professionIds.has(track.sourceId)) {
      throw new ReputationError('UNKNOWN_SOURCE', `reputation track ${track.id} does not bind to an enabled profession`);
    }
  }
}

export function loadReputationCatalog(
  metadata: ReputationMetadataAuthority,
  data: ReputationCatalogConfig = REPUTATION_CATALOG_DATA,
) {
  try {
    assertReputationProductionIntegrity(data);
    const catalog = createReputationCatalog(data);
    assertReputationCatalogSkeleton(catalog.snapshot());
    validateReputationCrossTable(metadata, catalog.snapshot());
    return catalog;
  } catch (error) {
    if (error instanceof ReputationError) throw error;
    throw new ReputationError('INVALID_CONFIG', error instanceof Error ? error.message : String(error));
  }
}
