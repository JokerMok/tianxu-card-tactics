import matrix from './difficulty-matrix.json' with { type: 'json' };

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

export const DIFFICULTY_MATRIX = deepFreeze(matrix);

export function getDifficultyProfile(mode) {
  return DIFFICULTY_MATRIX.modeProfiles.find((profile) => profile.id === mode);
}

export function getDifficultyEntry(mode, entryId) {
  return getDifficultyProfile(mode)?.entries.find((entry) => entry.id === entryId);
}
