// ═══════════════════════════════════════════════════════════════
//  game/BeatMap.ts
//  Handles: beat map generation, note scheduling, timing windows,
//           hit/miss detection, score calculation
// ═══════════════════════════════════════════════════════════════

export type NoteDir = 'left' | 'right' | 'up' | 'down';

export type Accuracy = 'PERFECT' | 'GOOD' | 'MISS';

export interface Note {
  id:      number;
  time:    number;   // seconds into song
  dir:     NoteDir;
  hit:     boolean;
  missed:  boolean;
  accuracy?: Accuracy;
}

export interface HitResult {
  note:     Note;
  accuracy: Accuracy;
  score:    number;
  combo:    number;
}

export interface BeatMapStats {
  totalNotes:  number;
  perfects:    number;
  goods:       number;
  misses:      number;
  maxCombo:    number;
  accuracy:    number; // 0–100 %
}

// Timing windows (seconds, ± around note.time)
const WINDOW_PERFECT = 0.10;
const WINDOW_GOOD    = 0.22;

// Score per hit
const SCORE_PERFECT  = 300;
const SCORE_GOOD     = 100;
const COMBO_BONUS    = 0.1; // +10% per combo step (capped at 5×)

export class BeatMap {
  private notes:    Note[] = [];
  private _combo    = 0;
  private _maxCombo = 0;
  private _score    = 0;
  private noteId    = 0;

  private onHitCallbacks:  ((result: HitResult) => void)[] = [];
  private onMissCallbacks: ((note: Note)        => void)[] = [];

  // ── Generation ───────────────────────────────────────────────
  generate(duration: number, bpm: number): void {
    this.notes   = [];
    this._combo  = 0;
    this._score  = 0;
    this.noteId  = 0;

    const beat     = 60 / bpm;
    const dirs: NoteDir[] = ['left', 'right', 'up', 'down'];

    // Density: one note per beat, skip ~30% randomly, no same dir twice in row
    let prevDir: NoteDir | null = null;

    for (let t = beat * 3; t < duration - 2; t += beat) {
      if (Math.random() < 0.28) continue; // breathing room

      // Pick dir (not same as previous)
      let dir: NoteDir;
      do { dir = dirs[Math.floor(Math.random() * dirs.length)]; }
      while (dir === prevDir);
      prevDir = dir;

      // Occasionally add a double note (same beat, different dir)
      const isDouble = Math.random() < 0.12 && prevDir !== null;

      this.notes.push({
        id:     this.noteId++,
        time:   t,
        dir,
        hit:    false,
        missed: false,
      });

      if (isDouble) {
        const otherDirs = dirs.filter(d => d !== dir);
        const dir2 = otherDirs[Math.floor(Math.random() * otherDirs.length)];
        this.notes.push({
          id:     this.noteId++,
          time:   t + beat * 0.05, // tiny offset so they don't overlap
          dir:    dir2,
          hit:    false,
          missed: false,
        });
      }
    }
  }

  // ── Per-frame update ─────────────────────────────────────────
  /** Call every frame. Returns list of notes that became missed. */
  update(songTime: number): Note[] {
    const newlyMissed: Note[] = [];

    for (const note of this.notes) {
      if (note.hit || note.missed) continue;
      if (songTime - note.time > WINDOW_GOOD + 0.12) {
        note.missed = true;
        this._combo = 0;
        newlyMissed.push(note);
        this.onMissCallbacks.forEach(cb => cb(note));
      }
    }

    return newlyMissed;
  }

  // ── Hit detection ────────────────────────────────────────────
  tryHit(dir: NoteDir, songTime: number): HitResult | null {
    let best: Note | null = null;
    let bestDiff = Infinity;

    for (const note of this.notes) {
      if (note.hit || note.missed || note.dir !== dir) continue;
      const diff = Math.abs(note.time - songTime);
      if (diff < bestDiff && diff <= WINDOW_GOOD) {
        bestDiff = best ? bestDiff : diff;
        best     = note;
        bestDiff = diff;
      }
    }

    if (!best) return null;

    const accuracy: Accuracy = bestDiff <= WINDOW_PERFECT ? 'PERFECT' : 'GOOD';
    best.hit      = true;
    best.accuracy = accuracy;

    this._combo++;
    if (this._combo > this._maxCombo) this._maxCombo = this._combo;

    const comboMult = Math.min(5, 1 + this._combo * COMBO_BONUS);
    const baseScore = accuracy === 'PERFECT' ? SCORE_PERFECT : SCORE_GOOD;
    const earned    = Math.round(baseScore * comboMult);
    this._score    += earned;

    const result: HitResult = { note: best, accuracy, score: earned, combo: this._combo };
    this.onHitCallbacks.forEach(cb => cb(result));
    return result;
  }

  // ── Getters ──────────────────────────────────────────────────

  /** Notes visible in the window [songTime - lookBehind, songTime + lookAhead] */
  getVisibleNotes(songTime: number, lookAhead = 2.5, lookBehind = 0.3): Note[] {
    return this.notes.filter(n =>
      !n.missed &&
      n.time >= songTime - lookBehind &&
      n.time <= songTime + lookAhead
    );
  }

  getStats(): BeatMapStats {
    const total    = this.notes.length;
    const perfects = this.notes.filter(n => n.accuracy === 'PERFECT').length;
    const goods    = this.notes.filter(n => n.accuracy === 'GOOD').length;
    const misses   = this.notes.filter(n => n.missed).length;
    const hit      = perfects + goods;
    const acc      = total > 0 ? Math.round((hit / total) * 100) : 0;

    return {
      totalNotes: total,
      perfects,
      goods,
      misses,
      maxCombo:   this._maxCombo,
      accuracy:   acc,
    };
  }

  get notes_all():  Note[]  { return this.notes; }
  get combo():      number  { return this._combo; }
  get maxCombo():   number  { return this._maxCombo; }
  get score():      number  { return this._score; }

  // ── Event listeners ──────────────────────────────────────────
  onHit(cb:  (result: HitResult) => void): void { this.onHitCallbacks.push(cb); }
  onMiss(cb: (note: Note)        => void): void { this.onMissCallbacks.push(cb); }

  reset(): void {
    this.notes    = [];
    this._combo   = 0;
    this._maxCombo = 0;
    this._score   = 0;
  }
}
