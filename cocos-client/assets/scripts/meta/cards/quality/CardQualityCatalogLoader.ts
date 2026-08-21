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

const CATALOG_DATA_KEYS = new Set(['schemaVersion', 'allowedSources', 'entries']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
  assertCatalogData(data);
  return createCardQualityCatalog({
    metadata,
    entries: { schemaVersion: data.schemaVersion, entries: data.entries },
    allowedSources: data.allowedSources,
  });
}
