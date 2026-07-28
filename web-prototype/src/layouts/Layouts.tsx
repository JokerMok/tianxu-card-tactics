import type { ReactNode } from 'react';

export interface LayoutParts {
  playerHero: ReactNode;
  enemyHero: ReactNode;
  controls: ReactNode;
  board: ReactNode;
  hand: ReactNode;
  verticalHand: ReactNode;
  log: ReactNode;
  compactLog: ReactNode;
  overlay: ReactNode;
}

export function VariantA({ parts }: { parts: LayoutParts }) {
  return (
    <main className="game-layout variant-a">
      <header className="top-hud">{parts.playerHero}{parts.controls}{parts.enemyHero}</header>
      <section className="board-region">{parts.board}</section>
      <footer className="bottom-zone">{parts.compactLog}{parts.hand}</footer>
      {parts.overlay}
    </main>
  );
}

export function VariantB({ parts }: { parts: LayoutParts }) {
  return (
    <main className="game-layout variant-b">
      <aside className="commander-column player-column">{parts.playerHero}{parts.verticalHand}</aside>
      <section className="tactical-center"><div className="center-controls">{parts.controls}</div>{parts.board}</section>
      <aside className="commander-column enemy-column">{parts.enemyHero}{parts.log}</aside>
      {parts.overlay}
    </main>
  );
}

export function VariantC({ parts }: { parts: LayoutParts }) {
  return (
    <main className="game-layout variant-c">
      <section className="immersive-stage">
        <div className="immersive-controls">{parts.controls}</div>
        <div className="hero-rail player-rail">{parts.playerHero}</div>
        {parts.board}
        <div className="hero-rail enemy-rail">{parts.enemyHero}</div>
      </section>
      <section className="immersive-hand">{parts.hand}</section>
      {parts.overlay}
    </main>
  );
}
