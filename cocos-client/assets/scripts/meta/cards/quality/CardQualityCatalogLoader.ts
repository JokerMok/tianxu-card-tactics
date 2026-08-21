import {
  CARD_QUALITY_CATALOG_DATA,
  type CardQualityCatalogData,
} from './CardQualityCatalogData.ts';
import {
  CARD_QUALITY_SCHEMA_VERSION,
  CardQualityError,
  type CardQualityCatalog,
  type CardQualityCatalogOptions,
  createCardQualityCatalog,
} from './CardQuality.ts';
import {
  CARD_QUALITY_PRODUCTION_DIGEST,
  CARD_QUALITY_PRODUCTION_REGISTRY,
  EXPECTED_CARD_QUALITY_CARD_COUNT,
  EXPECTED_CARD_QUALITY_ENTRY_COUNT,
} from './CardQualityCatalogIntegrity.ts';

const CATALOG_DATA_KEYS = new Set(['schemaVersion', 'allowedSources', 'entries']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalEntry(value: unknown, index: number): Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value.abilities) || !Array.isArray(value.sources)) {
    throw new CardQualityError('INVALID_CONFIG', `card quality catalog entry ${index} is not digestible`);
  }
  return {
    cardId: value.cardId,
    quality: value.quality,
    abilities: Object.fromEntries(Object.entries(value.abilities).sort(([left], [right]) => left.localeCompare(right))),
    sources: [...value.sources].sort(),
    copyLimit: value.copyLimit,
  };
}

function productionDigest(data: CardQualityCatalogData): string {
  const canonical = JSON.stringify({
    schemaVersion: data.schemaVersion,
    allowedSources: [...data.allowedSources].sort(),
    entries: data.entries
      .map((entry, index) => canonicalEntry(entry, index))
      .sort((left, right) => String(left.cardId).localeCompare(String(right.cardId)) || Number(left.quality) - Number(right.quality)),
  });
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function assertProductionRegistry(metadata: CardQualityCatalogOptions['metadata']): void {
  if (!isRecord(metadata) || !Array.isArray(metadata.cards)) {
    throw new CardQualityError('INVALID_METADATA', 'card quality loader requires the real cards.json registry');
  }
  if (metadata.cards.some((card) => !isRecord(card))) {
    throw new CardQualityError('INVALID_METADATA', 'real cards.json registry contains an invalid row');
  }
  const enabledCards = metadata.cards.filter((card) => card.enabled !== false);
  if (enabledCards.length !== EXPECTED_CARD_QUALITY_CARD_COUNT) {
    throw new CardQualityError('INVALID_METADATA', 'real cards.json registry must contain exactly 44 enabled cards');
  }
  const actualById = new Map<string, Record<string, unknown>>();
  for (const [index, card] of enabledCards.entries()) {
    if (!isRecord(card) || typeof card.id !== 'string') {
      throw new CardQualityError('INVALID_METADATA', `real card registry row ${index} is invalid`);
    }
    if (actualById.has(card.id)) {
      throw new CardQualityError('INVALID_METADATA', `duplicate real card registry ID: ${card.id}`);
    }
    if (Object.prototype.hasOwnProperty.call(card, 'name')) {
      throw new CardQualityError('INVALID_METADATA', `real card registry row ${card.id} contains forged name field`);
    }
    actualById.set(card.id, card);
  }
  for (const expected of CARD_QUALITY_PRODUCTION_REGISTRY) {
    const actual = actualById.get(expected.id);
    if (!actual || actual.nameKey !== expected.nameKey || actual.copyLimit !== expected.copyLimit) {
      throw new CardQualityError('INVALID_METADATA', `real card registry binding mismatch: ${expected.id}`);
    }
  }
  if (actualById.size !== CARD_QUALITY_PRODUCTION_REGISTRY.length) {
    throw new CardQualityError('INVALID_METADATA', 'real card registry contains an unexpected enabled card');
  }
}

function assertProductionCatalogIntegrity(data: CardQualityCatalogData): void {
  if (data.entries.length !== EXPECTED_CARD_QUALITY_ENTRY_COUNT) {
    throw new CardQualityError('INVALID_CONFIG', 'production card quality catalog must contain exactly 264 records');
  }
  if (productionDigest(data) !== CARD_QUALITY_PRODUCTION_DIGEST) {
    throw new CardQualityError('INVALID_CONFIG', 'production card quality catalog integrity digest mismatch');
  }
}

function assertCatalogData(value: unknown): asserts value is CardQualityCatalogData {
  if (!isRecord(value)) throw new CardQualityError('INVALID_CONFIG', 'card quality catalog data must be an object');
  for (const key of Object.keys(value)) {
    if (!CATALOG_DATA_KEYS.has(key)) {
      throw new CardQualityError('INVALID_CONFIG', `card quality catalog data contains unknown field: ${key}`);
    }
  }
  if (value.schemaVersion !== CARD_QUALITY_SCHEMA_VERSION) {
    throw new CardQualityError('INVALID_CONFIG', 'unsupported card quality catalog schema version');
  }
  if (!Array.isArray(value.allowedSources) || !Array.isArray(value.entries)) {
    throw new CardQualityError('INVALID_CONFIG', 'card quality catalog data is incomplete');
  }
}

export function loadCardQualityCatalog(
  metadata: CardQualityCatalogOptions['metadata'],
  data: unknown = CARD_QUALITY_CATALOG_DATA,
): CardQualityCatalog {
  assertProductionRegistry(metadata);
  assertCatalogData(data);
  assertProductionCatalogIntegrity(data);
  return createCardQualityCatalog({
    metadata,
    entries: { schemaVersion: data.schemaVersion, entries: data.entries },
    allowedSources: data.allowedSources,
  });
}
