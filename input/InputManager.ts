// ═══════════════════════════════════════════════════════════════
//  input/InputManager.ts
//  Handles: keyboard input, touch/mobile input, key-to-action
//           mapping, debounce, input event dispatching
// ═══════════════════════════════════════════════════════════════

import { NoteDir } from '../game/BeatMap';

export type InputAction = NoteDir | 'special' | 'pause' | 'restart';

export interface InputEvent {
  action:    InputAction;
  timestamp: number; // performance.now()
}

type InputCallback = (event: InputEvent) => void;

// Key → action mapping
const KEY_MAP: Record<string, InputAction> = {
  ArrowLeft:  'left',
  KeyA:       'left',
  ArrowRight: 'right',
  KeyD:       'right',
  ArrowUp:    'up',
  KeyW:       'up',
  ArrowDown:  'down',
  KeyS:       'down',
  Space:      'special',
  KeyP:       'pause',
  Escape:     'pause',
  KeyR:       'restart',
};

// Visual key element IDs (for UI feedback)
const DIR_KEY_IDS: Partial<Record<InputAction, string>> = {
  left:    'key-left',
  right:   'key-right',
  up:      'key-up',
  down:    'key-down',
  special: 'key-special',
};

export class InputManager {
  private heldKeys = new Set<string>();
  private callbacks: InputCallback[] = [];
  private enabled = false;

  // ── Lifecycle ────────────────────────────────────────────────
  init(): void {
    window.addEventListener('keydown',   this.handleKeyDown);
    window.addEventListener('keyup',     this.handleKeyUp);
    this.initTouchControls();
    this.enabled = true;
  }

  destroy(): void {
    window.removeEventListener('keydown',   this.handleKeyDown);
    window.removeEventListener('keyup',     this.handleKeyUp);
    this.enabled = false;
  }

  enable():  void { this.enabled = true; }
  disable(): void { this.enabled = false; }

  // ── Keyboard ─────────────────────────────────────────────────
  private handleKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled) return;
    if (this.heldKeys.has(e.code)) return; // no repeat
    this.heldKeys.add(e.code);

    const action = KEY_MAP[e.code];
    if (!action) return;

    // Prevent page scroll for arrow/space keys
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space'].includes(e.code)) {
      e.preventDefault();
    }

    this.dispatch(action);
    this.flashKeyUI(action, true);
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.heldKeys.delete(e.code);
    const action = KEY_MAP[e.code];
    if (action) this.flashKeyUI(action, false);
  };

  // ── Touch controls ───────────────────────────────────────────
  private initTouchControls(): void {
    // Create on-screen D-pad for mobile if touch is available
    if (!('ontouchstart' in window)) return;

    const dpad = document.createElement('div');
    dpad.id    = 'touch-dpad';
    dpad.style.cssText = `
      position: fixed;
      bottom: 30px;
      left: 50%;
      transform: translateX(-50%);
      display: grid;
      grid-template-columns: 64px 64px 64px;
      grid-template-rows:    64px 64px 64px;
      gap: 4px;
      z-index: 20;
      pointer-events: all;
    `;

    const buttons: { label: string; action: InputAction; col: number; row: number }[] = [
      { label: '↑', action: 'up',    col: 2, row: 1 },
      { label: '←', action: 'left',  col: 1, row: 2 },
      { label: '↓', action: 'down',  col: 2, row: 3 },
      { label: '→', action: 'right', col: 3, row: 2 },
    ];

    buttons.forEach(({ label, action, col, row }) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.style.cssText = `
        grid-column: ${col}; grid-row: ${row};
        background: rgba(255,255,255,0.08);
        border: 2px solid rgba(255,255,255,0.2);
        border-radius: 8px;
        color: #fff;
        font-size: 22px;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
      `;
      btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (!this.enabled) return;
        this.dispatch(action);
        this.flashKeyUI(action, true);
        btn.style.background = 'rgba(0,245,212,0.2)';
      });
      btn.addEventListener('touchend', () => {
        this.flashKeyUI(action, false);
        btn.style.background = 'rgba(255,255,255,0.08)';
      });
      dpad.appendChild(btn);
    });

    document.body.appendChild(dpad);
  }

  // ── Dispatch ─────────────────────────────────────────────────
  private dispatch(action: InputAction): void {
    const event: InputEvent = { action, timestamp: performance.now() };
    this.callbacks.forEach(cb => cb(event));
  }

  // ── UI Flash ─────────────────────────────────────────────────
  private flashKeyUI(action: InputAction, active: boolean): void {
    const id = DIR_KEY_IDS[action];
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    if (active) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  }

  flashMiss(action: InputAction): void {
    const id = DIR_KEY_IDS[action];
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('miss-flash');
    setTimeout(() => el.classList.remove('miss-flash'), 200);
  }

  // ── Listener registration ────────────────────────────────────
  on(cb: InputCallback): void {
    this.callbacks.push(cb);
  }

  off(cb: InputCallback): void {
    this.callbacks = this.callbacks.filter(c => c !== cb);
  }

  // ── Query ────────────────────────────────────────────────────
  isHeld(code: string): boolean {
    return this.heldKeys.has(code);
  }
}
