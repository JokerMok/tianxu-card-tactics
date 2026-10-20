export type PageId = 'home' | 'campaign' | 'cards' | 'deck' | 'hero' | 'adventure' | 'city' | 'tasks' | 'inventory';

export interface OwnedCard {
  id: string;
  name: string;
  kind: 'unit' | 'skill';
  faction: string;
  cost: number;
  level: number;
  copies: number;
  power: number;
}

export interface Reward {
  silver?: number;
  crystal?: number;
  xp?: number;
  stamina?: number;
  cardId?: string;
  cardCopies?: number;
  material?: string;
  materialCount?: number;
}

export interface GameState {
  version: 1;
  player: { name: string; level: number; xp: number; power: number; profession: string };
  resources: { silver: number; crystal: number; stamina: number; staminaMax: number; towerTicket: number };
  cards: OwnedCard[];
  deck: string[];
  equipment: Record<'weapon' | 'helmet' | 'armor' | 'cloak', { name: string; level: number }>;
  campaign: { unlocked: number; stars: Record<string, number>; selectedStage: number };
  tower: { floor: number; best: number };
  buildings: Record<'castle' | 'alchemy' | 'forge' | 'harbor', number>;
  inventory: Record<string, number>;
  tasks: Record<string, { progress: number; target: number; claimed: boolean }>;
  expedition: { active: boolean; endsAt: number; reward: number };
  transactions: string[];
}

const STORAGE_KEY = 'tianxu.pve.save.v1';

const cardSeed: OwnedCard[] = [
  ['U002', '折锋枪兵', 'unit', '人间诸国', 3, 1, 3, 116],
  ['U004', '岚羽游射手', 'unit', '仙门遗派', 2, 1, 3, 108],
  ['U001', '铸壁守望者', 'unit', '人间诸国', 3, 1, 2, 124],
  ['U008', '霆脊巨兽', 'unit', '山海遗族', 6, 1, 2, 178],
  ['U003', '玄甲骑卫', 'unit', '失位神将', 4, 1, 2, 146],
  ['U006', '灵符方士', 'unit', '仙门遗派', 4, 1, 1, 151],
  ['U009', '山海药师', 'unit', '山海遗族', 3, 1, 2, 131],
  ['U013', '空册侍从', 'unit', '无名者', 2, 1, 2, 102],
  ['S001', '烈纹天罚', 'skill', '将印', 3, 1, 1, 138],
  ['S002', '凝霎', 'skill', '方术', 2, 1, 1, 122],
  ['S003', '守土成城', 'skill', '军略', 4, 1, 1, 142],
  ['S004', '归魂引', 'skill', '神道', 5, 1, 1, 162],
].map(([id, name, kind, faction, cost, level, copies, power]) => ({
  id: id as string,
  name: name as string,
  kind: kind as 'unit' | 'skill',
  faction: faction as string,
  cost: cost as number,
  level: level as number,
  copies: copies as number,
  power: power as number,
}));

export function createDefaultState(): GameState {
  return {
    version: 1,
    player: { name: '岳沉戈', level: 8, xp: 320, power: 1680, profession: '镇军' },
    resources: { silver: 12800, crystal: 460, stamina: 82, staminaMax: 100, towerTicket: 3 },
    cards: cardSeed.map((card) => ({ ...card })),
    deck: ['U002', 'U004', 'U001', 'U008', 'U003', 'U006', 'U009', 'U013', 'S001', 'S002'],
    equipment: {
      weapon: { name: '玄铁断刃', level: 5 },
      helmet: { name: '边军兜鍪', level: 3 },
      armor: { name: '赤纹战衣', level: 4 },
      cloak: { name: '无字披风', level: 2 },
    },
    campaign: { unlocked: 4, stars: { '1': 3, '2': 3, '3': 2 }, selectedStage: 4 },
    tower: { floor: 7, best: 6 },
    buildings: { castle: 3, alchemy: 2, forge: 2, harbor: 1 },
    inventory: { '强化石': 36, '山海鳞片': 14, '法印残片': 8, '远征券': 5 },
    tasks: {
      stage: { progress: 3, target: 4, claimed: false },
      upgrade: { progress: 0, target: 1, claimed: false },
      tower: { progress: 6, target: 10, claimed: false },
    },
    expedition: { active: false, endsAt: 0, reward: 0 },
    transactions: [],
  };
}

export function loadGame(): GameState {
  const current=localStorage.getItem('tianxu.pve.save.v2');
  if(current!==null){
    const envelope=JSON.parse(current);
    if(envelope.version!==2||envelope.game?.version!==1)throw new Error('存档版本不兼容，原记录已保留');
    return envelope.game;
  }
  const raw=localStorage.getItem(STORAGE_KEY);
  if(raw===null)return createDefaultState();
  const saved=JSON.parse(raw) as GameState;
  if(saved.version!==1||!saved.player||!saved.resources||!Array.isArray(saved.cards))throw new Error('存档损坏，原记录已保留');
  return saved;
}

export function saveGame(state: GameState): void {
  const raw=localStorage.getItem('tianxu.pve.save.v2');
  if(raw!==null){
    const envelope=JSON.parse(raw);
    if(envelope.version!==2)throw new Error('存档版本不兼容');
    if(envelope.campaign?.phase==='active')throw new Error('战斗进行中，请先完成或退出');
    localStorage.setItem('tianxu.pve.save.v2',JSON.stringify({...envelope,game:state}));
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function grantReward(state: GameState, reward: Reward, transactionId: string): boolean {
  if (state.transactions.includes(transactionId)) return false;
  state.transactions.push(transactionId);
  if (state.transactions.length > 200) state.transactions.splice(0, state.transactions.length - 200);
  state.resources.silver += reward.silver ?? 0;
  state.resources.crystal += reward.crystal ?? 0;
  state.resources.stamina = Math.min(state.resources.staminaMax, state.resources.stamina + (reward.stamina ?? 0));
  state.player.xp += reward.xp ?? 0;
  while (state.player.xp >= state.player.level * 100) {
    state.player.xp -= state.player.level * 100;
    state.player.level += 1;
    state.resources.stamina = state.resources.staminaMax;
  }
  if (reward.cardId) {
    const card = state.cards.find((entry) => entry.id === reward.cardId);
    if (card) card.copies += reward.cardCopies ?? 1;
  }
  if (reward.material) state.inventory[reward.material] = (state.inventory[reward.material] ?? 0) + (reward.materialCount ?? 1);
  saveGame(state);
  return true;
}

export function completeStage(state: GameState, stage: number): Reward {
  const firstClear = !state.campaign.stars[String(stage)];
  state.campaign.stars[String(stage)] = Math.max(state.campaign.stars[String(stage)] ?? 0, 3);
  state.campaign.unlocked = Math.max(state.campaign.unlocked, Math.min(12, stage + 1));
  state.tasks.stage.progress = Math.min(state.tasks.stage.target, state.tasks.stage.progress + 1);
  const reward: Reward = { silver: firstClear ? 900 : 240, xp: firstClear ? 180 : 60, material: '法印残片', materialCount: firstClear ? 3 : 1 };
  grantReward(state, reward, `stage:${stage}:${firstClear ? 'first' : Date.now()}`);
  return reward;
}

export function upgradeCard(state: GameState, cardId: string): boolean {
  const card = state.cards.find((entry) => entry.id === cardId);
  if (!card) return false;
  const cost = card.level * 500;
  if (card.copies < 2 || state.resources.silver < cost) return false;
  card.copies -= 2;
  card.level += 1;
  card.power += 24 + card.level * 3;
  state.resources.silver -= cost;
  state.player.power += 18;
  state.tasks.upgrade.progress = state.tasks.upgrade.target;
  saveGame(state);
  return true;
}

export function upgradeBuilding(state: GameState, id: keyof GameState['buildings']): boolean {
  const level = state.buildings[id];
  const silver = level * 1400;
  const crystal = level * 40;
  if (state.resources.silver < silver || state.resources.crystal < crystal || level >= state.buildings.castle + (id === 'castle' ? 1 : 0)) return false;
  state.resources.silver -= silver;
  state.resources.crystal -= crystal;
  state.buildings[id] += 1;
  saveGame(state);
  return true;
}

export function claimTask(state: GameState, id: keyof GameState['tasks']): boolean {
  const task = state.tasks[id];
  if (!task || task.claimed || task.progress < task.target) return false;
  task.claimed = true;
  return grantReward(state, { silver: 1200, crystal: 30, xp: 80 }, `task:${id}`);
}

export function startExpedition(state: GameState): boolean {
  if (state.expedition.active || state.resources.stamina < 10) return false;
  state.resources.stamina -= 10;
  state.expedition = { active: true, endsAt: Date.now() + 60_000, reward: 1600 };
  saveGame(state);
  return true;
}

export function claimExpedition(state: GameState): boolean {
  if (!state.expedition.active || Date.now() < state.expedition.endsAt) return false;
  const reward = state.expedition.reward;
  state.expedition = { active: false, endsAt: 0, reward: 0 };
  return grantReward(state, { silver: reward, material: '山海鳞片', materialCount: 2 }, `expedition:${Date.now()}`);
}

export function resetGame(): GameState {
  const state = createDefaultState();
  saveGame(state);
  return state;
}
