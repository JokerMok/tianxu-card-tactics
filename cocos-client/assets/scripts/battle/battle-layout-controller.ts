export const BATTLE_LAYOUT_DESIGN_SIZE = Object.freeze({ width: 1920, height: 1080 });

export interface BattleLayoutInsets {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface BattleLayoutViewport {
  readonly width: number;
  readonly height: number;
  readonly insets?: BattleLayoutInsets;
  readonly safeArea?: BattleLayoutInsets;
  readonly safeAreaInsets?: BattleLayoutInsets;
}

export interface BattleLayoutRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface BattleLayoutPoint {
  readonly x: number;
  readonly y: number;
}

export interface BattleLayoutSnapshot {
  readonly viewport: BattleLayoutRect;
  readonly safeRect: BattleLayoutRect;
  readonly safeArea: BattleLayoutRect;
  readonly contentRect: BattleLayoutRect;
  readonly topUiRect: BattleLayoutRect;
  readonly bottomUiRect: BattleLayoutRect;
  readonly designSize: Readonly<typeof BATTLE_LAYOUT_DESIGN_SIZE>;
  readonly scale: number;
  screenToDesign(point: unknown): BattleLayoutPoint | null;
  designToScreen(point: unknown): BattleLayoutPoint | null;
  isOperableScreenPoint(point: unknown): boolean;
}

type ViewportSnapshot = {
  readonly width: number;
  readonly height: number;
  readonly insets: BattleLayoutInsets;
};

type OwnDataSnapshot = {
  readonly keys: readonly string[];
  readonly values: readonly unknown[];
};

const EMPTY_INSETS: BattleLayoutInsets = Object.freeze({ left: 0, top: 0, right: 0, bottom: 0 });

/** Reads a host record once without invoking accessors or retaining its values. */
function snapshotOwnData(value: unknown): OwnDataSnapshot | null {
  try {
    if (!isRecord(value)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors);
    const values: unknown[] = [];
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (
        descriptor === undefined
        || descriptor.enumerable !== true
        || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ) return null;
      values.push(descriptor.value);
    }
    return Object.freeze({ keys: Object.freeze(keys), values: Object.freeze(values) });
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnly(keys: readonly string[], expected: readonly string[]): boolean {
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function nonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function ownValue(snapshot: OwnDataSnapshot, key: string): unknown {
  const index = snapshot.keys.indexOf(key);
  return index < 0 ? undefined : snapshot.values[index];
}

function freezeRect(x: number, y: number, width: number, height: number): BattleLayoutRect {
  return Object.freeze({ x, y, width, height });
}

function freezePoint(x: number, y: number): BattleLayoutPoint {
  return Object.freeze({ x, y });
}

/** Copies one point read before any geometry work is performed. */
function snapshotPoint(value: unknown): BattleLayoutPoint | null {
  const source = snapshotOwnData(value);
  if (source === null || !hasOnly(source.keys, ['x', 'y'])) return null;
  const x = ownValue(source, 'x');
  const y = ownValue(source, 'y');
  return finite(x) && finite(y) ? freezePoint(x, y) : null;
}

/** Copies one inset read and rejects any shape that cannot describe a usable area. */
function snapshotInsets(value: unknown): BattleLayoutInsets | null {
  const source = snapshotOwnData(value);
  if (source === null || !hasOnly(source.keys, ['left', 'top', 'right', 'bottom'])) return null;
  const left = ownValue(source, 'left');
  const top = ownValue(source, 'top');
  const right = ownValue(source, 'right');
  const bottom = ownValue(source, 'bottom');
  return nonNegative(left) && nonNegative(top) && nonNegative(right) && nonNegative(bottom)
    ? Object.freeze({ left, top, right, bottom })
    : null;
}

function snapshotViewport(value: unknown, positionalInsets: unknown): ViewportSnapshot | null {
  const source = snapshotOwnData(value);
  if (source === null) return null;
  const insetFields = ['insets', 'safeArea', 'safeAreaInsets'].filter((key) => source.keys.includes(key));
  if (
    !hasOnly(source.keys, positionalInsets === undefined ? ['width', 'height', ...insetFields] : ['width', 'height'])
    || insetFields.length > 1
  ) return null;

  const width = ownValue(source, 'width');
  const height = ownValue(source, 'height');
  if (!positive(width) || !positive(height) || width <= height) return null;

  const rawInsets = positionalInsets === undefined
    ? (insetFields.length === 1 ? ownValue(source, insetFields[0]) : EMPTY_INSETS)
    : positionalInsets;
  const insets = rawInsets === EMPTY_INSETS ? EMPTY_INSETS : snapshotInsets(rawInsets);
  if (insets === null || insets.left + insets.right >= width || insets.top + insets.bottom >= height) return null;
  return Object.freeze({ width, height, insets });
}

function screenToDesign(content: BattleLayoutRect, scale: number, point: unknown): BattleLayoutPoint | null {
  const screen = snapshotPoint(point);
  if (
    screen === null
    || screen.x < content.x
    || screen.y < content.y
    || screen.x >= content.x + content.width
    || screen.y >= content.y + content.height
  ) return null;
  return freezePoint((screen.x - content.x) / scale, (screen.y - content.y) / scale);
}

function designToScreen(content: BattleLayoutRect, scale: number, point: unknown): BattleLayoutPoint | null {
  const design = snapshotPoint(point);
  if (
    design === null
    || design.x < 0
    || design.y < 0
    || design.x >= BATTLE_LAYOUT_DESIGN_SIZE.width
    || design.y >= BATTLE_LAYOUT_DESIGN_SIZE.height
  ) return null;
  return freezePoint(content.x + design.x * scale, content.y + design.y * scale);
}

/** Builds an isolated 16:9 geometry snapshot from one viewport reading. */
export function createBattleLayout(viewport: unknown, positionalInsets?: unknown): BattleLayoutSnapshot | null {
  try {
    const source = snapshotViewport(viewport, positionalInsets);
    if (source === null) return null;

    const safeRect = freezeRect(
      source.insets.left,
      source.insets.top,
      source.width - source.insets.left - source.insets.right,
      source.height - source.insets.top - source.insets.bottom,
    );
    const scale = Math.min(
      safeRect.width / BATTLE_LAYOUT_DESIGN_SIZE.width,
      safeRect.height / BATTLE_LAYOUT_DESIGN_SIZE.height,
    );
    if (!positive(scale)) return null;

    const contentWidth = Math.min(safeRect.width, BATTLE_LAYOUT_DESIGN_SIZE.width * scale);
    const contentHeight = Math.min(safeRect.height, BATTLE_LAYOUT_DESIGN_SIZE.height * scale);
    if (!positive(contentWidth) || !positive(contentHeight)) return null;
    const contentRect = freezeRect(
      Math.max(safeRect.x, Math.min(safeRect.x + safeRect.width - contentWidth, safeRect.x + (safeRect.width - contentWidth) / 2)),
      Math.max(safeRect.y, Math.min(safeRect.y + safeRect.height - contentHeight, safeRect.y + (safeRect.height - contentHeight) / 2)),
      contentWidth,
      contentHeight,
    );
    const zoneHeight = contentHeight / 6;
    const topUiRect = freezeRect(contentRect.x, contentRect.y, contentRect.width, zoneHeight);
    const bottomUiRect = freezeRect(
      contentRect.x,
      contentRect.y + contentRect.height - zoneHeight,
      contentRect.width,
      zoneHeight,
    );

    return Object.freeze({
      viewport: freezeRect(0, 0, source.width, source.height),
      safeRect,
      safeArea: safeRect,
      contentRect,
      topUiRect,
      bottomUiRect,
      designSize: BATTLE_LAYOUT_DESIGN_SIZE,
      scale,
      screenToDesign: (point: unknown) => screenToDesign(contentRect, scale, point),
      designToScreen: (point: unknown) => designToScreen(contentRect, scale, point),
      isOperableScreenPoint: (point: unknown) => screenToDesign(contentRect, scale, point) !== null,
    });
  } catch {
    return null;
  }
}

/** Runtime-neutral owner for the latest layout snapshot. */
export class BattleLayoutController {
  private layoutValue: BattleLayoutSnapshot | null = null;

  get snapshot(): BattleLayoutSnapshot | null {
    return this.layoutValue;
  }

  get layout(): BattleLayoutSnapshot | null {
    return this.layoutValue;
  }

  resize(viewport: unknown, positionalInsets?: unknown): BattleLayoutSnapshot | null {
    try {
      const next = createBattleLayout(viewport, positionalInsets);
      if (next === null) return null;
      this.layoutValue = next;
      return next;
    } catch {
      return null;
    }
  }

  screenToDesign(point: unknown): BattleLayoutPoint | null {
    try {
      return this.layoutValue === null ? null : this.layoutValue.screenToDesign(point);
    } catch {
      return null;
    }
  }

  designToScreen(point: unknown): BattleLayoutPoint | null {
    try {
      return this.layoutValue === null ? null : this.layoutValue.designToScreen(point);
    } catch {
      return null;
    }
  }

  isOperableScreenPoint(point: unknown): boolean {
    try {
      return this.layoutValue !== null && this.layoutValue.isOperableScreenPoint(point);
    } catch {
      return false;
    }
  }
}
