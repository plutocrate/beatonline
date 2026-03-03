'use strict';
// ═══════════════════════════════════════════════════════════════
//  BEAT DANCER — Phase 2   dist/bundle.js
//  New in this build:
//   • Tighter timing windows (PERFECT ±65ms, GOOD ±140ms)
//   • Early/Late press = score PENALTY + "EARLY!" / "LATE!" text
//   • Presses outside any window = PENALTY (score goes down)
//   • Camera REWARD: zoom + orbit swing on PERFECT, tilt on GOOD
//   • Miss JERK: violent camera slam + red vignette + stumble anim
//   • Background color shifts with combo level
// ═══════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────
//  TIMING WINDOWS  (seconds, ±)
// ─────────────────────────────────────────────────────────────
const WIN_PERFECT = 0.065;   // ±65ms
const WIN_GOOD    = 0.140;   // ±140ms
// Anything outside WIN_GOOD but within this range = EARLY/LATE penalty
const WIN_PENALTY = 0.320;   // ±320ms — if you press here, score drops

const SCORE_PERFECT = 300;
const SCORE_GOOD    = 100;
const SCORE_PENALTY = -80;   // wrong-window press deduction

// ─────────────────────────────────────────────────────────────
//  SLOT META
// ─────────────────────────────────────────────────────────────
const SLOT_META = {
  idle:    { key:'IDL', label:'Idle' },
  left:    { key:'←',   label:'← Left' },
  right:   { key:'→',   label:'→ Right' },
  up:      { key:'↑',   label:'↑ Up' },
  down:    { key:'↓',   label:'↓ Down' },
  special: { key:'SPC', label:'Special' },
  extra1:  { key:'E1',  label:'Extra 1' },
  extra2:  { key:'E2',  label:'Extra 2' },
  extra3:  { key:'E3',  label:'Extra 3' },
  extra4:  { key:'E4',  label:'Extra 4' },
  extra5:  { key:'E5',  label:'Extra 5' },
  extra6:  { key:'E6',  label:'Extra 6' },
};

// ─────────────────────────────────────────────────────────────
//  GLOBAL STATE
// ─────────────────────────────────────────────────────────────
const G = {
  score: 0, combo: 0, maxCombo: 0, hp: 100,   // hp = health bar, 0–100
  bpm: 120, songName: '—', songDuration: 0, isPlaying: false,
  loadedAnimBuffers: {},
  audioBuffer: null,
  selectedTrackURL: null,
  selectedTrackFile: null,
};

// ─────────────────────────────────────────────────────────────
//  CAMERA STATE MACHINE
//  Tracks the current camera "mode" and smoothly interpolates
// ─────────────────────────────────────────────────────────────
const CAM = {
  // base position
  baseX: 0, baseY: 1.6, baseZ: 4.5,
  // current actual position (lerped toward target)
  x: 0, y: 1.6, z: 4.5,
  // target
  tx: 0, ty: 1.6, tz: 4.5,
  // look-at target (lerped)
  lookX: 0, lookY: 1.0, lookZ: 0,
  tlookX: 0, tlookY: 1.0, tlookZ: 0,
  // shake (additive, decays)
  shakeX: 0, shakeY: 0, shakeZ: 0,
  shakeDecay: 0.85,
  // orbit angle (for PERFECT reward swing)
  orbitAngle: 0,
  orbitSpeed: 0,
  orbitRadius: 0,
  orbitDecay: 0.94,
  // zoom (lerped)
  fovTarget: 55,
  fovCurrent: 55,
  // roll (for miss jerk)
  roll: 0,
  rollTarget: 0,
  rollDecay: 0.88,
  // beat bob
  beatBob: 0,
  lerpSpeed: 6.0,
};

// ─────────────────────────────────────────────────────────────
//  AUDIO ENGINE
// ─────────────────────────────────────────────────────────────
let audioCtx = null, audioSrc = null, analyserNode = null;
let audioStartTime = 0, audioPauseOffset = 0;
let _freqData = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
async function decodeAudio(ab) { return getAudioCtx().decodeAudioData(ab); }

async function startAudio() {
  if (!G.audioBuffer || G.isPlaying) return;
  const ctx = getAudioCtx();
  if (ctx.state === 'suspended') await ctx.resume();
  if (audioSrc) { try { audioSrc.stop(); } catch(e){} try { audioSrc.disconnect(); } catch(e){} audioSrc = null; }
  analyserNode = ctx.createAnalyser();
  analyserNode.fftSize = 512;
  analyserNode.smoothingTimeConstant = 0.75;
  analyserNode.connect(ctx.destination);
  audioSrc = ctx.createBufferSource();
  audioSrc.buffer = G.audioBuffer;
  audioSrc.connect(analyserNode);
  audioStartTime = ctx.currentTime - audioPauseOffset;
  audioSrc.start(0, audioPauseOffset);
  G.isPlaying = true;
  audioSrc.onended = () => { if (G.isPlaying) { audioPauseOffset = G.songDuration || 999; G.isPlaying = false; } };
}

function getSongTime() {
  if (!audioCtx || !G.isPlaying) return audioPauseOffset;
  return audioCtx.currentTime - audioStartTime;
}

function getFreqBand(lo, hi) {
  if (!analyserNode) return 0;
  if (!_freqData) _freqData = new Uint8Array(analyserNode.frequencyBinCount);
  analyserNode.getByteFrequencyData(_freqData);
  const nyq = audioCtx.sampleRate / 2;
  const bins = _freqData.length;
  const iLo = Math.floor((lo / nyq) * bins);
  const iHi = Math.floor((hi / nyq) * bins);
  let s = 0, c = 0;
  for (let i = iLo; i <= iHi && i < bins; i++) { s += _freqData[i]; c++; }
  return c > 0 ? s / (c * 255) : 0;
}

function getBassEnergy()   { return getFreqBand(20,  200); }
function getMidEnergy()    { return getFreqBand(200, 2000); }
function getHighEnergy()   { return getFreqBand(2000,8000); }

async function detectBPM(buffer) {
  const sr = buffer.sampleRate;
  // Only analyze first 30s — enough for accurate BPM, 10x faster for long tracks
  const analyzeSecs = Math.min(30, buffer.duration);
  const analyzeLen  = Math.floor(analyzeSecs * sr);
  const offline = new OfflineAudioContext(1, analyzeLen, sr);
  const src = offline.createBufferSource();
  // Create a short copy so we don't hold the full buffer reference
  const shortBuf = offline.createBuffer(1, analyzeLen, sr);
  shortBuf.copyToChannel(buffer.getChannelData(0).subarray(0, analyzeLen), 0);
  src.buffer = shortBuf;
  const f = offline.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 200;
  src.connect(f); f.connect(offline.destination); src.start(0);
  const rendered = await offline.startRendering();
  const data = rendered.getChannelData(0);
  const win = Math.floor(sr * 0.01);
  const energies = [];
  for (let i = 0; i < data.length - win; i += win) {
    let e = 0; for (let j = 0; j < win; j++) e += data[i+j] ** 2;
    energies.push(e / win);
  }
  const avg = energies.reduce((a,b)=>a+b,0) / energies.length;
  const thr = avg * 3, minD = Math.floor(0.3*(sr/win));
  const peaks = [];
  for (let i = 1; i < energies.length-1; i++) {
    if (energies[i]>thr && energies[i]>energies[i-1] && energies[i]>energies[i+1]
        && (peaks.length===0||i-peaks[peaks.length-1]>minD)) peaks.push(i);
  }
  if (peaks.length<4) return 120;
  const intervals = [];
  for (let i=1; i<Math.min(peaks.length,50); i++) intervals.push(peaks[i]-peaks[i-1]);
  const avgI = intervals.reduce((a,b)=>a+b,0)/intervals.length;
  let bpm = Math.round(60/(avgI*win/sr));
  while (bpm<60) bpm*=2; while (bpm>200) bpm/=2;
  return Math.max(60, Math.min(200, bpm));
}

// ─────────────────────────────────────────────────────────────
//  BEAT MAP
// ─────────────────────────────────────────────────────────────
let beatMap = [], noteIdCtr = 0;

function generateBeatMap(duration, bpm) {
  beatMap = []; noteIdCtr = 0;
  const beat = 60 / bpm;
  const dirs = ['left','right','up','down'];
  let prev = null;
  for (let t = beat * 3; t < duration - 2; t += beat) {
    if (Math.random() < 0.22) continue;
    let dir; do { dir = dirs[Math.floor(Math.random() * dirs.length)]; } while (dir === prev);
    prev = dir;
    beatMap.push({ id: noteIdCtr++, time: t, dir, hit: false, missed: false });
  }
}

// Returns: { accuracy:'PERFECT'|'GOOD', note } | { penalty:'EARLY'|'LATE' } | null
function tryHit(dir, songTime) {
  let best = null, bestDiff = Infinity;
  for (const n of beatMap) {
    if (n.hit || n.missed || n.dir !== dir) continue;
    const d = Math.abs(n.time - songTime);
    if (d < bestDiff) { bestDiff = d; best = n; }
  }

  if (!best) {
    // No note at all of this direction upcoming → heavy penalty
    applyPenalty();
    return { penalty: 'GHOST' };
  }

  const diff = songTime - best.time; // positive = late, negative = early

  if (Math.abs(diff) <= WIN_PERFECT) {
    best.hit = true;
    G.combo++;
    if (G.combo > G.maxCombo) G.maxCombo = G.combo;
    const mult = Math.min(8, 1 + G.combo * 0.12);
    G.score = Math.max(0, G.score + Math.round(SCORE_PERFECT * mult));
    G.hp = Math.min(100, G.hp + 3);
    return { accuracy: 'PERFECT', note: best };
  }

  if (Math.abs(diff) <= WIN_GOOD) {
    best.hit = true;
    G.combo++;
    if (G.combo > G.maxCombo) G.maxCombo = G.combo;
    const mult = Math.min(4, 1 + G.combo * 0.06);
    G.score = Math.max(0, G.score + Math.round(SCORE_GOOD * mult));
    G.hp = Math.min(100, G.hp + 1);
    return { accuracy: 'GOOD', note: best };
  }

  // Within penalty window — pressed too early or too late
  if (Math.abs(diff) <= WIN_PENALTY) {
    applyPenalty();
    return { penalty: diff < 0 ? 'EARLY' : 'LATE' };
  }

  // Way outside — ghost press
  applyPenalty();
  return { penalty: 'GHOST' };
}

function applyPenalty() {
  G.score  = Math.max(0, G.score + SCORE_PENALTY);
  G.combo  = 0;
  G.hp     = Math.max(0, G.hp - 8);
}

function updateBeatMap(songTime) {
  for (const n of beatMap) {
    if (!n.hit && !n.missed && songTime - n.time > WIN_GOOD + 0.08) {
      n.missed = true;
      onMissNote(n.dir);
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  THREE.JS SCENE
// ─────────────────────────────────────────────────────────────
let renderer3, scene, camera, clock3;
let beatLight, fillLight2, bgParticles, stageRing, floorMesh;
let character = null, mixer = null, animActions = {}, currentAction = null;
let beatLightIntensity = 0;
// Background color target (shifts with combo)
let bgColorTarget = new THREE.Color(0x050508);
let bgColorCurrent = new THREE.Color(0x050508);

function initThree() {
  // Guard: reuse renderer on restart, only rebuild scene objects
  if (renderer3) {
    if (scene) { while (scene.children.length > 0) scene.remove(scene.children[0]); }
    bgColorCurrent.set(0x050508);
    bgColorTarget.set(0x050508);
    buildScene();
    return;
  }
  renderer3 = new THREE.WebGLRenderer({ antialias: true });
  renderer3.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer3.setSize(window.innerWidth, window.innerHeight);
  renderer3.shadowMap.enabled = true;
  renderer3.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer3.outputEncoding = THREE.sRGBEncoding;
  renderer3.toneMapping = THREE.ACESFilmicToneMapping;
  renderer3.toneMappingExposure = 1.2;
  document.getElementById('canvas-container').appendChild(renderer3.domElement);
  scene = new THREE.Scene();
  scene.background = bgColorCurrent;
  scene.fog = new THREE.FogExp2(bgColorCurrent, 0.032);
  camera = new THREE.PerspectiveCamera(55, window.innerWidth/window.innerHeight, 0.1, 200);
  camera.position.set(0, 1.6, 4.5);
  camera.lookAt(0, 1, 0);
  clock3 = new THREE.Clock();
  window.addEventListener('resize', () => {
    renderer3.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
  });
  buildScene();
}

function buildScene() {
  floorMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.MeshStandardMaterial({ color: 0x0a0a12, metalness: 0.7, roughness: 0.35 })
  );
  floorMesh.rotation.x = -Math.PI/2; floorMesh.receiveShadow = true; scene.add(floorMesh);
  scene.add(new THREE.GridHelper(30, 30, 0x1a1a2e, 0x1a1a2e));

  const stage = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 1.6, 0.08, 32),
    new THREE.MeshStandardMaterial({ color: 0x1a0a2e, metalness: 0.8, roughness: 0.2 })
  );
  stage.position.y = 0.01; stage.receiveShadow = true; scene.add(stage);

  stageRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.6, 0.045, 8, 64),
    new THREE.MeshStandardMaterial({ color: 0xff2d78, emissive: new THREE.Color(0xff2d78), emissiveIntensity: 2.5 })
  );
  stageRing.rotation.x = Math.PI/2; stageRing.position.y = 0.055; scene.add(stageRing);

  scene.add(new THREE.AmbientLight(0x111122, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 0.8);
  key.position.set(2, 5, 3); key.castShadow = true;
  key.shadow.mapSize.width = key.shadow.mapSize.height = 1024;
  scene.add(key);

  beatLight = new THREE.PointLight(0xff2d78, 0, 5);
  beatLight.position.set(0, 0.6, 0); scene.add(beatLight);

  // Second reward light (accent2 color, triggered on PERFECT)
  fillLight2 = new THREE.PointLight(0x00f5d4, 0, 6);
  fillLight2.position.set(0, 3, 0); scene.add(fillLight2);

  const fill = new THREE.DirectionalLight(0x00f5d4, 0.3);
  fill.position.set(-3, 3, -2); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffe600, 0.4);
  rim.position.set(0, 4, -4); scene.add(rim);

  // Particles
  const cnt = 600, pos = new Float32Array(cnt*3);
  for (let i=0; i<cnt; i++) {
    pos[i*3]=(Math.random()-.5)*50; pos[i*3+1]=Math.random()*18; pos[i*3+2]=(Math.random()-.5)*50;
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  bgParticles = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0x334466, size: 0.065, transparent: true, opacity: 0.55 }));
  scene.add(bgParticles);
}

// ── Fallback block character ──────────────────────────────────
let fbParts = {};
function buildFallbackChar() {
  const g = new THREE.Group();
  const bm = new THREE.MeshStandardMaterial({ color: 0x2a2a4a, metalness: 0.3, roughness: 0.6 });
  const am = new THREE.MeshStandardMaterial({ color: 0xff2d78, emissive: new THREE.Color(0xff2d78), emissiveIntensity: 0.6 });
  const em = new THREE.MeshStandardMaterial({ color: 0x00f5d4, emissive: new THREE.Color(0x00f5d4), emissiveIntensity: 1 });
  const mk = (geo, mat, x, y, z, name) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x,y,z); m.castShadow = true;
    g.add(m); fbParts[name] = m; return m;
  };
  mk(new THREE.BoxGeometry(0.5,0.65,0.25), bm, 0, 1.15, 0, 'torso');
  mk(new THREE.SphereGeometry(0.2,16,16),  bm, 0, 1.65, 0, 'head');
  mk(new THREE.SphereGeometry(0.04,8,8),   em,-0.07,1.68,0.18,'eyeL');
  mk(new THREE.SphereGeometry(0.04,8,8),   em, 0.07,1.68,0.18,'eyeR');
  mk(new THREE.BoxGeometry(0.15,0.5,0.15), bm,-0.35,1.05,0,'armL');
  mk(new THREE.BoxGeometry(0.15,0.5,0.15), bm, 0.35,1.05,0,'armR');
  mk(new THREE.BoxGeometry(0.2,0.55,0.2),  bm,-0.14,0.55,0,'legL');
  mk(new THREE.BoxGeometry(0.2,0.55,0.2),  bm, 0.14,0.55,0,'legR');
  mk(new THREE.BoxGeometry(0.52,0.05,0.27),am, 0, 1.38, 0,'strip');
  g.position.y = 0.05; scene.add(g);
  character = g; character._isFallback = true; character._proc = { type:'idle', t:0 };
}

function parseFBX(buffer) {
  return new Promise((res, rej) => {
    try { res(new THREE.FBXLoader().parse(buffer, '')); } catch(e) { rej(e); }
  });
}

async function loadCharacterAndAnims() {
  // Only use selected anim slots (or all if none selected)
  const allSlots = Object.keys(G.loadedAnimBuffers);
  const slots = selectedAnimSlots.size > 0
    ? allSlots.filter(s => selectedAnimSlots.has(s))
    : allSlots;
  if (slots.length === 0) { buildFallbackChar(); return; }
  const primarySlot = slots.includes('idle') ? 'idle' : slots[0];
  try {
    setLoadingUI('Loading character model…', 15);
    const fbx = await parseFBX(G.loadedAnimBuffers[primarySlot]);
    fbx.scale.setScalar(0.01); fbx.position.set(0, 0.05, 0);
    fbx.traverse(c => {
      if (c.isMesh) {
        c.castShadow = c.receiveShadow = true;
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        mats.forEach(m => { if (m.roughness !== undefined) { m.roughness = 0.65; m.metalness = 0.12; } });
      }
    });
    scene.add(fbx);
    character = fbx; character._isFBX = true;
    mixer = new THREE.AnimationMixer(character);
    if (fbx.animations && fbx.animations.length > 0) {
      const clip = fbx.animations[0]; clip.name = primarySlot;
      const action = mixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.clampWhenFinished = false;
      animActions[primarySlot] = action;
    }
  } catch(e) { console.warn('Base FBX failed, using fallback:', e); buildFallbackChar(); return; }

  // Parse all remaining FBX files in parallel — much faster than sequential
  const remainingSlots = slots.filter(s => s !== primarySlot);
  setLoadingUI(`Parsing ${remainingSlots.length} animations in parallel…`, 20);
  const parseResults = await Promise.allSettled(
    remainingSlots.map(slot =>
      parseFBX(G.loadedAnimBuffers[slot]).then(fbx => ({ slot, fbx }))
    )
  );
  let done = 1;
  for (const result of parseResults) {
    if (result.status === 'fulfilled') {
      const { slot, fbx } = result.value;
      if (fbx.animations && fbx.animations.length > 0) {
        const clip = fbx.animations[0]; clip.name = slot;
        const action = mixer.clipAction(clip);
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.clampWhenFinished = false;
        animActions[slot] = action;
      }
    } else {
      console.warn(`Anim load failed:`, result.reason);
    }
    done++;
    setLoadingUI(`Loaded ${done}/${slots.length} animations…`, 20 + Math.round((done/slots.length)*60));
  }

  const startSlot = animActions['idle'] ? 'idle' : Object.keys(animActions)[0];
  if (startSlot) {
    // Queue system: listen for finished events to chain animations
    animQueue = Object.keys(animActions);
    animQueueIdx = 0;
    _clipStartTime = 0; _animClock = 0;
    playAnimSlot(animQueue[0]);
  }
}

// ── Time-driven animation playlist ──────────────────────────
// Clips cycle 1->2->3->4->1... driven by elapsed time every frame.
// No finished events - bulletproof looping for any number of clips.
let animQueue    = [];
let animQueueIdx = 0;
let animPending  = null;
let animWaiting  = false;
let _clipStartTime = 0;
let _animClock     = 0;
const CROSSFADE    = 0.35;

function playAnimSlot(slot, fade) {
  if (!mixer) return;
  const target = animActions[slot];
  if (!target) return;
  const ft   = (fade !== undefined) ? fade : CROSSFADE;
  const prev = currentAction;
  target.stop();
  target.reset();
  target.setEffectiveTimeScale(1);
  target.setEffectiveWeight(1);
  target.clampWhenFinished = false;
  target.play();
  if (prev && prev !== target) {
    prev.crossFadeTo(target, ft, false);
  }
  currentAction  = target;
  _clipStartTime = _animClock;
  const label = slot.toUpperCase().replace(/_/g, ' ');
  qs('#anim-label').textContent = label;
  qs('#dance-mode').textContent  = label;
}

function tickAnimPlaylist(delta) {
  if (!mixer || animQueue.length === 0 || !currentAction) return;
  _animClock += delta;
  const clip  = currentAction._clip;
  if (!clip) return;
  const dur     = clip.duration;
  const elapsed = _animClock - _clipStartTime;
  const switchAt = Math.max(dur - CROSSFADE, dur * 0.5);
  if (elapsed >= switchAt) {
    const nextIdx = (animQueueIdx + 1) % animQueue.length;
    animQueueIdx  = nextIdx;
    playAnimSlot(animQueue[nextIdx], CROSSFADE);
  }
}

function onAnimFinished(e) {}
function scheduleNextAnim(s) {}
let _idleTimer = null;
function transitionTo(slot, fade) {}
function returnToIdle() {}

// Procedural stumble for miss
function triggerStumble() {
  if (character && character._isFBX) {
    // quick stumble: lurch forward, snap back
    let t = 0;
    const stumble = () => {
      t += 0.06;
      character.rotation.x = Math.sin(t * 8) * 0.15 * Math.exp(-t * 2);
      character.rotation.z = Math.sin(t * 6) * 0.12 * Math.exp(-t * 2);
      if (t < 1.5) requestAnimationFrame(stumble);
      else { character.rotation.x = 0; character.rotation.z = 0; }
    };
    stumble();
  }
  if (character && character._isFallback) {
    character._proc.type = 'stumble'; character._proc.t = 0;
  }
}

// ── Fallback procedural ───────────────────────────────────────
function animateFallback(delta) {
  if (!character || !character._isFallback) return;
  const p = fbParts, s = character._proc;
  s.t += delta;
  const bp = s.t * (G.bpm/60) * Math.PI * 2;
  switch (s.type) {
    case 'idle':
      p.torso.rotation.z=Math.sin(bp*.5)*.03; p.torso.position.y=1.15+Math.sin(bp)*.02;
      p.head.rotation.y=Math.sin(bp*.3)*.1; p.head.position.y=1.65+Math.sin(bp)*.02;
      p.armL.rotation.z=-.15+Math.sin(bp*.5)*.05; p.armR.rotation.z=.15-Math.sin(bp*.5)*.05;
      p.legL.rotation.x=Math.sin(bp*.5)*.03; p.legR.rotation.x=-Math.sin(bp*.5)*.03; break;
    case 'left':
      character.position.x=Math.sin(Math.min(s.t*4,Math.PI*.5))*-.4;
      p.torso.rotation.z=.15; p.armL.rotation.z=-.6-Math.sin(s.t*4)*.3; p.armR.rotation.z=.6+Math.sin(s.t*4)*.3;
      p.legL.rotation.x=Math.sin(s.t*4)*.4; p.legR.rotation.x=-Math.sin(s.t*4)*.4; break;
    case 'right':
      character.position.x=Math.sin(Math.min(s.t*4,Math.PI*.5))*.4;
      p.torso.rotation.z=-.15; p.armR.rotation.z=.6+Math.sin(s.t*4)*.3; p.armL.rotation.z=-.6-Math.sin(s.t*4)*.3;
      p.legL.rotation.x=-Math.sin(s.t*4)*.4; p.legR.rotation.x=Math.sin(s.t*4)*.4; break;
    case 'up':
      character.position.y=.05+Math.sin(Math.min(s.t*3,Math.PI))*.6;
      p.armL.rotation.z=-1.2; p.armR.rotation.z=1.2;
      p.legL.rotation.x=p.legR.rotation.x=-Math.sin(s.t*3)*.5; break;
    case 'down':
      p.torso.position.y=1.0-Math.sin(Math.min(s.t*4,Math.PI))*.2;
      p.legL.rotation.x=p.legR.rotation.x=.4; p.armL.rotation.x=p.armR.rotation.x=.3; break;
    case 'stumble':
      p.torso.rotation.z=Math.sin(s.t*12)*.25*Math.exp(-s.t*3);
      p.head.rotation.z=Math.sin(s.t*10)*.2*Math.exp(-s.t*3);
      p.armL.rotation.x=Math.sin(s.t*8)*.5; p.armR.rotation.x=Math.sin(s.t*8+1)*.5;
      if (s.t > 0.9) s.type = 'idle'; break;
  }
  if (s.type !== 'up')    character.position.y += (.05-character.position.y)*.07;
  if (s.type !== 'left' && s.type !== 'right') character.position.x += (0-character.position.x)*.07;
}

// ─────────────────────────────────────────────────────────────
//  CAMERA REWARD / PUNISHMENT TRIGGERS
// ─────────────────────────────────────────────────────────────

// ── Camera Panning System ────────────────────────────────────
// Pan to new angle on every right hit. Smooth lerp always.
// PERFECT = full pan, GOOD = subtle half-pan, combo×5 = heavy cinematic.
const PAN_ANGLES = [
  // [x, y, z, lookY]  — wide dramatic angles, clearly visible
  [ 3.5,  1.4, 4.0,  1.1],   // hard right low
  [-3.5,  1.4, 4.0,  1.1],   // hard left low
  [ 0,    3.8, 4.5,  0.7],   // high overhead
  [ 0,    0.6, 3.0,  1.6],   // ground level close
  [ 4.5,  2.2, 2.5,  1.0],   // side right elevated
  [-4.5,  2.2, 2.5,  1.0],   // side left elevated
  [ 2.0,  0.8, 2.8,  1.4],   // low-right close
  [-2.0,  0.8, 2.8,  1.4],   // low-left close
  [ 0,    2.0, 2.2,  1.2],   // front close
  [ 3.0,  3.0, 3.5,  0.9],   // diagonal high right
  [-3.0,  3.0, 3.5,  0.9],   // diagonal high left
];
const COMBO_ANGLES = [
  // More extreme — reserved for combo milestones
  [ 5.5,  1.2, 2.5,  1.2],   // extreme right close
  [-5.5,  1.2, 2.5,  1.2],   // extreme left close
  [ 0,    5.0, 3.0,  0.4],   // top-down dramatic
  [ 0,    0.3, 1.8,  1.8],   // floor-level worm cam
  [ 4.0,  3.5, 2.0,  0.8],   // diagonal dramatic right
  [-4.0,  3.5, 2.0,  0.8],   // diagonal dramatic left
];
const PAN = { tx:0, ty:1.6, tz:4.5, tlookY:1.0, cx:0, cy:1.6, cz:4.5, clookY:1.0, speed:0.04, lastIdx:0, comboIdx:0 };

function setPanTarget(angle, speed) {
  PAN.tx=angle[0]; PAN.ty=angle[1]; PAN.tz=angle[2]; PAN.tlookY=angle[3]; PAN.speed=speed;
}

function onRightHit(combo) {
  // Always pick a new angle different from current
  var idx = PAN.lastIdx;
  var tries = 0;
  while (idx === PAN.lastIdx && tries < 15) {
    idx = Math.floor(Math.random() * PAN_ANGLES.length);
    tries++;
  }
  PAN.lastIdx = idx;

  if (combo > 0 && combo % 5 === 0) {
    // Combo milestone (5, 10, 15...): dramatic cinematic cut to heavy angle
    var cidx = PAN.comboIdx % COMBO_ANGLES.length;
    PAN.comboIdx++;
    setPanTarget(COMBO_ANGLES[cidx], 0.35);
    CAM.shakeX = (Math.random() - 0.5) * 0.18;
    CAM.shakeY = (Math.random() - 0.5) * 0.12;
    CAM.fovTarget = 46;
    setTimeout(function() { CAM.fovTarget = 55; }, 600);
  } else {
    // Every single right press: snap to new angle — clearly visible
    setPanTarget(PAN_ANGLES[idx], 0.28);
  }
}
function camRewardPerfect() { /* now handled via onRightHit */ }
function camRewardGood()    { /* now handled via onRightHit */ }

function camMissJerk() {
  // Violent shake + roll slam
  CAM.shakeX = (Math.random()-.5) * 0.55;
  CAM.shakeY = (Math.random()-.5) * 0.40;
  CAM.shakeZ = (Math.random()-.5) * 0.20;
  CAM.roll   = (Math.random()>.5 ? 1:-1) * 0.18;
  CAM.fovTarget = 64;   // sudden wide shock
  // Tilt look-at downward
  CAM.tlookY = 0.4;
  // Zoom back out and stabilise
  setTimeout(() => {
    CAM.fovTarget = 55;
    CAM.tlookY = 1.0;
    CAM.roll = 0;
  }, 400);
}

function camEarlyLatePenalty() {
  // Small stumble shake
  CAM.shakeX = (Math.random()-.5) * 0.22;
  CAM.shakeY = (Math.random()-.5) * 0.15;
  CAM.roll   = (Math.random()>.5 ? 1:-1) * 0.06;
  setTimeout(() => { CAM.roll = 0; }, 250);
}

// ─────────────────────────────────────────────────────────────
//  BACKGROUND COLOR — shifts with combo level
// ─────────────────────────────────────────────────────────────
const BG_COLORS = [
  new THREE.Color(0x050508),   // 0–5   combo
  new THREE.Color(0x070510),   // 6–10
  new THREE.Color(0x0a0518),   // 11–20
  new THREE.Color(0x0d0820),   // 21–35
  new THREE.Color(0x12052a),   // 36–50
  new THREE.Color(0x1a0435),   // 51+   deep purple-black
];

function getTargetBgColor() {
  const c = G.combo;
  if (c >= 51) return BG_COLORS[5];
  if (c >= 36) return BG_COLORS[4];
  if (c >= 21) return BG_COLORS[3];
  if (c >= 11) return BG_COLORS[2];
  if (c >= 6)  return BG_COLORS[1];
  return BG_COLORS[0];
}

// ─────────────────────────────────────────────────────────────
//  NOTE LANE
// ─────────────────────────────────────────────────────────────
const NOTE_FALL = 2.0;   // faster fall (was 2.2) → tighter feel
const HIT_BOT   = 100;
const noteEls = {};

function updateNoteElements(songTime) {
  const lh = window.innerHeight;
  const lane = qs('#notes-lane');
  for (const n of beatMap) {
    if (n.hit || n.missed) {
      if (noteEls[n.id]) { noteEls[n.id].remove(); delete noteEls[n.id]; }
      continue;
    }
    const tu = n.time - songTime;
    if (tu > NOTE_FALL || tu < -.25) {
      if (noteEls[n.id]) { noteEls[n.id].remove(); delete noteEls[n.id]; }
      continue;
    }
    if (!noteEls[n.id]) {
      const el = document.createElement('div');
      el.className = 'note-element ' + n.dir;
      el.textContent = {left:'←',right:'→',up:'↑',down:'↓'}[n.dir];
      lane.appendChild(el);
      noteEls[n.id] = el;
    }
    const prog = tu / NOTE_FALL;  // 1=far top, 0=hit zone
    const yBot = HIT_BOT + prog * (lh - HIT_BOT - 60);
    const el = noteEls[n.id];
    el.style.bottom = yBot + 'px';

    // Perfect zone glow (when within perfect window distance)
    const perfectFrac = WIN_PERFECT / NOTE_FALL;
    const goodFrac    = WIN_GOOD    / NOTE_FALL;
    if (prog < perfectFrac) {
      el.style.boxShadow = `0 0 28px 6px currentColor`;
      el.style.transform  = (n.dir==='up'||n.dir==='down') ? 'translateX(-50%) scale(1.18)' : 'scale(1.18)';
    } else if (prog < goodFrac * 1.5) {
      const g = 1 - prog/(goodFrac*1.5);
      el.style.boxShadow = `0 0 ${14*g}px currentColor`;
      el.style.transform  = (n.dir==='up'||n.dir==='down') ? 'translateX(-50%)' : '';
    } else {
      el.style.boxShadow = '';
      el.style.transform  = (n.dir==='up'||n.dir==='down') ? 'translateX(-50%)' : '';
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  INPUT
// ─────────────────────────────────────────────────────────────
const KEY_MAP = {
  ArrowLeft:'left', KeyA:'left',
  ArrowRight:'right', KeyD:'right',
  ArrowUp:'up', KeyW:'up',
  ArrowDown:'down', KeyS:'down',
  Space:'special', KeyP:'pause', Escape:'pause',
};
const heldKeys = new Set();

document.addEventListener('keydown', e => {
  if (heldKeys.has(e.code)) return;
  heldKeys.add(e.code);
  if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space'].includes(e.code)) e.preventDefault();
  const action = KEY_MAP[e.code];
  if (!action) return;
  if (action === 'pause') { togglePause(); return; }
  if (!G.isPlaying) return;
  handleInput(action);
  flashKey(action, true);
  setTimeout(() => flashKey(action, false), 120);
});
document.addEventListener('keyup', e => heldKeys.delete(e.code));

function handleInput(dir) {
  // Pan camera on EVERY right press — unconditional, fires before hit logic
  if (dir === 'right') onRightHit(G.combo);

  const st = getSongTime();
  const result = tryHit(dir, st);

  if (!result) return;

  if (result.accuracy) {
    showAccuracy(result.accuracy);
    updateScoreUI();
    updateHealthBar();
    updateBgColor();

    if (result.accuracy === 'PERFECT') {
      camRewardPerfect();
      spawnHitParticles(dir, true);
      if (character && character._isFBX) transitionTo(dir, 0.08);
      if (character && character._isFallback) { character._proc.type = dir; character._proc.t = 0; }
    } else {
      camRewardGood();
      spawnHitParticles(dir, false);
      if (character && character._isFBX) transitionTo(dir, 0.20);
      if (character && character._isFallback) { character._proc.type = dir; character._proc.t = 0; }
    }
  } else if (result.penalty) {
    const label = result.penalty === 'GHOST' ? 'GHOST' : result.penalty;
    showAccuracy(label);
    updateScoreUI();
    updateHealthBar();
    updateBgColor();
    camEarlyLatePenalty();
    triggerRedVignette(0.3);
  }
}

function onMissNote(dir) {
  G.hp = Math.max(0, G.hp - 12);
  updateHealthBar();
  updateBgColor();
  showAccuracy('MISS');
  updateScoreUI();
  flashMissKey(dir);
  camMissJerk();
  triggerRedVignette(0.7);
  triggerStumble();
  if (character && character._isFBX) returnToIdle();
}

const KEY_SLOT_IDS = { left:'key-left', right:'key-right', up:'key-up', down:'key-down' };
function flashKey(dir, on) {
  const el = document.getElementById(KEY_SLOT_IDS[dir]); if (!el) return;
  on ? el.classList.add('active') : el.classList.remove('active');
}
function flashMissKey(dir) {
  const el = document.getElementById(KEY_SLOT_IDS[dir]); if (!el) return;
  el.classList.add('miss-flash');
  setTimeout(() => el.classList.remove('miss-flash'), 280);
}

// ─────────────────────────────────────────────────────────────
//  HIT PARTICLES (CSS, not Three.js — fast to create)
// ─────────────────────────────────────────────────────────────
function spawnHitParticles(dir, perfect) {
  const ids = { left:'key-left', right:'key-right', up:'key-up', down:'key-down' };
  const anchor = document.getElementById(ids[dir]); if (!anchor) return;
  const rect = anchor.getBoundingClientRect();
  const cx = rect.left + rect.width/2, cy = rect.top + rect.height/2;
  const colors = perfect
    ? ['#00f5d4','#ffffff','#ffe600']
    : ['#ff2d78','#ffffff','#ffe600'];
  const count = perfect ? 14 : 7;
  for (let i=0; i<count; i++) {
    const p = document.createElement('div');
    const angle = (i/count) * Math.PI*2;
    const speed = perfect ? 80+Math.random()*60 : 40+Math.random()*40;
    const dx = Math.cos(angle)*speed, dy = Math.sin(angle)*speed;
    const color = colors[Math.floor(Math.random()*colors.length)];
    const size = perfect ? 5+Math.random()*5 : 3+Math.random()*4;
    p.style.cssText = `
      position:fixed; left:${cx}px; top:${cy}px;
      width:${size}px; height:${size}px;
      border-radius:50%; background:${color};
      pointer-events:none; z-index:50;
      box-shadow:0 0 ${size*2}px ${color};
      transform:translate(-50%,-50%);
      transition: transform 0.5s ease-out, opacity 0.5s ease-out;
    `;
    document.body.appendChild(p);
    requestAnimationFrame(() => {
      p.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      p.style.opacity = '0';
    });
    setTimeout(() => p.remove(), 520);
  }
}

// ─────────────────────────────────────────────────────────────
//  RED VIGNETTE (miss / penalty feedback)
// ─────────────────────────────────────────────────────────────
let _vignetteEl = null;
function getVignetteEl() {
  if (!_vignetteEl) {
    _vignetteEl = document.createElement('div');
    _vignetteEl.style.cssText = `
      position:fixed; inset:0; pointer-events:none; z-index:8;
      background: radial-gradient(ellipse at center, transparent 40%, rgba(255,20,50,0) 100%);
      opacity:0; transition:opacity 0.06s;
    `;
    document.body.appendChild(_vignetteEl);
  }
  return _vignetteEl;
}
let _vigTimer = null;
function triggerRedVignette(strength) {
  const el = getVignetteEl();
  el.style.background = `radial-gradient(ellipse at center, transparent 35%, rgba(200,10,30,${strength.toFixed(2)}) 100%)`;
  el.style.transition = 'opacity 0.04s';
  el.style.opacity = '1';
  clearTimeout(_vigTimer);
  _vigTimer = setTimeout(() => {
    el.style.transition = 'opacity 0.45s';
    el.style.opacity = '0';
  }, 120);
}

// ─────────────────────────────────────────────────────────────
//  UI FEEDBACK
// ─────────────────────────────────────────────────────────────
let _accTimer = null;
function showAccuracy(txt) {
  const el = qs('#accuracy-popup');
  el.textContent = txt;
  // Map label to CSS class
  const cls = { PERFECT:'perfect', GOOD:'good', MISS:'miss',
                 EARLY:'early', LATE:'late', GHOST:'ghost' }[txt] || 'miss';
  el.className = cls;
  el.style.transition = 'none';
  el.style.opacity = '1';
  el.style.transform = 'translateX(-50%) scale(1.15)';
  clearTimeout(_accTimer);
  _accTimer = setTimeout(() => {
    el.style.transition = 'opacity 0.3s, transform 0.3s';
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) scale(0.85)';
  }, 500);
}

function updateScoreUI() {
  qs('#score-value').textContent = String(Math.max(0,Math.floor(G.score))).padStart(6,'0');
  qs('#combo-value').textContent = `${G.combo}x COMBO`;
  if (G.combo > 5) {
    qs('#combo-value').style.transform = 'scale(1.18)';
    setTimeout(() => qs('#combo-value').style.transform = 'scale(1)', 100);
  }
}

function updateHealthBar() {
  const bar = qs('#hp-bar-inner');
  if (!bar) return;
  const pct = Math.max(0, Math.min(100, G.hp));
  bar.style.width = pct + '%';
  // Color: green → yellow → red
  if (pct > 60)      bar.style.background = 'linear-gradient(90deg,#00f5d4,#00e5a4)';
  else if (pct > 30) bar.style.background = 'linear-gradient(90deg,#ffe600,#ffaa00)';
  else               bar.style.background = 'linear-gradient(90deg,#ff2d78,#cc0040)';
}

function updateBgColor() {
  bgColorTarget.copy(getTargetBgColor());
}

let _bfTimer = null;
function triggerBeatFlash() {
  const el = qs('#beat-flash');
  el.style.opacity = '0.10';
  clearTimeout(_bfTimer);
  _bfTimer = setTimeout(() => el.style.opacity = '0', 75);
}

// ─────────────────────────────────────────────────────────────
//  BEAT DETECTION
// ─────────────────────────────────────────────────────────────
let prevBass = 0, beatCD = 0;
function detectBeat(delta) {
  beatCD = Math.max(0, beatCD - delta);
  const e = getBassEnergy();
  if (e > prevBass * 1.45 && e > 0.14 && beatCD === 0) {
    beatCD = 0.22;
    triggerBeatFlash();
    beatLightIntensity = 2.8 * e;
  }
  prevBass = e;
}

// ─────────────────────────────────────────────────────────────
//  CAMERA UPDATE (runs every frame)
// ─────────────────────────────────────────────────────────────
function updateCamera(delta, elapsed) {
  // Beat bob
  if (G.isPlaying) {
    CAM.beatBob = Math.sin((elapsed * G.bpm / 60) % 1 * Math.PI * 2) * 0.012;
  } else {
    CAM.beatBob *= 0.95;
  }

  // Single-lerp PAN — no double chain. panF at speed=0.18, 60fps reaches target in ~0.4s visibly
  var panF = 1.0 - Math.pow(1.0 - PAN.speed, delta * 60);
  PAN.cx     += (PAN.tx     - PAN.cx)     * panF;
  PAN.cy     += (PAN.ty     - PAN.cy)     * panF;
  PAN.cz     += (PAN.tz     - PAN.cz)     * panF;
  PAN.clookY += (PAN.tlookY - PAN.clookY) * panF;

  // Shake/roll decay
  CAM.shakeX *= 0.82; CAM.shakeY *= 0.82; CAM.shakeZ *= 0.82;
  CAM.roll   *= 0.88;

  // FOV lerp
  CAM.fovCurrent += (CAM.fovTarget - CAM.fovCurrent) * Math.min(1, delta * 8);

  // Apply PAN directly to camera — no intermediate CAM.x lerp killing speed
  camera.position.set(
    PAN.cx + CAM.shakeX + (Math.random() - 0.5) * Math.abs(CAM.shakeX) * 0.3,
    PAN.cy + CAM.beatBob + CAM.shakeY + (Math.random() - 0.5) * Math.abs(CAM.shakeY) * 0.3,
    PAN.cz + CAM.shakeZ
  );
  camera.lookAt(0, PAN.clookY, 0);
  camera.rotation.z += CAM.roll;
  camera.fov = CAM.fovCurrent;
  camera.updateProjectionMatrix();
}

// ─────────────────────────────────────────────────────────────
//  PAUSE
// ─────────────────────────────────────────────────────────────
let paused = false, _raf = 0, _songEnded = false;
function togglePause() {
  if (!G.isPlaying && !paused) return;
  if (paused) {
    G.isPlaying = false; audioPauseOffset = getSongTime(); startAudio();
    gameLoop(); paused = false;
  } else {
    audioPauseOffset = getSongTime();
    try { audioSrc && audioSrc.stop(); } catch(e){}
    G.isPlaying = false; cancelAnimationFrame(_raf); paused = true;
  }
}

// ─────────────────────────────────────────────────────────────
//  RENDER LOOP
// ─────────────────────────────────────────────────────────────
function gameLoop() {
  _raf = requestAnimationFrame(gameLoop);
  const delta   = clock3.getDelta();
  const elapsed = clock3.getElapsedTime();
  const songTime = getSongTime();

  if (mixer) { mixer.update(delta); tickAnimPlaylist(delta); }
  if (character && character._isFallback) animateFallback(delta);

  if (G.isPlaying) {
    updateBeatMap(songTime);
    updateNoteElements(songTime);
    detectBeat(delta);
    if (G.songDuration > 0) {
      qs('#progress-bar-inner').style.width = Math.min(100, songTime/G.songDuration*100)+'%';
    }
  }

  // Song end detection
  if (!_songEnded && G.songDuration > 0 && !G.isPlaying && audioPauseOffset > G.songDuration - 0.5 && !paused) {
    _songEnded = true;
    cancelAnimationFrame(_raf);
    setTimeout(showRestartScreen, 800);
  }

  // Beat light
  beatLightIntensity = Math.max(0, beatLightIntensity - delta*9);
  beatLight.intensity = beatLightIntensity;
  fillLight2.intensity = Math.max(0, fillLight2.intensity - delta*12);

  // Background color lerp
  bgColorCurrent.lerp(bgColorTarget, delta * 1.2);
  scene.background = bgColorCurrent;
  scene.fog.color.copy(bgColorCurrent);

  // Stage ring pulse
  const bassE = getBassEnergy();
  stageRing.material.emissiveIntensity = 1.8 + Math.sin(elapsed*3)*.5 + beatLightIntensity*.4 + bassE*1.5;

  // Particles
  bgParticles.rotation.y += delta * .018;
  const midE = getMidEnergy();
  bgParticles.material.size = 0.06 + midE * 0.06;

  // Camera
  updateCamera(delta, elapsed);

  renderer3.render(scene, camera);
}

// ─────────────────────────────────────────────────────────────
//  LOADING
// ─────────────────────────────────────────────────────────────
function setLoadingUI(msg, pct) {
  qs('#loading-status').textContent = msg;
  qs('#loading-bar').style.width = pct + '%';
}
function showScreen(id) {
  ['start-screen','loading-screen','ui-overlay'].forEach(sid => {
    const el = qs('#'+sid);
    el.style.display = sid===id ? (sid==='ui-overlay'?'block':'flex') : 'none';
  });
}

function showRestartScreen() {
  const el = qs('#restart-screen');
  if (!el) return;
  const scoreEl = el.querySelector('#final-score');
  const comboEl = el.querySelector('#final-combo');
  if (scoreEl) scoreEl.textContent = String(Math.max(0,Math.floor(G.score))).padStart(6,'0');
  if (comboEl) comboEl.textContent = 'Best combo: ' + G.maxCombo + 'x';
  el.style.display = 'flex';
}

function hideRestartScreen() {
  const el = qs('#restart-screen');
  if (el) el.style.display = 'none';
}
function qs(sel) { return document.querySelector(sel); }

// ─────────────────────────────────────────────────────────────
//  START GAME
// ─────────────────────────────────────────────────────────────
async function startGame() {
  // ── Stop and cancel everything from previous run ──────────
  cancelAnimationFrame(_raf);
  _raf = 0;
  if (audioSrc) { try { audioSrc.stop(); } catch(e){} try { audioSrc.disconnect(); } catch(e){} audioSrc = null; }
  // Close and recreate AudioContext so decodeAudioData + BufferSource work fresh
  if (audioCtx) { try { await audioCtx.close(); } catch(e){} audioCtx = null; }
  analyserNode = null; _freqData = null;
  G.isPlaying = false;
  audioPauseOffset = 0;

  // ── Reset game state ───────────────────────────────────────
  _songEnded = false;
  paused     = false;
  G.score = 0; G.combo = 0; G.maxCombo = 0; G.hp = 100;
  beatMap = []; noteIdCtr = 0;

  // ── Reset camera to default position ──────────────────────
  PAN.tx = 0; PAN.ty = 1.6; PAN.tz = 4.5; PAN.tlookY = 1.0;
  PAN.cx = 0; PAN.cy = 1.6; PAN.cz = 4.5; PAN.clookY = 1.0;
  PAN.speed = 0.04; PAN.lastIdx = 0;
  CAM.x = 0; CAM.y = 1.6; CAM.z = 4.5;
  CAM.tx = 0; CAM.ty = 1.6; CAM.tz = 4.5;
  CAM.shakeX = 0; CAM.shakeY = 0; CAM.shakeZ = 0;
  CAM.roll = 0; CAM.fovTarget = 55; CAM.fovCurrent = 55;
  CAM.lookX = 0; CAM.lookY = 1.0; CAM.lookZ = 0;
  CAM.tlookY = 1.0;

  // ── Reset character/mixer ─────────────────────────────────
  character = null; mixer = null; animActions = {}; currentAction = null;
  animQueue = []; animQueueIdx = 0; animPending = null; animWaiting = false; _clipStartTime = 0; _animClock = 0;
  fbParts = {};

  hideRestartScreen();
  showScreen('loading-screen'); setLoadingUI('Initialising 3D…', 3);
  initThree();

  setLoadingUI('Loading character & animations…', 10);
  await loadCharacterAndAnims();

  setLoadingUI('Decoding audio…', 83);
  let rawBuffer;
  if (G.selectedTrackURL) {
    // Stream with progress so user sees download happening, not frozen spinner
    setLoadingUI('Downloading audio…', 83);
    const res = await fetch(G.selectedTrackURL);
    const contentLength = res.headers.get('Content-Length');
    if (contentLength && res.body) {
      const total  = parseInt(contentLength, 10);
      const reader = res.body.getReader();
      const chunks = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        const pct = Math.round((received / total) * 100);
        setLoadingUI(`Downloading audio… ${pct}%`, 83 + Math.round(pct * 0.05));
      }
      const merged = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
      rawBuffer = merged.buffer;
    } else {
      rawBuffer = await res.arrayBuffer();
    }
  } else if (G.selectedTrackFile) {
    rawBuffer = await G.selectedTrackFile.arrayBuffer();
  }
  if (!rawBuffer) { showScreen('start-screen'); return; }

  G.audioBuffer  = await decodeAudio(rawBuffer);
  G.songDuration = G.audioBuffer.duration;

  setLoadingUI('Detecting BPM…', 91);
  G.bpm = await detectBPM(G.audioBuffer);
  generateBeatMap(G.songDuration, G.bpm);

  const nameEl = qs('#song-name');
  const bpmEl  = qs('#bpm-display');
  if (nameEl) nameEl.textContent = G.songName.toUpperCase().slice(0,20);
  if (bpmEl)  bpmEl.textContent  = G.bpm + ' BPM';

  setLoadingUI('Ready!', 100);
  await new Promise(r => setTimeout(r, 350));
  showScreen('ui-overlay');
  updateScoreUI();
  updateHealthBar();
  await new Promise(r => setTimeout(r, 80));
  await startAudio();
  gameLoop();
}

// ─────────────────────────────────────────────────────────────
//  START SCREEN: ANIMATION PANEL

// ─────────────────────────────────────────────────────────────
//  DYNAMIC SCAN — live /api/* from node server.js
//  Falls back to legacy manifest.json if API not available.
//  Called fresh every time panels refresh, so new/removed files
//  are always reflected without restarting anything.
// ─────────────────────────────────────────────────────────────

async function safeFetch(url) {
  try {
    const r = await fetch(url + (url.includes('?') ? '&' : '?') + '_t=' + Date.now());
    if (r.ok) return await r.json();
  } catch(e) {}
  return null;
}

async function fetchAnimationList() {
  const d = await safeFetch('/api/animations');
  if (d && Array.isArray(d.animations) && d.animations.length) return d.animations;
  // legacy fallbacks
  const m = (await safeFetch('/animations/manifest.json'))
         || (await safeFetch('../animations/manifest.json'));
  return (m && Array.isArray(m.animations) && m.animations.length) ? m.animations : null;
}

async function fetchMusicList() {
  const d = await safeFetch('/api/music');
  if (d && Array.isArray(d.tracks) && d.tracks.length) return d.tracks;
  const m = (await safeFetch('/music/manifest.json'))
         || (await safeFetch('../music/manifest.json'));
  return (m && Array.isArray(m.tracks) && m.tracks.length) ? m.tracks : null;
}

// ─────────────────────────────────────────────────────────────
//  ANIMATION PANEL  — clears + reloads buffers on every call
// ─────────────────────────────────────────────────────────────
// ── Selected animation slots (toggle on start screen) ───────
let selectedAnimSlots = new Set();
const DEFAULT_ANIM_SLOTS = ['idle','left','right','up']; // default 4

function toggleAnimCard(card, slot) {
  if (selectedAnimSlots.has(slot)) {
    if (selectedAnimSlots.size <= 1) return; // keep minimum 1
    selectedAnimSlots.delete(slot);
    card.classList.remove('selected');
  } else {
    selectedAnimSlots.add(slot);
    card.classList.add('selected');
  }
  // Sync G.loadedAnimBuffers to selection (don't load, just control which get used)
  updateSelCountEl();
}

function updateSelCountEl() {
  const el = qs('#anim-sel-count');
  if (el) el.textContent = selectedAnimSlots.size > 0 ? '(' + selectedAnimSlots.size + ' selected)' : '';
}

async function initAnimationPanel() {
  const grid    = qs('#anim-grid');
  const countEl = qs('#anim-sel-count') || { textContent: '' };

  // Wipe old buffers so removed files don't linger
  G.loadedAnimBuffers = {};

  countEl.textContent = 'scanning…';
  grid.innerHTML = '<div style="grid-column:1/-1;font-size:10px;color:rgba(255,255,255,0.18);letter-spacing:1px;padding:6px 0">Scanning animations/ …</div>';

  const anims = await fetchAnimationList();

  if (!anims || anims.length === 0) {
    grid.innerHTML = '<div style="grid-column:1/-1;font-size:10px;color:rgba(255,100,80,0.85);letter-spacing:1px;line-height:2;">' +
      'No .fbx/.glb files found in <code style="color:rgba(255,255,255,0.45)">animations/</code>.<br>' +
      'Start the server: <code style="color:rgba(255,255,255,0.45)">node server.js</code><br>' +
      'Then drop FBX files in and click <b>⟳ Refresh</b>.' +
      '</div>';
    countEl.textContent = '0 found';
    return;
  }

  grid.innerHTML = '';
  countEl.textContent = '0 / ' + anims.length;
  let loadedCount = 0;

  const fetchPromises = anims.map(def => {
    const meta = SLOT_META[def.slot] || {
      key:   def.slot.replace(/extra(\d+)/, 'E$1').slice(0, 3).toUpperCase(),
      label: def.label || def.slot
    };
    const card = document.createElement('div');
    const isDefault = DEFAULT_ANIM_SLOTS.includes(def.slot) && selectedAnimSlots.size < 4;
    if (isDefault) selectedAnimSlots.add(def.slot);
    card.className = 'anim-card' + (isDefault ? ' selected' : '');
    card.id = 'anim-card-' + def.slot;
    card.dataset.slot = def.slot;
    const displayLabel = def.label || def.slot;
    card.innerHTML =
      '<div class="anim-dot"></div>' +
      '<div class="anim-name" title="' + displayLabel + '">' + displayLabel + '</div>';
    card.addEventListener('click', () => toggleAnimCard(card, def.slot));
    grid.appendChild(card);
    updateSelCountEl();

    return (async () => {
      let buf = null;
      // URL-encode filename to handle spaces and special characters
      const encodedFile = encodeURIComponent(def.file);
      for (const base of ['/animations/', '../animations/']) {
        try {
          const r = await fetch(base + encodedFile + '?_t=' + Date.now());
          if (r.ok) { buf = await r.arrayBuffer(); break; }
        } catch(e) {}
      }
      if (buf) {
        G.loadedAnimBuffers[def.slot] = buf;
        const wasSelected = selectedAnimSlots.has(def.slot);
        card.className = 'anim-card' + (wasSelected ? ' selected' : '');
        loadedCount++;
        if (countEl) countEl.textContent = loadedCount + ' / ' + anims.length;
      } else {
        card.className = 'anim-card error';
        card.title = 'Could not load ' + def.file;
        console.warn('[Anim] failed:', def.file);
      }
    })();
  });

  await Promise.allSettled(fetchPromises);
  countEl.textContent = loadedCount + ' / ' + anims.length;
}

// ─────────────────────────────────────────────────────────────
//  MUSIC PANEL  — reloads on every call, restores selection
// ─────────────────────────────────────────────────────────────
async function initMusicPanel() {
  const list = qs('#music-list');
  const prevFile = G.selectedTrackURL ? G.selectedTrackURL.split('/').pop() : null;

  list.innerHTML = '<div class="music-empty">Scanning music/ …</div>';

  const tracks = await fetchMusicList();

  if (!tracks || tracks.length === 0) {
    list.innerHTML = '<div class="music-empty">' +
      'No audio files found in <code style="color:rgba(255,255,255,0.3)">music/</code>.<br>' +
      'Drop MP3 / WAV / OGG files there and click <b>⟳ Refresh</b>,<br>' +
      'or use <b>Browse</b> below.' +
      '</div>';
    return;
  }

  list.innerHTML = '';
  let autoSelected = false;
  for (const track of tracks) {
    const item = document.createElement('div');
    item.className = 'music-item';
    // Decode both for comparison (handle URL-encoded filenames)
    const decodedPrev = prevFile ? decodeURIComponent(prevFile) : null;
    const isThisSelected = (decodedPrev && decodedPrev === track.file) || (!decodedPrev && !autoSelected);
    if (isThisSelected) {
      item.classList.add('selected');
      if (!autoSelected) {
        // URL-encode the filename to handle spaces/special chars
        G.selectedTrackURL  = '/music/' + encodeURIComponent(track.file);
        G.selectedTrackFile = null;
        G.songName = track.name;
        qs('#start-btn').disabled = false;
        qs('#start-btn').textContent = 'START DANCING';
        autoSelected = true;
      }
    }
    item.innerHTML = '<div class="mi-dot"></div><span class="mi-name" title="' + track.name + '">' + track.name + '</span>';
    item.addEventListener('click', () => {
      list.querySelectorAll('.music-item').forEach(i => i.classList.remove('selected'));
      item.classList.add('selected');
      G.selectedTrackURL  = '/music/' + encodeURIComponent(track.file);
      G.selectedTrackFile = null;
      G.songName = track.name;
      qs('#start-btn').textContent = 'START DANCING';
      qs('#start-btn').disabled = false;
    });
    list.appendChild(item);
  }
}

// ─────────────────────────────────────────────────────────────
//  MANUAL UPLOAD
// ─────────────────────────────────────────────────────────────
qs('#music-file-input').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  qs('#music-decode-status').textContent = 'Checking…';
  try {
    const tmpCtx = new (window.AudioContext || window.webkitAudioContext)();
    await tmpCtx.decodeAudioData((await file.arrayBuffer()).slice(0));
    G.selectedTrackFile = file; G.selectedTrackURL = null;
    G.songName = file.name.replace(/\.[^.]+$/, '');
    qs('#music-decode-status').textContent = '✓ ' + G.songName;
    qs('#music-list').querySelectorAll('.music-item').forEach(i => i.classList.remove('selected'));
    qs('#start-btn').textContent = 'START DANCING';
    qs('#start-btn').disabled = false;
  } catch(err) {
    qs('#music-decode-status').textContent = '✗ Could not read this file';
  }
});

// ─────────────────────────────────────────────────────────────
//  START BUTTON + ENTER KEY
// ─────────────────────────────────────────────────────────────
qs('#start-btn').addEventListener('click', () => {
  if (!G.selectedTrackURL && !G.selectedTrackFile) return;
  startGame();
});
document.addEventListener('keydown', e => {
  if (e.code === 'Enter') {
    const ss = qs('#start-screen');
    if (ss && ss.style.display !== 'none' && !qs('#start-btn').disabled) startGame();
  }
});

// ─────────────────────────────────────────────────────────────
//  REFRESH BUTTON — rescans folders without page reload
// ─────────────────────────────────────────────────────────────
(qs('#refresh-btn') || document.createElement('div')).addEventListener('click', async () => {
  const btn = qs('#refresh-btn');
  btn.textContent = '⟳';
  btn.style.animation = 'spin 0.6s linear infinite';
  await Promise.all([initAnimationPanel(), initMusicPanel()]);
  btn.style.animation = '';
  btn.textContent = '⟳ Refresh';
});

// ─────────────────────────────────────────────────────────────
//  DRAG & DROP  — audio or FBX onto start screen
// ─────────────────────────────────────────────────────────────
qs('#start-screen').addEventListener('dragover', e => e.preventDefault());
qs('#start-screen').addEventListener('drop', async e => {
  e.preventDefault();
  let needsRescan = false;
  for (const file of Array.from(e.dataTransfer.files)) {
    const n = file.name.toLowerCase();
    if (/\.(mp3|wav|ogg|m4a|aac|flac|opus)$/.test(n)) {
      G.selectedTrackFile = file; G.selectedTrackURL = null;
      G.songName = file.name.replace(/\.[^.]+$/, '');
      qs('#music-decode-status').textContent = '✓ ' + G.songName;
      qs('#start-btn').textContent = 'START DANCING';
      qs('#start-btn').disabled = false;
    } else if (/\.(fbx|glb|gltf)$/.test(n)) {
      // Dropped FBX: find best available slot
      const n2 = file.name.toLowerCase().replace(/\.[^.]+$/, '');
      let slot = null;
      const GUESS_RULES = [
        [/house|samba|idle|breath/, 'idle'],
        [/swing|salsa|left/,        'left'],
        [/hip.?hop|step.?hip|right/,'right'],
        [/gangnam|thriller|jump|up/, 'up'],
        [/chicken|silly|crouch|down/,'down'],
        [/special|robot|wave|pop/,  'special'],
      ];
      for (const [rx, s] of GUESS_RULES) {
        if (rx.test(n2) && !G.loadedAnimBuffers[s]) { slot = s; break; }
      }
      if (!slot) {
        const extras = ['extra1','extra2','extra3','extra4','extra5'];
        slot = extras.find(s => !G.loadedAnimBuffers[s]) || 'extra1';
      }
      G.loadedAnimBuffers[slot] = await file.arrayBuffer();
      const card = qs('#anim-card-' + slot);
      if (card) { card.className = 'anim-card loaded'; card.querySelector('.anim-status').textContent = '✓'; }
      else {
        // Card doesn't exist yet (file not in manifest) — trigger full rescan
        needsRescan = true;
      }
    }
  }
  if (needsRescan) await initAnimationPanel();
});

// ─────────────────────────────────────────────────────────────
//  BOOT
// ─────────────────────────────────────────────────────────────
// ── Restart / Menu buttons ──────────────────────────────────
(function() {
  const restartBtn = qs('#restart-btn');
  const menuBtn    = qs('#menu-btn');
  if (restartBtn) restartBtn.addEventListener('click', () => { hideRestartScreen(); startGame(); });
  if (menuBtn) menuBtn.addEventListener('click', () => {
    hideRestartScreen();
    cancelAnimationFrame(_raf); _raf = 0;
    if (audioSrc) { try { audioSrc.stop(); } catch(e){} try { audioSrc.disconnect(); } catch(e){} audioSrc = null; }
    G.isPlaying = false;
    const ov = qs('#ui-overlay'); if (ov) ov.style.display = 'none';
    const ls = qs('#loading-screen'); if (ls) ls.style.display = 'none';
    const ss = qs('#start-screen'); if (ss) ss.style.display = 'flex';
  });

  // ── Anim panel: ALL toggle + refresh button ─────────────
  const allBtn     = qs('#anim-toggle-all');
  const refreshBtn = qs('#refresh-btn');

  if (allBtn) allBtn.addEventListener('click', () => {
    const allCards = document.querySelectorAll('.anim-card:not(.error)');
    const allSlots = Array.from(allCards).map(c => c.dataset.slot).filter(Boolean);
    const allOn    = allSlots.every(s => selectedAnimSlots.has(s));
    if (allOn) {
      // deselect all except first loaded
      const first = allSlots[0];
      selectedAnimSlots = new Set(first ? [first] : []);
    } else {
      selectedAnimSlots = new Set(allSlots);
    }
    allCards.forEach(c => {
      if (selectedAnimSlots.has(c.dataset.slot)) c.classList.add('selected');
      else c.classList.remove('selected');
    });
    updateSelCountEl();
  });

  if (refreshBtn) refreshBtn.addEventListener('click', async () => {
    refreshBtn.textContent = '…';
    refreshBtn.style.opacity = '0.4';
    await Promise.all([initAnimationPanel(), initMusicPanel()]);
    refreshBtn.textContent = '↻';
    refreshBtn.style.opacity = '1';
  });
})();

initAnimationPanel();
initMusicPanel();
