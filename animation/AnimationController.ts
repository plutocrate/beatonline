// ═══════════════════════════════════════════════════════════════
//  animation/AnimationController.ts
//  Handles: AnimationMixer, crossfade blending, animation state
//           machine, beat-synced triggers, animation queuing
// ═══════════════════════════════════════════════════════════════

import * as THREE from 'three';
import { Accuracy } from '../game/BeatMap';
import { NoteDir }  from '../game/BeatMap';

export type AnimSlot =
  | 'idle'
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'special';

export type AnimStateType = 'IDLE' | 'DANCING' | 'TRANSITIONING';

export interface AnimConfig {
  /** Crossfade time for PERFECT hits */
  perfectFade:    number;
  /** Crossfade time for GOOD hits */
  goodFade:       number;
  /** Crossfade time back to idle */
  idleFade:       number;
  /** How many ms after a move to auto-return to idle (0 = use clip length) */
  returnToIdleMs: number;
}

const DEFAULT_CONFIG: AnimConfig = {
  perfectFade:    0.10,
  goodFade:       0.25,
  idleFade:       0.35,
  returnToIdleMs: 0,
};

export class AnimationController {
  private mixer!:   THREE.AnimationMixer;
  private actions:  Map<AnimSlot, THREE.AnimationAction> = new Map();
  private current:  THREE.AnimationAction | null = null;
  private currentSlot: AnimSlot = 'idle';

  private state: AnimStateType = 'IDLE';
  private config: AnimConfig;

  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private bpm = 120;

  // Callbacks
  private onStateChange?: (state: AnimStateType, slot: AnimSlot) => void;

  constructor(config: Partial<AnimConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── Initialise with a loaded Object3D ───────────────────────
  init(root: THREE.Object3D): void {
    this.mixer = new THREE.AnimationMixer(root);
  }

  setBPM(bpm: number): void {
    this.bpm = bpm;
  }

  // ── Register an animation clip under a slot name ─────────────
  registerClip(slot: AnimSlot, clip: THREE.AnimationClip): void {
    if (!this.mixer) {
      console.warn('[AnimationController] init() must be called before registerClip()');
      return;
    }
    const action = this.mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = false;
    this.actions.set(slot, action);
    console.log(`[AnimationController] Registered "${slot}" (${clip.duration.toFixed(2)}s)`);
  }

  // ── Trigger a move based on input direction + accuracy ───────
  trigger(dir: NoteDir | 'special', accuracy: Accuracy): void {
    if (accuracy === 'MISS') {
      this.returnToIdle(this.config.idleFade * 0.7);
      return;
    }

    const fade = accuracy === 'PERFECT'
      ? this.config.perfectFade
      : this.config.goodFade;

    this.transitionTo(dir as AnimSlot, fade);
  }

  // ── Core crossfade transition ─────────────────────────────────
  transitionTo(slot: AnimSlot, fadeTime = 0.25): void {
    const target = this.actions.get(slot) ?? this.actions.get('idle');
    if (!target) return;

    // Only skip if we're already on this exact non-idle slot in a dancing state
    if (target === this.current && slot !== 'idle' && this.state === 'DANCING') return;

    const from = this.current;

    // Always fully reset the target so it plays from the beginning with correct weight
    target.reset();
    target.setEffectiveTimeScale(1);
    target.setEffectiveWeight(1);
    target.play();

    if (from && from !== target) {
      // warp:false prevents crossFadeTo from corrupting the timeScale of the incoming clip
      from.crossFadeTo(target, fadeTime, false);
    } else {
      target.fadeIn(fadeTime);
    }

    this.current     = target;
    this.currentSlot = slot;
    this.state       = slot === 'idle' ? 'IDLE' : 'DANCING';
    this.onStateChange?.(this.state, slot);

    // Schedule return to idle only for non-idle moves
    if (slot !== 'idle') {
      this.scheduleIdleReturn(target);
    }
  }

  // ── Return to idle ───────────────────────────────────────────
  returnToIdle(fadeTime?: number): void {
    const idle = this.actions.get('idle');
    if (!idle) return;

    // Cancel any pending idle return timer
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    // If already on idle, just ensure it's healthy and looping
    if (this.current === idle) {
      idle.setEffectiveTimeScale(1);
      idle.setEffectiveWeight(1);
      if (!idle.isRunning()) {
        idle.reset();
        idle.play();
      }
      this.state = 'IDLE';
      this.onStateChange?.(this.state, 'idle');
      return;
    }

    const ft = fadeTime ?? this.config.idleFade;

    idle.reset();
    idle.setEffectiveTimeScale(1);
    idle.setEffectiveWeight(1);
    idle.play();

    if (this.current) {
      // warp:false to avoid corrupting the idle clip's timeScale on arrival
      this.current.crossFadeTo(idle, ft, false);
    } else {
      idle.fadeIn(ft);
    }

    this.current     = idle;
    this.currentSlot = 'idle';
    this.state       = 'IDLE';
    this.onStateChange?.(this.state, 'idle');
  }

  private scheduleIdleReturn(action: THREE.AnimationAction): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);

    const beatMs  = (60 / this.bpm) * 1000;
    const clipMs  = action._clip ? action._clip.duration * 1000 : beatMs * 2;
    const delayMs = this.config.returnToIdleMs > 0
      ? this.config.returnToIdleMs
      : Math.min(clipMs, beatMs * 4);

    this.idleTimer = setTimeout(() => {
      if (this.state === 'DANCING') this.returnToIdle();
    }, delayMs);
  }

  // ── Per-frame update ─────────────────────────────────────────
  update(delta: number): void {
    this.mixer?.update(delta);

    // Safety net: if idle action has somehow stopped while in IDLE state, restart it
    if (this.state === 'IDLE' && this.current) {
      if (!this.current.isRunning()) {
        this.current.reset();
        this.current.setEffectiveTimeScale(1);
        this.current.setEffectiveWeight(1);
        this.current.play();
      }
    }
  }

  // ── Beat-synced idle pulse ───────────────────────────────────
  /** Called on every detected beat -- can add subtle idle variation */
  onBeat(energy: number): void {
    if (this.state !== 'IDLE') return;
    const idle = this.actions.get('idle');
    if (!idle) return;
    // Slightly speed up idle on strong beats
    idle.timeScale = 1 + energy * 0.4;
    setTimeout(() => { if (idle) idle.timeScale = 1; }, 200);
  }

  // ── Accessors ────────────────────────────────────────────────
  get currentState():    AnimStateType { return this.state; }
  get currentSlotName(): AnimSlot      { return this.currentSlot; }
  get hasAnimations():   boolean       { return this.actions.size > 0; }

  getAvailableSlots(): AnimSlot[] {
    return Array.from(this.actions.keys());
  }

  setOnStateChange(cb: (state: AnimStateType, slot: AnimSlot) => void): void {
    this.onStateChange = cb;
  }

  // ── Serialise state (for debug) ──────────────────────────────
  debug(): object {
    return {
      state:    this.state,
      slot:     this.currentSlot,
      slots:    this.getAvailableSlots(),
      bpm:      this.bpm,
    };
  }
}
