import { useCallback, useEffect, useMemo, useState } from 'react';
import { Crosshair, RotateCcw, X } from 'lucide-react';
import { canPlayCard, createBattle, endTurn, getHandCard, getLegalDeploymentCells, getLegalLanes, getLegalUnitIds, playCard, runEnemyTurn, runPlayerAutoAction, surrenderBattle } from './battle/engine';
import type { CardTarget } from './battle/types';
import { getCard } from './data/cards';
import {
  Battlefield,
  BattleControls,
  BattleLog,
  HeroStatus,
  ReadyHand,
  ResultOverlay,
  SurrenderConfirm,
} from './components/GamePieces';
import { PrototypeSwitcher, type Variant } from './components/PrototypeSwitcher';
import { VariantA, VariantB, VariantC, type LayoutParts } from './layouts/Layouts';

const DEFAULT_SEED = 20260712;
const showPrototypeSwitcher = new URLSearchParams(window.location.search).has('prototype');

function initialVariant(): Variant {
  const value = new URLSearchParams(window.location.search).get('variant');
  return value === 'B' || value === 'C' ? value : 'A';
}

function useLandscape(): boolean {
  const [landscape, setLandscape] = useState(() => window.innerWidth >= window.innerHeight);
  useEffect(() => {
    const update = () => setLandscape(window.innerWidth >= window.innerHeight);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return landscape;
}

export default function App() {
  const [state, setState] = useState(() => createBattle(DEFAULT_SEED));
  const [selectedCardId, setSelectedCardId] = useState<string>();
  const [autoPlay, setAutoPlay] = useState(false);
  const [speed, setSpeed] = useState<1 | 2>(1);
  const [variant, setVariant] = useState<Variant>(initialVariant);
  const [notice, setNotice] = useState('');
  const [confirmingSurrender, setConfirmingSurrender] = useState(false);
  const landscape = useLandscape();

  const selectedCard = selectedCardId ? getHandCard(state, 'player', selectedCardId) : undefined;
  const selectedDefinition = selectedCard ? getCard(selectedCard.cardId) : undefined;
  const legalLanes = useMemo(
    () => selectedCard && getCard(selectedCard.cardId).kind === 'skill'
      ? getLegalLanes(state, 'player', selectedCard.cardId)
      : [],
    [selectedCard, state],
  );
  const legalCells = useMemo(
    () => selectedCard && getCard(selectedCard.cardId).kind === 'unit'
      ? getLegalDeploymentCells(state, 'player')
      : [],
    [selectedCard, state],
  );
  const legalUnits = useMemo(
    () => selectedCard ? getLegalUnitIds(state, 'player', selectedCard.cardId) : [],
    [state, selectedCard],
  );
  const playableCardIds = useMemo(() => new Set(
    state.hands.player
      .filter((card) => canPlayCard(state, 'player', card))
      .map((card) => card.instanceId),
  ), [state]);
  const targetLabel = selectedDefinition?.kind === 'unit'
    ? '选择召唤区域内的空格'
    : selectedDefinition?.skill?.targetType === 'lane'
      ? '选择敌方路线'
      : selectedDefinition
        ? '选择目标单位'
        : '';

  const restart = useCallback(() => {
    setState(createBattle(DEFAULT_SEED));
    setSelectedCardId(undefined);
    setNotice('');
    setConfirmingSurrender(false);
  }, []);

  const requestSurrender = useCallback(() => {
    setSelectedCardId(undefined);
    setNotice('');
    setConfirmingSurrender(true);
  }, []);

  const confirmSurrender = useCallback(() => {
    setAutoPlay(false);
    setConfirmingSurrender(false);
    setState((current) => surrenderBattle(current, 'player'));
  }, []);

  const endPlayerTurn = useCallback(() => {
    setSelectedCardId(undefined);
    setNotice('');
    setState((current) => endTurn(current, 'player'));
  }, []);

  const commitPlay = useCallback((target: CardTarget) => {
    if (!selectedCardId) return;
    const result = playCard(state, 'player', selectedCardId, target);
    setState(result.state);
    if (result.played) {
      setSelectedCardId(undefined);
      setNotice('');
    } else {
      setNotice(result.reason ?? '当前目标无效');
    }
  }, [selectedCardId, state]);

  const selectCard = useCallback((instanceId: string) => {
    if (autoPlay) return;
    if (selectedCardId === instanceId) {
      setSelectedCardId(undefined);
      setNotice('');
      return;
    }
    const instance = getHandCard(state, 'player', instanceId);
    if (!instance || !canPlayCard(state, 'player', instance)) {
      setNotice(instance?.remaining === 0 ? '当前没有合法目标' : '卡牌尚未准备完成');
      return;
    }
    const card = getCard(instance.cardId);
    if (card.skill?.targetType === 'global') {
      const result = playCard(state, 'player', instanceId, { kind: 'global' });
      setState(result.state);
      setNotice(result.played ? '' : result.reason ?? '当前无法使用');
      return;
    }
    setSelectedCardId(instanceId);
    setNotice('');
  }, [autoPlay, selectedCardId, state]);

  const toggleAutoPlay = useCallback(() => {
    setSelectedCardId(undefined);
    setNotice('');
    setAutoPlay((value) => !value);
  }, []);

  const changeVariant = useCallback((next: Variant) => {
    const url = new URL(window.location.href);
    url.searchParams.set('variant', next);
    window.history.replaceState({}, '', url);
    setVariant(next);
  }, []);

  useEffect(() => {
    if (confirmingSurrender || !landscape || state.status !== 'playing' || state.activeSide !== 'enemy') return;
    const timer = window.setTimeout(() => setState((current) => runEnemyTurn(current)), 700 / speed);
    return () => window.clearTimeout(timer);
  }, [confirmingSurrender, landscape, speed, state.activeSide, state.status, state.turn]);

  useEffect(() => {
    if (confirmingSurrender || !autoPlay || !landscape || state.status !== 'playing' || state.activeSide !== 'player') return;
    const timer = window.setTimeout(() => {
      setSelectedCardId(undefined);
      setNotice('');
      setState((current) => runPlayerAutoAction(current));
    }, 520 / speed);
    return () => window.clearTimeout(timer);
  }, [autoPlay, confirmingSurrender, landscape, speed, state]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, button, a, [contenteditable="true"]')) return;
      if (event.key === 'Escape' && !autoPlay) {
        setSelectedCardId(undefined);
        setNotice('');
      }
      if (!autoPlay && selectedDefinition?.kind === 'unit' && ['1', '2', '3', '4', '5', '6'].includes(event.key)) {
        const targetCell = legalCells[Number(event.key) - 1];
        if (targetCell) commitPlay({ kind: 'cell', ...targetCell });
      } else if (selectedCard && ['1', '2'].includes(event.key)) {
        const lane = Number(event.key) - 1;
        if (legalLanes.includes(lane)) commitPlay({ kind: 'lane', lane });
      }
      if (event.key === ' ' && !autoPlay && !selectedCard && state.activeSide === 'player' && state.status === 'playing') {
        event.preventDefault();
        endPlayerTurn();
      }
      const variants: Variant[] = ['A', 'B', 'C'];
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const offset = event.key === 'ArrowLeft' ? -1 : 1;
        const index = variants.indexOf(variant);
        changeVariant(variants[(index + offset + variants.length) % variants.length]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [autoPlay, changeVariant, commitPlay, endPlayerTurn, legalCells, legalLanes, selectedCard, selectedDefinition, state.activeSide, state.status, variant]);

  const board = (
    <Battlefield
      state={state}
      legalLanes={legalLanes}
      legalCells={legalCells}
      legalUnits={legalUnits}
      onLane={(lane) => commitPlay({ kind: 'lane', lane })}
      onCell={(lane, cell) => commitPlay({ kind: 'cell', lane, cell })}
      onUnit={(unitId) => commitPlay({ kind: 'unit', unitId })}
    />
  );
  const hand = <ReadyHand state={state} selectedCardId={selectedCardId} playableCardIds={playableCardIds} onSelect={selectCard} automated={autoPlay} />;
  const verticalHand = <ReadyHand state={state} selectedCardId={selectedCardId} playableCardIds={playableCardIds} onSelect={selectCard} automated={autoPlay} vertical />;
  const controls = (
    <BattleControls
      state={state}
      autoPlay={autoPlay}
      speed={speed}
      onEndTurn={endPlayerTurn}
      onAutoPlay={toggleAutoPlay}
      onSpeed={() => setSpeed((value) => value === 1 ? 2 : 1)}
      onRestart={restart}
      onSurrender={requestSurrender}
    />
  );
  const overlay = (
    <>
      <ResultOverlay state={state} onRestart={restart} />
      <SurrenderConfirm
        open={confirmingSurrender}
        onCancel={() => setConfirmingSurrender(false)}
        onConfirm={confirmSurrender}
      />
      {notice && <div className="notice" role="status">{notice}</div>}
      {selectedDefinition && (
        <div className="target-prompt" role="status">
          <Crosshair aria-hidden="true" />
          <strong>{selectedDefinition.name}</strong>
          <span>{targetLabel}</span>
          <button
            type="button"
            onClick={() => { setSelectedCardId(undefined); setNotice(''); }}
            aria-label="取消选择"
            title="取消选择"
          ><X /></button>
        </div>
      )}
      {!landscape && (
        <div className="orientation-gate" role="dialog" aria-label="请横屏体验">
          <RotateCcw aria-hidden="true" /><strong>请横屏体验</strong>
        </div>
      )}
    </>
  );
  const parts: LayoutParts = {
    playerHero: <HeroStatus side="player" state={state} />,
    enemyHero: <HeroStatus side="enemy" state={state} />,
    controls,
    board,
    hand,
    verticalHand,
    log: <BattleLog state={state} />,
    compactLog: <BattleLog state={state} compact />,
    overlay,
  };

  return (
    <div className={`prototype-root ${showPrototypeSwitcher ? 'has-switcher' : ''}`} data-variant={variant}>
      {variant === 'A' && <VariantA parts={parts} />}
      {variant === 'B' && <VariantB parts={parts} />}
      {variant === 'C' && <VariantC parts={parts} />}
      <PrototypeSwitcher current={variant} visible={showPrototypeSwitcher} onChange={changeVariant} />
    </div>
  );
}
