# BEAT DANCER — Phase 2

Browser-based music rhythm dance simulator with real Mixamo animations.

## Folder Structure

```
beat-dancer/
│
├── audio/
│   └── AudioAnalyzer.ts        # Audio decoding, BPM detection, beat callbacks
│
├── game/
│   └── BeatMap.ts              # Note generation, hit/miss detection, scoring
│
├── input/
│   └── InputManager.ts         # Keyboard + touch input, action dispatch
│
├── animation/
│   └── AnimationController.ts  # AnimationMixer, crossfade, state machine
│
├── character/
│   └── CharacterController.ts  # FBX loading, model setup, fallback character
│
├── render/
│   └── Renderer.ts             # Three.js scene, camera, lights, beat FX
│
├── ui/
│   └── UIController.ts         # All DOM UI: score, notes lane, accuracy popup
│
├── music/
│   ├── manifest.json           # ← ADD YOUR TRACKS HERE
│   ├── README.md
│   └── (your .mp3 / .wav files go here)
│
├── animations/
│   ├── Chicken_Dance.fbx
│   ├── Gangnam_Style.fbx
│   ├── House_Dancing.fbx
│   ├── Salsa_Dancing.fbx
│   ├── Samba_Dancing.fbx
│   ├── Silly_Dancing.fbx
│   ├── Step_Hip_Hop_Dance.fbx
│   ├── Swing_Dancing.fbx
│   └── Thriller_Part_3.fbx
│
├── public/
│   └── index.html              # Game entry point
│
├── main.ts                     # Orchestrator — wires all modules
├── tsconfig.json
├── vite.config.ts
└── package.json
```

## Quickstart

```bash
# 1. Install dependencies
npm install

# 2. Start dev server
npm run dev

# 3. Open browser at http://localhost:5173
```

## Adding Music

1. Drop MP3/WAV files into `/music/`
2. Add them to `/music/manifest.json`
3. They'll appear in the in-game library on the start screen

## FBX Animation Mapping

| Key       | Recommended Animation          |
|-----------|-------------------------------|
| IDL (idle)| House_Dancing or Samba_Dancing |
| ← Left    | Swing_Dancing or Salsa_Dancing |
| → Right   | Step_Hip_Hop_Dance             |
| ↑ Up      | Gangnam_Style or Thriller_Part_3 |
| ↓ Down    | Chicken_Dance or Silly_Dancing |
| Space     | Any remaining                  |

On the start screen, assign each FBX to its slot — or just drag & drop
all your FBX files onto the screen; they'll auto-assign by filename.

## Controls

| Key         | Action       |
|-------------|--------------|
| ← / A       | Left step    |
| → / D       | Right step   |
| ↑ / W       | Jump / lift  |
| ↓ / S       | Crouch move  |
| Space       | Special      |
| P / Escape  | Pause        |

## Tech Stack

- TypeScript
- Three.js r128
- Web Audio API
- Mixamo FBX animations
- Vite (build tool)
