import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

const clientRoot = resolve(process.cwd());
const repoRoot = resolve(clientRoot, '..');
const unitRoot = resolve(clientRoot, 'assets/resources/art/battle/units/U005');
const skeletonPath = resolve(unitRoot, 'skeleton.json');
const contractPath = resolve(unitRoot, 'production-contract.json');
const poseMetaPath = resolve(unitRoot, 'U005-POSE-SHEET.png.meta');
const cutoutMetaPath = resolve(unitRoot, 'U005-CUTOUT-SHEET.png.meta');
const cardsPath = resolve(clientRoot, 'assets/resources/config/cards.json');
const unitsPath = resolve(clientRoot, 'assets/resources/config/units.json');
const roleDocPath = resolve(repoRoot, '角色兵种体系-v1.1.md');
const cardDocPath = resolve(repoRoot, '第一批卡牌设计表.md');
const artDocPath = resolve(repoRoot, '首批美术素材清单-v2.2.md');
const sourceArtPath = resolve(repoRoot, '美术素材/标准版/单位卡面/U005-CARD.png');

const REQUIRED_ACTIONS = Object.freeze(['Idle', 'Move', 'Attack', 'Hit', 'Death']);
const REQUIRED_MOUNTS = Object.freeze(['attackOrigin', 'effect', 'healthBar', 'shadow', 'cardAnchor']);
const TRACK_PROPERTIES = new Set(['translateX', 'translateY', 'rotate', 'scaleX', 'scaleY', 'opacity']);
const EXPECTED_FILES = Object.freeze([
  'U005-CUTOUT-SHEET.png',
  'U005-CUTOUT-SHEET.png.meta',
  'U005-POSE-SHEET.png',
  'U005-POSE-SHEET.png.meta',
  'production-contract.json',
  'production-contract.json.meta',
  'skeleton.json',
  'skeleton.json.meta',
]);
const EXPECTED_BINDING = Object.freeze({
  displayName: '流光驭手',
  unitId: 'U005',
  race: '羽民',
  politicalFaction: '山海诸庭',
  role: 'FAST',
  attackChannel: 'PHYSICAL',
  offenseType: 'SLASH',
  defenseType: 'LIGHT',
  element: 'METAL',
  range: 1,
  maxHp: 4,
  attack: 2,
  armor: 0,
  move: 2,
  abilityIds: Object.freeze(['A005']),
  visualArchetype: 'WINGED_RIDER',
  prepare: 2,
  rarity: 3,
  copyLimit: 3,
  tags: Object.freeze(['unit', 'fast']),
});
const EXPECTED_POSE_GRID = Object.freeze([
  Object.freeze({ state: 'Idle', rect: Object.freeze({ x: 0, y: 0, width: 360, height: 640 }) }),
  Object.freeze({ state: 'Move', rect: Object.freeze({ x: 360, y: 0, width: 360, height: 640 }) }),
  Object.freeze({ state: 'Attack', rect: Object.freeze({ x: 720, y: 0, width: 360, height: 640 }) }),
  Object.freeze({ state: 'Hit', rect: Object.freeze({ x: 1080, y: 0, width: 360, height: 640 }) }),
  Object.freeze({ state: 'Death', rect: Object.freeze({ x: 1440, y: 0, width: 360, height: 640 }) }),
]);
const EXPECTED_SLICES = Object.freeze({
  fullBody: Object.freeze({ x: 0, y: 0, width: 460, height: 560 }),
  spearThrust: Object.freeze({ x: 460, y: 0, width: 500, height: 420 }),
  afterimageTrail: Object.freeze({ x: 980, y: 0, width: 556, height: 430 }),
  lowerStride: Object.freeze({ x: 0, y: 560, width: 460, height: 464 }),
  rigSilhouette: Object.freeze({ x: 420, y: 264, width: 560, height: 760 }),
});
const MOUNT_CONTRACT = Object.freeze({
  attackOrigin: Object.freeze({ bones: Object.freeze(['spear']), x: Object.freeze([180, 240]), y: Object.freeze([0, 36]) }),
  effect: Object.freeze({ bones: Object.freeze(['torso']), x: Object.freeze([16, 72]), y: Object.freeze([48, 112]) }),
  healthBar: Object.freeze({ bones: Object.freeze(['root']), x: Object.freeze([-24, 24]), y: Object.freeze([180, 256]) }),
  shadow: Object.freeze({ bones: Object.freeze(['root']), x: Object.freeze([-24, 24]), y: Object.freeze([-24, 12]) }),
  cardAnchor: Object.freeze({ bones: Object.freeze(['root']), x: Object.freeze([-24, 24]), y: Object.freeze([72, 144]) }),
});
const EXPECTED_ORIENTATION = Object.freeze({
  player: Object.freeze({ direction: 1, scaleX: 1 }),
  enemy: Object.freeze({ direction: -1, scaleX: -1 }),
});
const PANEL_GUARDS = Object.freeze({
  // These area floors reflect the actual sparse foreground mask; scene provenance is checked separately below.
  Idle: Object.freeze({ minAlphaPixels: 28000, minVisibleWidth: 240, minVisibleHeight: 360, maxCoverage: 0.36, minInnerTransparentRatio: 0.45 }),
  Move: Object.freeze({ minAlphaPixels: 25000, minVisibleWidth: 260, minVisibleHeight: 360, maxCoverage: 0.38, minInnerTransparentRatio: 0.4 }),
  Attack: Object.freeze({ minAlphaPixels: 25000, minVisibleWidth: 260, minVisibleHeight: 320, maxCoverage: 0.35, minInnerTransparentRatio: 0.45 }),
  Hit: Object.freeze({ minAlphaPixels: 25000, minVisibleWidth: 240, minVisibleHeight: 340, maxCoverage: 0.32, minInnerTransparentRatio: 0.5 }),
  Death: Object.freeze({ minAlphaPixels: 10000, minVisibleWidth: 180, minVisibleHeight: 120, maxCoverage: 0.1, minInnerTransparentRatio: 0.85 }),
});
const SLICE_GUARDS = Object.freeze({
  fullBody: Object.freeze({ minAlphaPixels: 45000, minVisibleWidth: 240, minVisibleHeight: 360, maxCoverage: 0.24, minInnerTransparentRatio: 0.6 }),
  spearThrust: Object.freeze({ minAlphaPixels: 30000, minVisibleWidth: 300, minVisibleHeight: 220, maxCoverage: 0.34, minInnerTransparentRatio: 0.45 }),
  afterimageTrail: Object.freeze({ minAlphaPixels: 40000, minVisibleWidth: 400, minVisibleHeight: 260, maxCoverage: 0.56, minInnerTransparentRatio: 0.22 }),
  lowerStride: Object.freeze({ minAlphaPixels: 40000, minVisibleWidth: 220, minVisibleHeight: 260, maxCoverage: 0.28, minInnerTransparentRatio: 0.55 }),
  rigSilhouette: Object.freeze({ minAlphaPixels: 80000, minVisibleWidth: 360, minVisibleHeight: 520, maxCoverage: 0.32, minInnerTransparentRatio: 0.58 }),
});
const SCENE_SAMPLE_RECTS = Object.freeze([
  Object.freeze({ name: 'sky', x: 0, y: 0, width: 24, height: 24 }),
  Object.freeze({ name: 'city', x: 0, y: 560, width: 24, height: 24 }),
  Object.freeze({ name: 'ground-reflection', x: 760, y: 1400, width: 24, height: 24 }),
]);

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function sha256(value) {
  const buffer = Buffer.isBuffer(value) ? value : readFileSync(value);
  return createHash('sha256').update(buffer).digest('hex');
}

function assertExactKeys(record, keys, label) {
  assert.deepEqual(Object.keys(record).sort(), [...keys].sort(), `${label} keys must match the approved set`);
}

function assertRect(rect, bounds, label) {
  for (const key of ['x', 'y', 'width', 'height']) {
    assert.equal(Number.isInteger(rect?.[key]), true, `${label}.${key} must be an integer`);
  }
  assert.equal(rect.x >= 0 && rect.y >= 0, true, `${label} must start inside the atlas`);
  assert.equal(rect.width > 0 && rect.height > 0, true, `${label} dimensions must be positive`);
  assert.equal(rect.x + rect.width <= bounds.width, true, `${label} exceeds atlas width`);
  assert.equal(rect.y + rect.height <= bounds.height, true, `${label} exceeds atlas height`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function parsePng(file) {
  const buffer = readFileSync(file);
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${basename(file)} must be a PNG`);
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    assert.equal(end + 4 <= buffer.length, true, `${basename(file)} has a truncated ${type} chunk`);
    const chunk = buffer.subarray(start, end);
    offset = end + 4;
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      assert.equal(chunk[8], 8, `${basename(file)} must use 8-bit channels`);
      colorType = chunk[9];
      assert.equal(colorType === 6 || colorType === 2, true, `${basename(file)} must use RGB or RGBA pixels`);
      assert.equal(chunk[10], 0, `${basename(file)} must use PNG default compression`);
      assert.equal(chunk[11], 0, `${basename(file)} must use PNG default filtering`);
      assert.equal(chunk[12], 0, `${basename(file)} must be non-interlaced`);
    } else if (type === 'IDAT') {
      idat.push(chunk);
    } else if (type === 'IEND') {
      break;
    }
  }
  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const stride = width * bytesPerPixel;
  const filtered = inflateSync(Buffer.concat(idat));
  const rgba = Buffer.alloc(width * height * 4);
  let sourceOffset = 0;
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filterType = filtered[sourceOffset];
    sourceOffset += 1;
    const row = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const raw = filtered[sourceOffset + x];
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
      const above = previous[x];
      const upperLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
      if (filterType === 0) row[x] = raw;
      else if (filterType === 1) row[x] = (raw + left) & 255;
      else if (filterType === 2) row[x] = (raw + above) & 255;
      else if (filterType === 3) row[x] = (raw + Math.floor((left + above) / 2)) & 255;
      else if (filterType === 4) {
        const predictor = left + above - upperLeft;
        const pa = Math.abs(predictor - left);
        const pb = Math.abs(predictor - above);
        const pc = Math.abs(predictor - upperLeft);
        const prior = pa <= pb && pa <= pc ? left : pb <= pc ? above : upperLeft;
        row[x] = (raw + prior) & 255;
      } else {
        assert.fail(`${basename(file)} uses unsupported PNG filter ${filterType}`);
      }
    }
    for (let x = 0; x < width; x += 1) {
      const rowOffset = x * bytesPerPixel;
      const target = (y * width + x) * 4;
      rgba[target] = row[rowOffset];
      rgba[target + 1] = row[rowOffset + 1];
      rgba[target + 2] = row[rowOffset + 2];
      rgba[target + 3] = bytesPerPixel === 4 ? row[rowOffset + 3] : 255;
    }
    previous = row;
    sourceOffset += stride;
  }
  return { width, height, rgba, colorType };
}

function cropMetrics(image, rect, label) {
  assertRect(rect, { width: image.width, height: image.height }, label);
  let alphaPixels = 0;
  let minX = rect.width;
  let minY = rect.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < rect.height; y += 1) {
    const base = ((rect.y + y) * image.width + rect.x) * 4;
    for (let x = 0; x < rect.width; x += 1) {
      const alpha = image.rgba[base + x * 4 + 3];
      if (alpha > 0) {
        alphaPixels += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  assert.equal(alphaPixels > 0, true, `${label} must contain visible pixels`);
  const innerInsetX = Math.max(8, Math.floor(rect.width / 8));
  const innerInsetY = Math.max(8, Math.floor(rect.height / 8));
  let innerTransparentPixels = 0;
  let innerPixels = 0;
  for (let y = innerInsetY; y < rect.height - innerInsetY; y += 1) {
    const base = ((rect.y + y) * image.width + rect.x) * 4;
    for (let x = innerInsetX; x < rect.width - innerInsetX; x += 1) {
      innerPixels += 1;
      if (image.rgba[base + x * 4 + 3] === 0) innerTransparentPixels += 1;
    }
  }
  return {
    alphaPixels,
    visibleBounds: {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    },
    alphaCoverage: alphaPixels / (rect.width * rect.height),
    innerTransparentRatio: innerPixels === 0 ? 0 : innerTransparentPixels / innerPixels,
  };
}

function assertTransparentProjection(metrics, rule, label) {
  assert.equal(metrics.alphaPixels >= rule.minAlphaPixels, true, `${label} must contain enough visible combat pixels`);
  assert.equal(metrics.visibleBounds.width >= rule.minVisibleWidth, true, `${label} visible silhouette is too narrow`);
  assert.equal(metrics.visibleBounds.height >= rule.minVisibleHeight, true, `${label} visible silhouette is too short`);
  assert.equal(metrics.alphaCoverage <= rule.maxCoverage, true, `${label} still behaves like a card-background crop`);
  assert.equal(metrics.innerTransparentRatio >= rule.minInnerTransparentRatio, true, `${label} lacks internal transparency and still reads like a pseudo-transparent card slice`);
}

function validatePosePanels(image, panels) {
  for (const panel of panels) {
    const metrics = cropMetrics(image, panel.rect, `U005 pose panel ${panel.state}`);
    assertTransparentProjection(metrics, PANEL_GUARDS[panel.state], `U005 pose panel ${panel.state}`);
    if (panel.state === 'Death') {
      assert.equal(metrics.visibleBounds.width > metrics.visibleBounds.height / 2, true, 'U005 Death panel must read as a fallen sideways silhouette');
    }
  }
}

function validateCutoutSlices(image, slices) {
  for (const slice of slices) {
    const metrics = cropMetrics(image, slice.rect, `U005 cutout slice ${slice.name}`);
    assertTransparentProjection(metrics, SLICE_GUARDS[slice.name], `U005 cutout slice ${slice.name}`);
  }
  const thrustMetrics = cropMetrics(image, EXPECTED_SLICES.spearThrust, 'U005 spearThrust slice');
  assert.equal(thrustMetrics.visibleBounds.x >= 24, true, 'U005 spearThrust must leave a transparent rear margin instead of filling the full card width');
  assert.equal(thrustMetrics.visibleBounds.x + thrustMetrics.visibleBounds.width >= 430, true, 'U005 spearThrust must preserve a right-facing weapon extension');
  const afterimageMetrics = cropMetrics(image, EXPECTED_SLICES.afterimageTrail, 'U005 afterimageTrail slice');
  assert.equal(afterimageMetrics.alphaCoverage >= 0.3, true, 'U005 afterimageTrail must retain substantial visible afterimage content');
}

function makeBlankImage(width, height) {
  return { width, height, rgba: Buffer.alloc(width * height * 4) };
}

function copyScaledPixel(source, sourceX, sourceY, target, targetX, targetY, alpha) {
  const clampedX = Math.max(0, Math.min(source.width - 1, sourceX));
  const clampedY = Math.max(0, Math.min(source.height - 1, sourceY));
  const sourceOffset = (clampedY * source.width + clampedX) * 4;
  const targetOffset = (targetY * target.width + targetX) * 4;
  target.rgba[targetOffset] = source.rgba[sourceOffset];
  target.rgba[targetOffset + 1] = source.rgba[sourceOffset + 1];
  target.rgba[targetOffset + 2] = source.rgba[sourceOffset + 2];
  target.rgba[targetOffset + 3] = alpha;
}

function buildEdgeTransparentCardSheet(sourceImage, entries, sheetSize) {
  const result = makeBlankImage(sheetSize.width, sheetSize.height);
  for (const entry of entries) {
    const rect = entry.rect;
    const border = Math.max(10, Math.floor(Math.min(rect.width, rect.height) * 0.03));
    for (let y = 0; y < rect.height; y += 1) {
      for (let x = 0; x < rect.width; x += 1) {
        const alpha = x < border || y < border || x >= rect.width - border || y >= rect.height - border ? 0 : 255;
        const sourceX = Math.floor((x / Math.max(1, rect.width - 1)) * (sourceImage.width - 1));
        const sourceY = Math.floor((y / Math.max(1, rect.height - 1)) * (sourceImage.height - 1));
        copyScaledPixel(sourceImage, sourceX, sourceY, result, rect.x + x, rect.y + y, alpha);
      }
    }
  }
  return result;
}

function extractScenePatch(sourceImage, rect) {
  assertRect(rect, { width: sourceImage.width, height: sourceImage.height }, `scene sample ${rect.name}`);
  const pixels = Buffer.alloc(rect.width * rect.height * 3);
  let offset = 0;
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      const sourceOffset = (y * sourceImage.width + x) * 4;
      pixels[offset] = sourceImage.rgba[sourceOffset];
      pixels[offset + 1] = sourceImage.rgba[sourceOffset + 1];
      pixels[offset + 2] = sourceImage.rgba[sourceOffset + 2];
      offset += 3;
    }
  }
  return { ...rect, pixels };
}

function containsOpaqueScenePatch(image, patch) {
  for (let y = 0; y <= image.height - patch.height; y += 1) {
    for (let x = 0; x <= image.width - patch.width; x += 1) {
      const first = (y * image.width + x) * 4;
      if (image.rgba[first + 3] < 248 || image.rgba[first] !== patch.pixels[0] || image.rgba[first + 1] !== patch.pixels[1] || image.rgba[first + 2] !== patch.pixels[2]) continue;
      let matches = true;
      let patchOffset = 0;
      for (let patchY = 0; patchY < patch.height && matches; patchY += 1) {
        for (let patchX = 0; patchX < patch.width; patchX += 1) {
          const imageOffset = ((y + patchY) * image.width + x + patchX) * 4;
          if (image.rgba[imageOffset + 3] < 248 || image.rgba[imageOffset] !== patch.pixels[patchOffset] || image.rgba[imageOffset + 1] !== patch.pixels[patchOffset + 1] || image.rgba[imageOffset + 2] !== patch.pixels[patchOffset + 2]) {
            matches = false;
            break;
          }
          patchOffset += 3;
        }
      }
      if (matches) return true;
    }
  }
  return false;
}

function luminanceSignature(rgba, width, height, x, y, sampleWidth, sampleHeight, gridSize = 6) {
  const values = [];
  for (let gridY = 0; gridY < gridSize; gridY += 1) {
    const startY = y + Math.floor((gridY * sampleHeight) / gridSize);
    const endY = y + Math.max(startY - y + 1, Math.floor(((gridY + 1) * sampleHeight) / gridSize));
    for (let gridX = 0; gridX < gridSize; gridX += 1) {
      const startX = x + Math.floor((gridX * sampleWidth) / gridSize);
      const endX = x + Math.max(startX - x + 1, Math.floor(((gridX + 1) * sampleWidth) / gridSize));
      let total = 0;
      let count = 0;
      for (let pixelY = startY; pixelY < Math.min(y + sampleHeight, endY); pixelY += 1) {
        for (let pixelX = startX; pixelX < Math.min(x + sampleWidth, endX); pixelX += 1) {
          const offset = (pixelY * width + pixelX) * 4;
          if (rgba[offset + 3] < 248) continue;
          total += rgba[offset] * 0.2126 + rgba[offset + 1] * 0.7152 + rgba[offset + 2] * 0.0722;
          count += 1;
        }
      }
      values.push(count === 0 ? 0 : total / count);
    }
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const deviation = Math.sqrt(variance);
  return { values, mean, deviation, normalized: deviation < 1 ? values.map(() => 0) : values.map((value) => (value - mean) / deviation) };
}

function signatureCorrelation(left, right) {
  if (left.normalized.length !== right.normalized.length || left.deviation < 1 || right.deviation < 1) return 0;
  return left.normalized.reduce((sum, value, index) => sum + value * right.normalized[index], 0) / left.normalized.length;
}

function containsTransformedScenePatch(image, patch) {
  const patchRgba = Buffer.alloc(patch.width * patch.height * 4);
  for (let index = 0, sourceOffset = 0; index < patch.width * patch.height; index += 1, sourceOffset += 3) {
    const targetOffset = index * 4;
    patchRgba[targetOffset] = patch.pixels[sourceOffset];
    patchRgba[targetOffset + 1] = patch.pixels[sourceOffset + 1];
    patchRgba[targetOffset + 2] = patch.pixels[sourceOffset + 2];
    patchRgba[targetOffset + 3] = 255;
  }
  const sourceSignature = luminanceSignature(patchRgba, patch.width, patch.height, 0, 0, patch.width, patch.height);
  if (sourceSignature.deviation < 1) return false;
  for (const scale of [0.75, 1, 1.5, 2]) {
    const tileWidth = Math.max(6, Math.round(patch.width * scale));
    const tileHeight = Math.max(6, Math.round(patch.height * scale));
    if (tileWidth > image.width || tileHeight > image.height) continue;
    for (let y = 0; y <= image.height - tileHeight; y += 4) {
      for (let x = 0; x <= image.width - tileWidth; x += 4) {
        const coarseCandidate = luminanceSignature(image.rgba, image.width, image.height, x, y, tileWidth, tileHeight);
        if (signatureCorrelation(sourceSignature, coarseCandidate) < 0.75) continue;
        for (let offsetY = 0; offsetY < 4 && y + offsetY <= image.height - tileHeight; offsetY += 1) {
          for (let offsetX = 0; offsetX < 4 && x + offsetX <= image.width - tileWidth; offsetX += 1) {
            const candidate = luminanceSignature(image.rgba, image.width, image.height, x + offsetX, y + offsetY, tileWidth, tileHeight);
            if (signatureCorrelation(sourceSignature, candidate) >= 0.985) return true;
          }
        }
      }
    }
  }
  return false;
}

function assertNoSceneResidual(image, sourceImage, label) {
  for (const sample of SCENE_SAMPLE_RECTS.map((rect) => extractScenePatch(sourceImage, rect))) {
    assert.equal(containsOpaqueScenePatch(image, sample), false, `${label} contains an opaque ${sample.name} scene residual copied from U005-CARD.png`);
    assert.equal(containsTransformedScenePatch(image, sample), false, `${label} contains a scaled or color-transformed ${sample.name} scene residual`);
  }
}

function injectScenePatch(image, sourceImage, sampleRect, destination) {
  const result = { width: image.width, height: image.height, rgba: Buffer.from(image.rgba) };
  const patch = extractScenePatch(sourceImage, sampleRect);
  assertRect(destination, { width: image.width, height: image.height }, `scene residual destination ${sampleRect.name}`);
  assert.equal(destination.width, patch.width, 'scene residual destination width must match the source patch');
  assert.equal(destination.height, patch.height, 'scene residual destination height must match the source patch');
  let patchOffset = 0;
  for (let y = destination.y; y < destination.y + destination.height; y += 1) {
    for (let x = destination.x; x < destination.x + destination.width; x += 1) {
      const targetOffset = (y * result.width + x) * 4;
      result.rgba[targetOffset] = patch.pixels[patchOffset];
      result.rgba[targetOffset + 1] = patch.pixels[patchOffset + 1];
      result.rgba[targetOffset + 2] = patch.pixels[patchOffset + 2];
      result.rgba[targetOffset + 3] = 255;
      patchOffset += 3;
    }
  }
  return result;
}

function injectTransformedScenePatch(image, sourceImage, sampleRect, destination, scale, tint) {
  const result = { width: image.width, height: image.height, rgba: Buffer.from(image.rgba) };
  const patch = extractScenePatch(sourceImage, sampleRect);
  const scaledWidth = Math.round(patch.width * scale);
  const scaledHeight = Math.round(patch.height * scale);
  assertRect({ ...destination, width: scaledWidth, height: scaledHeight }, { width: image.width, height: image.height }, `transformed scene destination ${sampleRect.name}`);
  for (let y = 0; y < scaledHeight; y += 1) {
    for (let x = 0; x < scaledWidth; x += 1) {
      const sourceX = Math.min(patch.width - 1, Math.floor(x / scale));
      const sourceY = Math.min(patch.height - 1, Math.floor(y / scale));
      const sourceOffset = (sourceY * patch.width + sourceX) * 3;
      const targetOffset = ((destination.y + y) * result.width + destination.x + x) * 4;
      result.rgba[targetOffset] = Math.min(255, Math.round(patch.pixels[sourceOffset] * tint[0] + tint[3]));
      result.rgba[targetOffset + 1] = Math.min(255, Math.round(patch.pixels[sourceOffset + 1] * tint[1] + tint[3]));
      result.rgba[targetOffset + 2] = Math.min(255, Math.round(patch.pixels[sourceOffset + 2] * tint[2] + tint[3]));
      result.rgba[targetOffset + 3] = 255;
    }
  }
  return result;
}

function validateTextureMeta(metaPath, image, expectedDisplayName) {
  const meta = readJson(metaPath);
  assert.equal(meta.importer, 'image', `${basename(metaPath)} must be an image importer meta`);
  assert.equal(meta.imported, true, `${basename(metaPath)} must be imported`);
  assert.equal(meta.userData?.type, 'sprite-frame', `${basename(metaPath)} must expose a sprite-frame redirect`);
  assert.equal(meta.userData?.hasAlpha, true, `${basename(metaPath)} must preserve alpha`);
  const entries = Object.values(meta.subMetas ?? {});
  const texture = entries.find((entry) => entry.importer === 'texture');
  const spriteFrame = entries.find((entry) => entry.importer === 'sprite-frame');
  assert.ok(texture, `${basename(metaPath)} must contain a texture sub-meta`);
  assert.ok(spriteFrame, `${basename(metaPath)} must contain a sprite-frame sub-meta`);
  assert.equal(texture.displayName, expectedDisplayName, `${basename(metaPath)} texture displayName changed`);
  assert.equal(spriteFrame.displayName, expectedDisplayName, `${basename(metaPath)} sprite-frame displayName changed`);
  assert.equal(meta.userData.redirect, texture.uuid, `${basename(metaPath)} redirect must target the texture sub-meta`);
  assert.equal(spriteFrame.userData.imageUuidOrDatabaseUri, texture.uuid, `${basename(metaPath)} sprite-frame must target its texture sub-meta`);
  assert.equal(spriteFrame.userData.width, image.width, `${basename(metaPath)} sprite-frame width must match the real PNG`);
  assert.equal(spriteFrame.userData.height, image.height, `${basename(metaPath)} sprite-frame height must match the real PNG`);
  assert.equal(spriteFrame.userData.rawWidth, image.width, `${basename(metaPath)} sprite-frame rawWidth must match the real PNG`);
  assert.equal(spriteFrame.userData.rawHeight, image.height, `${basename(metaPath)} sprite-frame rawHeight must match the real PNG`);
}

function validateContract(contract, skeleton) {
  assert.equal(contract.schema, 'battle-unit-production-contract/v1', 'U005 contract schema changed');
  assert.equal(contract.contractVersion, '2.2', 'U005 contract version changed');
  assert.equal(contract.productionTask, 'T282', 'U005 production task changed');
  assert.equal(contract.approvedAt, '2026-08-21', 'U005 approval date changed');
  assert.equal(contract.unitId, EXPECTED_BINDING.unitId, 'U005 contract unitId changed');
  assert.equal(contract.displayName, EXPECTED_BINDING.displayName, 'U005 contract display name changed');
  assert.equal(contract.resourceRoot, 'assets/resources/art/battle/units/U005', 'U005 contract resource root changed');

  assert.deepEqual(contract.combatIdentity, {
    race: EXPECTED_BINDING.race,
    politicalFaction: EXPECTED_BINDING.politicalFaction,
    role: EXPECTED_BINDING.role,
    offenseType: EXPECTED_BINDING.offenseType,
    defenseType: EXPECTED_BINDING.defenseType,
    element: EXPECTED_BINDING.element,
    visualArchetype: EXPECTED_BINDING.visualArchetype,
    abilityHint: '急行',
    combatPurpose: '空线压力',
    stats: {
      prepare: EXPECTED_BINDING.prepare,
      maxHp: EXPECTED_BINDING.maxHp,
      attack: EXPECTED_BINDING.attack,
      armor: EXPECTED_BINDING.armor,
      move: EXPECTED_BINDING.move,
      range: EXPECTED_BINDING.range,
      copyLimit: EXPECTED_BINDING.copyLimit,
      rarity: EXPECTED_BINDING.rarity,
    },
    tags: [...EXPECTED_BINDING.tags],
  }, 'U005 combat identity drifted from the approved docs');

  assert.deepEqual(contract.designIntent, {
    silhouette: '骑具、短矛',
    readabilityPx: 120,
    readabilityRequirement: '两格移动通过残影和步幅表达',
    animationFocus: ['低空前倾', '两格步幅', '短矛切入', '受击回撤', '死亡退场'],
  }, 'U005 design intent changed unexpectedly');

  const contractPose = contract.resources.poseSheet;
  assert.equal(contractPose.file, 'U005-POSE-SHEET.png', 'U005 pose sheet file changed');
  assert.equal(contractPose.metaFile, 'U005-POSE-SHEET.png.meta', 'U005 pose sheet meta changed');
  assert.equal(contractPose.resourcePath, 'art/battle/units/U005/U005-POSE-SHEET/spriteFrame', 'U005 pose resource path changed');
  assert.equal(contractPose.referencePath, '美术素材/标准版/单位卡面/U005-CARD.png', 'U005 pose reference path changed');
  assert.equal(contractPose.sha256, skeleton.atlases.poseSheet.sha256, 'U005 pose hash mismatch between contract and skeleton');
  assert.deepEqual(contractPose.size, skeleton.atlases.poseSheet.size, 'U005 pose size mismatch between contract and skeleton');
  assert.deepEqual(contractPose.poseGrid, skeleton.atlases.poseSheet.statePanels, 'U005 pose grid mismatch between contract and skeleton');

  const contractCutout = contract.resources.cutoutSheet;
  assert.equal(contractCutout.file, 'U005-CUTOUT-SHEET.png', 'U005 cutout file changed');
  assert.equal(contractCutout.metaFile, 'U005-CUTOUT-SHEET.png.meta', 'U005 cutout meta changed');
  assert.equal(contractCutout.resourcePath, 'art/battle/units/U005/U005-CUTOUT-SHEET/spriteFrame', 'U005 cutout resource path changed');
  assert.equal(contractCutout.referencePath, '美术素材/标准版/单位卡面/U005-CARD.png', 'U005 cutout reference path changed');
  assert.equal(contractCutout.sha256, skeleton.atlases.cutoutSheet.sha256, 'U005 cutout hash mismatch between contract and skeleton');
  assert.deepEqual(contractCutout.size, skeleton.atlases.cutoutSheet.size, 'U005 cutout size mismatch between contract and skeleton');
  assert.deepEqual(contractCutout.slices, skeleton.atlases.cutoutSheet.slices, 'U005 cutout slices mismatch between contract and skeleton');

  assert.deepEqual(contract.runtime.requiredActions, REQUIRED_ACTIONS, 'U005 required actions changed');
  assert.deepEqual(contract.runtime.requiredMountPoints, REQUIRED_MOUNTS, 'U005 required mounts changed');
  assert.deepEqual(contract.runtime.orientationPair, skeleton.orientations, 'U005 orientation pair mismatch');
  assert.deepEqual(contract.runtime.requiredEvents, {
    Move: ['footstep'],
    Attack: ['windup', 'impact'],
    Hit: ['hit'],
    Death: ['despawn'],
  }, 'U005 runtime events changed');

  assert.deepEqual(contract.provenance.designEvidence, ['角色兵种体系-v1.1.md', '第一批卡牌设计表.md', '首批美术素材清单-v2.2.md'], 'U005 design evidence changed');
}

function validateSkeleton(skeleton) {
  assert.equal(skeleton.schema, 'battle-unit-production/v1', 'U005 skeleton schema changed');
  assert.equal(skeleton.contractVersion, '2.2', 'U005 skeleton version changed');
  assert.equal(skeleton.unitId, 'U005', 'U005 skeleton unitId changed');
  assert.equal(skeleton.assetStage, 'A2-derived-battle-reference', 'U005 asset stage changed');
  assert.equal(skeleton.runtimeMode, 'pose-sheet-skeleton', 'U005 runtime mode changed');
  assert.equal(skeleton.derivationPolicy, 'derived-from-approved-card-art; low-altitude-stride-read; no-full-mount-silhouette', 'U005 derivation policy changed');

  assert.deepEqual(skeleton.designTruth, {
    name: EXPECTED_BINDING.displayName,
    race: EXPECTED_BINDING.race,
    politicalFaction: EXPECTED_BINDING.politicalFaction,
    battleRole: '快速',
    coreAbility: '移动力二',
    visualArchetype: EXPECTED_BINDING.visualArchetype,
  }, 'U005 design truth drifted from the approved docs');

  assert.deepEqual(skeleton.combatProfile, {
    maxHp: EXPECTED_BINDING.maxHp,
    attack: EXPECTED_BINDING.attack,
    armor: EXPECTED_BINDING.armor,
    spellResist: 0,
    move: EXPECTED_BINDING.move,
    range: EXPECTED_BINDING.range,
    attackChannel: EXPECTED_BINDING.attackChannel,
    offenseType: EXPECTED_BINDING.offenseType,
    defenseType: EXPECTED_BINDING.defenseType,
    element: EXPECTED_BINDING.element,
    role: EXPECTED_BINDING.role,
    prepare: EXPECTED_BINDING.prepare,
    copyLimit: EXPECTED_BINDING.copyLimit,
    abilityId: EXPECTED_BINDING.abilityIds[0],
  }, 'U005 combat profile drifted from the approved config');

  assert.equal(skeleton.artConstraints.weaponType, 'SHORT_SPEAR', 'U005 weapon silhouette changed');
  assert.equal(skeleton.artConstraints.riderGearVisible, true, 'U005 rider gear requirement changed');
  assert.equal(skeleton.artConstraints.strideRead, true, 'U005 stride readability changed');
  assert.equal(skeleton.artConstraints.afterimageRead, true, 'U005 afterimage readability changed');
  assert.deepEqual(skeleton.artConstraints.requiredNotes, ['骑具', '短矛', '两格移动通过残影和步幅表达'], 'U005 required notes changed');
  assert.deepEqual(skeleton.artConstraints.forbiddenLook, ['FULL_MOUNT', 'LARGE_WINGS_BLOCKING_SILHOUETTE', 'STATIC_REARLINE_POSTURE'], 'U005 forbidden looks changed');

  assert.deepEqual(skeleton.canvas, { width: 512, height: 512, pivot: { x: 0.5, y: 0.1 } }, 'U005 canvas changed');
  assert.equal(skeleton.atlases.poseSheet.path, 'cocos-client/assets/resources/art/battle/units/U005/U005-POSE-SHEET.png', 'U005 poseSheet path changed');
  assert.equal(skeleton.atlases.cutoutSheet.path, 'cocos-client/assets/resources/art/battle/units/U005/U005-CUTOUT-SHEET.png', 'U005 cutoutSheet path changed');

  const posePanels = skeleton.atlases.poseSheet.statePanels;
  assert.equal(posePanels.length, REQUIRED_ACTIONS.length, 'U005 pose panel count changed');
  let poseCursor = 0;
  for (const [index, expected] of EXPECTED_POSE_GRID.entries()) {
    const panel = posePanels[index];
    assert.equal(panel.index, index, `U005 ${expected.state} pose index changed`);
    assert.equal(panel.state, expected.state, `U005 pose order changed at ${expected.state}`);
    assert.deepEqual(panel.rect, expected.rect, `U005 ${expected.state} rect changed`);
    assert.equal(panel.rect.x, poseCursor, `U005 ${expected.state} pose rect must start after the previous panel`);
    poseCursor += panel.rect.width;
  }
  assert.equal(poseCursor, skeleton.atlases.poseSheet.size.width, 'U005 pose panels must cover the full pose sheet width');

  const sliceMap = new Map(skeleton.atlases.cutoutSheet.slices.map((slice) => [slice.name, slice]));
  assert.deepEqual([...sliceMap.keys()].sort(), Object.keys(EXPECTED_SLICES).sort(), 'U005 cutout slice names changed');
  for (const [name, rect] of Object.entries(EXPECTED_SLICES)) {
    assert.deepEqual(sliceMap.get(name)?.rect, rect, `U005 cutout slice ${name} changed`);
  }

  const boneNames = new Set();
  assert.equal(Array.isArray(skeleton.bones) && skeleton.bones.length >= 8, true, 'U005 must define a non-trivial bone hierarchy');
  for (const [index, bone] of skeleton.bones.entries()) {
    assert.match(bone.name ?? '', /^[a-z][a-zA-Z0-9]*$/, `U005 bone ${index} must use a stable identifier`);
    assert.equal(boneNames.has(bone.name), false, `U005 bone ${bone.name} is duplicated`);
    if (index === 0) {
      assert.equal(bone.name, 'root', 'U005 hierarchy must start at root');
      assert.equal('parent' in bone, false, 'U005 root must not declare a parent');
    } else {
      assert.equal(boneNames.has(bone.parent), true, `U005 bone ${bone.name} must target an earlier parent`);
    }
    boneNames.add(bone.name);
  }

  const attachmentNames = new Set();
  assert.equal(Array.isArray(skeleton.attachments) && skeleton.attachments.length === 5, true, 'U005 attachments changed');
  for (const attachment of skeleton.attachments) {
    assert.equal(attachmentNames.has(attachment.name), false, `U005 attachment ${attachment.name} is duplicated`);
    assert.equal(boneNames.has(attachment.bone), true, `U005 attachment ${attachment.name} targets an unknown bone`);
    assert.equal(attachment.source, 'cutoutSheet', `U005 attachment ${attachment.name} must use cutoutSheet`);
    assertRect(attachment.sourceRect, skeleton.atlases.cutoutSheet.size, `U005 attachment ${attachment.name}`);
    assert.equal(attachment.width, attachment.sourceRect.width, `U005 attachment ${attachment.name} width changed`);
    assert.equal(attachment.height, attachment.sourceRect.height, `U005 attachment ${attachment.name} height changed`);
    attachmentNames.add(attachment.name);
  }

  const mounts = new Map(skeleton.mountPoints.map((mount) => [mount.name, mount]));
  assert.deepEqual([...mounts.keys()].sort(), [...REQUIRED_MOUNTS].sort(), 'U005 mount points changed');
  for (const [name, rule] of Object.entries(MOUNT_CONTRACT)) {
    const mount = mounts.get(name);
    assert.equal(Boolean(mount), true, `U005 missing mount ${name}`);
    assert.equal(rule.bones.includes(mount.bone), true, `U005 ${name} must stay on ${rule.bones.join('/')}`);
    assert.equal(mount.x >= rule.x[0] && mount.x <= rule.x[1], true, `U005 ${name}.x left the approved range`);
    assert.equal(mount.y >= rule.y[0] && mount.y <= rule.y[1], true, `U005 ${name}.y left the approved range`);
  }

  assert.deepEqual(skeleton.orientations, EXPECTED_ORIENTATION, 'U005 orientations must keep player-right / enemy-left mapping');

  assertExactKeys(skeleton.stateMap, REQUIRED_ACTIONS, 'U005 stateMap');
  assertExactKeys(skeleton.animations, REQUIRED_ACTIONS, 'U005 animations');
  for (const [index, state] of REQUIRED_ACTIONS.entries()) {
    assert.deepEqual(skeleton.stateMap[state], { source: 'poseSheet', panelIndex: index }, `U005 ${state} state map changed`);
    const animation = skeleton.animations[state];
    assert.equal(typeof animation.duration === 'number' && Number.isFinite(animation.duration), true, `U005 ${state} duration must be numeric`);
    assert.equal(animation.duration > 0, true, `U005 ${state} duration must be positive`);
    assert.deepEqual(animation.sourcePose, skeleton.stateMap[state], `U005 ${state} source pose changed`);
    assert.equal(Array.isArray(animation.tracks) && animation.tracks.length >= 1, true, `U005 ${state} must define transform tracks`);
    let hasChangingTrack = false;
    for (const track of animation.tracks) {
      assert.equal(boneNames.has(track.bone), true, `U005 ${state} track targets an unknown bone`);
      assert.equal(TRACK_PROPERTIES.has(track.property), true, `U005 ${state} uses an unsupported track property`);
      assert.equal(Array.isArray(track.frames) && track.frames.length >= 2, true, `U005 ${state} track must have two or more keyframes`);
      let lastTime = -1;
      const values = new Set();
      for (const frame of track.frames) {
        assert.equal(typeof frame.time === 'number' && Number.isFinite(frame.time), true, `U005 ${state} frame time must be finite`);
        assert.equal(typeof frame.value === 'number' && Number.isFinite(frame.value), true, `U005 ${state} frame value must be finite`);
        assert.equal(frame.time >= 0 && frame.time <= animation.duration, true, `U005 ${state} frame time left its duration bounds`);
        assert.equal(frame.time > lastTime, true, `U005 ${state} frame times must be strictly increasing`);
        lastTime = frame.time;
        values.add(frame.value);
      }
      assert.equal(track.frames[0].time, 0, `U005 ${state} tracks must start at time 0`);
      if (values.size > 1) hasChangingTrack = true;
    }
    assert.equal(hasChangingTrack, true, `U005 ${state} needs at least one visibly changing track`);
  }

  assert.equal(skeleton.animations.Idle.loop, true, 'U005 Idle must loop');
  assert.equal(skeleton.animations.Move.loop, true, 'U005 Move must loop');
  for (const state of ['Attack', 'Hit', 'Death']) {
    assert.equal(skeleton.animations[state].loop, false, `U005 ${state} must not loop`);
  }
  assert.deepEqual(skeleton.animations.Move.events.map((event) => event.name), ['footstep', 'footstep'], 'U005 Move must expose two footstep events');
  assert.deepEqual(skeleton.animations.Attack.events.map((event) => event.name), ['windup', 'impact'], 'U005 Attack must expose windup and impact');
  assert.deepEqual(skeleton.animations.Hit.events.map((event) => event.name), ['hit'], 'U005 Hit must expose a hit event');
  assert.deepEqual(skeleton.animations.Death.events.map((event) => event.name), ['despawn'], 'U005 Death must expose a despawn event');
  assert.equal(skeleton.animations.Death.events[0].time, skeleton.animations.Death.duration, 'U005 Death despawn must align with the final keyframe');
}

function validateConfigAndDocs(skeleton, contract) {
  const units = readJson(unitsPath).units;
  const cards = readJson(cardsPath).cards;
  const unit = units.find((entry) => entry.id === 'U005');
  const card = cards.find((entry) => entry.id === 'U005');
  assert.ok(unit, 'real units.json must contain U005');
  assert.ok(card, 'real cards.json must contain U005');

  assert.equal(unit.race, EXPECTED_BINDING.race, 'units.json U005 race changed');
  assert.equal(unit.politicalFaction, EXPECTED_BINDING.politicalFaction, 'units.json U005 political faction changed');
  assert.equal(unit.role, EXPECTED_BINDING.role, 'units.json U005 role changed');
  assert.equal(unit.attackChannel, EXPECTED_BINDING.attackChannel, 'units.json U005 attackChannel changed');
  assert.equal(unit.offenseType, EXPECTED_BINDING.offenseType, 'units.json U005 offenseType changed');
  assert.equal(unit.defenseType, EXPECTED_BINDING.defenseType, 'units.json U005 defenseType changed');
  assert.equal(unit.element, EXPECTED_BINDING.element, 'units.json U005 element changed');
  assert.equal(unit.range, EXPECTED_BINDING.range, 'units.json U005 range changed');
  assert.equal(unit.maxHp, EXPECTED_BINDING.maxHp, 'units.json U005 maxHp changed');
  assert.equal(unit.attack, EXPECTED_BINDING.attack, 'units.json U005 attack changed');
  assert.equal(unit.armor, EXPECTED_BINDING.armor, 'units.json U005 armor changed');
  assert.equal(unit.move, EXPECTED_BINDING.move, 'units.json U005 move changed');
  assert.deepEqual(unit.abilityIds, [...EXPECTED_BINDING.abilityIds], 'units.json U005 ability changed');
  assert.equal(unit.visualArchetype, EXPECTED_BINDING.visualArchetype, 'units.json U005 visual archetype changed');

  assert.equal(card.cardType, 'UNIT', 'cards.json U005 cardType changed');
  assert.equal(card.unitId, EXPECTED_BINDING.unitId, 'cards.json U005 unit binding changed');
  assert.equal(card.prepare, EXPECTED_BINDING.prepare, 'cards.json U005 prepare changed');
  assert.equal(card.rarity, EXPECTED_BINDING.rarity, 'cards.json U005 rarity changed');
  assert.equal(card.copyLimit, EXPECTED_BINDING.copyLimit, 'cards.json U005 copyLimit changed');
  assert.deepEqual(card.tags, [...EXPECTED_BINDING.tags], 'cards.json U005 tags changed');
  assert.equal(card.race, EXPECTED_BINDING.race, 'cards.json U005 race changed');
  assert.equal(card.politicalFaction, EXPECTED_BINDING.politicalFaction, 'cards.json U005 faction changed');

  assert.equal(contract.combatIdentity.stats.move, unit.move, 'contract move must match units.json');
  assert.equal(contract.combatIdentity.stats.attack, unit.attack, 'contract attack must match units.json');
  assert.equal(contract.combatIdentity.stats.maxHp, unit.maxHp, 'contract maxHp must match units.json');
  assert.equal(contract.combatIdentity.stats.prepare, card.prepare, 'contract prepare must match cards.json');
  assert.equal(skeleton.combatProfile.prepare, card.prepare, 'skeleton prepare must match cards.json');
  assert.equal(skeleton.combatProfile.abilityId, unit.abilityIds[0], 'skeleton abilityId must match units.json');

  const roleDoc = readFileSync(roleDocPath, 'utf8');
  const cardDoc = readFileSync(cardDocPath, 'utf8');
  const artDoc = readFileSync(artDocPath, 'utf8');
  assert.match(roleDoc, /\|\s*U005\s*\|\s*流光驭手\s*\|\s*快速\s*\|\s*2\s*\|\s*移动力二\s*\|/, '角色兵种体系 must freeze U005 as a FAST 羽民 unit with move-2 identity');
  assert.match(cardDoc, /\|\s*U005\s*\|\s*流光驭手\s*\|\s*羽民\s*\|\s*3\s*\|\s*2\s*\|\s*4\s*\|\s*2\s*\|\s*0\s*\|\s*2\s*\|\s*1\s*\|\s*急行\s*\|\s*空线压力\s*\|/, '第一批卡牌设计表 must freeze U005 stats and role');
  assert.match(artDoc, /\|\s*U005 流光驭手\s*\|\s*骑具、短矛\s*\|\s*两格移动通过残影和步幅表达\s*\|/, '首批美术素材清单 must freeze the U005 silhouette and move readability requirements');
}

function validatePngAssets(contract, skeleton) {
  assert.equal(existsSync(sourceArtPath), true, 'U005 source art must exist');
  assert.equal(sha256(sourceArtPath), skeleton.sourceArt.sha256, 'U005 source art hash changed');
  assert.equal(contract.sourceArt.sha256, skeleton.sourceArt.sha256, 'U005 source art hash mismatch between contract and skeleton');

  const posePath = resolve(unitRoot, contract.resources.poseSheet.file);
  const cutoutPath = resolve(unitRoot, contract.resources.cutoutSheet.file);
  assert.equal(existsSync(posePath), true, 'U005 pose sheet is missing');
  assert.equal(existsSync(cutoutPath), true, 'U005 cutout sheet is missing');
  assert.equal(sha256(posePath), contract.resources.poseSheet.sha256, 'U005 pose hash drifted from the contract');
  assert.equal(sha256(cutoutPath), contract.resources.cutoutSheet.sha256, 'U005 cutout hash drifted from the contract');

  const poseImage = parsePng(posePath);
  const cutoutImage = parsePng(cutoutPath);
  assert.deepEqual({ width: poseImage.width, height: poseImage.height }, contract.resources.poseSheet.size, 'U005 pose PNG dimensions changed');
  assert.deepEqual({ width: cutoutImage.width, height: cutoutImage.height }, contract.resources.cutoutSheet.size, 'U005 cutout PNG dimensions changed');
  assert.equal(poseImage.colorType, 6, 'U005 pose sheet must keep RGBA transparency');
  assert.equal(cutoutImage.colorType, 6, 'U005 cutout sheet must keep RGBA transparency');
  validateTextureMeta(poseMetaPath, poseImage, 'U005-POSE-SHEET');
  validateTextureMeta(cutoutMetaPath, cutoutImage, 'U005-CUTOUT-SHEET');

  validatePosePanels(poseImage, skeleton.atlases.poseSheet.statePanels);
  validateCutoutSlices(cutoutImage, skeleton.atlases.cutoutSheet.slices);

  const sourceImage = parsePng(sourceArtPath);
  assertNoSceneResidual(poseImage, sourceImage, 'U005 pose sheet');
  assertNoSceneResidual(cutoutImage, sourceImage, 'U005 cutout sheet');
  const fakePoseImage = buildEdgeTransparentCardSheet(sourceImage, skeleton.atlases.poseSheet.statePanels, skeleton.atlases.poseSheet.size);
  assert.throws(() => validatePosePanels(fakePoseImage, skeleton.atlases.poseSheet.statePanels), /card-background crop|pseudo-transparent card slice/, 'border-transparent full-card pose projections must fail');
  const fakeCutoutImage = buildEdgeTransparentCardSheet(sourceImage, skeleton.atlases.cutoutSheet.slices, skeleton.atlases.cutoutSheet.size);
  assert.throws(() => validateCutoutSlices(fakeCutoutImage, skeleton.atlases.cutoutSheet.slices), /card-background crop|pseudo-transparent card slice/, 'border-transparent full-card cutout slices must fail');
  const fakePoseSceneResidual = injectScenePatch(poseImage, sourceImage, SCENE_SAMPLE_RECTS[2], { x: 120, y: 220, width: 24, height: 24 });
  assert.throws(() => assertNoSceneResidual(fakePoseSceneResidual, sourceImage, 'fake U005 pose sheet'), /scene residual/, 'opaque ground/reflection pixels inside a valid pose must fail');
  const fakeCutoutSceneResidual = injectScenePatch(cutoutImage, sourceImage, SCENE_SAMPLE_RECTS[1], { x: 160, y: 180, width: 24, height: 24 });
  assert.throws(() => assertNoSceneResidual(fakeCutoutSceneResidual, sourceImage, 'fake U005 cutout sheet'), /scene residual/, 'opaque city pixels inside a valid cutout must fail');
  const fakeScaledPoseSceneResidual = injectTransformedScenePatch(poseImage, sourceImage, SCENE_SAMPLE_RECTS[1], { x: 261, y: 221 }, 2, [0.72, 0.86, 1.08, 18]);
  assert.throws(() => assertNoSceneResidual(fakeScaledPoseSceneResidual, sourceImage, 'fake scaled U005 pose sheet'), /scaled or color-transformed .* scene residual/, 'scaled and color-transformed city pixels inside a valid pose must fail');
  const fakeTintedCutoutSceneResidual = injectTransformedScenePatch(cutoutImage, sourceImage, SCENE_SAMPLE_RECTS[2], { x: 181, y: 241 }, 1.5, [1.08, 0.78, 0.64, 12]);
  assert.throws(() => assertNoSceneResidual(fakeTintedCutoutSceneResidual, sourceImage, 'fake tinted U005 cutout sheet'), /scaled or color-transformed .* scene residual/, 'tinted ground pixels inside a valid cutout must fail');
}

function expectFailure(label, mutate, pattern) {
  const candidate = clone(readJson(skeletonPath));
  mutate(candidate);
  assert.throws(() => validateSkeleton(candidate), pattern, label);
}

function expectContractFailure(label, mutate, pattern) {
  const candidate = clone(readJson(contractPath));
  mutate(candidate);
  const skeleton = readJson(skeletonPath);
  assert.throws(() => validateContract(candidate, skeleton), pattern, label);
}

const skeleton = readJson(skeletonPath);
const contract = readJson(contractPath);

assert.deepEqual(readdirSync(unitRoot).sort(), [...EXPECTED_FILES].sort(), 'U005 asset directory should only contain the approved production files');
validateContract(contract, skeleton);
validateSkeleton(skeleton);
validateConfigAndDocs(skeleton, contract);
validatePngAssets(contract, skeleton);

expectFailure('missing Death state', (candidate) => {
  delete candidate.stateMap.Death;
}, /stateMap|Death/);

expectFailure('attackOrigin out of range', (candidate) => {
  candidate.mountPoints.find((mount) => mount.name === 'attackOrigin').x = 999;
}, /attackOrigin/);

expectFailure('reversed player/enemy orientation', (candidate) => {
  candidate.orientations = {
    player: { direction: -1, scaleX: -1 },
    enemy: { direction: 1, scaleX: 1 },
  };
}, /player-right \/ enemy-left mapping/);

expectContractFailure('reversed runtime orientation pair', (candidate) => {
  candidate.runtime.orientationPair = {
    player: { direction: -1, scaleX: -1 },
    enemy: { direction: 1, scaleX: 1 },
  };
}, /orientation pair mismatch|player-right \/ enemy-left mapping/);

expectFailure('pose sheet path escape', (candidate) => {
  candidate.atlases.poseSheet.path = 'cocos-client/assets/resources/art/battle/units/U004/U004-POSE-SHEET.png';
}, /poseSheet path|U005/);

console.log('T282 U005 production PASS: real source art, production contract, pose/cutout PNGs, skeleton runtime, config/doc bindings and negative cases validated');
