import type { RecoveredContent } from './RecoveredContent.ts';
import { numeric } from './RecoveredContent.ts';

export const TERRAIN_SKILL_IDS = [
  50731, 50732, 50733, 50734,
  50741, 50742, 50743, 50744,
  50806, 50807, 50808, 50809,
  50903,
] as const;

export type TerrainSkillId = typeof TERRAIN_SKILL_IDS[number];

export interface TerrainSummonChoice {
  monsterId: number;
  /** Exclusive upper bound for a single 0..100 roll. */
  threshold: number;
}

/** Durable, data-only rule returned to every BattleKernel consumer. */
export interface TerrainRule {
  skillId: TerrainSkillId;
  serverClass: 18 | 19;
  topographyId: number;
  effectId: number;
  placement: 'scatter' | 'ward';
  count: number;
  startCol: number;
  endCol: number;
  remainingTurns: number | null;
  entryDamage: number;
  stayDamage: number;
  damageType: number;
  blocksPositiveStatuses: boolean;
  summonChoices: TerrainSummonChoice[];
}

interface TopographyBinding {
  effectId: number;
  turns: number;
}

// Recovered from main:embeddata/scp/topography.xml. The imported JSON is kept
// as evidence and tested directly; battle state stores only the resolved rule.
const TOPOGRAPHY = new Map<number, TopographyBinding>([
  [50704, { effectId: 40052, turns: 8 }],
  [50705, { effectId: 40053, turns: 8 }],
  [50806, { effectId: 40503, turns: 1 }],
  [50807, { effectId: 40504, turns: 1 }],
  [50808, { effectId: 40056, turns: 0 }],
  [50809, { effectId: 40057, turns: 0 }],
  [50903, { effectId: 40801, turns: 0 }],
]);

const SUPPORTED = new Set<number>(TERRAIN_SKILL_IDS);

export function getTerrainRule(content: RecoveredContent, skillId: number): TerrainRule | undefined {
  if (!SUPPORTED.has(skillId)) return undefined;
  const skill = content.skill(skillId).raw!;
  const topographyId = numeric(skill, 'DamValue', 0);
  const binding = TOPOGRAPHY.get(topographyId);
  if (!binding) throw new Error(`Terrain ${skillId} has no topography binding for ${topographyId}`);
  const effect = content.data.effects[String(binding.effectId)];
  if (!effect) throw new Error(`Terrain ${skillId} is missing effect ${binding.effectId}`);
  const effectType = numeric(effect, 'TypeID', 0);
  const triggerMode = numeric(effect, 'param1', 0);
  const amount = Math.max(0, numeric(effect, 'param2', 0));
  const serverClass = numeric(skill, 'ServerClassID', 0);
  if (serverClass !== 18 && serverClass !== 19) throw new Error(`Terrain ${skillId} has invalid ServerClassID ${serverClass}`);

  const summonChoices: TerrainSummonChoice[] = [];
  if (effectType === 405) {
    for (let index = 1; index <= 7; index += 2) {
      const monsterId = numeric(effect, `param${index}`, 0);
      const threshold = numeric(effect, `param${index + 1}`, 0);
      if (monsterId > 0 && threshold > 0) summonChoices.push({ monsterId, threshold });
    }
  }

  return {
    skillId: skillId as TerrainSkillId,
    serverClass,
    topographyId,
    effectId: binding.effectId,
    placement: skillId === 50903 ? 'ward' : 'scatter',
    count: skillId === 50903 ? 0 : Math.max(1, numeric(skill, 'CureValue', 1)),
    startCol: numeric(skill, 'StartX', 1),
    endCol: numeric(skill, 'EndX', 10),
    remainingTurns: binding.turns > 0 ? binding.turns : null,
    entryDamage: effectType === 400 && triggerMode === 3 ? amount : 0,
    stayDamage: effectType === 400 && (triggerMode === 2 || triggerMode === 3) ? amount : 0,
    damageType: effectType === 400 ? numeric(effect, 'param3', 0) : 0,
    blocksPositiveStatuses: effectType === 408,
    summonChoices,
  };
}
