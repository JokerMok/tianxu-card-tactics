import type { PageId } from '../../GameState.ts';

export const SHELL_SCHEMA_VERSION = 1 as const;

export type ShellPageId = PageId;
export type ShellResourceId = 'stamina' | 'silver' | 'crystal' | 'towerTicket';

export interface ShellNavigationDefinition {
  readonly id: ShellPageId;
  readonly label: string;
  readonly glyph: string;
}

export interface ShellResourceDefinition {
  readonly id: ShellResourceId;
  readonly label: string;
  readonly topBar: boolean;
}

export const SHELL_NAVIGATION: readonly ShellNavigationDefinition[] = Object.freeze([
  Object.freeze({ id: 'home', label: '主城', glyph: '城' }),
  Object.freeze({ id: 'campaign', label: '征战', glyph: '征' }),
  Object.freeze({ id: 'cards', label: '卡库', glyph: '卡' }),
  Object.freeze({ id: 'deck', label: '编队', glyph: '阵' }),
  Object.freeze({ id: 'hero', label: '主将', glyph: '将' }),
  Object.freeze({ id: 'adventure', label: '历练', glyph: '历' }),
  Object.freeze({ id: 'city', label: '营造', glyph: '造' }),
  Object.freeze({ id: 'tasks', label: '任务', glyph: '任' }),
  Object.freeze({ id: 'inventory', label: '行囊', glyph: '囊' }),
]);

export const SHELL_RESOURCE_DEFINITIONS: readonly ShellResourceDefinition[] = Object.freeze([
  Object.freeze({ id: 'stamina', label: '体力', topBar: true }),
  Object.freeze({ id: 'silver', label: '银币', topBar: true }),
  Object.freeze({ id: 'crystal', label: '水晶', topBar: true }),
  Object.freeze({ id: 'towerTicket', label: '塔票', topBar: false }),
]);

export const SHELL_LAYOUT_CONTRACT = Object.freeze({
  contractId: 'T244-M7-03-SHELL',
  contractVersion: 1,
  designResolution: Object.freeze({ width: 1920, height: 1080 }),
  viewport: Object.freeze({ fit: 'contain', aspectRatio: Object.freeze([16, 9]) }),
  topBar: Object.freeze({ x: 0, y: 494, width: 1920, height: 92 }),
  navigation: Object.freeze({
    x: -855,
    y: -46,
    width: 210,
    height: 988,
    itemX: 10,
    itemWidth: 178,
    itemHeight: 68,
    firstItemY: 390,
    itemStepY: -91,
  }),
  topBarResources: Object.freeze([
    Object.freeze({ id: 'stamina', label: '体力', anchorX: 190, valueFormat: 'current/max' }),
    Object.freeze({ id: 'silver', label: '银币', anchorX: 390, valueFormat: 'compact' }),
    Object.freeze({ id: 'crystal', label: '水晶', anchorX: 590, valueFormat: 'compact' }),
  ]),
  navigationItems: SHELL_NAVIGATION,
});

// These literals are part of the approval contract; the test recomputes both hashes.
export const SHELL_LAYOUT_CONTRACT_SHA256 = '4dee6014303f2ab744937d46fcc837b7301812c4940f89e02a0b5aea5dea1c54';
export const SHELL_DEFAULT_SNAPSHOT_SHA256 = 'b366d6a2510f5bb08b91e8a53c87eb5d1d5f05ebd1d4efba9341988abdfd663d';
