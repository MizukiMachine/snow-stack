import {
  AmbientLight,
  BufferGeometry,
  BoxGeometry,
  Color,
  DirectionalLight,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RingGeometry,
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
  heldPiece: TetrominoType | null;
};

type CameraOrbitState = {
  radius: number;
  theta: number;
  phi: number;
  target: Vector3;
  dragging: boolean;
  dragAxis: 'horizontal' | 'vertical' | null;
  pointerId: number | null;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
};

const CAMERA_SETTINGS = {
  targetHeightFactor: 0.42,
  initialTheta: -Math.PI / 2,
  initialPhi: 1.08,
  minPhi: 0.08,
  maxPhi: Math.PI / 2,
  rotateSpeedX: 0.0022,
  rotateSpeedY: 0.002,
  zoomSpeed: 0.01,
  minRadius: 16,
  maxRadius: 42,
  initialRadiusMultiplier: 1.46,
  axisLockThresholdPx: 6
} as const;

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
      height * CELL_SIZE * CAMERA_SETTINGS.targetHeightFactor,
      FIELD_ORIGIN.z + (depth * CELL_SIZE) / 2
    );

    this.cameraOrbit = {
      radius: 0,
      theta: CAMERA_SETTINGS.initialTheta,
      phi: CAMERA_SETTINGS.initialPhi,
      target,
      dragging: false,
      dragAxis: null,
      pointerId: null,
      startX: 0,
      startY: 0,
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
      settingsOpen: false,
      heldPiece: null
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
    scene.background = new Color('#02050d');
    scene.fog = null;

    const camera = new PerspectiveCamera(36, this.getAspectRatio(), 0.1, 1000);
    this.configureInitialCameraOrbit(camera);
    this.applyCameraOrbit(camera);

    const renderer = new WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true
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
    this.updateHud([], 'running', 0, 0, 1, 700, 0, false, false, null);
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
    settingsOpen: boolean,
    heldPiece: TetrominoType | null
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
    this.hudState.heldPiece = heldPiece;

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
        ? 'Rotate the view and start a fresh run.'
        : 'Clear more lines at once to earn higher scores!'
    );

    this.renderPreview(
      root.querySelector('[data-role="next-piece"]'),
      this.hudState.queue[0] ?? 'T'
    );
    this.renderPreview(
      root.querySelector('[data-role="hold-piece"]'),
      this.hudState.heldPiece ?? null
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
        <div class="card-icon" aria-hidden="true">
          <span></span><span></span><span></span>
        </div>
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
          <div class="metric-row"><span><i class="metric-icon">T</i> SCORE</span><strong data-role="score">0</strong></div>
          <div class="metric-row"><span><i class="metric-icon">L</i> LEVEL</span><strong data-role="level">1</strong></div>
          <div class="metric-row"><span><i class="metric-icon">S</i> LINES</span><strong data-role="lines">0</strong></div>
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
            <div class="control-row"><span class="keys"><b>←</b><b>→</b></span><span>MOVE</span></div>
            <div class="control-row"><span class="keys"><b>↑</b><b>↓</b></span><span>HEIGHT</span></div>
            <div class="control-row"><span class="keys"><b>W</b><b>S</b></span><span>DEPTH</span></div>
            <div class="control-row"><span class="keys"><b>A</b><b>D</b></span><span>ROTATE</span></div>
            <div class="control-row"><span class="keys wide"><b>SPACE</b></span><span>DROP</span></div>
            <div class="control-row"><span class="keys"><b>C</b></span><span>HOLD</span></div>
            <div class="control-row"><span class="keys"><b>◔</b></span><span>CAMERA</span></div>
          </div>
        </section>
        <div class="action-row">
          <button class="action-button" data-action="pause" type="button"><span>II</span><span data-role="pause-label">PAUSE</span></button>
          <button class="action-button" data-action="restart" type="button"><span>◔</span><span>RESTART</span></button>
          <button class="action-button" data-action="settings" type="button"><span>◌</span><span>SETTINGS</span></button>
        </div>
      </aside>
      <section class="status-bar">
        <div class="status-pill"><span class="status-label">STATUS</span><span class="status-dot"></span><span data-role="status-label">RUNNING</span></div>
        <div class="status-hint"><span>◌</span><span data-role="footer-tip"></span></div>
        <div class="status-meta"><span data-role="timer">00:00:00</span></div>
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
        <div class="overlay-alert">!</div>
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
          <button class="overlay-button overlay-button-danger" data-action="restart" type="button">RETRY</button>
          <button class="overlay-button overlay-button-primary" data-action="settings" type="button">MENU</button>
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
      opacity: 0.1,
      roughness: 0.35,
      metalness: 0.25
    });

    const floor = new Mesh(
      new PlaneGeometry(width * CELL_SIZE, depth * CELL_SIZE),
      new MeshStandardMaterial({
        color: 0x081326,
        roughness: 0.5,
        metalness: 0.3,
        transparent: true,
        opacity: 0.18
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

    const boundsGeometry = new BoxGeometry(width * CELL_SIZE, height * CELL_SIZE, depth * CELL_SIZE);
    boundsGeometry.translate(
      (width * CELL_SIZE) / 2,
      (height * CELL_SIZE) / 2,
      (depth * CELL_SIZE) / 2
    );
    const bounds = new LineSegments(
      new EdgesGeometry(boundsGeometry),
      new LineBasicMaterial({ color: 0x8fdfff, transparent: true, opacity: 0.96 })
    );

    group.add(floor, leftWall, rightWall, backWall, bounds);
    group.add(this.createFaceGrid('xy', width, height, depth, 0x62c4ff));
    group.add(this.createFaceGrid('yz', depth, height, 0, 0x4ca6ff));
    group.add(this.createFaceGrid('yz', depth, height, width, 0x4ca6ff));
    group.add(this.createFaceGrid('xz', width, depth, 0, 0x2a7cff));
    group.add(this.createCornerGlow(width, height, depth));
    return group;
  }

  private createLighting(): Group {
    const group = new Group();
    group.add(new AmbientLight(0xb9d5ff, 0.62));

    const key = new DirectionalLight(0x8fd7ff, 1.7);
    key.position.set(14, 22, 10);
    group.add(key);

    const rim = new DirectionalLight(0x6f7cff, 1);
    rim.position.set(-12, 16, -8);
    group.add(rim);

    const warm = new DirectionalLight(0xffb44a, 0.7);
    warm.position.set(4, 8, 14);
    group.add(warm);

    return group;
  }

  private createFloorHalo(): Group {
    const group = new Group();
    const { width, depth } = FIELD_DIMENSIONS;
    const centerX = FIELD_ORIGIN.x + (width * CELL_SIZE) / 2;
    const centerZ = FIELD_ORIGIN.z + (depth * CELL_SIZE) / 2;

    for (let i = 0; i < 6; i += 1) {
      const innerRadius = width * 0.9 + i * 1.8;
      const outerRadius = innerRadius + 0.12;
      const ring = new Mesh(
        new RingGeometry(innerRadius, outerRadius, 96),
        new MeshBasicMaterial({
          color: i % 2 === 0 ? 0x1e84ff : 0xab43ff,
          transparent: true,
          opacity: i === 0 ? 0.22 : 0.08
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(centerX, -0.04 - i * 0.003, centerZ);
      group.add(ring);
    }

    return group;
  }

  private createBlockMesh(color: number, isActive: boolean): Group {
    const cube = new Group();

    const solid = new Mesh(
      new BoxGeometry(CELL_SIZE * 0.92, CELL_SIZE * 0.92, CELL_SIZE * 0.92),
      new MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: isActive ? 0.92 : 0.45,
        metalness: 0.14,
        roughness: 0.12,
        transparent: true,
        opacity: isActive ? 0.56 : 0.42
      })
    );
    cube.add(solid);

    const inner = new Mesh(
      new BoxGeometry(CELL_SIZE * 0.72, CELL_SIZE * 0.72, CELL_SIZE * 0.72),
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: isActive ? 0.3 : 0.2
      })
    );
    cube.add(inner);

    cube.add(
      new LineSegments(
        new EdgesGeometry(new BoxGeometry(CELL_SIZE, CELL_SIZE, CELL_SIZE)),
        new LineBasicMaterial({
          color: 0xf5fbff,
          transparent: true,
          opacity: isActive ? 0.96 : 0.7
        })
      )
    );

    return cube;
  }

  private createFaceGrid(
    plane: 'xy' | 'yz' | 'xz',
    spanA: number,
    spanB: number,
    offset: number,
    color: number
  ): Group {
    const group = new Group();
    const positions: number[] = [];

    for (let a = 0; a <= spanA; a += 1) {
      for (let b = 0; b <= spanB; b += 1) {
        const point = this.getPlanePoint(plane, a, b, offset);
        positions.push(point.x, point.y, point.z);
      }
    }

    const pointsGeometry = new BufferGeometry();
    pointsGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    group.add(
      new Points(
        pointsGeometry,
        new PointsMaterial({
          color,
          size: 0.045,
          transparent: true,
          opacity: 0.54
        })
      )
    );

    const lineMaterial = new LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.12
    });

    for (let a = 0; a <= spanA; a += 1) {
      const geometry = new BufferGeometry().setFromPoints([
        this.getPlanePoint(plane, a, 0, offset),
        this.getPlanePoint(plane, a, spanB, offset)
      ]);
      group.add(new LineSegments(geometry, lineMaterial));
    }

    for (let b = 0; b <= spanB; b += 1) {
      const geometry = new BufferGeometry().setFromPoints([
        this.getPlanePoint(plane, 0, b, offset),
        this.getPlanePoint(plane, spanA, b, offset)
      ]);
      group.add(new LineSegments(geometry, lineMaterial));
    }

    return group;
  }

  private getPlanePoint(plane: 'xy' | 'yz' | 'xz', a: number, b: number, offset: number): Vector3 {
    if (plane === 'xy') {
      return new Vector3(a * CELL_SIZE, b * CELL_SIZE, offset * CELL_SIZE);
    }
    if (plane === 'yz') {
      return new Vector3(offset * CELL_SIZE, b * CELL_SIZE, a * CELL_SIZE);
    }
    return new Vector3(a * CELL_SIZE, offset * CELL_SIZE, b * CELL_SIZE);
  }

  private createCornerGlow(width: number, height: number, depth: number): Group {
    const group = new Group();
    const corners = [
      [0, 0, 0],
      [width, 0, 0],
      [0, 0, depth],
      [width, 0, depth],
      [0, height, 0],
      [width, height, 0],
      [0, height, depth],
      [width, height, depth]
    ] as const;

    corners.forEach(([x, y, z]) => {
      const orb = new Mesh(
        new SphereGeometry(0.14, 10, 10),
        new MeshBasicMaterial({
          color: 0x7fd9ff,
          transparent: true,
          opacity: 0.9
        })
      );
      orb.position.set(x * CELL_SIZE, y * CELL_SIZE, z * CELL_SIZE);
      group.add(orb);
    });

    return group;
  }

  private attachCameraControls(): void {
    if (!this.renderer || this.controlsBound) {
      return;
    }

    const canvas = this.renderer.domElement;

    this.pointerDownHandler = (event: PointerEvent) => {
      this.cameraOrbit.dragging = true;
      this.cameraOrbit.dragAxis = null;
      this.cameraOrbit.pointerId = event.pointerId;
      this.cameraOrbit.startX = event.clientX;
      this.cameraOrbit.startY = event.clientY;
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
      const dragX = event.clientX - this.cameraOrbit.startX;
      const dragY = event.clientY - this.cameraOrbit.startY;
      this.cameraOrbit.lastX = event.clientX;
      this.cameraOrbit.lastY = event.clientY;

      if (
        !this.cameraOrbit.dragAxis &&
        (Math.abs(dragX) >= CAMERA_SETTINGS.axisLockThresholdPx ||
          Math.abs(dragY) >= CAMERA_SETTINGS.axisLockThresholdPx)
      ) {
        this.cameraOrbit.dragAxis =
          Math.abs(dragX) >= Math.abs(dragY) ? 'horizontal' : 'vertical';
      }

      if (this.cameraOrbit.dragAxis === 'horizontal') {
        this.cameraOrbit.theta -= deltaX * CAMERA_SETTINGS.rotateSpeedX;
      } else if (this.cameraOrbit.dragAxis === 'vertical') {
        this.cameraOrbit.phi = clamp(
          this.cameraOrbit.phi - deltaY * CAMERA_SETTINGS.rotateSpeedY,
          CAMERA_SETTINGS.minPhi,
          CAMERA_SETTINGS.maxPhi
        );
      }

      if (this.camera) {
        this.applyCameraOrbit(this.camera);
        this.renderFrame();
      }
    };

    this.pointerUpHandler = (event: PointerEvent) => {
      if (this.cameraOrbit.pointerId === event.pointerId) {
        this.cameraOrbit.dragging = false;
        this.cameraOrbit.dragAxis = null;
        this.cameraOrbit.pointerId = null;
        canvas.releasePointerCapture(event.pointerId);
      }
    };

    this.wheelHandler = (event: WheelEvent) => {
      event.preventDefault();
      this.cameraOrbit.radius = clamp(
        this.cameraOrbit.radius + event.deltaY * CAMERA_SETTINGS.zoomSpeed,
        CAMERA_SETTINGS.minRadius,
        CAMERA_SETTINGS.maxRadius
      );
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

  private configureInitialCameraOrbit(camera: PerspectiveCamera): void {
    const { width, height, depth } = this.gameState.getDimensions();
    const paddedHeight = height + 2;
    const halfWidth = (width * CELL_SIZE) / 2;
    const halfHeight = (paddedHeight * CELL_SIZE) / 2;
    const halfDepth = (depth * CELL_SIZE) / 2;
    const halfVerticalFov = (camera.fov * Math.PI) / 360;
    const halfHorizontalFov = Math.atan(Math.tan(halfVerticalFov) * camera.aspect);
    const fitHeightDistance = halfHeight / Math.tan(halfVerticalFov);
    const fitWidthDistance = halfWidth / Math.tan(halfHorizontalFov);
    const boundingRadius = Math.hypot(halfWidth, halfHeight, halfDepth);

    this.cameraOrbit.radius =
      Math.max(fitHeightDistance, fitWidthDistance, boundingRadius) *
      CAMERA_SETTINGS.initialRadiusMultiplier;
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

  private renderPreview(container: Element | null, type: TetrominoType | null): void {
    if (!(container instanceof HTMLElement)) {
      return;
    }

    if (!type) {
      container.innerHTML = '';
      return;
    }

    const definition = getTetrominoDefinition(type);
    const projected = definition.cells.map((cell) => ({
      left: cell.x * 31 + cell.z * 17,
      top: -cell.z * 27 + cell.y * -12
    }));

    const minLeft = Math.min(...projected.map((cell) => cell.left));
    const minTop = Math.min(...projected.map((cell) => cell.top));
    const maxLeft = Math.max(...projected.map((cell) => cell.left));
    const maxTop = Math.max(...projected.map((cell) => cell.top));
    const width = maxLeft - minLeft + 34;
    const height = maxTop - minTop + 34;

    container.innerHTML = projected
      .map(
        (cell) => `
          <span
            class="mini-voxel"
            style="
              left:${cell.left - minLeft + 50 - width / 2}px;
              top:${cell.top - minTop + 58 - height / 2}px;
              --piece-color:#${definition.color.toString(16).padStart(6, '0')};
            "
          ><span></span></span>
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
