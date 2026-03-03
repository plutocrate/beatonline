// ═══════════════════════════════════════════════════════════════
//  render/Renderer.ts
//  Handles: Three.js scene construction, camera system,
//           lighting, floor, stage, particles, beat FX,
//           camera shake, render loop tick
// ═══════════════════════════════════════════════════════════════

import * as THREE from 'three';

export interface RenderConfig {
  container: HTMLElement;
  antialias?: boolean;
  pixelRatio?: number;
}

export class Renderer {
  renderer!:  THREE.WebGLRenderer;
  scene!:     THREE.Scene;
  camera!:    THREE.PerspectiveCamera;
  clock:      THREE.Clock = new THREE.Clock();

  // Scene objects
  private floorMesh!:    THREE.Mesh;
  private particles!:    THREE.Points;
  private stageRing!:    THREE.Mesh;
  private beatLight!:    THREE.PointLight;

  // Camera animation
  private camShake      = 0;
  private camBeatBob    = 0;
  private camBaseY      = 1.6;
  private camBaseZ      = 4.5;
  private bpm           = 120;

  // ── Init ─────────────────────────────────────────────────────
  init(config: RenderConfig): void {
    const { container, antialias = true, pixelRatio } = config;

    this.renderer = new THREE.WebGLRenderer({ antialias, alpha: false });
    this.renderer.setPixelRatio(Math.min(pixelRatio ?? window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled  = true;
    this.renderer.shadowMap.type     = THREE.PCFSoftShadowMap;
    this.renderer.outputEncoding     = THREE.sRGBEncoding;
    this.renderer.toneMapping        = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050508);
    this.scene.fog        = new THREE.FogExp2(0x050508, 0.035);

    this.camera = new THREE.PerspectiveCamera(
      55,
      window.innerWidth / window.innerHeight,
      0.1,
      200
    );
    this.camera.position.set(0, this.camBaseY, this.camBaseZ);
    this.camera.lookAt(0, 1, 0);

    window.addEventListener('resize', this.onResize);
    this.buildScene();
  }

  private onResize = (): void => {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  };

  // ── Scene Construction ───────────────────────────────────────
  private buildScene(): void {
    // Floor
    const floorGeo = new THREE.PlaneGeometry(30, 30);
    const floorMat = new THREE.MeshStandardMaterial({
      color:     0x0a0a12,
      metalness: 0.6,
      roughness: 0.4,
    });
    this.floorMesh = new THREE.Mesh(floorGeo, floorMat);
    this.floorMesh.rotation.x  = -Math.PI / 2;
    this.floorMesh.receiveShadow = true;
    this.scene.add(this.floorMesh);

    // Grid
    const grid = new THREE.GridHelper(30, 30, 0x1a1a2e, 0x1a1a2e);
    this.scene.add(grid);

    // Stage disc
    const stageGeo = new THREE.CylinderGeometry(1.6, 1.6, 0.08, 32);
    const stageMat = new THREE.MeshStandardMaterial({ color: 0x1a0a2e, metalness: 0.8, roughness: 0.2 });
    const stage    = new THREE.Mesh(stageGeo, stageMat);
    stage.position.y      = 0.01;
    stage.receiveShadow   = true;
    this.scene.add(stage);

    // Stage ring
    const ringGeo = new THREE.TorusGeometry(1.6, 0.04, 8, 64);
    const ringMat = new THREE.MeshStandardMaterial({
      color:             0xff2d78,
      emissive:          new THREE.Color(0xff2d78),
      emissiveIntensity: 2,
    });
    this.stageRing = new THREE.Mesh(ringGeo, ringMat);
    this.stageRing.rotation.x = Math.PI / 2;
    this.stageRing.position.y = 0.05;
    this.scene.add(this.stageRing);

    // Ambient light
    this.scene.add(new THREE.AmbientLight(0x111122, 0.5));

    // Key light (main)
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.8);
    keyLight.position.set(2, 5, 3);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width  = 1024;
    keyLight.shadow.mapSize.height = 1024;
    this.scene.add(keyLight);

    // Beat point light (under character, pulsed on beats)
    this.beatLight = new THREE.PointLight(0xff2d78, 0, 4);
    this.beatLight.position.set(0, 0.5, 0);
    this.scene.add(this.beatLight);

    // Fill & rim
    const fill = new THREE.DirectionalLight(0x00f5d4, 0.3);
    fill.position.set(-3, 3, -2);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffe600, 0.4);
    rim.position.set(0, 4, -4);
    this.scene.add(rim);

    // Particles
    this.buildParticles();
  }

  private buildParticles(): void {
    const count = 400;
    const pos   = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * 40;
      pos[i * 3 + 1] = Math.random() * 15;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 40;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color:       0x334466,
      size:        0.06,
      transparent: true,
      opacity:     0.6,
    });
    this.particles = new THREE.Points(geo, mat);
    this.scene.add(this.particles);
  }

  // ── Per-frame update ─────────────────────────────────────────
  /**
   * Call once per animation frame.
   * @param delta  seconds since last frame
   * @param isPlaying  is music currently playing
   */
  tick(delta: number, isPlaying: boolean): void {
    const elapsed = this.clock.getElapsedTime();

    // Particles slow drift
    this.particles.rotation.y += delta * 0.02;

    // Camera bob synced to BPM
    if (isPlaying) {
      const beatPhase = (elapsed * this.bpm / 60) % 1;
      this.camBeatBob  = Math.sin(beatPhase * Math.PI * 2) * 0.015;
    } else {
      this.camBeatBob += (0 - this.camBeatBob) * 0.05;
    }

    // Camera shake decay
    this.camShake *= 0.88;
    this.camera.position.y = this.camBaseY + this.camBeatBob +
      (Math.random() - 0.5) * this.camShake;
    this.camera.position.x = (Math.random() - 0.5) * this.camShake;
    this.camera.lookAt(0, 1, 0);

    // Beat light decay
    this.beatLight.intensity = Math.max(0, this.beatLight.intensity - delta * 8);

    // Stage ring pulse
    const ringMat = this.stageRing.material as THREE.MeshStandardMaterial;
    ringMat.emissiveIntensity = 1.5 + Math.sin(elapsed * 3) * 0.5 +
      this.beatLight.intensity * 0.5;

    this.renderer.render(this.scene, this.camera);
  }

  // ── Beat effects ─────────────────────────────────────────────
  onBeat(energy: number): void {
    this.beatLight.intensity    = 2.5 * energy;
    this.particles.material     = this.particles.material as THREE.PointsMaterial;
    (this.particles.material as THREE.PointsMaterial).size = 0.10;
  }

  triggerCameraShake(intensity: number): void {
    this.camShake = Math.max(this.camShake, intensity);
  }

  // ── Config ───────────────────────────────────────────────────
  setBPM(bpm: number): void { this.bpm = bpm; }

  // ── Cleanup ──────────────────────────────────────────────────
  destroy(): void {
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
  }
}
