// ═══════════════════════════════════════════════════════════════
//  main.ts  —  Game Orchestrator
//  Wires all modules together and drives the main game loop.
// ═══════════════════════════════════════════════════════════════

import { AudioAnalyzer }        from './audio/AudioAnalyzer';
import { BeatMap }              from './game/BeatMap';
import { InputManager }         from './input/InputManager';
import { AnimationController }  from './animation/AnimationController';
import { CharacterController, FBXSlotDef, guessSlot } from './character/CharacterController';
import { Renderer }             from './render/Renderer';
import { UIController }         from './ui/UIController';
import { NoteDir }              from './game/BeatMap';
import { AnimSlot }             from './animation/AnimationController';

// ── Module instances ──────────────────────────────────────────
const audio   = new AudioAnalyzer();
const beatMap = new BeatMap();
const input   = new InputManager();
const animCtrl = new AnimationController({ perfectFade: 0.10, goodFade: 0.25 });
const renderer = new Renderer();
const ui       = new UIController();

// CharacterController is created after renderer so it has access to scene
let character: CharacterController;

// ── Loaded FBX slots (collected before game start) ────────────
const pendingFBX: Map<string, FBXSlotDef> = new Map();

// ── RAF handle ───────────────────────────────────────────────
let rafId = 0;

// ════════════════════════════════════════════════════════════════
//  SETUP
// ════════════════════════════════════════════════════════════════

function setup(): void {
  ui.init();
  ui.showStartScreen();
  bindStartScreenEvents();
  bindInputEvents();
}

// ════════════════════════════════════════════════════════════════
//  START SCREEN BINDINGS
// ════════════════════════════════════════════════════════════════

function bindStartScreenEvents(): void {
  // Music file upload
  const musicInput = document.getElementById('music-input') as HTMLInputElement;
  musicInput?.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    ui.setMusicStatus('Decoding…');
    try {
      audio.init();
      await audio.loadFile(file);
      ui.setMusicStatus(`✓ ${audio.songName} (${Math.floor(audio.duration)}s)`);
      ui.setSongInfo(audio.songName, audio.bpm);
      ui.setStartButtonEnabled(true);
    } catch {
      ui.setMusicStatus('✗ Failed to decode audio');
    }
  });

  // FBX slot uploads
  document.querySelectorAll<HTMLInputElement>('.fbx-slot input').forEach(input => {
    input.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const slotAttr = input.dataset.slot ?? '';
      const slot     = (slotAttr as AnimSlot) || guessSlot(file.name) || 'idle';
      const buffer   = await file.arrayBuffer();
      pendingFBX.set(slot, { slot: slot as AnimSlot, buffer, name: file.name });
      ui.markFBXSlotLoaded(slot, file.name);
    });
  });

  // Start button
  document.getElementById('start-btn')?.addEventListener('click', startGame);
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Enter') {
      const startScreen = document.getElementById('start-screen');
      if (startScreen && startScreen.style.display !== 'none' && audio.duration > 0) {
        startGame();
      }
    }
  });

  // Drag & drop onto start screen
  const startScreen = document.getElementById('start-screen')!;
  startScreen.addEventListener('dragover', e => e.preventDefault());
  startScreen.addEventListener('drop', handleDrop);
}

async function handleDrop(e: DragEvent): Promise<void> {
  e.preventDefault();
  const files = Array.from(e.dataTransfer?.files ?? []);
  for (const file of files) {
    const name = file.name.toLowerCase();
    if (/\.(mp3|wav|ogg|m4a|aac)$/.test(name)) {
      audio.init();
      await audio.loadFile(file);
      ui.setMusicStatus(`✓ ${audio.songName}`);
      ui.setSongInfo(audio.songName, audio.bpm);
      ui.setStartButtonEnabled(true);
    } else if (/\.(fbx|glb|gltf)$/.test(name)) {
      const buffer = await file.arrayBuffer();
      const slot   = guessSlot(file.name) ?? 'idle';
      pendingFBX.set(slot, { slot, buffer, name: file.name });
      ui.markFBXSlotLoaded(slot, file.name);
    }
  }
}

// ════════════════════════════════════════════════════════════════
//  INPUT BINDINGS
// ════════════════════════════════════════════════════════════════

function bindInputEvents(): void {
  input.init();
  input.on((evt) => {
    const dir = evt.action as NoteDir;
    if (!['left','right','up','down','special'].includes(dir)) {
      if (evt.action === 'pause') togglePause();
      return;
    }
    handleDanceInput(dir as NoteDir);
  });
}

function handleDanceInput(dir: NoteDir): void {
  if (!audio.isPlaying) return;

  const songTime = audio.currentTime;
  const result   = beatMap.tryHit(dir, songTime);

  if (result) {
    ui.showAccuracy(result.accuracy);
    ui.updateScore(beatMap.score, beatMap.combo);
    animCtrl.trigger(dir, result.accuracy);
    if (character.isFallbackMode) character.setProceduralState(dir);
    if (result.accuracy === 'PERFECT') renderer.triggerCameraShake(0.06);
  } else {
    // Free-play — still animate, no score
    animCtrl.trigger(dir, 'GOOD');
    if (character.isFallbackMode) character.setProceduralState(dir);
  }

  ui.flashKey(dir, true);
  setTimeout(() => ui.flashKey(dir, false), 150);
}

// ════════════════════════════════════════════════════════════════
//  START GAME
// ════════════════════════════════════════════════════════════════

async function startGame(): Promise<void> {
  ui.hideStartScreen();
  ui.showLoadingScreen();
  ui.setLoadingProgress('Initialising renderer…', 5);

  // Init THREE scene
  renderer.init({ container: document.getElementById('canvas-container')! });
  character = new CharacterController(renderer.scene, animCtrl);

  // Load character & animations
  await character.loadFBXSlots(
    Array.from(pendingFBX.values()),
    (msg, pct) => ui.setLoadingProgress(msg, pct)
  );

  animCtrl.setBPM(audio.bpm);
  renderer.setBPM(audio.bpm);
  ui.setSongInfo(audio.songName, audio.bpm);
  ui.setLoadingProgress('Generating beat map…', 92);

  // Generate beat map
  beatMap.generate(audio.duration, audio.bpm);

  // Beat map callbacks
  beatMap.onMiss((note) => {
    ui.showAccuracy('MISS');
    ui.flashMissKey(note.dir as NoteDir);
    ui.updateScore(beatMap.score, beatMap.combo);
    if (character.isFallbackMode) character.setProceduralState('idle');
    animCtrl.returnToIdle(0.2);
  });

  // Audio beat callbacks
  audio.onBeat((evt) => {
    ui.triggerBeatFlash();
    renderer.onBeat(evt.energy);
    animCtrl.onBeat(evt.energy);
  });

  // Animation state change
  animCtrl.setOnStateChange((_, slot) => {
    ui.setAnimLabel(slot);
  });

  ui.setLoadingProgress('Ready!', 100);
  await delay(400);

  ui.hideLoadingScreen();
  ui.showGameUI();

  // Start playback
  audio.play();
  input.enable();

  // Kick render loop
  gameLoop();
}

// ════════════════════════════════════════════════════════════════
//  GAME LOOP
// ════════════════════════════════════════════════════════════════

function gameLoop(): void {
  rafId = requestAnimationFrame(gameLoop);

  const delta    = renderer.clock.getDelta();
  const songTime = audio.currentTime;

  // Module updates
  audio.update(delta);
  animCtrl.update(delta);
  beatMap.update(songTime);

  // Fallback procedural animation
  if (character.isFallbackMode) {
    character.updateFallback(delta, audio.bpm);
  }

  // UI note lane
  ui.updateNotes(beatMap.notes_all, songTime);

  // Progress bar
  if (audio.duration > 0) {
    ui.setProgress((songTime / audio.duration) * 100);
  }

  // Render scene
  renderer.tick(delta, audio.isPlaying);
}

// ════════════════════════════════════════════════════════════════
//  PAUSE
// ════════════════════════════════════════════════════════════════

let paused = false;
function togglePause(): void {
  if (paused) {
    audio.play();
    input.enable();
    gameLoop();
  } else {
    audio.pause();
    input.disable();
    cancelAnimationFrame(rafId);
  }
  paused = !paused;
}

// ── Utility ───────────────────────────────────────────────────
function delay(ms: number): Promise<void> {
  return new Promise(res => setTimeout(res, ms));
}

// ════════════════════════════════════════════════════════════════
//  BOOT
// ════════════════════════════════════════════════════════════════
setup();
