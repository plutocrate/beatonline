// ═══════════════════════════════════════════════════════════════
//  character/CharacterController.ts
//  Handles: FBX/GLTF model loading, skeleton setup, material
//           enhancement, fallback procedural character,
//           wiring clips into AnimationController
// ═══════════════════════════════════════════════════════════════

import * as THREE from 'three';
import { AnimationController, AnimSlot } from '../animation/AnimationController';

// FBXLoader is loaded globally via <script> tag in index.html
declare const THREE: any; // extended with FBXLoader

export interface FBXSlotDef {
  slot:   AnimSlot;
  buffer: ArrayBuffer;
  name:   string;
}

// Auto-detect slot from common Mixamo filenames
export function guessSlot(filename: string): AnimSlot | null {
  const n = filename.toLowerCase();
  if (n.includes('house')  || n.includes('samba'))                     return 'idle';
  if (n.includes('swing')  || n.includes('salsa'))                     return 'left';
  if (n.includes('step_hip') || n.includes('hip_hop'))                 return 'right';
  if (n.includes('gangnam') || n.includes('thriller'))                 return 'up';
  if (n.includes('chicken') || n.includes('silly'))                    return 'down';
  if (n.includes('special') || n.includes('extra') || n.includes('b_boy')) return 'special';
  if (n.includes('idle')   || n.includes('breath'))                    return 'idle';
  if (n.includes('left'))  return 'left';
  if (n.includes('right')) return 'right';
  if (n.includes('jump')   || n.includes('up'))   return 'up';
  if (n.includes('crouch') || n.includes('down')) return 'down';
  return null;
}

export class CharacterController {
  private root:   THREE.Object3D | null = null;
  private scene:  THREE.Scene;
  private animCtrl: AnimationController;

  // Fallback parts
  private fallbackParts: Record<string, THREE.Mesh> = {};
  private isFallback = false;

  // Procedural animation state (fallback only)
  private procState = { type: 'idle', t: 0 };

  constructor(scene: THREE.Scene, animCtrl: AnimationController) {
    this.scene    = scene;
    this.animCtrl = animCtrl;
  }

  // ── Load multiple FBX slots ──────────────────────────────────
  async loadFBXSlots(
    slots:      FBXSlotDef[],
    onProgress: (msg: string, pct: number) => void
  ): Promise<void> {
    if (slots.length === 0) {
      this.buildFallback();
      return;
    }

    // Sort: idle first so we get the base model from it
    const sorted = [...slots].sort((a, b) =>
      a.slot === 'idle' ? -1 : b.slot === 'idle' ? 1 : 0
    );

    let loaded = 0;

    for (const def of sorted) {
      onProgress(`Loading ${def.name}…`, 10 + (loaded / sorted.length) * 80);
      try {
        await this.loadOneSlot(def, loaded === 0);
      } catch (e) {
        console.warn(`[CharacterController] Failed to load slot "${def.slot}":`, e);
      }
      loaded++;
    }

    if (!this.root) {
      console.warn('[CharacterController] No model loaded — using fallback');
      this.buildFallback();
      return;
    }

    // Wire AnimationController to this model
    this.animCtrl.init(this.root);

    // Start idle
    if (this.animCtrl.getAvailableSlots().includes('idle')) {
      this.animCtrl.transitionTo('idle', 0.01);
    } else {
      const first = this.animCtrl.getAvailableSlots()[0];
      if (first) this.animCtrl.transitionTo(first, 0.01);
    }

    onProgress('Character ready', 95);
  }

  private async loadOneSlot(def: FBXSlotDef, isBase: boolean): Promise<void> {
    const fbx = await this.parseFBX(def.buffer);

    if (isBase) {
      // First model becomes the visible character
      fbx.scale.setScalar(0.01);
      fbx.position.set(0, 0.05, 0);

      fbx.traverse((child: THREE.Object3D) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.castShadow    = true;
          mesh.receiveShadow = true;
          this.enhanceMaterial(mesh);
        }
      });

      this.scene.add(fbx);
      this.root = fbx;
      this.animCtrl.init(fbx);
    }

    // Pull first animation clip from every FBX
    if (fbx.animations && fbx.animations.length > 0) {
      const clip = fbx.animations[0];
      clip.name  = def.slot;
      this.animCtrl.registerClip(def.slot, clip);
    }
  }

  private parseFBX(buffer: ArrayBuffer): Promise<THREE.Group> {
    return new Promise((resolve, reject) => {
      try {
        // Use the globally-loaded FBXLoader (from script tag)
        const loader = new (THREE as any).FBXLoader();
        const result = loader.parse(buffer, '');
        resolve(result);
      } catch (e) {
        reject(e);
      }
    });
  }

  private enhanceMaterial(mesh: THREE.Mesh): void {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach(m => {
      if (m instanceof THREE.MeshStandardMaterial ||
          m instanceof THREE.MeshPhongMaterial) {
        (m as THREE.MeshStandardMaterial).roughness  = 0.65;
        (m as THREE.MeshStandardMaterial).metalness  = 0.15;
      }
    });
  }

  // ── Fallback Block Character ─────────────────────────────────
  buildFallback(): void {
    this.isFallback = true;
    const group     = new THREE.Group();

    const body   = new THREE.MeshStandardMaterial({ color: 0x2a2a4a, metalness: 0.3, roughness: 0.6 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xff2d78, emissive: 0xff2d78, emissiveIntensity: 0.6 });
    const eye    = new THREE.MeshStandardMaterial({ color: 0x00f5d4, emissive: 0x00f5d4, emissiveIntensity: 1 });

    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, name: string) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      group.add(m);
      this.fallbackParts[name] = m;
      return m;
    };

    add(new THREE.BoxGeometry(0.50, 0.65, 0.25), body,   0,      1.15,  0,    'torso');
    add(new THREE.SphereGeometry(0.20, 16, 16),  body,   0,      1.65,  0,    'head');
    add(new THREE.SphereGeometry(0.04, 8, 8),    eye,   -0.07,   1.68,  0.18, 'eyeL');
    add(new THREE.SphereGeometry(0.04, 8, 8),    eye,    0.07,   1.68,  0.18, 'eyeR');
    add(new THREE.BoxGeometry(0.15, 0.50, 0.15), body,  -0.35,   1.05,  0,    'armL');
    add(new THREE.BoxGeometry(0.15, 0.50, 0.15), body,   0.35,   1.05,  0,    'armR');
    add(new THREE.BoxGeometry(0.20, 0.55, 0.20), body,  -0.14,   0.55,  0,    'legL');
    add(new THREE.BoxGeometry(0.20, 0.55, 0.20), body,   0.14,   0.55,  0,    'legR');
    add(new THREE.BoxGeometry(0.52, 0.05, 0.27), accent, 0,      1.38,  0,    'strip');

    group.position.y = 0.05;
    this.scene.add(group);
    this.root = group;

    // Wire fallback into AnimationController as a pass-through
    // (no clips — procedural update handles movement)
    this.animCtrl.init(group);
  }

  // ── Procedural animation for fallback ───────────────────────
  updateFallback(delta: number, bpm: number): void {
    if (!this.isFallback || !this.root) return;

    const p  = this.fallbackParts;
    const st = this.procState;
    st.t += delta;

    const beat = (bpm / 60) * Math.PI * 2;
    const bp   = st.t * beat;

    switch (st.type) {
      case 'idle':
        p.torso.rotation.z   =  Math.sin(bp * 0.5)  * 0.03;
        p.torso.position.y   =  1.15 + Math.sin(bp) * 0.02;
        p.head.rotation.y    =  Math.sin(bp * 0.3)  * 0.10;
        p.head.position.y    =  1.65 + Math.sin(bp) * 0.02;
        p.armL.rotation.z    = -0.15 + Math.sin(bp * 0.5) * 0.05;
        p.armR.rotation.z    =  0.15 - Math.sin(bp * 0.5) * 0.05;
        p.legL.rotation.x    =  Math.sin(bp * 0.5)  * 0.03;
        p.legR.rotation.x    = -Math.sin(bp * 0.5)  * 0.03;
        break;

      case 'left':
        this.root.position.x = Math.sin(Math.min(st.t * 4, Math.PI * 0.5)) * -0.4;
        p.torso.rotation.z   =  0.15;
        p.armL.rotation.z    = -0.6 - Math.sin(st.t * 4) * 0.3;
        p.armR.rotation.z    =  0.6 + Math.sin(st.t * 4) * 0.3;
        p.legL.rotation.x    =  Math.sin(st.t * 4) * 0.4;
        p.legR.rotation.x    = -Math.sin(st.t * 4) * 0.4;
        break;

      case 'right':
        this.root.position.x = Math.sin(Math.min(st.t * 4, Math.PI * 0.5)) * 0.4;
        p.torso.rotation.z   = -0.15;
        p.armR.rotation.z    =  0.6 + Math.sin(st.t * 4) * 0.3;
        p.armL.rotation.z    = -0.6 - Math.sin(st.t * 4) * 0.3;
        p.legL.rotation.x    = -Math.sin(st.t * 4) * 0.4;
        p.legR.rotation.x    =  Math.sin(st.t * 4) * 0.4;
        break;

      case 'up':
        this.root.position.y = 0.05 + Math.sin(Math.min(st.t * 3, Math.PI)) * 0.6;
        p.armL.rotation.z    = -1.2;
        p.armR.rotation.z    =  1.2;
        p.legL.rotation.x    = -Math.sin(st.t * 3) * 0.5;
        p.legR.rotation.x    = -Math.sin(st.t * 3) * 0.5;
        break;

      case 'down':
        p.torso.position.y   = 1.0 - Math.sin(Math.min(st.t * 4, Math.PI)) * 0.2;
        p.legL.rotation.x    = 0.4;
        p.legR.rotation.x    = 0.4;
        p.armL.rotation.x    = 0.3;
        p.armR.rotation.x    = 0.3;
        break;

      case 'special':
        this.root.rotation.y = st.t * 4;
        p.armL.rotation.z    = -1.0;
        p.armR.rotation.z    =  1.0;
        p.torso.position.y   = 1.15 + Math.sin(st.t * 8) * 0.05;
        break;
    }

    // Ease root back to base position
    if (st.type !== 'up') {
      this.root.position.y += (0.05 - this.root.position.y) * 0.06;
    }
    if (st.type !== 'left' && st.type !== 'right') {
      this.root.position.x += (0 - this.root.position.x) * 0.06;
    }
    if (st.type !== 'special') {
      this.root.rotation.y += (0 - this.root.rotation.y) * 0.06;
    }
  }

  setProceduralState(type: string): void {
    if (!this.isFallback) return;
    this.procState.type = type;
    this.procState.t    = 0;
  }

  // ── Getters ──────────────────────────────────────────────────
  get model():          THREE.Object3D | null { return this.root; }
  get isFallbackMode(): boolean               { return this.isFallback; }
}
