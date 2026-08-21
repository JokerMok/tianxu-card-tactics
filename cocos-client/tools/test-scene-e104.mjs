import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';

const clientRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(clientRoot, '..');
const sceneRoot = path.join(clientRoot, 'assets/resources/art/battle/scenes/E104');
const contractPath = path.join(sceneRoot, 'scene-contract.json');
const EXPECTED_CANVAS = [1920, 1080];
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EXPECTED_PROVENANCE = {
  referenceManifest: '美术素材/A0/资源清单.json',
  referenceAssetId: 'E104-PARALLAX-BOARD',
  referenceAsset: '美术素材/A0/场景/E104-PARALLAX-BOARD.png',
  runtimeComposite: 'cocos-client/assets/resources/a0/background/E104-PARALLAX-BOARD.png',
  runtimeCompositeSha256: '368ead21d68c2a202cbe76304e9dd7a33aa21cd5d7c1e296fcaf529b94790429',
  runtimeCompositeSize: [1672, 941]
};

// These values are fixed review fixtures, independent of scene-contract.json.
// A JSON-only edit must therefore fail before it can redefine the evidence.
const EXPECTED_LAYERS = [
  {
    id: 'sky',
    order: 0,
    source: 'env_E104_sky_01_v001.png',
    sourceRect: { x: 0, y: 444, width: 1672, height: 58 },
    outputSize: [1672, 58],
    sha256: '949254ab4e4d555bf71d9b26a553f88885a51b23a669ba4599ca47385167e68e',
    parallax: 0.08,
    renderBounds: [0, 0, 1, 0.3],
    occludes: [],
    occludedBy: ['far', 'mid', 'road', 'foreground'],
    unitOcclusion: 'background',
    pixelEvidence: {
      decodedRgbaSha256: 'ee5d6e11541ff51b1bbeb3e4874c3c8d5126b50d6c7aff11bc63bdd92e3fc921',
      alphaCoverage: 1,
      visibleBounds: [0, 0, 1671, 57]
    }
  },
  {
    id: 'far',
    order: 1,
    source: 'env_E104_far_02_v001.png',
    sourceRect: { x: 0, y: 506, width: 1672, height: 76 },
    outputSize: [1672, 76],
    sha256: 'e4a355fff725771890e22f7ec76f30700a6cf0b23c5a4fb38b6dc6c57e865d41',
    parallax: 0.18,
    renderBounds: [0, 0.14, 1, 0.27],
    occludes: ['sky'],
    occludedBy: ['mid', 'road', 'foreground'],
    unitOcclusion: 'background',
    pixelEvidence: {
      decodedRgbaSha256: '202ee632a5104e4384b28e144e64c23fe09225eceabfdc85dc27ad04f8dcb680',
      alphaCoverage: 0.968231,
      visibleBounds: [4, 2, 1666, 75]
    }
  },
  {
    id: 'mid',
    order: 2,
    source: 'env_E104_mid_03_v001.png',
    sourceRect: { x: 0, y: 584, width: 1672, height: 76 },
    outputSize: [1672, 76],
    sha256: '786a345d42c2c06529a926e77f7ea0d9b1480da7c3131ca62707c72d9cd58611',
    parallax: 0.32,
    renderBounds: [0, 0.34, 1, 0.18],
    occludes: ['sky', 'far'],
    occludedBy: ['road', 'foreground'],
    unitOcclusion: 'background',
    pixelEvidence: {
      decodedRgbaSha256: '056cfedebece31f09f0b51eb21b4d600dd9f37dc25514fc33b7797bb23c947a4',
      alphaCoverage: 0.954097,
      visibleBounds: [4, 1, 1666, 74]
    }
  },
  {
    id: 'road',
    order: 3,
    source: 'env_E104_road_04_v001.png',
    sourceRect: { x: 0, y: 662, width: 1672, height: 116 },
    outputSize: [1672, 116],
    sha256: '985fc932aae53372ed0f02193407aa3dc25214b3b18a4c7a766a553704d5be15',
    parallax: 0.58,
    renderBounds: [0, 0.48, 1, 0.28],
    occludes: ['sky', 'far', 'mid'],
    occludedBy: ['foreground'],
    unitOcclusion: 'behind-units',
    sourceSlices: [
      { id: 'upper', y: 0, height: 53 },
      { id: 'lower', y: 61, height: 55 }
    ],
    pixelEvidence: {
      decodedRgbaSha256: 'bcd2632ba29ec053c75c438640e59235f20470bbfff8b21fe92c29bbae2356bf',
      alphaCoverage: 0.946301,
      visibleBounds: [4, 0, 1666, 115]
    }
  },
  {
    id: 'foreground',
    order: 4,
    source: 'env_E104_foreground_05_v001.png',
    sourceRect: { x: 0, y: 778, width: 1672, height: 72 },
    outputSize: [1672, 72],
    sha256: '589dc9125698009a22531f127f2d8588f84cc96b5746bfdfe0e1b4b3c590c929',
    parallax: 0.82,
    renderBounds: [0, 0.7, 1, 0.18],
    occludes: ['sky', 'far', 'mid', 'road'],
    occludedBy: [],
    unitOcclusion: 'front-occluder',
    pixelEvidence: {
      decodedRgbaSha256: '3421a4962df915a43d99c03970da4c9911cfca8f2ff4733b99cbcf0be0365f93',
      alphaCoverage: 0.980346,
      visibleBounds: [4, 0, 1666, 71]
    }
  },
  {
    id: 'dynamic',
    order: 5,
    source: 'env_E104_dynamic_06_v001.png',
    sourceRect: { x: 0, y: 854, width: 1672, height: 87 },
    outputSize: [1672, 87],
    sha256: '4cd3288ab71e9034f148a98490df2ebac35972df3001736e8d0d18fea0999e0c',
    parallax: 1,
    renderBounds: [0, 0, 1, 1],
    occludes: [],
    occludedBy: [],
    unitOcclusion: 'overlay-no-silhouette-loss',
    pixelEvidence: {
      decodedRgbaSha256: '26fdd47ff18622de26836ace55b440a7a4116c3d89d2fd05d14455dc1b918054',
      alphaCoverage: 0.935434,
      visibleBounds: [4, 0, 1666, 82]
    }
  }
];

const EXPECTED_ROAD = {
  layerId: 'road',
  laneCount: 2,
  columnsPerLane: 12,
  sharedColumnGrid: true,
  bounds: [0.08, 0.47, 0.84, 0.29],
  lanes: [
    { id: 'upper', bounds: [0.08, 0.47, 0.84, 0.13] },
    { id: 'lower', bounds: [0.08, 0.63, 0.84, 0.13] }
  ],
  minimumLaneHeightRatio: 0.11,
  maximumLaneHeightRatio: 0.17,
  maximumColumnWidthDeltaPx: 1
};

const EXPECTED_UNIT_EVIDENCE = {
  method: 'fixed-design-targets-bound-to-approved-unit-reference-pngs; scene geometry and reference hashes are verified independently',
  unitAssets: [
    {
      unitId: 'U002',
      path: 'cocos-client/assets/resources/a0/units/U002-ANIMATION-POSES.png',
      size: [1983, 793],
      sha256: '9507ca351922a5fe6302cbcdaeab4c9711869e40ec1950afd4959caa14f7f81f'
    },
    {
      unitId: 'U008',
      path: 'cocos-client/assets/resources/a0/units/U008-ANIMATION-POSES.png',
      size: [1983, 793],
      sha256: 'f83fd4b3c4b2f27eb43cdf88cd94f4d7590e3f2c6155976c83ec1f9836fa1da6'
    }
  ]
};

const EXPECTED_READABILITY = {
  coordinateSpace: '1920x1080-design-resolution',
  minimumSilhouetteHeightPx: 120,
  minimumSilhouetteWidthPx: 48,
  minimumRoadClearancePx: 16,
  maximumForegroundOccludedFraction: 0.2,
  minimumSilhouetteContrastRatio: 1.35,
  anchors: [
    {
      unitId: 'U002',
      lane: 'upper',
      silhouetteHeightPx: 168,
      silhouetteWidthPx: 72,
      roadClearancePx: 24,
      foregroundOccludedFraction: 0.08,
      silhouetteContrastRatio: 1.55
    },
    {
      unitId: 'U008',
      lane: 'lower',
      silhouetteHeightPx: 156,
      silhouetteWidthPx: 118,
      roadClearancePx: 22,
      foregroundOccludedFraction: 0.12,
      silhouetteContrastRatio: 1.48
    }
  ]
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function paeth(a, b, c) {
  const estimate = a + b - c;
  const distanceA = Math.abs(estimate - a);
  const distanceB = Math.abs(estimate - b);
  const distanceC = Math.abs(estimate - c);
  if (distanceA <= distanceB && distanceA <= distanceC) return a;
  if (distanceB <= distanceC) return b;
  return c;
}

function decodePng(filePath) {
  const bytes = fs.readFileSync(filePath);
  assert(bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE), `not a PNG: ${filePath}`);

  let offset = PNG_SIGNATURE.length;
  let ihdr;
  const idat = [];
  let iendCount = 0;
  while (offset < bytes.length) {
    assert(offset + 12 <= bytes.length, `truncated PNG chunk: ${filePath}`);
    const length = bytes.readUInt32BE(offset);
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcOffset = dataEnd;
    assert(crcOffset + 4 <= bytes.length, `truncated PNG data: ${filePath}`);
    const data = bytes.subarray(dataStart, dataEnd);
    const actualCrc = bytes.readUInt32BE(crcOffset);
    assert.equal(actualCrc, crc32(Buffer.concat([typeBytes, data])), `PNG CRC mismatch: ${filePath} ${type}`);
    offset = crcOffset + 4;

    if (type === 'IHDR') {
      assert.equal(ihdr, undefined, `duplicate PNG IHDR: ${filePath}`);
      assert.equal(data.length, 13, `invalid PNG IHDR: ${filePath}`);
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12]
      };
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      assert.equal(data.length, 0, `invalid PNG IEND: ${filePath}`);
      iendCount += 1;
      break;
    }
  }

  assert.equal(offset, bytes.length, `trailing bytes after PNG IEND: ${filePath}`);
  assert(ihdr, `missing PNG IHDR: ${filePath}`);
  assert.equal(iendCount, 1, `missing PNG IEND: ${filePath}`);
  assert.equal(ihdr.bitDepth, 8, `PNG must be 8-bit: ${filePath}`);
  assert([2, 6].includes(ihdr.colorType), `PNG must be RGB or RGBA: ${filePath}`);
  assert.equal(ihdr.compression, 0, `unsupported PNG compression: ${filePath}`);
  assert.equal(ihdr.filter, 0, `unsupported PNG filter method: ${filePath}`);
  assert.equal(ihdr.interlace, 0, `interlaced PNG is not accepted: ${filePath}`);

  const channels = ihdr.colorType === 6 ? 4 : 3;
  const rowBytes = ihdr.width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  assert.equal(raw.length, (rowBytes + 1) * ihdr.height, `decoded PNG row data mismatch: ${filePath}`);
  const unfiltered = Buffer.alloc(ihdr.width * ihdr.height * channels);
  let rawOffset = 0;
  let previous = Buffer.alloc(rowBytes);
  for (let y = 0; y < ihdr.height; y += 1) {
    const filterType = raw[rawOffset];
    rawOffset += 1;
    assert(filterType <= 4, `unsupported PNG row filter ${filterType}: ${filePath}`);
    const row = Buffer.alloc(rowBytes);
    for (let x = 0; x < rowBytes; x += 1) {
      const left = x >= channels ? row[x - channels] : 0;
      const above = previous[x];
      const upperLeft = x >= channels ? previous[x - channels] : 0;
      const predictor = filterType === 0
        ? 0
        : filterType === 1
          ? left
          : filterType === 2
            ? above
            : filterType === 3
              ? Math.floor((left + above) / 2)
              : paeth(left, above, upperLeft);
      row[x] = (raw[rawOffset] + predictor) & 0xff;
      rawOffset += 1;
    }
    row.copy(unfiltered, y * rowBytes);
    previous = row;
  }

  const rgba = Buffer.alloc(ihdr.width * ihdr.height * 4);
  for (let pixel = 0; pixel < ihdr.width * ihdr.height; pixel += 1) {
    const source = pixel * channels;
    const target = pixel * 4;
    rgba[target] = unfiltered[source];
    rgba[target + 1] = unfiltered[source + 1];
    rgba[target + 2] = unfiltered[source + 2];
    rgba[target + 3] = channels === 4 ? unfiltered[source + 3] : 255;
  }
  return { bytes, width: ihdr.width, height: ihdr.height, colorType: ihdr.colorType, rgba };
}

function pixelStats(image) {
  let visiblePixels = 0;
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  const alphaValues = new Set();
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const alpha = image.rgba[(y * image.width + x) * 4 + 3];
      alphaValues.add(alpha);
      if (alpha === 0) continue;
      visiblePixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return {
    decodedRgbaSha256: sha256(image.rgba),
    alphaCoverage: Number((visiblePixels / (image.width * image.height)).toFixed(6)),
    visibleBounds: [minX, minY, maxX, maxY],
    alphaValueCount: alphaValues.size
  };
}

function rgbCropMatch(layer, board, sourceRect) {
  let matches = 0;
  const total = sourceRect.width * sourceRect.height;
  for (let y = 0; y < sourceRect.height; y += 1) {
    for (let x = 0; x < sourceRect.width; x += 1) {
      const layerOffset = (y * layer.width + x) * 4;
      const boardOffset = ((sourceRect.y + y) * board.width + sourceRect.x + x) * 4;
      if (
        layer.rgba[layerOffset] === board.rgba[boardOffset]
        && layer.rgba[layerOffset + 1] === board.rgba[boardOffset + 1]
        && layer.rgba[layerOffset + 2] === board.rgba[boardOffset + 2]
      ) {
        matches += 1;
      }
    }
  }
  return { matches, total, ratio: matches / total };
}

function alphaCoverageInRect(image, rect) {
  let visible = 0;
  const total = rect.width * rect.height;
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      if (image.rgba[(y * image.width + x) * 4 + 3] > 0) visible += 1;
    }
  }
  return visible / total;
}

function validateProvenance(contract, referenceManifestOverride = null) {
  assert.equal(contract.provenance.referenceManifest, EXPECTED_PROVENANCE.referenceManifest, 'approved provenance manifest path drift');
  assert.equal(contract.provenance.referenceAssetId, EXPECTED_PROVENANCE.referenceAssetId, 'approved reference asset id drift');
  assert.equal(contract.provenance.referenceAsset, EXPECTED_PROVENANCE.referenceAsset, 'approved reference asset path drift');
  assert.equal(contract.provenance.runtimeComposite, EXPECTED_PROVENANCE.runtimeComposite, 'runtime composite path drift');
  assert.equal(contract.provenance.runtimeCompositeSha256, EXPECTED_PROVENANCE.runtimeCompositeSha256, 'runtime composite hash fixture drift');
  assert.deepEqual(contract.provenance.runtimeCompositeSize, EXPECTED_PROVENANCE.runtimeCompositeSize, 'runtime composite size fixture drift');
  const referenceManifestPath = path.join(repoRoot, contract.provenance.referenceManifest);
  const referenceManifest = referenceManifestOverride ?? readJson(referenceManifestPath);
  const referenceAsset = referenceManifest.assets.find((asset) => asset.id === contract.provenance.referenceAssetId);
  assert(referenceAsset, `missing reference asset: ${contract.provenance.referenceAssetId}`);
  assert.equal(referenceAsset.path, contract.provenance.referenceAsset, 'manifest reference asset path mismatch');
  assert.deepEqual(referenceAsset.size, contract.provenance.runtimeCompositeSize);
  assert.equal(referenceAsset.sha256, contract.provenance.runtimeCompositeSha256);

  const runtimeCompositePath = path.join(repoRoot, contract.provenance.runtimeComposite);
  const referenceBoardPath = path.join(repoRoot, contract.provenance.referenceAsset);
  assert.equal(sha256(fs.readFileSync(runtimeCompositePath)), contract.provenance.runtimeCompositeSha256);
  assert.equal(sha256(fs.readFileSync(referenceBoardPath)), contract.provenance.runtimeCompositeSha256);
  const runtimeComposite = decodePng(runtimeCompositePath);
  const referenceBoard = decodePng(referenceBoardPath);
  assert.equal(runtimeComposite.colorType, 2, 'runtime composite must be RGB reference PNG');
  assert.equal(referenceBoard.colorType, 2, 'approved board must be RGB reference PNG');
  assert.deepEqual([runtimeComposite.width, runtimeComposite.height], contract.provenance.runtimeCompositeSize);
  assert.deepEqual([referenceBoard.width, referenceBoard.height], contract.provenance.runtimeCompositeSize);
  assert(runtimeComposite.rgba.equals(referenceBoard.rgba), 'runtime composite pixels differ from approved board pixels');
  assert.match(contract.provenance.derivation, /Six independent RGBA layer sources/);
  assert.match(contract.provenance.derivation, /never counted as a scene layer/);
  return referenceBoard;
}

function validateLayers(contract, board) {
  assert.equal(contract.layers.length, EXPECTED_LAYERS.length, 'scene must contain exactly six layers');
  assert.deepEqual(contract.layers.map((layer) => layer.id), EXPECTED_LAYERS.map((layer) => layer.id));
  assert.equal(new Set(contract.layers.map((layer) => layer.source)).size, 6, 'layer sources must be independent');
  assert.equal(new Set(contract.layers.map((layer) => layer.sha256)).size, 6, 'layer hashes must be independent');
  assert.equal(new Set(contract.layers.map((layer) => layer.pixelEvidence?.decodedRgbaSha256)).size, 6, 'decoded pixel hashes must be independent');

  const decodedLayers = new Map();
  for (const expected of EXPECTED_LAYERS) {
    const layer = contract.layers.find((candidate) => candidate.id === expected.id);
    assert(layer, `missing layer: ${expected.id}`);
    assert.equal(layer.order, expected.order, `layer order mismatch: ${expected.id}`);
    assert.equal(layer.source, expected.source, `layer source mismatch: ${expected.id}`);
    assert.deepEqual(layer.sourceRect, expected.sourceRect, `layer sourceRect mismatch: ${expected.id}`);
    assert.deepEqual(layer.outputSize, expected.outputSize, `layer outputSize mismatch: ${expected.id}`);
    assert.equal(layer.sha256, expected.sha256, `layer file hash fixture mismatch: ${expected.id}`);
    assert.equal(layer.parallax, expected.parallax, `layer parallax mismatch: ${expected.id}`);
    assert.deepEqual(layer.renderBounds, expected.renderBounds, `layer render bounds mismatch: ${expected.id}`);
    assert.deepEqual(layer.occludes, expected.occludes, `layer occlusion list mismatch: ${expected.id}`);
    assert.deepEqual(layer.occludedBy, expected.occludedBy, `layer reverse occlusion list mismatch: ${expected.id}`);
    assert.equal(layer.unitOcclusion, expected.unitOcclusion, `layer unit occlusion mode mismatch: ${expected.id}`);
    assert.deepEqual(layer.pixelEvidence, expected.pixelEvidence, `layer pixel evidence contract mismatch: ${expected.id}`);
    assert.equal(layer.source, path.basename(layer.source), `layer source must stay inside E104: ${expected.id}`);
    assert(!layer.source.includes('E104-PARALLAX-BOARD'), 'the composite board cannot be a layer source');

    const sourcePath = path.join(sceneRoot, layer.source);
    const sourceStat = fs.lstatSync(sourcePath);
    assert(sourceStat.isFile(), `layer source must be a regular file: ${expected.id}`);
    const image = decodePng(sourcePath);
    assert.equal(image.colorType, 6, `layer must be RGBA: ${expected.id}`);
    assert.deepEqual([image.width, image.height], layer.outputSize, `wrong PNG dimensions: ${expected.id}`);
    assert.equal(sha256(image.bytes), layer.sha256, `layer file hash drift: ${expected.id}`);
    const stats = pixelStats(image);
    assert.equal(stats.decodedRgbaSha256, layer.pixelEvidence.decodedRgbaSha256, `decoded pixel hash drift: ${expected.id}`);
    assert.equal(stats.alphaCoverage, layer.pixelEvidence.alphaCoverage, `alpha coverage drift: ${expected.id}`);
    assert.deepEqual(stats.visibleBounds, layer.pixelEvidence.visibleBounds, `visible pixel bounds drift: ${expected.id}`);
    assert(stats.alphaValueCount >= (expected.id === 'sky' ? 1 : 3), `layer alpha channel is not real: ${expected.id}`);
    const crop = rgbCropMatch(image, board, layer.sourceRect);
    assert.equal(crop.matches, crop.total, `layer RGB pixels are not an exact crop of approved board: ${expected.id}`);
    decodedLayers.set(expected.id, image);
  }

  for (let index = 1; index < contract.layers.length; index += 1) {
    assert(contract.layers[index].parallax > contract.layers[index - 1].parallax, 'parallax must increase with layer order');
  }

  const byId = new Map(contract.layers.map((layer) => [layer.id, layer]));
  for (const layer of contract.layers) {
    for (const occludedId of layer.occludes) {
      const occluded = byId.get(occludedId);
      assert(occluded, `${layer.id} references missing occluded layer: ${occludedId}`);
      assert(occluded.order < layer.order, `${layer.id} may only occlude a lower layer`);
      assert.notEqual(layer.id, 'dynamic', 'dynamic particles must not be opaque occluders');
    }
    for (const occluderId of layer.occludedBy) {
      const occluder = byId.get(occluderId);
      assert(occluder, `${layer.id} references missing occluder: ${occluderId}`);
      assert(occluder.occludes.includes(layer.id), `occlusion graph is not reciprocal: ${occluderId} -> ${layer.id}`);
    }
  }
  assert.equal(byId.get('road').unitOcclusion, 'behind-units');
  assert.equal(byId.get('foreground').unitOcclusion, 'front-occluder');
  assert.equal(byId.get('dynamic').unitOcclusion, 'overlay-no-silhouette-loss');
  return decodedLayers;
}

function validateRoad(contract, decodedLayers) {
  const road = contract.roadContract;
  assert.deepEqual(road, EXPECTED_ROAD, 'road geometry contract drift');
  const [upperLane, lowerLane] = road.lanes;
  assert.equal(upperLane.bounds[0], lowerLane.bounds[0], 'lanes must share the same x origin');
  assert.equal(upperLane.bounds[2], lowerLane.bounds[2], 'lanes must share the same width');
  assert.equal(upperLane.bounds[3], lowerLane.bounds[3], 'lanes must share the same height');
  assert(upperLane.bounds[3] >= road.minimumLaneHeightRatio);
  assert(upperLane.bounds[3] <= road.maximumLaneHeightRatio);
  assert(lowerLane.bounds[1] > upperLane.bounds[1] + upperLane.bounds[3], 'lanes must not overlap');
  assert(road.bounds[0] <= upperLane.bounds[0]);
  assert(road.bounds[1] <= upperLane.bounds[1]);
  assert(road.bounds[0] + road.bounds[2] >= upperLane.bounds[0] + upperLane.bounds[2]);
  assert(road.bounds[1] + road.bounds[3] >= lowerLane.bounds[1] + lowerLane.bounds[3]);

  const expectedColumnWidth = road.bounds[2] * EXPECTED_CANVAS[0] / road.columnsPerLane;
  assert.equal(expectedColumnWidth, 134.4, 'road column scale drift');
  assert(road.maximumColumnWidthDeltaPx >= 0 && road.maximumColumnWidthDeltaPx <= 1);

  const roadLayer = EXPECTED_LAYERS.find((layer) => layer.id === 'road');
  assert.deepEqual(roadLayer.sourceSlices, [
    { id: 'upper', y: 0, height: 53 },
    { id: 'lower', y: 61, height: 55 }
  ]);
  const roadImage = decodedLayers.get('road');
  for (const slice of roadLayer.sourceSlices) {
    const coverage = alphaCoverageInRect(roadImage, { x: 0, y: slice.y, width: roadImage.width, height: slice.height });
    assert(coverage > 0.9, `road ${slice.id} pixels are not visibly populated`);
  }
  assert(roadLayer.sourceSlices[0].y + roadLayer.sourceSlices[0].height <= roadLayer.sourceSlices[1].y);
  assert.equal(roadLayer.sourceSlices[1].y + roadLayer.sourceSlices[1].height, roadLayer.outputSize[1]);
}

function validateUnitReadability(contract) {
  const readability = contract.unitReadability;
  assert.equal(readability.coordinateSpace, EXPECTED_READABILITY.coordinateSpace);
  assert.deepEqual(readability.evidence, EXPECTED_UNIT_EVIDENCE, 'unit readability evidence contract drift');
  assert.equal(readability.minimumSilhouetteHeightPx, EXPECTED_READABILITY.minimumSilhouetteHeightPx);
  assert.equal(readability.minimumSilhouetteWidthPx, EXPECTED_READABILITY.minimumSilhouetteWidthPx);
  assert.equal(readability.minimumRoadClearancePx, EXPECTED_READABILITY.minimumRoadClearancePx);
  assert.equal(readability.maximumForegroundOccludedFraction, EXPECTED_READABILITY.maximumForegroundOccludedFraction);
  assert.equal(readability.minimumSilhouetteContrastRatio, EXPECTED_READABILITY.minimumSilhouetteContrastRatio);
  assert.deepEqual(readability.anchors, EXPECTED_READABILITY.anchors, 'unit readability anchor contract drift');

  for (const expectedAsset of EXPECTED_UNIT_EVIDENCE.unitAssets) {
    const assetPath = path.join(repoRoot, expectedAsset.path);
    const image = decodePng(assetPath);
    assert.equal(image.colorType, 2, `unit reference must be RGB PNG: ${expectedAsset.unitId}`);
    assert.deepEqual([image.width, image.height], expectedAsset.size, `unit reference dimensions drift: ${expectedAsset.unitId}`);
    assert.equal(sha256(image.bytes), expectedAsset.sha256, `unit reference hash drift: ${expectedAsset.unitId}`);
  }

  const laneIds = new Set(EXPECTED_ROAD.lanes.map((lane) => lane.id));
  for (const anchor of readability.anchors) {
    assert(laneIds.has(anchor.lane), `${anchor.unitId} references a missing road lane`);
    assert(anchor.silhouetteHeightPx >= readability.minimumSilhouetteHeightPx, `${anchor.unitId} is too short`);
    assert(anchor.silhouetteWidthPx >= readability.minimumSilhouetteWidthPx, `${anchor.unitId} is too narrow`);
    assert(anchor.roadClearancePx >= readability.minimumRoadClearancePx, `${anchor.unitId} lacks road clearance`);
    assert(anchor.foregroundOccludedFraction > 0, `${anchor.unitId} has no foreground occlusion evidence`);
    assert(anchor.foregroundOccludedFraction <= readability.maximumForegroundOccludedFraction, `${anchor.unitId} is over-occluded`);
    assert(anchor.silhouetteContrastRatio >= readability.minimumSilhouetteContrastRatio, `${anchor.unitId} contrast is too low`);
  }

  const upper = EXPECTED_ROAD.lanes[0].bounds;
  const lower = EXPECTED_ROAD.lanes[1].bounds;
  const laneGapPx = (lower[1] - upper[1] - upper[3]) * EXPECTED_CANVAS[1];
  assert(laneGapPx >= Math.max(...readability.anchors.map((anchor) => anchor.roadClearancePx)), 'road gap cannot hold the readability clearances');
  const foregroundTopPx = EXPECTED_LAYERS.find((layer) => layer.id === 'foreground').renderBounds[1] * EXPECTED_CANVAS[1];
  assert(foregroundTopPx > lower[1] * EXPECTED_CANVAS[1]);
  assert(foregroundTopPx < (lower[1] + lower[3]) * EXPECTED_CANVAS[1]);
}

function validateContract(contract) {
  assert.equal(contract.contractVersion, 'E104-scene-v1');
  assert.equal(contract.sceneId, 'E104');
  assert.equal(contract.stage, 'formal-runtime-scene');
  assert.deepEqual(contract.canvas.designResolution, EXPECTED_CANVAS);
  assert.deepEqual(contract.canvas.supportedAspectRatios, [[16, 9], [21, 9]]);
  assert.match(contract.canvas.parallaxConvention, /cameraShiftMultiplier/);
  const board = validateProvenance(contract);
  const decodedLayers = validateLayers(contract, board);
  validateRoad(contract, decodedLayers);
  validateUnitReadability(contract);
}

const contract = readJson(contractPath);
validateContract(contract);

const manifestPathDriftCase = structuredClone(contract);
const driftedManifest = readJson(path.join(repoRoot, contract.provenance.referenceManifest));
const driftedReferenceAsset = driftedManifest.assets.find((asset) => asset.id === contract.provenance.referenceAssetId);
driftedReferenceAsset.path = contract.provenance.runtimeComposite;
assert.throws(() => validateProvenance(manifestPathDriftCase, driftedManifest), /manifest reference asset path mismatch/);

const provenanceShortcutCase = structuredClone(contract);
provenanceShortcutCase.provenance.referenceAsset = provenanceShortcutCase.provenance.runtimeComposite;
assert.throws(() => validateContract(provenanceShortcutCase), /approved reference asset path/);

const missingLayerCase = structuredClone(contract);
missingLayerCase.layers.pop();
assert.throws(() => validateContract(missingLayerCase), /exactly six layers/);

const compositeShortcutCase = structuredClone(contract);
compositeShortcutCase.layers[0].source = 'E104-PARALLAX-BOARD.png';
assert.throws(() => validateContract(compositeShortcutCase), /layer source mismatch/);

const pixelHashDriftCase = structuredClone(contract);
pixelHashDriftCase.layers[0].sha256 = '0'.repeat(64);
assert.throws(() => validateContract(pixelHashDriftCase), /layer file hash fixture mismatch/);

const decodedPixelDriftCase = structuredClone(contract);
decodedPixelDriftCase.layers[0].pixelEvidence.decodedRgbaSha256 = '0'.repeat(64);
assert.throws(() => validateContract(decodedPixelDriftCase), /pixel evidence contract mismatch/);

const sourceRectShortcutCase = structuredClone(contract);
sourceRectShortcutCase.layers[0].sourceRect.y = 0;
assert.throws(() => validateContract(sourceRectShortcutCase), /sourceRect mismatch/);

const occlusionShortcutCase = structuredClone(contract);
occlusionShortcutCase.layers[4].occludes = ['sky', 'far', 'mid'];
assert.throws(() => validateContract(occlusionShortcutCase), /occlusion list mismatch/);

const roadRatioCase = structuredClone(contract);
roadRatioCase.roadContract.lanes[0].bounds[2] = 0.83;
assert.throws(() => validateContract(roadRatioCase), /road geometry contract drift/);

const readabilityCase = structuredClone(contract);
readabilityCase.unitReadability.anchors[0].silhouetteHeightPx = 119;
assert.throws(() => validateContract(readabilityCase), /unit readability anchor contract drift/);

const unitReferenceDriftCase = structuredClone(contract);
unitReferenceDriftCase.unitReadability.evidence.unitAssets[1].sha256 = '0'.repeat(64);
assert.throws(() => validateContract(unitReferenceDriftCase), /unit readability evidence contract drift/);

console.log('E104 six-layer scene contract: PASS');
console.log('evidence=PNG-CRC+IDAT-pixels+crop-match+file-hash+decoded-pixel-hash');
console.log('layers=6 independent=6 parallax=0.08>0.18>0.32>0.58>0.82>1.00 occlusion=reciprocal road=2x12 readability=U002,U008');
console.log('negative-cases=missing-layer,composite-shortcut,hash-drift,pixel-drift,source-rect,occlusion,road-ratio,readability,unit-reference');
