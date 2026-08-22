import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

function parseJsonString(source, indexRef) {
  if (source[indexRef.value] !== '"') throw new SyntaxError(`Expected JSON string at position ${indexRef.value}`);
  indexRef.value += 1;
  let value = '';
  while (indexRef.value < source.length) {
    const character = source[indexRef.value];
    indexRef.value += 1;
    if (character === '"') return value;
    if (character === '\\') {
      if (indexRef.value >= source.length) throw new SyntaxError('Unterminated JSON string');
      const escape = source[indexRef.value];
      indexRef.value += 1;
      const escapes = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
      if (Object.hasOwn(escapes, escape)) {
        value += escapes[escape];
      } else if (escape === 'u') {
        const codePoint = source.slice(indexRef.value, indexRef.value + 4);
        if (!/^[0-9a-f]{4}$/i.test(codePoint)) throw new SyntaxError(`Invalid JSON unicode escape at position ${indexRef.value - 2}`);
        value += String.fromCharCode(Number.parseInt(codePoint, 16));
        indexRef.value += 4;
      } else {
        throw new SyntaxError(`Invalid JSON escape at position ${indexRef.value - 1}`);
      }
    } else {
      if (character < ' ') throw new SyntaxError(`Invalid control character in JSON string at position ${indexRef.value - 1}`);
      value += character;
    }
  }
  throw new SyntaxError('Unterminated JSON string');
}

export function parseJsonWithUniqueKeys(source, sourceName = 'JSON') {
  if (typeof source !== 'string') throw new TypeError(`${sourceName} must be a string`);
  const indexRef = { value: 0 };
  const skipWhitespace = () => {
    while (/\s/.test(source[indexRef.value] ?? '')) indexRef.value += 1;
  };
  const fail = (message) => {
    throw new SyntaxError(`${sourceName}: ${message} at position ${indexRef.value}`);
  };
  const parseValue = () => {
    skipWhitespace();
    const character = source[indexRef.value];
    if (character === '{') return parseObject();
    if (character === '[') return parseArray();
    if (character === '"') return parseJsonString(source, indexRef);
    if (source.startsWith('true', indexRef.value)) {
      indexRef.value += 4;
      return true;
    }
    if (source.startsWith('false', indexRef.value)) {
      indexRef.value += 5;
      return false;
    }
    if (source.startsWith('null', indexRef.value)) {
      indexRef.value += 4;
      return null;
    }
    const number = source.slice(indexRef.value).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u);
    if (number) {
      indexRef.value += number[0].length;
      return Number(number[0]);
    }
    fail(`Unexpected JSON token ${JSON.stringify(character)}`);
  };
  const parseObject = () => {
    indexRef.value += 1;
    const result = {};
    const keys = new Set();
    skipWhitespace();
    if (source[indexRef.value] === '}') {
      indexRef.value += 1;
      return result;
    }
    while (indexRef.value < source.length) {
      skipWhitespace();
      if (source[indexRef.value] !== '"') fail('Object keys must be JSON strings');
      const key = parseJsonString(source, indexRef);
      if (keys.has(key)) fail(`Duplicate JSON object key ${JSON.stringify(key)}`);
      keys.add(key);
      skipWhitespace();
      if (source[indexRef.value] !== ':') fail(`Expected ':' after object key ${JSON.stringify(key)}`);
      indexRef.value += 1;
      const value = parseValue();
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      });
      skipWhitespace();
      if (source[indexRef.value] === '}') {
        indexRef.value += 1;
        return result;
      }
      if (source[indexRef.value] !== ',') fail("Expected ',' or '}' in JSON object");
      indexRef.value += 1;
    }
    fail('Unterminated JSON object');
  };
  const parseArray = () => {
    indexRef.value += 1;
    const result = [];
    skipWhitespace();
    if (source[indexRef.value] === ']') {
      indexRef.value += 1;
      return result;
    }
    while (indexRef.value < source.length) {
      result.push(parseValue());
      skipWhitespace();
      if (source[indexRef.value] === ']') {
        indexRef.value += 1;
        return result;
      }
      if (source[indexRef.value] !== ',') fail("Expected ',' or ']' in JSON array");
      indexRef.value += 1;
    }
    fail('Unterminated JSON array');
  };

  const result = parseValue();
  skipWhitespace();
  if (indexRef.value !== source.length) fail('Unexpected trailing JSON content');
  return result;
}

const matrixPath = fileURLToPath(new URL('./difficulty-matrix.json', import.meta.url));

export function loadDifficultyMatrix(filePath = matrixPath) {
  return parseJsonWithUniqueKeys(fs.readFileSync(filePath, 'utf8'), filePath);
}

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

export const DIFFICULTY_MATRIX = deepFreeze(loadDifficultyMatrix());

export function getDifficultyProfile(mode) {
  return DIFFICULTY_MATRIX.modeProfiles.find((profile) => profile.id === mode);
}

export function getDifficultyEntry(mode, entryId) {
  return getDifficultyProfile(mode)?.entries.find((entry) => entry.id === entryId);
}
