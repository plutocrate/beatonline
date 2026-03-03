// ═══════════════════════════════════════════════════════════════
//  audio/AudioAnalyzer.ts
//  Handles: audio decoding, BPM detection, real-time FFT analysis,
//           beat detection callbacks, playback control
// ═══════════════════════════════════════════════════════════════

export interface BeatEvent {
  time: number;
  energy: number;
}

export type BeatCallback   = (event: BeatEvent) => void;
export type LoadedCallback = (bpm: number, duration: number, name: string) => void;

export class AudioAnalyzer {
  private ctx!: AudioContext;
  private analyser!: AnalyserNode;
  private source!: AudioBufferSourceNode | null;
  private buffer!: AudioBuffer | null;

  private startTime    = 0;
  private pauseOffset  = 0;
  private _isPlaying   = false;
  private _bpm         = 120;
  private _duration    = 0;
  private _songName    = '';

  // Beat detection state
  private freqData!:      Uint8Array;
  private prevEnergy      = 0;
  private beatCooldown    = 0;
  private readonly BEAT_THRESHOLD_MULT = 1.5;
  private readonly BEAT_MIN_INTERVAL   = 0.25; // seconds between beats

  // Callbacks
  private onBeatCallbacks:   BeatCallback[]   = [];
  private onLoadedCallbacks: LoadedCallback[] = [];

  // ── Initialise ──────────────────────────────────────────────
  init(): void {
    this.ctx      = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize        = 256;
    this.analyser.smoothingTimeConstant = 0.8;
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.connect(this.ctx.destination);
  }

  // ── Load from File ──────────────────────────────────────────
  async loadFile(file: File): Promise<void> {
    if (!this.ctx) this.init();
    this._songName = file.name.replace(/\.[^.]+$/, '');

    const arrayBuffer = await file.arrayBuffer();
    this.buffer       = await this.ctx.decodeAudioData(arrayBuffer.slice(0));
    this._duration    = this.buffer.duration;
    this._bpm         = await this.detectBPM(this.buffer);

    this.pauseOffset = 0;
    this.onLoadedCallbacks.forEach(cb => cb(this._bpm, this._duration, this._songName));
  }

  // ── Load from URL (for music/ folder assets) ─────────────────
  async loadURL(url: string): Promise<void> {
    if (!this.ctx) this.init();
    const name = url.split('/').pop() ?? url;
    this._songName = name.replace(/\.[^.]+$/, '');

    const res         = await fetch(url);
    const arrayBuffer = await res.arrayBuffer();
    this.buffer       = await this.ctx.decodeAudioData(arrayBuffer);
    this._duration    = this.buffer.duration;
    this._bpm         = await this.detectBPM(this.buffer);

    this.pauseOffset = 0;
    this.onLoadedCallbacks.forEach(cb => cb(this._bpm, this._duration, this._songName));
  }

  // ── Playback ────────────────────────────────────────────────
  play(): void {
    if (!this.buffer || this._isPlaying) return;
    if (!this.ctx) this.init();

    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.connect(this.analyser);
    this.startTime  = this.ctx.currentTime - this.pauseOffset;
    this.source.start(0, this.pauseOffset);
    this._isPlaying = true;

    this.source.onended = () => {
      if (this._isPlaying) {
        this.pauseOffset = 0;
        this._isPlaying  = false;
      }
    };
  }

  pause(): void {
    if (!this._isPlaying || !this.source) return;
    this.pauseOffset = this.currentTime;
    try { this.source.stop(); } catch (_) {}
    this.source     = null;
    this._isPlaying = false;
  }

  stop(): void {
    this.pause();
    this.pauseOffset = 0;
  }

  seek(time: number): void {
    const wasPlaying = this._isPlaying;
    this.pause();
    this.pauseOffset = Math.max(0, Math.min(time, this._duration));
    if (wasPlaying) this.play();
  }

  // ── Per-frame update (call from render loop) ─────────────────
  update(delta: number): void {
    if (!this._isPlaying) return;

    this.beatCooldown = Math.max(0, this.beatCooldown - delta);
    this.analyser.getByteFrequencyData(this.freqData);

    // Bass energy (bins 0-4 ≈ 0–430 Hz)
    let energy = 0;
    for (let i = 0; i < 5; i++) energy += this.freqData[i];
    energy /= 5 * 255;

    const delta_energy = energy - this.prevEnergy;
    if (
      delta_energy > 0 &&
      energy > this.prevEnergy * this.BEAT_THRESHOLD_MULT &&
      this.beatCooldown === 0 &&
      energy > 0.15
    ) {
      this.beatCooldown = this.BEAT_MIN_INTERVAL;
      const event: BeatEvent = { time: this.currentTime, energy };
      this.onBeatCallbacks.forEach(cb => cb(event));
    }

    this.prevEnergy = energy;
  }

  // ── Frequency helpers ────────────────────────────────────────
  /** Returns bass energy 0–1 */
  getBassEnergy(): number {
    this.analyser.getByteFrequencyData(this.freqData);
    let sum = 0;
    for (let i = 0; i < 5; i++) sum += this.freqData[i];
    return sum / (5 * 255);
  }

  /** Returns full frequency array (0–255 each bin) */
  getFrequencyData(): Uint8Array {
    this.analyser.getByteFrequencyData(this.freqData);
    return this.freqData;
  }

  // ── BPM Detection ────────────────────────────────────────────
  private async detectBPM(buffer: AudioBuffer): Promise<number> {
    const offlineCtx = new OfflineAudioContext(
      1,
      buffer.length,
      buffer.sampleRate
    );
    const src    = offlineCtx.createBufferSource();
    src.buffer   = buffer;
    const filter = offlineCtx.createBiquadFilter();
    filter.type            = 'lowpass';
    filter.frequency.value = 200;

    src.connect(filter);
    filter.connect(offlineCtx.destination);
    src.start(0);

    const rendered   = await offlineCtx.startRendering();
    const data       = rendered.getChannelData(0);
    const sampleRate = rendered.sampleRate;
    const winSize    = Math.floor(sampleRate * 0.01);
    const energies: number[] = [];

    for (let i = 0; i < data.length - winSize; i += winSize) {
      let e = 0;
      for (let j = 0; j < winSize; j++) e += data[i + j] ** 2;
      energies.push(e / winSize);
    }

    const avg       = energies.reduce((a, b) => a + b, 0) / energies.length;
    const threshold = avg * 3;
    const minDist   = Math.floor(0.3 * (sampleRate / winSize));
    const peaks: number[] = [];

    for (let i = 1; i < energies.length - 1; i++) {
      if (
        energies[i] > threshold &&
        energies[i] > energies[i - 1] &&
        energies[i] > energies[i + 1] &&
        (peaks.length === 0 || i - peaks[peaks.length - 1] > minDist)
      ) {
        peaks.push(i);
      }
    }

    if (peaks.length < 4) return 120;

    const intervals: number[] = [];
    for (let i = 1; i < Math.min(peaks.length, 50); i++) {
      intervals.push(peaks[i] - peaks[i - 1]);
    }

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    let bpm = Math.round(60 / (avgInterval * winSize / sampleRate));

    // Octave correction
    while (bpm < 60)  bpm *= 2;
    while (bpm > 200) bpm /= 2;

    return Math.max(60, Math.min(200, bpm));
  }

  // ── Event listeners ──────────────────────────────────────────
  onBeat(cb: BeatCallback):     void { this.onBeatCallbacks.push(cb); }
  onLoaded(cb: LoadedCallback): void { this.onLoadedCallbacks.push(cb); }

  // ── Getters ──────────────────────────────────────────────────
  get currentTime(): number {
    if (!this.ctx || !this._isPlaying) return this.pauseOffset;
    return this.ctx.currentTime - this.startTime;
  }
  get isPlaying():  boolean { return this._isPlaying; }
  get bpm():        number  { return this._bpm; }
  get duration():   number  { return this._duration; }
  get songName():   string  { return this._songName; }
  get audioCtx():   AudioContext { return this.ctx; }
}
