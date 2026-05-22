import {
  AdditiveBlending,
  AmbientLight,
  BufferGeometry,
  BoxGeometry,
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
  SRGBColorSpace,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer
} from 'three';
import type { Material } from 'three';
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

type HudIconName =
  | 'alert'
  | 'chart'
  | 'cube'
  | 'home'
  | 'layers'
  | 'lightbulb'
  | 'mouse'
  | 'pause'
  | 'restart'
  | 'settings'
  | 'snowflake'
  | 'trophy';

const CAMERA_SETTINGS = {
  targetHeightFactor: 0.5,
  initialTheta: -1.58,
  initialPhi: 0.74,
  minPhi: 0.22,
  maxPhi: 1.42,
  rotateSpeedX: 0.0022,
  rotateSpeedY: 0.002,
  zoomSpeed: 0.01,
  minRadius: 14,
  maxRadius: 38,
  initialRadiusMultiplier: 1.04,
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
  private lastNextPreviewType: TetrominoType | null = null;
  private lastHeldPreviewType: TetrominoType | null | undefined = undefined;

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
    this.canvasHost = canvasHost;

    const scene = new Scene();
    scene.background = null;
    scene.fog = null;

    const camera = new PerspectiveCamera(34, this.getAspectRatio(), 0.1, 1000);
    this.configureInitialCameraOrbit(camera);
    this.applyCameraOrbit(camera);

    const renderer = new WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    const renderSize = this.getRenderSize();
    renderer.setSize(renderSize.width, renderSize.height, false);
    renderer.domElement.className = 'scene-canvas';
    canvasHost.appendChild(renderer.domElement);

    container.appendChild(this.createHudElement());

    scene.add(this.createLighting());
    scene.add(this.createFieldBounds());
    scene.add(this.createFloorHalo());

    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;

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
    if (this.scene) {
      this.disposeObjectResources(this.scene);
      this.scene.clear();
    }
    this.renderer?.domElement.remove();
    this.renderer?.dispose();
    this.hudElement?.remove();
    this.canvasHost?.remove();
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.hudElement = null;
    this.container = null;
    this.canvasHost = null;
    this.activeTetrominoGroup = null;
    this.settledBlocksGroup = null;
    this.glowGroup = null;
    this.lastNextPreviewType = null;
    this.lastHeldPreviewType = undefined;
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
  }

  public updateElapsedTime(elapsedMs: number): void {
    if (!this.hudElement) {
      return;
    }

    this.hudState.elapsedMs = elapsedMs;
    this.syncHudTimer(this.hudElement);
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
    root.dataset.phase = this.hudState.phase;
    root.dataset.paused = String(this.hudState.isPaused);
    this.setText(root, '[data-role="score"]', this.formatNumber(this.hudState.score));
    this.setText(root, '[data-role="level"]', String(this.hudState.level).padStart(2, '0'));
    this.setText(
      root,
      '[data-role="lines"]',
      String(this.hudState.clearedLayerCount).padStart(3, '0')
    );
    this.setText(root, '[data-role="status-label"]', this.getStatusLabel());
    this.setText(root, '[data-role="speed"]', `${(1000 / this.hudState.dropIntervalMs).toFixed(2)}x`);
    this.syncHudTimer(root);
    this.setText(root, '[data-role="pause-label"]', this.hudState.isPaused ? 'RESUME' : 'PAUSE');
    this.setMeter(root, '[data-role="level-meter"]', Math.min(7, this.hudState.level));
    this.setMeter(
      root,
      '[data-role="layers-meter"]',
      this.hudState.clearedLayerCount === 0
        ? 0
        : Math.min(8, Math.max(1, this.hudState.clearedLayerCount % 9))
    );
    this.setText(
      root,
      '[data-role="footer-tip"]',
      this.hudState.phase === 'game-over'
        ? 'Rotate the view and start a fresh run.'
        : 'Complete horizontal Y-layers to clear them.'
    );

    const nextPreviewType = this.hudState.queue[0] ?? 'T';
    if (nextPreviewType !== this.lastNextPreviewType) {
      this.renderPreview(root.querySelector('[data-role="next-piece"]'), nextPreviewType);
      this.lastNextPreviewType = nextPreviewType;
    }

    const heldPreviewType = this.hudState.heldPiece ?? null;
    if (heldPreviewType !== this.lastHeldPreviewType) {
      this.renderPreview(root.querySelector('[data-role="hold-piece"]'), heldPreviewType);
      this.lastHeldPreviewType = heldPreviewType;
    }

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
    const icon = (name: HudIconName) => renderHudIcon(name);
    hud.className = 'ui-layer';
    hud.innerHTML = `
      <div class="brand-panel">
        <div class="brand-emblem">${icon('snowflake')}</div>
        <div class="brand-copy">
          <div class="brand-title">VOXEL<br />TETRIS</div>
          <div class="brand-subtitle">3D VOXEL PUZZLE GAME</div>
        </div>
      </div>
      <section class="info-card tip-card">
        <div class="card-title">${icon('snowflake')}<span>TIP</span></div>
        <div>
          <p>This is 3D. Move, rotate, and think in every direction.</p>
          <div class="tip-dots" aria-hidden="true"><span class="is-active"></span><span></span><span></span><span></span></div>
        </div>
      </section>
      <aside class="right-rail">
        <div class="telemetry-stack">
          <section class="panel metric-card">
            <div class="panel-heading">${icon('snowflake')}<span>SCORE</span></div>
            <strong class="metric-value" data-role="score">0</strong>
          </section>
          <section class="panel metric-card">
            <div class="panel-heading">${icon('snowflake')}<span>LEVEL</span></div>
            <div class="metric-inline"><strong class="metric-value" data-role="level">01</strong><div class="meter meter-dots" data-role="level-meter">${renderMeterSegments(7)}</div></div>
          </section>
          <section class="panel metric-card">
            <div class="panel-heading">${icon('snowflake')}<span>LAYERS</span></div>
            <div class="metric-inline"><strong class="metric-value" data-role="lines">000</strong><div class="meter meter-bars" data-role="layers-meter">${renderMeterSegments(8)}</div></div>
          </section>
          <section class="panel preview-panel">
            <h3>${icon('snowflake')}<span>NEXT PIECE</span></h3>
            <div class="piece-preview" data-role="next-piece"></div>
          </section>
          <section class="panel preview-panel">
            <h3>${icon('snowflake')}<span>HOLD PIECE</span></h3>
            <div class="piece-preview" data-role="hold-piece"></div>
          </section>
        </div>
        <div class="command-stack">
          <section class="panel controls-panel">
            <h3>${icon('snowflake')}<span>CONTROLS</span></h3>
            <div class="control-grid">
              <div class="control-row"><span class="keys"><b>←</b><b>→</b></span><span>Move X / Z</span></div>
              <div class="control-row"><span class="keys"><b>W</b></span><span>Move Up (Y+)</span></div>
              <div class="control-row"><span class="keys"><b>S</b></span><span>Move Down (Y-)</span></div>
              <div class="control-row"><span class="keys"><b>Q</b><b>E</b></span><span>Rotate Y Axis</span></div>
              <div class="control-row"><span class="keys"><b>A</b><b>D</b></span><span>Rotate Z Axis</span></div>
              <div class="control-row"><span class="keys"><b>Z</b><b>X</b></span><span>Rotate X Axis</span></div>
              <div class="control-row"><span class="keys"><b class="wide-key">Space</b></span><span>Hard Drop</span></div>
              <div class="control-row"><span class="keys"><b>C</b></span><span>Hold Piece</span></div>
              <div class="control-row"><span class="keys"><b class="wide-key">P / Esc</b></span><span>Pause</span></div>
              <div class="control-row"><span class="keys"><b>R</b></span><span>Restart</span></div>
              <div class="control-separator"></div>
              <div class="control-row"><span class="keys"><b class="wide-key key-icon">${icon('mouse')}Mouse</b></span><span>Rotate View</span></div>
              <div class="control-row"><span class="keys"><b class="wide-key">Wheel</b></span><span>Zoom</span></div>
            </div>
          </section>
          <div class="action-row">
            <button class="action-button" data-action="pause" type="button"><span class="button-icon">${icon('pause')}</span><span data-role="pause-label">PAUSE</span></button>
            <button class="action-button" data-action="restart" type="button"><span class="button-icon">${icon('restart')}</span><span>RESTART</span></button>
            <button class="action-button" data-action="settings" type="button"><span class="button-icon">${icon('settings')}</span><span>SETTINGS</span></button>
          </div>
        </div>
      </aside>
      <section class="status-bar">
        <div class="status-pill">${icon('snowflake')}<div><span class="status-label">STATUS</span><span class="status-state"><span class="status-dot"></span><span data-role="status-label">RUNNING</span></span></div></div>
        <div class="status-hint">${icon('snowflake')}<div><span class="status-label">HINT</span><span data-role="footer-tip"></span></div></div>
        <div class="status-meta"><span class="status-label">TIME</span><span data-role="timer">00:00:00</span></div>
        <div class="status-actions">
          <button class="status-button" data-action="pause" type="button">${icon('pause')}<span data-role="pause-label">PAUSE</span></button>
          <button class="status-button" data-action="restart" type="button">${icon('restart')}<span>RESTART</span></button>
          <button class="status-button" data-action="settings" type="button">${icon('settings')}<span>SETTINGS</span></button>
        </div>
      </section>
      <section class="panel settings-panel" data-role="settings-panel" hidden>
        <h3>${icon('snowflake')}<span>VIEW SETTINGS</span></h3>
        <div class="settings-copy">
          <p>Drag to orbit the tower.</p>
          <p>Wheel to zoom the camera.</p>
          <p>Press <strong>R</strong> at any time to restart.</p>
        </div>
      </section>
      <section class="overlay-card" data-role="overlay" hidden>
        <div class="overlay-alert">${icon('alert')}</div>
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
          <button class="overlay-button overlay-button-danger" data-action="restart" type="button">${icon('restart')}<span>RETRY</span></button>
          <button class="overlay-button overlay-button-primary" data-action="settings" type="button">${icon('home')}<span>MENU</span></button>
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
      color: 0xe8fbff,
      transparent: true,
      opacity: 0.22,
      roughness: 0.14,
      metalness: 0.42,
      depthWrite: false
    });

    const floor = new Mesh(
      new PlaneGeometry(width * CELL_SIZE, depth * CELL_SIZE),
      new MeshStandardMaterial({
        color: 0xf2fdff,
        roughness: 0.18,
        metalness: 0.48,
        transparent: true,
        opacity: 0.34,
        depthWrite: false
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
      new LineBasicMaterial({ color: 0xf7feff, transparent: true, opacity: 0.98 })
    );

    group.add(floor, leftWall, rightWall, backWall, bounds);
    group.add(this.createFieldFrameGlow(width, height, depth));
    group.add(this.createFaceGrid('xy', width, height, 0, 0x58c9ff));
    group.add(this.createFaceGrid('xy', width, height, depth, 0x62c4ff));
    group.add(this.createFaceGrid('yz', depth, height, 0, 0x4ca6ff));
    group.add(this.createFaceGrid('yz', depth, height, width, 0x4ca6ff));
    group.add(this.createFaceGrid('xz', width, depth, 0, 0x2a7cff));
    group.add(this.createFaceGrid('xz', width, depth, height, 0x62c4ff));
    group.add(this.createLayerScanBand(width, depth, Math.max(1, Math.round(height * 0.4))));
    group.add(this.createCornerGlow(width, height, depth));
    return group;
  }

  private createLighting(): Group {
    const group = new Group();
    group.add(new AmbientLight(0xe6f6ff, 1.08));

    const key = new DirectionalLight(0xc9f4ff, 1.85);
    key.position.set(14, 22, 10);
    group.add(key);

    const rim = new DirectionalLight(0x6dbdff, 1.1);
    rim.position.set(-12, 16, -8);
    group.add(rim);

    const warm = new DirectionalLight(0xffd184, 0.44);
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
          color: i % 2 === 0 ? 0x18d6ff : 0x7da7ff,
          transparent: true,
          opacity: i === 0 ? 0.34 : 0.11
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

    const glowShell = new Mesh(
      new BoxGeometry(CELL_SIZE * 1.1, CELL_SIZE * 1.1, CELL_SIZE * 1.1),
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: isActive ? 0.18 : 0.1,
        depthWrite: false,
        blending: AdditiveBlending
      })
    );
    cube.add(glowShell);

    const solid = new Mesh(
      new BoxGeometry(CELL_SIZE * 0.92, CELL_SIZE * 0.92, CELL_SIZE * 0.92),
      new MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: isActive ? 1.08 : 0.62,
        metalness: 0.22,
        roughness: 0.16,
        transparent: true,
        opacity: isActive ? 0.94 : 0.88
      })
    );
    cube.add(solid);

    const inner = new Mesh(
      new BoxGeometry(CELL_SIZE * 0.72, CELL_SIZE * 0.72, CELL_SIZE * 0.72),
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: isActive ? 0.3 : 0.24
      })
    );
    cube.add(inner);

    cube.add(
      new LineSegments(
        new EdgesGeometry(new BoxGeometry(CELL_SIZE, CELL_SIZE, CELL_SIZE)),
        new LineBasicMaterial({
          color: 0xf5fbff,
          transparent: true,
          opacity: isActive ? 0.98 : 0.78
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
          size: 0.07,
          transparent: true,
          opacity: 0.86,
          depthWrite: false
        })
      )
    );

    const lineMaterial = new LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.42,
      depthWrite: false
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

  private createFieldFrameGlow(width: number, height: number, depth: number): Group {
    const group = new Group();
    const boundsGeometry = new BoxGeometry(width * CELL_SIZE, height * CELL_SIZE, depth * CELL_SIZE);
    boundsGeometry.translate(
      (width * CELL_SIZE) / 2,
      (height * CELL_SIZE) / 2,
      (depth * CELL_SIZE) / 2
    );

    group.add(
      new LineSegments(
        new EdgesGeometry(boundsGeometry),
        new LineBasicMaterial({
          color: 0x70f4ff,
          transparent: true,
          opacity: 0.82,
          depthWrite: false
        })
      )
    );

    const baseGeometry = new BufferGeometry().setFromPoints([
      new Vector3(0, 0, 0),
      new Vector3(width * CELL_SIZE, 0, 0),
      new Vector3(width * CELL_SIZE, 0, 0),
      new Vector3(width * CELL_SIZE, 0, depth * CELL_SIZE),
      new Vector3(width * CELL_SIZE, 0, depth * CELL_SIZE),
      new Vector3(0, 0, depth * CELL_SIZE),
      new Vector3(0, 0, depth * CELL_SIZE),
      new Vector3(0, 0, 0)
    ]);
    group.add(
      new LineSegments(
        baseGeometry,
        new LineBasicMaterial({
          color: 0x28e8ff,
          transparent: true,
          opacity: 1,
          depthWrite: false
        })
      )
    );

    return group;
  }

  private createLayerScanBand(width: number, depth: number, layer: number): Group {
    const group = new Group();
    const y = layer * CELL_SIZE;
    const points = [
      new Vector3(0, y, 0),
      new Vector3(width * CELL_SIZE, y, 0),
      new Vector3(width * CELL_SIZE, y, 0),
      new Vector3(width * CELL_SIZE, y, depth * CELL_SIZE),
      new Vector3(width * CELL_SIZE, y, depth * CELL_SIZE),
      new Vector3(0, y, depth * CELL_SIZE),
      new Vector3(0, y, depth * CELL_SIZE),
      new Vector3(0, y, 0)
    ];

    group.add(
      new LineSegments(
        new BufferGeometry().setFromPoints(points),
        new LineBasicMaterial({
          color: 0x56f6ff,
          transparent: true,
          opacity: 0.98,
          depthWrite: false
        })
      )
    );

    const scanPlane = new Mesh(
      new PlaneGeometry(width * CELL_SIZE, depth * CELL_SIZE),
      new MeshBasicMaterial({
        color: 0x4ef4ff,
        transparent: true,
        opacity: 0.08,
        depthWrite: false
      })
    );
    scanPlane.rotation.x = -Math.PI / 2;
    scanPlane.position.set((width * CELL_SIZE) / 2, y, (depth * CELL_SIZE) / 2);
    group.add(scanPlane);

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
          color: 0xe7fbff,
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
    const renderSize = this.getRenderSize();
    this.renderer.setSize(renderSize.width, renderSize.height, false);
    this.renderFrame();
  }

  private getAspectRatio(): number {
    const { width, height } = this.getRenderSize();
    return width / height;
  }

  private getRenderSize(): { width: number; height: number } {
    const element = this.canvasHost ?? this.container;
    return {
      width: Math.max(1, element?.clientWidth ?? window.innerWidth),
      height: Math.max(1, element?.clientHeight ?? window.innerHeight)
    };
  }

  private disposeActiveTetrominoGroup(): void {
    if (!this.scene || !this.activeTetrominoGroup) {
      return;
    }
    this.disposeObjectResources(this.activeTetrominoGroup);
    this.scene.remove(this.activeTetrominoGroup);
    this.activeTetrominoGroup = null;
  }

  private disposeSettledBlocksGroup(): void {
    if (!this.scene || !this.settledBlocksGroup) {
      return;
    }
    this.disposeObjectResources(this.settledBlocksGroup);
    this.scene.remove(this.settledBlocksGroup);
    this.settledBlocksGroup = null;
  }

  private disposeGlowGroup(): void {
    if (!this.scene || !this.glowGroup) {
      return;
    }
    this.disposeObjectResources(this.glowGroup);
    this.scene.remove(this.glowGroup);
    this.glowGroup = null;
  }

  private disposeObjectResources(root: Group | Scene): void {
    const geometries = new Set<BufferGeometry>();
    const materials = new Set<Material>();

    root.traverse((child) => {
      if (!(child instanceof Mesh) && !(child instanceof LineSegments) && !(child instanceof Points)) {
        return;
      }

      geometries.add(child.geometry);
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => materials.add(material));
      } else {
        materials.add(child.material);
      }
    });

    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
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
    const blockSize = 34;
    const gap = 4;
    const step = blockSize + gap;
    const minCellX = Math.min(...definition.cells.map((cell) => cell.x));
    const maxCellX = Math.max(...definition.cells.map((cell) => cell.x));
    const minCellZ = Math.min(...definition.cells.map((cell) => cell.z));
    const maxCellZ = Math.max(...definition.cells.map((cell) => cell.z));
    const cubes = definition.cells
      .map((cell) => ({
        x: (cell.x - minCellX) * step,
        y: (maxCellZ - cell.z) * step
      }))
      .sort((a, b) => a.y - b.y || a.x - b.x);

    const previewWidth = (maxCellX - minCellX + 1) * step - gap;
    const previewHeight = (maxCellZ - minCellZ + 1) * step - gap;
    const padding = 20;
    const viewBox = [
      -padding,
      -padding,
      previewWidth + padding * 2,
      previewHeight + padding * 2
    ].join(' ');
    const baseColor = definition.color;
    const frontColor = mixColor(baseColor, 0xffffff, 0.08);
    const strokeColor = mixColor(baseColor, 0xffffff, 0.62);
    const glowColor = `#${baseColor.toString(16).padStart(6, '0')}`;

    container.innerHTML = `
      <svg
        class="piece-preview-svg"
        viewBox="${viewBox}"
        preserveAspectRatio="xMidYMid meet"
        style="--piece-color:${glowColor};"
        aria-hidden="true"
        focusable="false"
      >
        ${cubes
          .map(({ x, y }) =>
            renderPreviewCube(
              x,
              y,
              blockSize,
              frontColor,
              strokeColor
            )
          )
          .join('')}
      </svg>
    `;
  }

  private setText(root: ParentNode, selector: string, text: string): void {
    root.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      element.textContent = text;
    });
  }

  private setMeter(root: ParentNode, selector: string, activeCount: number): void {
    const meter = root.querySelector<HTMLElement>(selector);
    meter?.querySelectorAll<HTMLElement>('span').forEach((element, index) => {
      element.classList.toggle('is-active', index < activeCount);
    });
  }

  private syncHudTimer(root: ParentNode): void {
    const elapsed = this.formatElapsed(this.hudState.elapsedMs);
    this.setText(root, '[data-role="timer"]', elapsed);
    this.setText(root, '[data-role="overlay-time"]', elapsed);
  }

  private getStatusLabel(): string {
    if (this.hudState.phase === 'game-over') {
      return 'GAME OVER';
    }
    if (this.hudState.isPaused) {
      return 'PAUSED';
    }
    return 'RUNNING';
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

function renderMeterSegments(count: number): string {
  return Array.from({ length: count }, () => '<span></span>').join('');
}

function renderPreviewCube(
  x: number,
  y: number,
  size: number,
  frontColor: string,
  strokeColor: string
): string {
  return `
    <g class="preview-cube">
      <rect x="${x}" y="${y}" width="${size}" height="${size}" rx="5" fill="${frontColor}" stroke="${strokeColor}" />
      <path d="M${x + 6} ${y + 6} H${x + size - 8}" class="preview-cube-highlight" />
      <path d="M${x + size - 6} ${y + 7} V${y + size - 8}" class="preview-cube-shade" />
    </g>
  `;
}

function mixColor(color: number, target: number, amount: number): string {
  const sourceRgb = numberToRgb(color);
  const targetRgb = numberToRgb(target);
  const mixed = sourceRgb.map((value, index) =>
    Math.round(value + (targetRgb[index] - value) * amount)
  );
  return `rgb(${mixed[0]}, ${mixed[1]}, ${mixed[2]})`;
}

function numberToRgb(color: number): [number, number, number] {
  return [(color >> 16) & 255, (color >> 8) & 255, color & 255];
}

function renderHudIcon(name: HudIconName): string {
  const common =
    'class="hud-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"';
  const paths: Record<HudIconName, string> = {
    alert:
      '<path d="M12 3 22 20H2L12 3Z"/><path d="M12 9v5"/><path d="M12 17h.01"/>',
    chart:
      '<path d="M4 20V9"/><path d="M10 20V4"/><path d="M16 20v-8"/><path d="M22 20H2"/>',
    cube:
      '<path d="m12 2 8 4.5v9L12 20l-8-4.5v-9L12 2Z"/><path d="M12 11 4 6.5"/><path d="m12 11 8-4.5"/><path d="M12 11v9"/>',
    home:
      '<path d="M3 11 12 3l9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
    layers:
      '<path d="m12 3 9 4-9 4-9-4 9-4Z"/><path d="m3 12 9 4 9-4"/><path d="m3 17 9 4 9-4"/>',
    lightbulb:
      '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M8 14a6 6 0 1 1 8 0c-.8.7-1.2 1.6-1.2 2.5H9.2c0-.9-.4-1.8-1.2-2.5Z"/>',
    mouse:
      '<rect x="7" y="3" width="10" height="18" rx="5"/><path d="M12 7v4"/>',
    pause:
      '<path d="M8 5v14"/><path d="M16 5v14"/>',
    restart:
      '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v6h-6"/>',
    settings:
      '<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="M4 12h2"/><path d="M18 12h2"/><path d="m6.3 6.3 1.4 1.4"/><path d="m16.3 16.3 1.4 1.4"/><path d="m17.7 6.3-1.4 1.4"/><path d="m7.7 16.3-1.4 1.4"/><path d="M12 2v2"/><path d="M12 20v2"/>',
    snowflake:
      '<path d="M12 2v20"/><path d="m4.9 4.9 14.2 14.2"/><path d="m19.1 4.9-14.2 14.2"/><path d="m8 4 4 4 4-4"/><path d="m8 20 4-4 4 4"/><path d="m4 8 4 4-4 4"/><path d="m20 8-4 4 4 4"/>',
    trophy:
      '<path d="M8 4h8v4a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5a3 3 0 0 0 3 3"/><path d="M16 6h3a3 3 0 0 1-3 3"/><path d="M12 12v5"/><path d="M8 21h8"/><path d="M10 17h4"/>'
  };

  return `<svg ${common}>${paths[name]}</svg>`;
}
