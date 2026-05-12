import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer
} from 'three';
import type {
  ActiveTetrominoSnapshot,
  GamePhase,
  SettledBlockSnapshot
} from './GameState';
import { getTetrominoDefinition, type TetrominoType } from './constants/tetromino';
import { CELL_SIZE, FIELD_DIMENSIONS, FIELD_ORIGIN } from './constants/field';
import { GameState } from './GameState';

type RendererCallbacks = {
  onRestart?: () => void;
  onTogglePause?: () => void;
  onToggleSettings?: () => void;
};

type HudState = {
  queue: readonly TetrominoType[];
  phase: GamePhase;
  clearedLayerCount: number;
  score: number;
  level: number;
  dropIntervalMs: number;
  elapsedMs: number;
  isPaused: boolean;
  settingsOpen: boolean;
};

type CameraOrbitState = {
  radius: number;
  theta: number;
  phi: number;
  target: Vector3;
  dragging: boolean;
  pointerId: number | null;
  lastX: number;
  lastY: number;
};

/**
 * Three.js scene rendering and DOM-based HUD for the 3D Tetris playfield.
 */
export class Renderer {
  private readonly gameState: GameState;
  private readonly callbacks: RendererCallbacks;
  private scene: Scene | null = null;
  private camera: PerspectiveCamera | null = null;
  private renderer: WebGLRenderer | null = null;
  private container: HTMLElement | null = null;
  private canvasHost: HTMLDivElement | null = null;
  private hudElement: HTMLDivElement | null = null;
  private activeTetrominoGroup: Group | null = null;
  private settledBlocksGroup: Group | null = null;
  private glowGroup: Group | null = null;
  private resizeHandler: (() => void) | null = null;
  private controlsBound = false;
  private pointerDownHandler: ((event: PointerEvent) => void) | null = null;
  private pointerMoveHandler: ((event: PointerEvent) => void) | null = null;
  private pointerUpHandler: ((event: PointerEvent) => void) | null = null;
  private wheelHandler: ((event: WheelEvent) => void) | null = null;
  private readonly cameraOrbit: CameraOrbitState;
  private readonly hudState: HudState;

  constructor(gameState: GameState, callbacks: RendererCallbacks = {}) {
    this.gameState = gameState;
    this.callbacks = callbacks;

    const { width, height, depth } = this.gameState.getDimensions();
    const target = new Vector3(
      FIELD_ORIGIN.x + (width * CELL_SIZE) / 2,
      height * CELL_SIZE * 0.42,
      FIELD_ORIGIN.z + (depth * CELL_SIZE) / 2
    );

    this.cameraOrbit = {
      radius: Math.max(width, height, depth) * 1.58,
      theta: -0.86,
      phi: 1.08,
      target,
      dragging: false,
      pointerId: null,
      lastX: 0,
      lastY: 0
    };

    this.hudState = {
      queue: [],
      phase: 'running',
      clearedLayerCount: 0,
      score: 0,
      level: 1,
      dropIntervalMs: 700,
      elapsedMs: 0,
      isPaused: false,
      settingsOpen: false
    };
  }

  public initialize(container: HTMLElement): void {
    this.container = container;
    container.innerHTML = '';
    container.classList.add('game-shell');

    const canvasHost = document.createElement('div');
    canvasHost.className = 'scene-layer';
    container.appendChild(canvasHost);

    const scene = new Scene();
    scene.background = new Color('#030611');
    scene.fog = null;

    const camera = new PerspectiveCamera(44, this.getAspectRatio(), 0.1, 1000);
    this.applyCameraOrbit(camera);

    const renderer = new WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.domElement.className = 'scene-canvas';
    canvasHost.appendChild(renderer.domElement);

    container.appendChild(this.createHudElement());

    scene.add(this.createLighting());
    scene.add(this.createFieldBounds());
    scene.add(this.createFloorHalo());

    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.canvasHost = canvasHost;

    this.resizeHandler = () => this.onResize();
    window.addEventListener('resize', this.resizeHandler);
    this.attachCameraControls();

    this.updateActiveTetromino(this.gameState.getActiveTetromino());
    this.updateSettledBlocks(this.gameState.getSettledBlocks());
    this.updateHud([], 'running', 0, 0, 1, 700, 0, false, false);
    this.renderFrame();
  }

  public renderFrame(): void {
    if (!this.scene || !this.camera || !this.renderer) {
      return;
    }
    this.renderer.render(this.scene, this.camera);
  }

  public dispose(): void {
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }

    this.detachCameraControls();
    this.renderer?.dispose();
    this.disposeActiveTetrominoGroup();
    this.disposeSettledBlocksGroup();
    this.disposeGlowGroup();
    this.hudElement?.remove();
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.hudElement = null;
    this.container = null;
    this.canvasHost = null;
  }

  public updateActiveTetromino(tetromino: ActiveTetrominoSnapshot | null): void {
    if (!this.scene) {
      return;
    }

    this.disposeActiveTetrominoGroup();
    this.disposeGlowGroup();

    if (!tetromino) {
      return;
    }

    const group = new Group();
    group.position.set(FIELD_ORIGIN.x, FIELD_ORIGIN.y, FIELD_ORIGIN.z);

    tetromino.blocks.forEach((block) => {
      const mesh = this.createBlockMesh(tetromino.color, true);
      mesh.position.set(
        (block.x + 0.5) * CELL_SIZE,
        (block.y + 0.5) * CELL_SIZE,
        (block.z + 0.5) * CELL_SIZE
      );
      group.add(mesh);
    });

    const glow = new Group();
    glow.position.copy(group.position);
    tetromino.blocks.forEach((block) => {
      const orb = new Mesh(
        new SphereGeometry(0.42, 16, 16),
        new MeshBasicMaterial({
          color: tetromino.color,
          transparent: true,
          opacity: 0.22
        })
      );
      orb.position.set(
        (block.x + 0.5) * CELL_SIZE,
        (block.y + 0.5) * CELL_SIZE,
        (block.z + 0.5) * CELL_SIZE
      );
      glow.add(orb);
    });

    this.activeTetrominoGroup = group;
    this.glowGroup = glow;
    this.scene.add(group);
    this.scene.add(glow);
    this.renderFrame();
  }

  public updateSettledBlocks(blocks: readonly SettledBlockSnapshot[]): void {
    if (!this.scene) {
      return;
    }

    this.disposeSettledBlocksGroup();

    const group = new Group();
    group.position.set(FIELD_ORIGIN.x, FIELD_ORIGIN.y, FIELD_ORIGIN.z);

    blocks.forEach((block) => {
      const mesh = this.createBlockMesh(block.color, false);
      mesh.position.set(
        (block.coordinate.x + 0.5) * CELL_SIZE,
        (block.coordinate.y + 0.5) * CELL_SIZE,
        (block.coordinate.z + 0.5) * CELL_SIZE
      );
      group.add(mesh);
    });

    this.settledBlocksGroup = group;
    this.scene.add(group);
    this.renderFrame();
  }

  public updateHud(
    queue: readonly TetrominoType[],
    phase: GamePhase,
    clearedLayerCount: number,
    score: number,
    level: number,
    dropIntervalMs: number,
    elapsedMs: number,
    isPaused: boolean,
    settingsOpen: boolean
  ): void {
    if (!this.hudElement) {
      return;
    }

    this.hudState.queue = queue;
    this.hudState.phase = phase;
    this.hudState.clearedLayerCount = clearedLayerCount;
    this.hudState.score = score;
    this.hudState.level = level;
    this.hudState.dropIntervalMs = dropIntervalMs;
    this.hudState.elapsedMs = elapsedMs;
    this.hudState.isPaused = isPaused;
    this.hudState.settingsOpen = settingsOpen;

    this.syncHud();
  }

  private syncHud(): void {
    if (!this.hudElement) {
      return;
    }

    const root = this.hudElement;
    this.setText(root, '[data-role="score"]', this.formatNumber(this.hudState.score));
    this.setText(root, '[data-role="level"]', String(this.hudState.level));
    this.setText(root, '[data-role="lines"]', String(this.hudState.clearedLayerCount));
    this.setText(root, '[data-role="status-label"]', this.getStatusLabel());
    this.setText(root, '[data-role="speed"]', `${(1000 / this.hudState.dropIntervalMs).toFixed(2)}x`);
    this.setText(root, '[data-role="timer"]', this.formatElapsed(this.hudState.elapsedMs));
    this.setText(root, '[data-role="pause-label"]', this.hudState.isPaused ? 'RESUME' : 'PAUSE');
    this.setText(
      root,
      '[data-role="footer-tip"]',
      this.hudState.phase === 'game-over'
        ? 'Rotate the camera and reopen a fresh run.'
        : 'Clear more layers at once to push higher scores.'
    );

    this.renderPreview(
      root.querySelector('[data-role="next-piece"]'),
      this.hudState.queue[0] ?? 'T'
    );
    this.renderPreview(
      root.querySelector('[data-role="hold-piece"]'),
      this.hudState.queue[1] ?? 'S'
    );

    const overlay = root.querySelector<HTMLElement>('[data-role="overlay"]');
    if (overlay) {
      overlay.hidden = this.hudState.phase !== 'game-over';
      this.setText(overlay, '[data-role="overlay-score"]', this.formatNumber(this.hudState.score));
      this.setText(overlay, '[data-role="overlay-level"]', String(this.hudState.level));
      this.setText(overlay, '[data-role="overlay-lines"]', String(this.hudState.clearedLayerCount));
      this.setText(overlay, '[data-role="overlay-time"]', this.formatElapsed(this.hudState.elapsedMs));
    }

    const settings = root.querySelector<HTMLElement>('[data-role="settings-panel"]');
    if (settings) {
      settings.hidden = !this.hudState.settingsOpen;
    }
  }

  private createHudElement(): HTMLDivElement {
    const hud = document.createElement('div');
    hud.className = 'ui-layer';
    hud.innerHTML = `
      <div class="brand-panel">
        <div class="brand-mark"><span>3D</span> TETRIS</div>
      </div>
      <section class="info-card tip-card">
        <div class="card-icon">◇</div>
        <div>
          <div class="card-title">TIP</div>
          <p>This is 3D. Move, rotate, and think in every direction.</p>
        </div>
      </section>
      <section class="axis-card">
        <div class="axis axis-y"></div>
        <div class="axis axis-x"></div>
        <div class="axis axis-z"></div>
        <span class="axis-label axis-label-y">Y</span>
        <span class="axis-label axis-label-x">X</span>
        <span class="axis-label axis-label-z">Z</span>
      </section>
      <aside class="right-rail">
        <section class="panel stat-panel">
          <div class="metric-row"><span>🏆 SCORE</span><strong data-role="score">0</strong></div>
          <div class="metric-row"><span>▥ LEVEL</span><strong data-role="level">1</strong></div>
          <div class="metric-row"><span>▤ LINES</span><strong data-role="lines">0</strong></div>
        </section>
        <section class="panel preview-panel">
          <h3>NEXT PIECE</h3>
          <div class="piece-preview" data-role="next-piece"></div>
        </section>
        <section class="panel preview-panel">
          <h3>HOLD PIECE</h3>
          <div class="piece-preview" data-role="hold-piece"></div>
        </section>
        <section class="panel controls-panel">
          <h3>CONTROLS</h3>
          <div class="control-grid">
            <div class="control-row"><span class="keys">← ↑ ↓ →</span><span>MOVE</span></div>
            <div class="control-row"><span class="keys">Q E / A D / Z X</span><span>ROTATE</span></div>
            <div class="control-row"><span class="keys">SPACE</span><span>DROP</span></div>
            <div class="control-row"><span class="keys">DRAG</span><span>CAMERA</span></div>
          </div>
        </section>
      </aside>
      <div class="action-row">
        <button class="action-button" data-action="pause" type="button"><span>Ⅱ</span><span data-role="pause-label">PAUSE</span></button>
        <button class="action-button" data-action="restart" type="button"><span>↻</span><span>RESTART</span></button>
        <button class="action-button" data-action="settings" type="button"><span>⚙</span><span>SETTINGS</span></button>
      </div>
      <section class="status-bar">
        <div class="status-pill"><span class="status-label">STATUS</span><span class="status-dot"></span><span data-role="status-label">RUNNING</span></div>
        <div class="status-hint"><span>◌</span><span data-role="footer-tip"></span></div>
        <div class="status-meta"><span>SPEED <b data-role="speed">1.00x</b></span><span data-role="timer">00:00:00</span></div>
      </section>
      <section class="panel settings-panel" data-role="settings-panel" hidden>
        <h3>VIEW SETTINGS</h3>
        <div class="settings-copy">
          <p>Drag to orbit the tower.</p>
          <p>Wheel to zoom the camera.</p>
          <p>Press <strong>R</strong> at any time to restart.</p>
        </div>
      </section>
      <section class="overlay-card" data-role="overlay" hidden>
        <div class="overlay-alert">⚠</div>
        <h2>GAME OVER</h2>
        <p>The tower has reached the top.</p>
        <div class="overlay-scorebox">
          <span>FINAL SCORE</span>
          <strong data-role="overlay-score">0</strong>
        </div>
        <div class="overlay-metrics">
          <div><span>LEVEL REACHED</span><strong data-role="overlay-level">1</strong></div>
          <div><span>LINES CLEARED</span><strong data-role="overlay-lines">0</strong></div>
          <div><span>TIME PLAYED</span><strong data-role="overlay-time">00:00:00</strong></div>
        </div>
        <div class="overlay-actions">
          <button class="overlay-button overlay-button-danger" data-action="restart" type="button">⟳ RETRY</button>
          <button class="overlay-button overlay-button-primary" data-action="settings" type="button">⌂ MENU</button>
        </div>
        <p class="overlay-footnote">You can always rotate the view and look for a path.</p>
      </section>
    `;

    hud.querySelectorAll<HTMLElement>('[data-action]').forEach((element) => {
      element.addEventListener('click', () => {
        const action = element.dataset.action;
        if (action === 'restart') {
          this.callbacks.onRestart?.();
          return;
        }
        if (action === 'pause') {
          this.callbacks.onTogglePause?.();
          return;
        }
        if (action === 'settings') {
          this.callbacks.onToggleSettings?.();
        }
      });
    });

    this.hudElement = hud;
    return hud;
  }

  private createFieldBounds(): Group {
    const group = new Group();
    group.position.set(FIELD_ORIGIN.x, FIELD_ORIGIN.y, FIELD_ORIGIN.z);

    const { width, height, depth } = this.gameState.getDimensions();
    const panelMaterial = new MeshStandardMaterial({
      color: 0x0a1330,
      transparent: true,
      opacity: 0.12,
      roughness: 0.35,
      metalness: 0.25
    });

    const floor = new Mesh(
      new PlaneGeometry(width * CELL_SIZE, depth * CELL_SIZE),
      new MeshStandardMaterial({
        color: 0x061125,
        roughness: 0.5,
        metalness: 0.3,
        transparent: true,
        opacity: 0.4
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((width * CELL_SIZE) / 2, 0, (depth * CELL_SIZE) / 2);

    const leftWall = new Mesh(
      new PlaneGeometry(depth * CELL_SIZE, height * CELL_SIZE),
      panelMaterial
    );
    leftWall.position.set(0, (height * CELL_SIZE) / 2, (depth * CELL_SIZE) / 2);
    leftWall.rotation.y = Math.PI / 2;

    const rightWall = leftWall.clone();
    rightWall.position.set(width * CELL_SIZE, (height * CELL_SIZE) / 2, (depth * CELL_SIZE) / 2);
    rightWall.rotation.y = -Math.PI / 2;

    const backWall = new Mesh(
      new PlaneGeometry(width * CELL_SIZE, height * CELL_SIZE),
      panelMaterial
    );
    backWall.position.set((width * CELL_SIZE) / 2, (height * CELL_SIZE) / 2, depth * CELL_SIZE);
    backWall.rotation.y = Math.PI;

    const ceiling = new Mesh(
      new PlaneGeometry(width * CELL_SIZE, depth * CELL_SIZE),
      panelMaterial.clone()
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set((width * CELL_SIZE) / 2, height * CELL_SIZE, (depth * CELL_SIZE) / 2);

    const boundsGeometry = new BoxGeometry(width * CELL_SIZE, height * CELL_SIZE, depth * CELL_SIZE);
    boundsGeometry.translate(
      (width * CELL_SIZE) / 2,
      (height * CELL_SIZE) / 2,
      (depth * CELL_SIZE) / 2
    );
    const bounds = new LineSegments(
      new EdgesGeometry(boundsGeometry),
      new LineBasicMaterial({ color: 0x7bd9ff, transparent: true, opacity: 0.85 })
    );

    const verticals = new Group();
    const lineMaterial = new LineBasicMaterial({
      color: 0x4eb3ff,
      transparent: true,
      opacity: 0.35
    });

    for (let x = 0; x <= width; x += 1) {
      for (let z = 0; z <= depth; z += 1) {
        if (x !== 0 && x !== width && z !== 0 && z !== depth) {
          continue;
        }
        const geometry = new BoxGeometry(0.02, height * CELL_SIZE, 0.02);
        geometry.translate(x * CELL_SIZE, (height * CELL_SIZE) / 2, z * CELL_SIZE);
        verticals.add(new LineSegments(new EdgesGeometry(geometry), lineMaterial));
      }
    }

    const horizontalGrid = new Group();
    for (let y = 1; y < height; y += 1) {
      const ringGeometry = new BoxGeometry(width * CELL_SIZE, 0.01, depth * CELL_SIZE);
      ringGeometry.translate((width * CELL_SIZE) / 2, y * CELL_SIZE, (depth * CELL_SIZE) / 2);
      horizontalGrid.add(
        new LineSegments(
          new EdgesGeometry(ringGeometry),
          new LineBasicMaterial({
            color: 0x4a78d5,
            transparent: true,
            opacity: 0.14
          })
        )
      );
    }

    group.add(floor, ceiling, leftWall, rightWall, backWall, bounds, verticals, horizontalGrid);
    return group;
  }

  private createLighting(): Group {
    const group = new Group();
    group.add(new AmbientLight(0xb9d5ff, 0.5));

    const key = new DirectionalLight(0x8fd7ff, 1.4);
    key.position.set(14, 22, 10);
    group.add(key);

    const rim = new DirectionalLight(0x6f7cff, 0.8);
    rim.position.set(-12, 16, -8);
    group.add(rim);

    const warm = new DirectionalLight(0xffb44a, 0.55);
    warm.position.set(4, 8, 14);
    group.add(warm);

    return group;
  }

  private createFloorHalo(): Group {
    const group = new Group();
    const { width, depth } = FIELD_DIMENSIONS;

    for (let i = 0; i < 4; i += 1) {
      const scale = 1.2 + i * 0.4;
      const geometry = new PlaneGeometry(width * scale, depth * scale, 1, 1);
      const mesh = new Mesh(
        geometry,
        new MeshBasicMaterial({
          color: i % 2 === 0 ? 0x173d8a : 0x7a2cbf,
          transparent: true,
          opacity: 0.05
        })
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(0, -0.02 - i * 0.002, 0);
      group.add(mesh);
    }

    return group;
  }

  private createBlockMesh(color: number, isActive: boolean): Group {
    const cube = new Group();

    const solid = new Mesh(
      new BoxGeometry(CELL_SIZE * 0.95, CELL_SIZE * 0.95, CELL_SIZE * 0.95),
      new MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: isActive ? 0.45 : 0.22,
        metalness: 0.18,
        roughness: 0.28,
        transparent: true,
        opacity: isActive ? 0.95 : 0.82
      })
    );
    cube.add(solid);

    cube.add(
      new LineSegments(
        new EdgesGeometry(new BoxGeometry(CELL_SIZE, CELL_SIZE, CELL_SIZE)),
        new LineBasicMaterial({
          color: 0xf5fbff,
          transparent: true,
          opacity: isActive ? 0.72 : 0.38
        })
      )
    );

    return cube;
  }

  private attachCameraControls(): void {
    if (!this.renderer || this.controlsBound) {
      return;
    }

    const canvas = this.renderer.domElement;

    this.pointerDownHandler = (event: PointerEvent) => {
      this.cameraOrbit.dragging = true;
      this.cameraOrbit.pointerId = event.pointerId;
      this.cameraOrbit.lastX = event.clientX;
      this.cameraOrbit.lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    };

    this.pointerMoveHandler = (event: PointerEvent) => {
      if (!this.cameraOrbit.dragging || this.cameraOrbit.pointerId !== event.pointerId) {
        return;
      }

      const deltaX = event.clientX - this.cameraOrbit.lastX;
      const deltaY = event.clientY - this.cameraOrbit.lastY;
      this.cameraOrbit.lastX = event.clientX;
      this.cameraOrbit.lastY = event.clientY;

      this.cameraOrbit.theta -= deltaX * 0.008;
      this.cameraOrbit.phi = clamp(this.cameraOrbit.phi + deltaY * 0.008, 0.45, 1.45);

      if (this.camera) {
        this.applyCameraOrbit(this.camera);
        this.renderFrame();
      }
    };

    this.pointerUpHandler = (event: PointerEvent) => {
      if (this.cameraOrbit.pointerId === event.pointerId) {
        this.cameraOrbit.dragging = false;
        this.cameraOrbit.pointerId = null;
        canvas.releasePointerCapture(event.pointerId);
      }
    };

    this.wheelHandler = (event: WheelEvent) => {
      event.preventDefault();
      this.cameraOrbit.radius = clamp(this.cameraOrbit.radius + event.deltaY * 0.02, 14, 42);
      if (this.camera) {
        this.applyCameraOrbit(this.camera);
        this.renderFrame();
      }
    };

    canvas.addEventListener('pointerdown', this.pointerDownHandler);
    canvas.addEventListener('pointermove', this.pointerMoveHandler);
    canvas.addEventListener('pointerup', this.pointerUpHandler);
    canvas.addEventListener('pointercancel', this.pointerUpHandler);
    canvas.addEventListener('wheel', this.wheelHandler, { passive: false });
    this.controlsBound = true;
  }

  private detachCameraControls(): void {
    if (!this.renderer || !this.controlsBound) {
      return;
    }

    const canvas = this.renderer.domElement;
    if (this.pointerDownHandler) {
      canvas.removeEventListener('pointerdown', this.pointerDownHandler);
    }
    if (this.pointerMoveHandler) {
      canvas.removeEventListener('pointermove', this.pointerMoveHandler);
    }
    if (this.pointerUpHandler) {
      canvas.removeEventListener('pointerup', this.pointerUpHandler);
      canvas.removeEventListener('pointercancel', this.pointerUpHandler);
    }
    if (this.wheelHandler) {
      canvas.removeEventListener('wheel', this.wheelHandler);
    }
    this.pointerDownHandler = null;
    this.pointerMoveHandler = null;
    this.pointerUpHandler = null;
    this.wheelHandler = null;
    this.controlsBound = false;
  }

  private applyCameraOrbit(camera: PerspectiveCamera): void {
    const { radius, theta, phi, target } = this.cameraOrbit;
    const sinPhi = Math.sin(phi);
    const x = target.x + radius * sinPhi * Math.cos(theta);
    const y = target.y + radius * Math.cos(phi);
    const z = target.z + radius * sinPhi * Math.sin(theta);
    camera.position.set(x, y, z);
    camera.lookAt(target);
  }

  private onResize(): void {
    if (!this.camera || !this.renderer) {
      return;
    }

    this.camera.aspect = this.getAspectRatio();
    this.camera.updateProjectionMatrix();
    const width = this.container?.clientWidth ?? window.innerWidth;
    const height = this.container?.clientHeight ?? window.innerHeight;
    this.renderer.setSize(width, height);
    this.renderFrame();
  }

  private getAspectRatio(): number {
    const width = this.container?.clientWidth ?? window.innerWidth;
    const height = this.container?.clientHeight ?? window.innerHeight;
    return width / height;
  }

  private disposeActiveTetrominoGroup(): void {
    if (!this.scene || !this.activeTetrominoGroup) {
      return;
    }
    this.disposeGroupMeshes(this.activeTetrominoGroup);
    this.scene.remove(this.activeTetrominoGroup);
    this.activeTetrominoGroup = null;
  }

  private disposeSettledBlocksGroup(): void {
    if (!this.scene || !this.settledBlocksGroup) {
      return;
    }
    this.disposeGroupMeshes(this.settledBlocksGroup);
    this.scene.remove(this.settledBlocksGroup);
    this.settledBlocksGroup = null;
  }

  private disposeGlowGroup(): void {
    if (!this.scene || !this.glowGroup) {
      return;
    }
    this.disposeGroupMeshes(this.glowGroup);
    this.scene.remove(this.glowGroup);
    this.glowGroup = null;
  }

  private disposeGroupMeshes(group: Group): void {
    group.traverse((child) => {
      if (!(child instanceof Mesh) && !(child instanceof LineSegments)) {
        return;
      }
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material.dispose());
      } else {
        child.material.dispose();
      }
    });
  }

  private renderPreview(container: Element | null, type: TetrominoType): void {
    if (!(container instanceof HTMLElement)) {
      return;
    }

    const definition = getTetrominoDefinition(type);
    const projected = definition.cells.map((cell, index) => ({
      left: (cell.x + cell.z * 0.52) * 26,
      top: (-cell.z * 0.44) * 26 + index * 0.2
    }));

    const minLeft = Math.min(...projected.map((cell) => cell.left));
    const minTop = Math.min(...projected.map((cell) => cell.top));
    container.innerHTML = projected
      .map(
        (cell) => `
          <span
            class="mini-voxel"
            style="
              left:${cell.left - minLeft + 28}px;
              top:${cell.top - minTop + 16}px;
              --piece-color:#${definition.color.toString(16).padStart(6, '0')};
            "
          ></span>
        `
      )
      .join('');
  }

  private setText(root: ParentNode, selector: string, text: string): void {
    const element = root.querySelector<HTMLElement>(selector);
    if (element) {
      element.textContent = text;
    }
  }

  private getStatusLabel(): string {
    if (this.hudState.phase === 'game-over') {
      return 'Game Over';
    }
    if (this.hudState.isPaused) {
      return 'Paused';
    }
    return 'Playing';
  }

  private formatNumber(value: number): string {
    return new Intl.NumberFormat('en-US').format(value);
  }

  private formatElapsed(elapsedMs: number): string {
    const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
    const hours = Math.floor(totalSeconds / 3600)
      .toString()
      .padStart(2, '0');
    const minutes = Math.floor((totalSeconds % 3600) / 60)
      .toString()
      .padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
