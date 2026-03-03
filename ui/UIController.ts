// ═══════════════════════════════════════════════════════════════
//  ui/UIController.ts
//  Handles: score display, combo, accuracy popups, note lane
//           rendering, beat flash, loading screen, start screen,
//           progress bar, animation label
// ═══════════════════════════════════════════════════════════════

import { Note, NoteDir, Accuracy } from '../game/BeatMap';

interface UIRefs {
  startScreen:    HTMLElement;
  loadingScreen:  HTMLElement;
  uiOverlay:      HTMLElement;
  scoreValue:     HTMLElement;
  comboValue:     HTMLElement;
  songName:       HTMLElement;
  bpmDisplay:     HTMLElement;
  beatFlash:      HTMLElement;
  accuracyPopup:  HTMLElement;
  notesLane:      HTMLElement;
  animLabel:      HTMLElement;
  danceMode:      HTMLElement;
  loadingBar:     HTMLElement;
  loadingStatus:  HTMLElement;
  progressBar:    HTMLElement;
  keySlots:       Record<NoteDir, HTMLElement>;
}

// How long notes take to reach hit zone (seconds)
const NOTE_FALL_TIME = 2.2;
// Hit zone distance from bottom of viewport (px)
const HIT_ZONE_BOTTOM = 100;

export class UIController {
  private refs!: UIRefs;
  private noteElements: Map<number, HTMLElement> = new Map();
  private accTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Initialise ───────────────────────────────────────────────
  init(): void {
    this.refs = {
      startScreen:   this.q('#start-screen'),
      loadingScreen: this.q('#loading-screen'),
      uiOverlay:     this.q('#ui-overlay'),
      scoreValue:    this.q('#score-value'),
      comboValue:    this.q('#combo-value'),
      songName:      this.q('#song-name'),
      bpmDisplay:    this.q('#bpm-display'),
      beatFlash:     this.q('#beat-flash'),
      accuracyPopup: this.q('#accuracy-popup'),
      notesLane:     this.q('#notes-lane'),
      animLabel:     this.q('#anim-label'),
      danceMode:     this.q('#dance-mode'),
      loadingBar:    this.q('#loading-bar'),
      loadingStatus: this.q('#loading-status'),
      progressBar:   this.q('#progress-bar-inner'),
      keySlots: {
        left:  this.q('#key-left'),
        right: this.q('#key-right'),
        up:    this.q('#key-up'),
        down:  this.q('#key-down'),
      },
    };
  }

  private q(sel: string): HTMLElement {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) throw new Error(`[UIController] Missing element: ${sel}`);
    return el;
  }

  // ── Screen transitions ───────────────────────────────────────
  showStartScreen():   void { this.refs.startScreen.style.display   = 'flex'; }
  hideStartScreen():   void { this.refs.startScreen.style.display   = 'none'; }
  showLoadingScreen(): void { this.refs.loadingScreen.style.display = 'flex'; }
  hideLoadingScreen(): void { this.refs.loadingScreen.style.display = 'none'; }
  showGameUI():        void { this.refs.uiOverlay.style.display     = 'block'; }
  hideGameUI():        void { this.refs.uiOverlay.style.display     = 'none'; }

  // ── Loading progress ─────────────────────────────────────────
  setLoadingProgress(msg: string, pct: number): void {
    this.refs.loadingStatus.textContent = msg;
    this.refs.loadingBar.style.width    = `${Math.max(0, Math.min(100, pct))}%`;
  }

  // ── Song info ─────────────────────────────────────────────────
  setSongInfo(name: string, bpm: number): void {
    this.refs.songName.textContent  = name.toUpperCase().slice(0, 20);
    this.refs.bpmDisplay.textContent = `${bpm} BPM`;
  }

  // ── Score & Combo ─────────────────────────────────────────────
  updateScore(score: number, combo: number): void {
    this.refs.scoreValue.textContent = String(Math.floor(score)).padStart(6, '0');
    this.refs.comboValue.textContent = `${combo}x COMBO`;

    if (combo > 5) {
      this.refs.comboValue.style.transform = 'scale(1.15)';
      setTimeout(() => { this.refs.comboValue.style.transform = 'scale(1)'; }, 100);
    }
  }

  // ── Accuracy popup ────────────────────────────────────────────
  showAccuracy(accuracy: Accuracy): void {
    const el = this.refs.accuracyPopup;
    el.textContent = accuracy;
    el.className   = accuracy.toLowerCase();
    el.style.opacity   = '1';
    el.style.transform = 'translateX(-50%) scale(1.1)';
    el.style.transition = 'none';

    if (this.accTimer) clearTimeout(this.accTimer);
    this.accTimer = setTimeout(() => {
      el.style.transition = 'opacity 0.3s, transform 0.3s';
      el.style.opacity    = '0';
      el.style.transform  = 'translateX(-50%) scale(0.9)';
    }, 550);
  }

  // ── Beat flash ────────────────────────────────────────────────
  private beatFlashTimer: ReturnType<typeof setTimeout> | null = null;
  triggerBeatFlash(): void {
    this.refs.beatFlash.style.opacity = '0.12';
    if (this.beatFlashTimer) clearTimeout(this.beatFlashTimer);
    this.beatFlashTimer = setTimeout(() => {
      this.refs.beatFlash.style.opacity = '0';
    }, 80);
  }

  // ── Key slot feedback ─────────────────────────────────────────
  flashKey(dir: NoteDir, active: boolean): void {
    const el = this.refs.keySlots[dir];
    if (!el) return;
    if (active) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  }

  flashMissKey(dir: NoteDir): void {
    const el = this.refs.keySlots[dir];
    if (!el) return;
    el.classList.add('miss-flash');
    setTimeout(() => el.classList.remove('miss-flash'), 220);
  }

  // ── Animation label ───────────────────────────────────────────
  setAnimLabel(label: string): void {
    this.refs.animLabel.textContent  = label.toUpperCase().replace(/_/g, ' ');
    this.refs.danceMode.textContent  = label.toUpperCase();
  }

  // ── Song progress bar ─────────────────────────────────────────
  setProgress(pct: number): void {
    this.refs.progressBar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }

  // ── Note lane ─────────────────────────────────────────────────
  updateNotes(notes: Note[], songTime: number): void {
    const laneH = window.innerHeight;

    for (const note of notes) {
      // Remove stale elements
      if (note.hit || note.missed) {
        this.removeNoteElement(note.id);
        continue;
      }

      const timeUntil = note.time - songTime;
      if (timeUntil > NOTE_FALL_TIME || timeUntil < -0.3) {
        this.removeNoteElement(note.id);
        continue;
      }

      const el = this.getOrCreateNoteElement(note);

      // y position: 0 = hit zone, 1 = top of screen
      const progress    = timeUntil / NOTE_FALL_TIME;
      const yFromBottom = HIT_ZONE_BOTTOM +
        progress * (laneH - HIT_ZONE_BOTTOM - 60);
      el.style.bottom = `${yFromBottom}px`;

      // Glow near hit zone
      if (progress < 0.15) {
        const glow = 1 - progress / 0.15;
        el.style.boxShadow = `0 0 ${20 * glow}px currentColor`;
        const scaleStr =
          note.dir === 'up' || note.dir === 'down'
            ? `translateX(-50%) scale(${1 + glow * 0.1})`
            : `scale(${1 + glow * 0.1})`;
        el.style.transform = scaleStr;
      } else {
        el.style.boxShadow = '';
        el.style.transform = note.dir === 'up' || note.dir === 'down'
          ? 'translateX(-50%)'
          : '';
      }
    }
  }

  private getOrCreateNoteElement(note: Note): HTMLElement {
    if (this.noteElements.has(note.id)) {
      return this.noteElements.get(note.id)!;
    }

    const ARROWS: Record<NoteDir, string> = {
      left: '←', right: '→', up: '↑', down: '↓',
    };

    const el = document.createElement('div');
    el.className   = `note-element ${note.dir}`;
    el.textContent = ARROWS[note.dir];
    this.refs.notesLane.appendChild(el);
    this.noteElements.set(note.id, el);
    return el;
  }

  private removeNoteElement(id: number): void {
    const el = this.noteElements.get(id);
    if (el) {
      el.remove();
      this.noteElements.delete(id);
    }
  }

  clearNotes(): void {
    this.noteElements.forEach(el => el.remove());
    this.noteElements.clear();
  }

  // ── Music status (start screen) ───────────────────────────────
  setMusicStatus(msg: string): void {
    const el = document.querySelector<HTMLElement>('#music-status');
    if (el) el.textContent = msg;
  }

  setStartButtonEnabled(enabled: boolean): void {
    const btn = document.querySelector<HTMLButtonElement>('#start-btn');
    if (btn) btn.disabled = !enabled;
  }

  markFBXSlotLoaded(slot: string, name: string): void {
    const el = document.querySelector<HTMLElement>(`#slot-${slot}`);
    if (!el) return;
    el.classList.add('loaded');
    const short = name.replace(/\.(fbx|glb|gltf)$/i, '').slice(0, 14);
    // preserve input
    const input = el.querySelector('input');
    el.innerHTML = `<span class="key-tag">${slot.slice(0,3).toUpperCase()}</span>${short}`;
    if (input) el.appendChild(input);
  }
}
