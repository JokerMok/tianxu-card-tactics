import {
  Bot,
  Crosshair,
  CornerDownRight,
  FastForward,
  Flag,
  Flame,
  HeartPulse,
  RefreshCw,
  Shield,
  SkipForward,
  Sparkles,
  Swords,
  Wind,
} from 'lucide-react';
import { getCard } from '../data/cards';
import { getDeckComposition, PLAYER_DECK } from '../data/decks';
import type { BattleState, CardInstance, Role, Side, Unit } from '../battle/types';

const playerDeckComposition = getDeckComposition(PLAYER_DECK);

const roleIcons = {
  guard: Shield,
  striker: Swords,
  ranged: Crosshair,
  healer: HeartPulse,
  fast: Wind,
  caster: Sparkles,
} satisfies Record<Role, typeof Shield>;

function CardGlyph({ cardId }: { cardId: string }) {
  const card = getCard(cardId);
  const Icon = card.kind === 'skill'
    ? (cardId === 'S001' ? Flame : cardId === 'S007' ? HeartPulse : Sparkles)
    : roleIcons[card.unit!.role];
  return <Icon aria-hidden="true" />;
}

export function HeroStatus({ side, state, compact = false }: { side: Side; state: BattleState; compact?: boolean }) {
  const hp = state.heroHp[side];
  const maxHp = state.heroMaxHp[side];
  const label = side === 'player' ? '我方指挥官' : '敌方统领';
  return (
    <section className={`hero-status ${side} ${compact ? 'compact' : ''}`} aria-label={`${label}生命 ${hp}/${maxHp}`}>
      <div className="hero-emblem" aria-hidden="true"><Shield /></div>
      <div className="hero-copy">
        <span>{label}</span>
        <strong>{hp}<small> / {maxHp}</small></strong>
      </div>
      <div className="hero-health" aria-hidden="true">
        <i style={{ transform: `scaleX(${hp / maxHp})` }} />
      </div>
    </section>
  );
}

function UnitToken({ unit, legal, onClick }: { unit: Unit; legal: boolean; onClick: () => void }) {
  const Icon = roleIcons[unit.role];
  const statuses = [
    unit.status.stunRounds > 0 ? '晕' : '',
    unit.status.freezeRounds > 0 ? '冻' : '',
    unit.status.burnRounds > 0 ? '灼' : '',
    unit.status.barrier > 0 ? '盾' : '',
  ].filter(Boolean);
  return (
    <button
      type="button"
      className={`unit-token ${unit.side} role-${unit.role} ${legal ? 'legal-target' : ''}`}
      onClick={(event) => { event.stopPropagation(); if (legal) onClick(); }}
      disabled={!legal}
      aria-label={`${unit.side === 'player' ? '我方' : '敌方'}${unit.name}，生命 ${unit.hp}/${unit.maxHp}，攻击 ${unit.attack}`}
      data-testid={`unit-${unit.id}`}
    >
      <div className="unit-hp" aria-hidden="true"><i style={{ transform: `scaleX(${unit.hp / unit.maxHp})` }} /></div>
      <div className="unit-figure" aria-hidden="true"><Icon /></div>
      <div className="unit-nameplate"><span>{unit.name}</span><b>{unit.attack}</b></div>
      {statuses.length > 0 && <em aria-hidden="true">{statuses.join('·')}</em>}
    </button>
  );
}

export function BattlefieldCommander({ side, state }: { side: Side; state: BattleState }) {
  const label = side === 'player' ? '我方固定主将' : '敌方固定主将';
  const latestHit = [...state.events].reverse().find((event) => event.type === 'HERO_DAMAGED' && event.side === side);
  const heavyHitThreshold = Math.max(4, Math.ceil(state.heroMaxHp[side] * .12));
  const hitLevel = latestHit
    ? (latestHit.value ?? 0) >= heavyHitThreshold ? 'heavy' : 'light'
    : undefined;
  return (
    <aside
      className={`battlefield-commander ${side}`}
      aria-label={`${label}，生命 ${state.heroHp[side]}/${state.heroMaxHp[side]}，不移动且不占路线格`}
      data-testid={`battlefield-commander-${side}`}
      data-animation-set="idle hit-light hit-heavy command critical defeat"
    >
      <div
        key={`${side}-${latestHit?.id ?? 'idle'}`}
        className={`commander-figure ${hitLevel ? `is-hit is-hit-${hitLevel}` : ''}`}
        data-hit-event={latestHit?.id}
        data-hit-level={hitLevel}
        aria-hidden="true"
      >
        <img src={`/assets/commanders/${side}.webp`} alt="" />
      </div>
    </aside>
  );
}

export function Battlefield({
  state,
  legalLanes,
  legalCells,
  legalUnits,
  onLane,
  onCell,
  onUnit,
}: {
  state: BattleState;
  legalLanes: number[];
  legalCells: Array<{ lane: number; cell: number }>;
  legalUnits: string[];
  onLane: (lane: number) => void;
  onCell: (lane: number, cell: number) => void;
  onUnit: (unitId: string) => void;
}) {
  const legalCellKeys = new Set(legalCells.map(({ lane, cell }) => `${lane}:${cell}`));
  return (
    <div className="battlefield-shell">
      <BattlefieldCommander side="player" state={state} />
      <div
        className="battlefield"
        role="grid"
        aria-label="两路十二格战场"
        data-testid="battlefield"
        style={{ gridTemplateRows: `repeat(${state.laneCount}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: state.laneCount }, (_, lane) => (
          <div
            className={`battle-lane ${legalLanes.includes(lane) ? 'legal-lane' : ''}`}
            role="row"
            key={lane}
            data-testid={`lane-${lane}`}
            style={{ gridTemplateColumns: `repeat(${state.cellsPerLane}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: state.cellsPerLane }, (_, cell) => {
              const unit = state.units.find((candidate) => candidate.lane === lane && candidate.cell === cell);
              const legalDeployment = legalCellKeys.has(`${lane}:${cell}`);
              const zone = cell < state.summonDepth
                ? 'player-zone'
                : cell >= state.cellsPerLane - state.summonDepth
                  ? 'enemy-zone'
                  : '';
              return (
                <div
                  role="gridcell"
                  className={`battle-cell ${zone} ${legalDeployment ? 'legal-deployment' : ''}`}
                  key={cell}
                  onClick={() => {
                    if (legalDeployment) onCell(lane, cell);
                    else if (legalLanes.includes(lane)) onLane(lane);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    if (legalDeployment) onCell(lane, cell);
                    else if (legalLanes.includes(lane)) onLane(lane);
                  }}
                  tabIndex={legalDeployment || (legalLanes.includes(lane) && cell === 0) ? 0 : -1}
                  aria-disabled={!legalDeployment && !legalLanes.includes(lane)}
                  aria-label={`第 ${lane + 1} 路，第 ${cell + 1} 格${legalDeployment ? '，可召唤' : ''}${unit ? `，${unit.name}` : ''}`}
                  data-testid={`cell-${lane}-${cell}`}
                >
                  <span className="cell-mark">{cell + 1}</span>
                  {unit && (
                    <UnitToken
                      unit={unit}
                      legal={legalUnits.includes(unit.id)}
                      onClick={() => onUnit(unit.id)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <BattlefieldCommander side="enemy" state={state} />
      <div className="board-edge player" aria-hidden="true" />
      <div className="board-edge enemy" aria-hidden="true" />
    </div>
  );
}

function ReadyCard({
  instance,
  selected,
  playable,
  disabled,
  onClick,
}: {
  instance: CardInstance;
  selected: boolean;
  playable: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const card = getCard(instance.cardId);
  const stats = card.unit ? `${card.unit.attack}攻 · ${card.unit.maxHp}命` : card.skill?.targetType === 'lane' ? '路线' : '战术';
  return (
    <button
      type="button"
      className={`ready-card ${card.kind} ${selected ? 'selected' : ''} ${instance.remaining === 0 ? 'is-ready' : ''} ${playable ? 'is-playable' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={`${card.name}，${instance.remaining > 0 ? `还需 ${instance.remaining} 回合` : playable ? '可以使用' : '已准备但当前没有合法目标'}`}
      title={card.name}
      data-testid={`card-${instance.instanceId}`}
      data-card-id={instance.cardId}
    >
      <div className="card-art">
        <CardGlyph cardId={instance.cardId} />
        <span>{card.kind === 'unit' ? card.faction : card.profession}</span>
      </div>
      <div className="card-copy"><span className="card-name">{card.shortName}</span><small>{stats}</small></div>
      <b className="prepare-value">{instance.remaining === 0 ? '就绪' : instance.remaining}</b>
    </button>
  );
}

export function ReadyHand({
  state,
  selectedCardId,
  playableCardIds,
  onSelect,
  automated,
  vertical = false,
}: {
  state: BattleState;
  selectedCardId?: string;
  playableCardIds: Set<string>;
  onSelect: (instanceId: string) => void;
  automated: boolean;
  vertical?: boolean;
}) {
  return (
    <section className={`ready-hand ${vertical ? 'vertical' : ''}`} aria-label="准备栏">
      {state.hands.player.map((card) => (
        <ReadyCard
          key={card.instanceId}
          instance={card}
          selected={selectedCardId === card.instanceId}
          playable={playableCardIds.has(card.instanceId)}
          disabled={automated || state.status !== 'playing' || !playableCardIds.has(card.instanceId)}
          onClick={() => onSelect(card.instanceId)}
        />
      ))}
    </section>
  );
}

export function BattleControls({
  state,
  autoPlay,
  speed,
  onEndTurn,
  onAutoPlay,
  onSpeed,
  onRestart,
  onSurrender,
}: {
  state: BattleState;
  autoPlay: boolean;
  speed: 1 | 2;
  onEndTurn: () => void;
  onAutoPlay: () => void;
  onSpeed: () => void;
  onRestart: () => void;
  onSurrender: () => void;
}) {
  return (
    <div className="battle-controls" aria-label="战斗控制">
      <span className={`round-counter active-${state.activeSide}`}>
        <b>{state.round}</b> · {state.activeSide === 'player' ? '我方行动' : '敌方行动'}
      </span>
      <button
        type="button"
        onClick={onEndTurn}
        disabled={autoPlay || state.status !== 'playing' || state.activeSide !== 'player'}
        className="end-turn"
        aria-label="结束回合"
        title="结束回合"
      >
        <CornerDownRight /><span>结束</span>
      </button>
      <button
        type="button"
        role="switch"
        aria-checked={autoPlay}
        onClick={onAutoPlay}
        className={autoPlay ? 'auto-play enabled' : 'auto-play'}
        aria-label={autoPlay ? '关闭自动托管' : '开启自动托管'}
        title={autoPlay ? '关闭托管并接管操作' : '自动选牌、部署、施法并结束回合'}
      >
        <Bot /><span>{autoPlay ? '托管中' : '托管'}</span>
      </button>
      <button type="button" onClick={onSpeed} aria-label={`当前 ${speed} 倍速，点击切换`} title="切换倍速">
        {speed === 1 ? <SkipForward /> : <FastForward />}<span>{speed}×</span>
      </button>
      <button type="button" onClick={onRestart} aria-label="重新开局" title="重新开局"><RefreshCw /></button>
      <span
        className="deck-counter"
        title={`构筑：${playerDeckComposition.units} 张单位卡，${playerDeckComposition.skills} 张技能卡`}
      >
        牌 <b>{state.decks.player.length}</b> · 兵{playerDeckComposition.units} 术{playerDeckComposition.skills}
      </span>
      <button
        type="button"
        className="surrender"
        onClick={onSurrender}
        disabled={state.status !== 'playing'}
        aria-label="投降"
        title="投降"
      ><Flag /></button>
    </div>
  );
}

export function SurrenderConfirm({ open, onCancel, onConfirm }: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div className="surrender-scrim" role="dialog" aria-modal="true" aria-label="确认投降">
      <section className="surrender-panel">
        <strong>确认投降？</strong>
        <span>本场战斗将立即判负</span>
        <div>
          <button type="button" onClick={onCancel}>取消</button>
          <button type="button" className="confirm" onClick={onConfirm}>确认投降</button>
        </div>
      </section>
    </div>
  );
}

export function BattleLog({ state, compact = false }: { state: BattleState; compact?: boolean }) {
  const events = state.events.slice(compact ? -3 : -12).reverse();
  return (
    <section className={`battle-log ${compact ? 'compact' : ''}`} aria-label="战斗日志" aria-live="polite">
      {!compact && <h2>战况</h2>}
      {events.map((event) => <p key={event.id}><b>{event.turn}</b>{event.message}</p>)}
    </section>
  );
}

export function ResultOverlay({ state, onRestart }: { state: BattleState; onRestart: () => void }) {
  if (state.status === 'playing') return null;
  return (
    <div className="result-scrim" role="dialog" aria-modal="true" aria-label={state.status === 'won' ? '战斗胜利' : '战斗失败'}>
      <div className="result-panel">
        <span>{state.status === 'won' ? '阵线突破' : '防线失守'}</span>
        <strong>{state.status === 'won' ? '胜利' : '失败'}</strong>
        <small>第 {state.round} 回合</small>
        <button type="button" onClick={onRestart}><RefreshCw />重新开局</button>
      </div>
    </div>
  );
}
