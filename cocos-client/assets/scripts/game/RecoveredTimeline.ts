export interface RecoveredMatrix2D {
  a: number; b: number; c: number; d: number;
  tx_px?: number; ty_px?: number;
}

export interface RecoveredTimelineControl {
  op: 'place' | 'remove';
  depth: number;
  frame: number;
  move?: boolean;
  inherit_missing_fields?: boolean;
  character_id?: number;
  asset_id?: string;
  matrix?: RecoveredMatrix2D;
}

export interface RecoveredTimelineClock {
  declared_frames: number;
  show_frame_count: number;
  fps: number;
}

export interface RecoveredDisplayState {
  characterId?: number;
  assetId?: string;
  matrix: RecoveredMatrix2D;
  /** One-based parent frame on which this display object instance was placed. */
  placedFrame: number;
}

export const RECOVERED_IDENTITY_MATRIX: RecoveredMatrix2D =
  { a: 1, b: 0, c: 0, d: 1, tx_px: 0, ty_px: 0 };

/** Apply the SWF depth-list deltas through a one-based timeline frame. */
export function evaluateRecoveredTimeline(controls: RecoveredTimelineControl[], frame: number): Map<number, RecoveredDisplayState> {
  const display = new Map<number, RecoveredDisplayState>();
  for (const control of controls) {
    if (control.frame > frame) break;
    if (control.op === 'remove') {
      display.delete(control.depth);
      continue;
    }
    const previous = display.get(control.depth);
    const inherits = Boolean(control.move && control.inherit_missing_fields);
    const pureMove = inherits && control.character_id === undefined && control.asset_id === undefined;
    if (pureMove && !previous) continue;
    display.set(control.depth, {
      characterId: control.character_id ?? (inherits ? previous?.characterId : undefined),
      assetId: control.asset_id ?? (inherits ? previous?.assetId : undefined),
      matrix: control.matrix ?? (inherits ? previous?.matrix : undefined) ?? RECOVERED_IDENTITY_MATRIX,
      // A matrix-only Move keeps the same display object alive. Any explicit
      // character placement creates a fresh instance, even at the same depth.
      placedFrame: pureMove && previous ? previous.placedFrame : control.frame,
    });
  }
  return display;
}

/**
 * Resolve a nested clip from the instant it was placed on its parent.
 * Both inputs and the result are one-based display frames. A parent loop calls
 * this with its wrapped frame, so children are restarted with that loop.
 */
export function recoveredChildFrame(parentFrame: number, parentFps: number,
                                    state: RecoveredDisplayState,
                                    child: RecoveredTimelineClock): number {
  const childCount = Math.max(1, child.show_frame_count || child.declared_frames || 1);
  const elapsed = Math.max(0, parentFrame - state.placedFrame) / Math.max(1, parentFps || 24);
  const advanced = Math.floor(elapsed * Math.max(1, child.fps || parentFps || 24) + 1e-9);
  return advanced % childCount + 1;
}
