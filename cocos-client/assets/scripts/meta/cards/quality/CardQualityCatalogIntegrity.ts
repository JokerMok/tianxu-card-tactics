export const EXPECTED_CARD_QUALITY_CARD_COUNT = 44 as const;
export const EXPECTED_CARD_QUALITY_ENTRY_COUNT = 264 as const;

const CARD_QUALITY_PRODUCTION_REGISTRY_DATA = [
  { id: 'U001', nameKey: 'unit.U001.name', copyLimit: 4 },
  { id: 'U002', nameKey: 'unit.U002.name', copyLimit: 4 },
  { id: 'U003', nameKey: 'unit.U003.name', copyLimit: 3 },
  { id: 'U004', nameKey: 'unit.U004.name', copyLimit: 4 },
  { id: 'U005', nameKey: 'unit.U005.name', copyLimit: 3 },
  { id: 'U006', nameKey: 'unit.U006.name', copyLimit: 2 },
  { id: 'U007', nameKey: 'unit.U007.name', copyLimit: 3 },
  { id: 'U008', nameKey: 'unit.U008.name', copyLimit: 1 },
  { id: 'U009', nameKey: 'unit.U009.name', copyLimit: 3 },
  { id: 'U010', nameKey: 'unit.U010.name', copyLimit: 3 },
  { id: 'U011', nameKey: 'unit.U011.name', copyLimit: 2 },
  { id: 'U012', nameKey: 'unit.U012.name', copyLimit: 2 },
  { id: 'U013', nameKey: 'unit.U013.name', copyLimit: 3 },
  { id: 'U014', nameKey: 'unit.U014.name', copyLimit: 2 },
  { id: 'U015', nameKey: 'unit.U015.name', copyLimit: 3 },
  { id: 'U016', nameKey: 'unit.U016.name', copyLimit: 3 },
  { id: 'U017', nameKey: 'unit.U017.name', copyLimit: 2 },
  { id: 'U018', nameKey: 'unit.U018.name', copyLimit: 2 },
  { id: 'U019', nameKey: 'unit.U019.name', copyLimit: 2 },
  { id: 'U020', nameKey: 'unit.U020.name', copyLimit: 1 },
  { id: 'U021', nameKey: 'unit.U021.name', copyLimit: 2 },
  { id: 'U022', nameKey: 'unit.U022.name', copyLimit: 1 },
  { id: 'U023', nameKey: 'unit.U023.name', copyLimit: 3 },
  { id: 'U024', nameKey: 'unit.U024.name', copyLimit: 2 },
  { id: 'U025', nameKey: 'unit.U025.name', copyLimit: 2 },
  { id: 'U026', nameKey: 'unit.U026.name', copyLimit: 1 },
  { id: 'U027', nameKey: 'unit.U027.name', copyLimit: 2 },
  { id: 'U028', nameKey: 'unit.U028.name', copyLimit: 1 },
  { id: 'S001', nameKey: 'skill.S001.name', copyLimit: 1 },
  { id: 'S002', nameKey: 'skill.S002.name', copyLimit: 1 },
  { id: 'S003', nameKey: 'skill.S003.name', copyLimit: 1 },
  { id: 'S004', nameKey: 'skill.S004.name', copyLimit: 1 },
  { id: 'S005', nameKey: 'skill.S005.name', copyLimit: 1 },
  { id: 'S006', nameKey: 'skill.S006.name', copyLimit: 1 },
  { id: 'S007', nameKey: 'skill.S007.name', copyLimit: 1 },
  { id: 'S008', nameKey: 'skill.S008.name', copyLimit: 1 },
  { id: 'S009', nameKey: 'skill.S009.name', copyLimit: 1 },
  { id: 'S010', nameKey: 'skill.S010.name', copyLimit: 1 },
  { id: 'S011', nameKey: 'skill.S011.name', copyLimit: 1 },
  { id: 'S012', nameKey: 'skill.S012.name', copyLimit: 1 },
  { id: 'S013', nameKey: 'skill.S013.name', copyLimit: 1 },
  { id: 'S014', nameKey: 'skill.S014.name', copyLimit: 1 },
  { id: 'S015', nameKey: 'skill.S015.name', copyLimit: 1 },
  { id: 'S016', nameKey: 'skill.S016.name', copyLimit: 1 },
] as const;

export const CARD_QUALITY_PRODUCTION_REGISTRY = Object.freeze(
  CARD_QUALITY_PRODUCTION_REGISTRY_DATA.map((entry) => Object.freeze(entry)),
);

/** FNV-1a digest of the canonical schemaVersion, source authority and 264 production records. */
export const CARD_QUALITY_PRODUCTION_DIGEST = '8d03085b' as const;
