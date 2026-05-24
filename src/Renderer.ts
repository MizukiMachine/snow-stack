import {
  AmbientLight,
  BufferGeometry,
  BoxGeometry,
  CanvasTexture,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  LinearFilter,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RingGeometry,
  SRGBColorSpace,
  Scene,
  Sprite,
  Vector3,
  WebGLRenderer
} from 'three';
import type { Material, Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type {
  ActivePolyCubeSnapshot,
  FootprintCellSnapshot,
  GameStateOptions,
  GamePhase,
  MissionMode,
  SettledBlockSnapshot
} from './GameState';
import {
  BLOCK_SETS,
  MAX_LEVEL,
  MAX_PIT_DEPTH,
  MAX_PIT_HEIGHT,
  MAX_PIT_WIDTH,
  MIN_PIT_DEPTH,
  MIN_PIT_HEIGHT,
  MIN_PIT_WIDTH,
  getBlockSetLabel,
  getBlockOutLayerColor,
  getPolyCubeDefinition,
  type BlockSet
} from './constants/blockout';
import { CELL_SIZE } from './constants/field';
import { KEY_ASSIGNMENT_ROWS, type KeyAssignmentRow } from './config/controls';
import { GameState } from './GameState';

type RendererCallbacks = {
  onRestart?: () => void;
  onTogglePause?: () => void;
  onToggleSettings?: () => void;
  onApplySetup?: (setup: GameStateOptions) => void;
};

type HudState = {
  queue: readonly number[];
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

type CubeWorldAssetKey =
  | 'wallIce'
  | 'blockCore'
  | 'settledIceBlock';

type CubeWorldAssetDefinition = {
  readonly path: string;
  readonly tint?: number;
  readonly opacity?: number;
  readonly depthWrite?: boolean;
};

type AssetPlacement = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly scale?: number;
  readonly rotationX?: number;
  readonly rotationY?: number;
  readonly rotationZ?: number;
};

const MISSION_MODES: readonly MissionMode[] = Object.freeze(['endless', 'plane-sprint']);
const MISSION_MODE_LABELS: Record<MissionMode, string> = Object.freeze({
  endless: 'ENDLESS',
  'plane-sprint': 'SPRINT'
});
const PREVIEW_STAGE_LIMITS: Record<'queue' | 'hold', { width: number; height: number }> = Object.freeze({
  queue: { width: 44, height: 42 },
  hold: { width: 74, height: 42 }
});

const CAMERA_SETTINGS = {
  targetHeightFactor: 0.5,
  initialTheta: -Math.PI / 2,
  initialPhi: Math.PI / 2,
  minPhi: 0.34,
  maxPhi: Math.PI / 2,
  rotateSpeedY: 0.002,
  zoomSpeed: 0.01,
  minRadius: 8,
  maxRadius: 42,
  initialRadiusMultiplier: 1.12,
  axisLockThresholdPx: 6
} as const;

const CUBE_WORLD_ASSET_ROOT = '/assets/Cube%20World%20-%20Aug%202023';
const SETTLED_BLOCK_ASSET_SCALE = CELL_SIZE * 0.5;
const SETTLED_BLOCK_FALLBACK_CORE_SIZE = CELL_SIZE;
const DEFAULT_BLOCK_FALLBACK_CORE_SIZE = CELL_SIZE * 0.84;
const CUBE_WORLD_ASSETS: Record<CubeWorldAssetKey, CubeWorldAssetDefinition> = Object.freeze({
  wallIce: {
    path: `${CUBE_WORLD_ASSET_ROOT}/Pixel%20Blocks/glTF/Ice.gltf`,
    tint: 0xc3f3ff,
    opacity: 1,
    depthWrite: true
  },
  blockCore: {
    path: `${CUBE_WORLD_ASSET_ROOT}/Blocks/glTF/Block_Blank.gltf`,
    tint: 0xffffff,
    opacity: 0.12,
    depthWrite: false
  },
  settledIceBlock: {
    path: `${CUBE_WORLD_ASSET_ROOT}/Blocks/glTF/Block_Ice.gltf`,
    opacity: 0.96,
    depthWrite: true
  }
});
const CUBE_WIREFRAME_BEAM_GEOMETRY = new BoxGeometry(1, 1, 1);

/**
 * Three.js scene rendering and DOM-based HUD for the BlockOut pit.
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
  private fieldBoundsGroup: Group | null = null;
  private assetFieldLayer: Group | null = null;
  private activePolyCubeGroup: Group | null = null;
  private landingGhostGroup: Group | null = null;
  private footprintGroup: Group | null = null;
  private settledBlocksGroup: Group | null = null;
  private glowGroup: Group | null = null;
  private readonly gltfLoader = new GLTFLoader();
  private readonly assetTemplates = new Map<CubeWorldAssetKey, Group>();
  private assetLoadPromise: Promise<void> | null = null;
  private assetLoadGeneration = 0;
  private assetsReady = false;
  private disposed = false;
  private resizeHandler: (() => void) | null = null;
  private controlsBound = false;
  private pointerDownHandler: ((event: PointerEvent) => void) | null = null;
  private pointerMoveHandler: ((event: PointerEvent) => void) | null = null;
  private pointerUpHandler: ((event: PointerEvent) => void) | null = null;
  private wheelHandler: ((event: WheelEvent) => void) | null = null;
  private readonly cameraOrbit: CameraOrbitState;
  private readonly hudState: HudState;
  private lastSettingsOpen = false;
  private depthLayerGuideSignature = '';

  constructor(gameState: GameState, callbacks: RendererCallbacks = {}) {
    this.gameState = gameState;
    this.callbacks = callbacks;

    const { width, height, depth } = this.gameState.getDimensions();
    const origin = this.getFieldOrigin();
    const target = new Vector3(
      origin.x + (width * CELL_SIZE) / 2,
      height * CELL_SIZE * CAMERA_SETTINGS.targetHeightFactor,
      origin.z + (depth * CELL_SIZE) / 2
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
      level: this.gameState.getLevel(),
      dropIntervalMs: this.gameState.getDropIntervalMs(),
      elapsedMs: 0,
      isPaused: false,
      settingsOpen: false
    };
  }

  public initialize(container: HTMLElement): void {
    this.disposed = false;
    this.assetLoadGeneration += 1;
    this.depthLayerGuideSignature = '';
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

    const camera = new PerspectiveCamera(60, this.getAspectRatio(), 0.1, 1000);
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
    const fieldBounds = this.createFieldBounds();
    this.fieldBoundsGroup = fieldBounds;
    scene.add(fieldBounds);
    scene.add(this.createDepthLandingGlow());

    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;

    this.resizeHandler = () => this.onResize();
    window.addEventListener('resize', this.resizeHandler);
    this.attachCameraControls();

    this.updateActivePolyCube(this.gameState.getActivePolyCube());
    this.updateSettledBlocks(this.gameState.getSettledBlocks());
    this.updateHud(
      [],
      'running',
      0,
      0,
      this.gameState.getLevel(),
      this.gameState.getDropIntervalMs(),
      0,
      false,
      false
    );
    this.renderFrame();
    void this.loadCubeWorldAssets(this.assetLoadGeneration);
  }

  public renderFrame(): void {
    if (!this.scene || !this.camera || !this.renderer) {
      return;
    }
    this.renderer.render(this.scene, this.camera);
  }

  public dispose(): void {
    this.disposed = true;
    this.assetLoadGeneration += 1;
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }

    this.detachCameraControls();
    if (this.scene) {
      this.disposeObjectResources(this.scene);
      this.scene.clear();
    }
    this.disposeLoadedCubeWorldAssets();
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
    this.fieldBoundsGroup = null;
    this.assetFieldLayer = null;
    this.activePolyCubeGroup = null;
    this.landingGhostGroup = null;
    this.footprintGroup = null;
    this.settledBlocksGroup = null;
    this.glowGroup = null;
    this.lastSettingsOpen = false;
    this.depthLayerGuideSignature = '';
  }

  public updateActivePolyCube(polyCube: ActivePolyCubeSnapshot | null): void {
    if (!this.scene) {
      return;
    }

    this.disposeActivePolyCubeGroup();
    this.disposeLandingGhostGroup();
    this.disposeFootprintGroup();
    this.disposeGlowGroup();

    if (!polyCube) {
      return;
    }

    const footprint = this.createFootprintGroup(this.gameState.getActiveFootprintCells());
    if (footprint) {
      this.footprintGroup = footprint;
      this.scene.add(footprint);
    }

    const projected = this.gameState.getProjectedActivePolyCube();
    if (projected) {
      const ghost = this.createLandingGhostGroup(projected);
      this.landingGhostGroup = ghost;
      this.scene.add(ghost);
    }

    const group = new Group();
    const origin = this.getFieldOrigin();
    group.position.set(origin.x, origin.y, origin.z);

    polyCube.blocks.forEach((block) => {
      const mesh = this.createBlockMesh(polyCube.color, true, block.z);
      mesh.position.set(
        (block.x + 0.5) * CELL_SIZE,
        (block.y + 0.5) * CELL_SIZE,
        (block.z + 0.5) * CELL_SIZE
      );
      group.add(mesh);
    });

    this.activePolyCubeGroup = group;
    this.scene.add(group);
  }

  public updateSettledBlocks(blocks: readonly SettledBlockSnapshot[]): void {
    if (!this.scene) {
      return;
    }

    this.disposeSettledBlocksGroup();

    const group = new Group();
    const origin = this.getFieldOrigin();
    group.position.set(origin.x, origin.y, origin.z);

    const { depth } = this.gameState.getDimensions();
    blocks.forEach((block) => {
      const mesh = this.createBlockMesh(
        getBlockOutLayerColor(depth, block.coordinate.z),
        false,
        block.coordinate.z,
        'settledIceBlock'
      );
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

  private createLandingGhostGroup(polyCube: ActivePolyCubeSnapshot): Group {
    const group = new Group();
    const origin = this.getFieldOrigin();
    group.position.set(origin.x, origin.y, origin.z);
    group.name = 'landing-ghost';

    polyCube.blocks.forEach((block) => {
      const mesh = this.createGhostBlockMesh(polyCube.color);
      mesh.position.set(
        (block.x + 0.5) * CELL_SIZE,
        (block.y + 0.5) * CELL_SIZE,
        (block.z + 0.5) * CELL_SIZE
      );
      group.add(mesh);
    });

    return group;
  }

  private createFootprintGroup(cells: readonly FootprintCellSnapshot[]): Group | null {
    if (cells.length === 0) {
      return null;
    }

    const { depth } = this.gameState.getDimensions();
    const group = new Group();
    const origin = this.getFieldOrigin();
    group.position.set(origin.x, origin.y, origin.z);
    group.name = 'landing-footprint';

    cells.forEach((cell) => {
      const marker = this.createFootprintCellMesh();
      marker.position.set(
        (cell.x + 0.5) * CELL_SIZE,
        (cell.y + 0.5) * CELL_SIZE,
        depth * CELL_SIZE - CELL_SIZE * 0.018
      );
      group.add(marker);
    });

    return group;
  }

  public updateElapsedTime(elapsedMs: number): void {
    if (!this.hudElement) {
      return;
    }

    this.hudState.elapsedMs = elapsedMs;
    this.syncHudTimer(this.hudElement);
  }

  public updateHud(
    queue: readonly number[],
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
    const mission = this.gameState.getMissionSnapshot();
    root.dataset.phase = this.hudState.phase;
    root.dataset.paused = String(this.hudState.isPaused);
    root.dataset.missionActive = String(mission.mode !== 'endless');
    root.dataset.missionComplete = String(mission.complete);
    this.setText(root, '[data-role="score"]', this.formatNumber(this.hudState.score));
    this.setText(root, '[data-role="level"]', String(this.hudState.level).padStart(2, '0'));
    this.setText(
      root,
      '[data-role="lines"]',
      String(this.hudState.clearedLayerCount).padStart(3, '0')
    );
    this.setText(root, '[data-role="status-label"]', this.getStatusLabel());
    this.setText(root, '[data-role="block-set"]', this.gameState.getBlockSetLabel());
    this.syncDepthLayerGuide(root);
    this.syncQueue(root);
    this.syncHeldPiece(root);
    this.syncMission(root);
    this.syncHudTimer(root);
    this.setText(root, '[data-role="pause-label"]', this.hudState.isPaused ? 'RESUME' : 'PAUSE');
    this.setText(root, '[data-role="pit-size"]', this.formatPitSize());
    this.setText(
      root,
      '[data-role="start-level"]',
      String(this.gameState.getSetup().startLevel).padStart(2, '0')
    );
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
      this.hudState.settingsOpen
        ? 'Setup is open. The run is held until you apply or close it.'
        : mission.complete
        ? 'Mission clear. Start another run from setup or retry.'
        : this.hudState.phase === 'game-over'
        ? 'Rotate the view and start a fresh run.'
        : this.hudState.isPaused
        ? 'Run paused. Resume when you are ready.'
        : mission.mode === 'plane-sprint'
        ? `${mission.remainingPlanes} planes left in the sprint.`
        : 'Fill complete depth planes across the pit to clear them.'
    );

    const overlay = root.querySelector<HTMLElement>('[data-role="overlay"]');
    if (overlay) {
      this.setHidden(
        overlay,
        this.hudState.phase !== 'game-over' || this.hudState.settingsOpen
      );
      const missionComplete = this.gameState.getMissionSnapshot().complete;
      this.setText(
        overlay,
        '[data-role="overlay-title"]',
        missionComplete ? 'MISSION CLEAR' : 'GAME OVER'
      );
      this.setText(
        overlay,
        '[data-role="overlay-message"]',
        missionComplete ? 'Plane sprint complete.' : 'The pit has reached the top.'
      );
      this.setText(
        overlay,
        '[data-role="overlay-footnote"]',
        missionComplete
          ? 'Start another run from setup or chase a higher score.'
          : 'You can always rotate the view and look for a path.'
      );
      this.setText(overlay, '[data-role="overlay-score"]', this.formatNumber(this.hudState.score));
      this.setText(overlay, '[data-role="overlay-level"]', String(this.hudState.level));
      this.setText(overlay, '[data-role="overlay-lines"]', String(this.hudState.clearedLayerCount));
      this.setText(overlay, '[data-role="overlay-time"]', this.formatElapsed(this.hudState.elapsedMs));
    }

    const pauseOverlay = root.querySelector<HTMLElement>('[data-role="pause-overlay"]');
    if (pauseOverlay) {
      this.setHidden(
        pauseOverlay,
        !this.hudState.isPaused || this.hudState.phase === 'game-over' || this.hudState.settingsOpen
      );
    }

    const settings = root.querySelector<HTMLElement>('[data-role="settings-panel"]');
    if (settings) {
      this.setHidden(settings, !this.hudState.settingsOpen);
      if (this.hudState.settingsOpen && !this.lastSettingsOpen) {
        this.syncSetupControls(root);
      }
    }
    this.lastSettingsOpen = this.hudState.settingsOpen;
  }

  private createHudElement(): HTMLDivElement {
    const hud = document.createElement('div');
    const icon = (name: HudIconName) => renderHudIcon(name);
    const blockSetButtons = BLOCK_SETS.map(
      (blockSet) =>
        `<button class="segmented-button" data-block-set="${blockSet}" type="button">${getBlockSetLabel(blockSet)}</button>`
    ).join('');
    const missionButtons = MISSION_MODES.map(
      (missionMode) =>
        `<button class="segmented-button" data-mission-mode="${missionMode}" type="button">${MISSION_MODE_LABELS[missionMode]}</button>`
    ).join('');
    hud.className = 'ui-layer';
    hud.innerHTML = `
      <div class="brand-panel">
        <div class="brand-emblem">${icon('snowflake')}</div>
        <div class="brand-copy">
          <div class="brand-title">VOXEL<br />BLOCK<br />OUT</div>
          <div class="brand-subtitle">3D POLYCUBE PUZZLE</div>
        </div>
      </div>
      <section class="info-card layer-guide-card" aria-label="Depth layer colors">
        <div class="card-title">${icon('layers')}<span>DEPTH</span></div>
        <div class="layer-guide-stack" data-role="layer-guide-list"></div>
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
            <div class="panel-heading">${icon('snowflake')}<span>PLANES</span></div>
            <div class="metric-inline"><strong class="metric-value" data-role="lines">000</strong><div class="meter meter-bars" data-role="layers-meter">${renderMeterSegments(8)}</div></div>
          </section>
          <section class="panel metric-card queue-card">
            <div class="panel-heading">${icon('snowflake')}<span>NEXT</span></div>
            <div class="queue-list" data-role="queue-list"><span>--</span><span>--</span><span>--</span></div>
          </section>
          <section class="panel metric-card hold-card">
            <div class="panel-heading">${icon('cube')}<span>HOLD</span></div>
            <div class="hold-slot" data-role="hold-piece"><span>--</span></div>
          </section>
          <section class="panel metric-card">
            <div class="panel-heading">${icon('snowflake')}<span>BLOCK SET</span></div>
            <strong class="metric-value metric-value-small" data-role="block-set">FLAT</strong>
          </section>
          <section class="panel metric-card">
            <div class="panel-heading">${icon('snowflake')}<span>PIT</span></div>
            <strong class="metric-value metric-value-small" data-role="pit-size">5x5x12</strong>
          </section>
        </div>
        <div class="command-stack">
          <section class="panel controls-panel">
            <h3>${icon('snowflake')}<span>CONTROLS</span></h3>
            <div class="control-grid">
              ${KEY_ASSIGNMENT_ROWS.map(renderKeyAssignmentRow).join('')}
              <div class="control-separator"></div>
              <div class="control-row"><span class="keys"><b class="wide-key key-icon">${icon('mouse')}Mouse</b></span><span>Tilt View</span></div>
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
        <div class="status-mission" data-role="mission-pill" hidden>${icon('trophy')}<div><span class="status-label" data-role="mission-label">ENDLESS</span><div class="mission-progress" data-role="mission-progress"><span></span></div></div></div>
        <div class="status-hint">${icon('snowflake')}<div><span class="status-label">HINT</span><span data-role="footer-tip"></span></div></div>
        <div class="status-meta"><span class="status-label">TIME</span><span data-role="timer">00:00:00</span></div>
      </section>
      <section class="panel settings-panel" data-role="settings-panel" hidden>
        <h3>${icon('settings')}<span>SETUP</span></h3>
        <form class="setup-form" data-role="setup-form">
          <div class="setup-field setup-field-wide">
            <span class="setup-label">BLOCK SET</span>
            <div class="segmented-control" data-role="block-set-control">${blockSetButtons}</div>
          </div>
          <div class="setup-field setup-field-wide">
            <span class="setup-label">MISSION</span>
            <div class="segmented-control" data-role="mission-mode-control">${missionButtons}</div>
          </div>
          <label class="setup-field">
            <span class="setup-label">WIDTH</span>
            <input data-setup-field="width" type="number" min="${MIN_PIT_WIDTH}" max="${MAX_PIT_WIDTH}" step="1" />
          </label>
          <label class="setup-field">
            <span class="setup-label">HEIGHT</span>
            <input data-setup-field="height" type="number" min="${MIN_PIT_HEIGHT}" max="${MAX_PIT_HEIGHT}" step="1" />
          </label>
          <label class="setup-field">
            <span class="setup-label">DEPTH</span>
            <input data-setup-field="depth" type="number" min="${MIN_PIT_DEPTH}" max="${MAX_PIT_DEPTH}" step="1" />
          </label>
          <label class="setup-field">
            <span class="setup-label">START</span>
            <input data-setup-field="startLevel" type="number" min="0" max="${MAX_LEVEL - 1}" step="1" />
          </label>
          <button class="setup-submit" type="submit">${icon('restart')}<span>APPLY</span></button>
        </form>
      </section>
      <section class="overlay-card" data-role="overlay" hidden>
        <div class="overlay-alert">${icon('alert')}</div>
        <h2 data-role="overlay-title">GAME OVER</h2>
        <p data-role="overlay-message">The pit has reached the top.</p>
        <div class="overlay-scorebox">
          <span>FINAL SCORE</span>
          <strong data-role="overlay-score">0</strong>
        </div>
        <div class="overlay-metrics">
          <div><span>LEVEL REACHED</span><strong data-role="overlay-level">0</strong></div>
          <div><span>PLANES CLEARED</span><strong data-role="overlay-lines">0</strong></div>
          <div><span>TIME PLAYED</span><strong data-role="overlay-time">00:00:00</strong></div>
        </div>
        <div class="overlay-actions">
          <button class="overlay-button overlay-button-danger" data-action="restart" type="button">${icon('restart')}<span>RETRY</span></button>
          <button class="overlay-button overlay-button-primary" data-action="settings" type="button">${icon('home')}<span>MENU</span></button>
        </div>
        <p class="overlay-footnote" data-role="overlay-footnote">You can always rotate the view and look for a path.</p>
      </section>
      <section class="pause-card" data-role="pause-overlay" hidden>
        <div class="overlay-alert">${icon('pause')}</div>
        <h2>PAUSED</h2>
        <p>The current run is held.</p>
        <div class="overlay-actions">
          <button class="overlay-button overlay-button-primary" data-action="pause" type="button">${icon('pause')}<span>RESUME</span></button>
          <button class="overlay-button" data-action="settings" type="button">${icon('settings')}<span>SETUP</span></button>
        </div>
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

    hud.querySelectorAll<HTMLButtonElement>('[data-block-set]').forEach((button) => {
      button.addEventListener('click', () => {
        hud.querySelectorAll<HTMLButtonElement>('[data-block-set]').forEach((item) => {
          const isActive = item === button;
          item.classList.toggle('is-active', isActive);
          item.setAttribute('aria-pressed', String(isActive));
        });
      });
    });

    hud.querySelectorAll<HTMLButtonElement>('[data-mission-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        hud.querySelectorAll<HTMLButtonElement>('[data-mission-mode]').forEach((item) => {
          const isActive = item === button;
          item.classList.toggle('is-active', isActive);
          item.setAttribute('aria-pressed', String(isActive));
        });
      });
    });

    hud.querySelector<HTMLFormElement>('[data-role="setup-form"]')?.addEventListener('submit', (event) => {
      event.preventDefault();
      this.callbacks.onApplySetup?.(this.collectSetupValues(hud));
    });

    this.hudElement = hud;
    this.syncSetupControls(hud);
    return hud;
  }

  private createFieldBounds(): Group {
    const group = new Group();
    const origin = this.getFieldOrigin();
    group.position.set(origin.x, origin.y, origin.z);

    const { width, height, depth } = this.gameState.getDimensions();
    // Spatial contract: x/y is the camera-facing pit face; +z is the fall direction.
    // Do not use y=0 as a floor. The landing ground is the far depth plane at z=depth.
    const sideWallMaterial = new MeshBasicMaterial({
      map: this.createSnowWallTexture(),
      color: 0xaac7d7,
      transparent: false,
      depthWrite: true,
      side: DoubleSide
    });
    const depthLandingMaterial = new MeshBasicMaterial({
      map: this.createSnowWallTexture(),
      color: 0x8fb9d2,
      transparent: false,
      depthWrite: true,
      side: DoubleSide
    });

    const leftWall = new Mesh(
      new PlaneGeometry(depth * CELL_SIZE, height * CELL_SIZE),
      sideWallMaterial
    );
    leftWall.position.set(0, (height * CELL_SIZE) / 2, (depth * CELL_SIZE) / 2);
    leftWall.rotation.y = Math.PI / 2;

    const rightWall = leftWall.clone();
    rightWall.position.set(width * CELL_SIZE, (height * CELL_SIZE) / 2, (depth * CELL_SIZE) / 2);
    rightWall.rotation.y = -Math.PI / 2;

    const depthLanding = new Mesh(
      new PlaneGeometry(width * CELL_SIZE, height * CELL_SIZE),
      depthLandingMaterial
    );
    depthLanding.position.set((width * CELL_SIZE) / 2, (height * CELL_SIZE) / 2, depth * CELL_SIZE);
    depthLanding.rotation.y = Math.PI;

    const boundsGeometry = new BoxGeometry(width * CELL_SIZE, height * CELL_SIZE, depth * CELL_SIZE);
    boundsGeometry.translate(
      (width * CELL_SIZE) / 2,
      (height * CELL_SIZE) / 2,
      (depth * CELL_SIZE) / 2
    );
    const bounds = new LineSegments(
      new EdgesGeometry(boundsGeometry),
      new LineBasicMaterial({ color: 0x67d7ff, transparent: true, opacity: 0.68 })
    );

    group.add(leftWall, rightWall, depthLanding, bounds);
    group.add(this.createFieldFrameGlow(width, height, depth));
    group.add(this.createFaceGrid('xy', width, height, 0, 0x58c9ff));
    group.add(this.createFaceGrid('xy', width, height, depth, 0x62c4ff));
    group.add(this.createFaceGrid('yz', depth, height, 0, 0x4ca6ff));
    group.add(this.createFaceGrid('yz', depth, height, width, 0x4ca6ff));
    if (this.assetsReady) {
      this.assetFieldLayer = this.createCubeWorldFieldLayer();
      group.add(this.assetFieldLayer);
    }
    return group;
  }

  private createSnowWallTexture(): CanvasTexture {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) {
      return new CanvasTexture(canvas);
    }

    const gradient = context.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, '#f3fbff');
    gradient.addColorStop(0.48, '#bdd6df');
    gradient.addColorStop(1, '#eef8fb');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);

    context.globalAlpha = 0.34;
    for (let y = -size; y < size * 2; y += 24) {
      context.beginPath();
      context.moveTo(-16, y);
      context.lineTo(size + 16, y + size * 0.32);
      context.strokeStyle = '#ffffff';
      context.lineWidth = 7;
      context.stroke();
    }

    context.globalAlpha = 0.22;
    for (let i = 0; i < 180; i += 1) {
      const x = deterministicNoise(i, 1) * size;
      const y = deterministicNoise(i, 2) * size;
      const radius = 0.5 + deterministicNoise(i, 3) * 1.4;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fillStyle = deterministicNoise(i, 4) > 0.35 ? '#ffffff' : '#7fa8b5';
      context.fill();
    }

    context.globalAlpha = 0.18;
    context.strokeStyle = '#5f8795';
    context.lineWidth = 1;
    for (let x = 0; x <= size; x += 64) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x + 18, size);
      context.stroke();
    }
    for (let y = 0; y <= size; y += 64) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(size, y + 12);
      context.stroke();
    }

    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    return texture;
  }

  private async loadCubeWorldAssets(generation: number): Promise<void> {
    if (this.assetLoadPromise) {
      return this.assetLoadPromise;
    }

    this.assetLoadPromise = this.loadCubeWorldAssetTemplates(generation);
    return this.assetLoadPromise;
  }

  private async loadCubeWorldAssetTemplates(generation: number): Promise<void> {
    const entries = Object.entries(CUBE_WORLD_ASSETS) as [
      CubeWorldAssetKey,
      CubeWorldAssetDefinition
    ][];
    const sourceTemplatePromises = new Map<string, Promise<Group>>();
    const loadSourceTemplate = (path: string): Promise<Group> => {
      const existing = sourceTemplatePromises.get(path);
      if (existing) {
        return existing;
      }

      const promise = this.gltfLoader.loadAsync(path).then((gltf) => gltf.scene);
      sourceTemplatePromises.set(path, promise);
      return promise;
    };

    const results = await Promise.allSettled(
      entries.map(async ([key, definition]) => {
        const source = await loadSourceTemplate(definition.path);
        const template = source.clone(true) as Group;
        this.prepareCubeWorldTemplate(template, definition);
        return [key, template] as const;
      })
    );

    if (this.disposed || generation !== this.assetLoadGeneration) {
      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          this.disposeObjectResources(result.value[1]);
        }
      });
      return;
    }

    const failures: string[] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const [key, template] = result.value;
        this.assetTemplates.set(key, template);
        return;
      }
      failures.push(`${entries[index][0]}: ${String(result.reason)}`);
    });

    if (failures.length > 0) {
      console.warn(`Cube World assets failed to load: ${failures.join('; ')}`);
    }

    this.assetsReady = this.assetTemplates.size > 0;
    if (!this.assetsReady) {
      return;
    }

    if (!this.scene || !this.fieldBoundsGroup) {
      return;
    }

    this.rebuildCubeWorldFieldLayer();
    this.updateSettledBlocks(this.gameState.getSettledBlocks());
    this.updateActivePolyCube(this.gameState.getActivePolyCube());
    this.renderFrame();
  }

  private prepareCubeWorldTemplate(root: Group, definition: CubeWorldAssetDefinition): void {
    root.traverse((child) => {
      if (!(child instanceof Mesh)) {
        return;
      }

      child.castShadow = false;
      child.receiveShadow = true;
      const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material];
      const convertedMaterials = sourceMaterials.map((material) =>
        this.createCubeWorldMaterial(material, definition)
      );
      child.material = Array.isArray(child.material) ? convertedMaterials : convertedMaterials[0];
    });
  }

  private createCubeWorldMaterial(
    sourceMaterial: Material,
    definition: CubeWorldAssetDefinition
  ): MeshBasicMaterial {
    const source = sourceMaterial as Material & {
      map?: Texture | null;
      color?: { getHex: () => number };
    };
    const map = source.map ?? null;
    if (map) {
      map.colorSpace = SRGBColorSpace;
      map.minFilter = LinearFilter;
      map.magFilter = LinearFilter;
    }

    const opacity = definition.opacity ?? 1;
    const material = new MeshBasicMaterial({
      map,
      color: definition.tint ?? source.color?.getHex() ?? 0xffffff,
      transparent: opacity < 1,
      opacity,
      depthWrite: definition.depthWrite ?? opacity >= 1,
      side: DoubleSide
    });
    return material;
  }

  private rebuildCubeWorldFieldLayer(): void {
    if (!this.fieldBoundsGroup) {
      return;
    }

    if (this.assetFieldLayer) {
      this.fieldBoundsGroup.remove(this.assetFieldLayer);
      this.disposeObjectResources(this.assetFieldLayer);
    }

    this.assetFieldLayer = this.createCubeWorldFieldLayer();
    this.fieldBoundsGroup.add(this.assetFieldLayer);
  }

  private createCubeWorldFieldLayer(): Group {
    const group = new Group();
    group.name = 'cube-world-field-assets';
    const { width, height, depth } = this.gameState.getDimensions();

    this.addCubeWorldIceWell(group, width, height, depth);
    return group;
  }

  private addCubeWorldIceWell(group: Group, width: number, height: number, depth: number): void {
    const addedCells = new Set<string>();
    const addWallCell = (x: number, y: number, z: number) => {
      const key = `${x},${y},${z}`;
      if (addedCells.has(key)) {
        return;
      }
      addedCells.add(key);
      this.addCubeWorldAsset(group, 'wallIce', {
        x: (x + 0.5) * CELL_SIZE,
        y: (y + 0.5) * CELL_SIZE,
        z: (z + 0.5) * CELL_SIZE,
        scale: CELL_SIZE * 0.5
      });
    };

    for (let z = 0; z < depth; z += 1) {
      for (let y = 0; y < height; y += 1) {
        addWallCell(-1, y, z);
        addWallCell(width, y, z);
      }
    }

    for (let x = 0; x < width; x += 1) {
      for (let y = 0; y < height; y += 1) {
        addWallCell(x, y, depth);
      }
    }

    for (let x = 0; x < width; x += 1) {
      for (let z = 0; z < depth; z += 1) {
        addWallCell(x, -1, z);
        addWallCell(x, height, z);
      }
    }

    for (let x = -1; x <= width; x += 1) {
      for (let y = -1; y <= height; y += 1) {
        for (let z = 0; z <= depth; z += 1) {
          const boundaryAxes =
            (x === -1 || x === width ? 1 : 0) +
            (y === -1 || y === height ? 1 : 0) +
            (z === depth ? 1 : 0);
          if (boundaryAxes >= 2) {
            addWallCell(x, y, z);
          }
        }
      }
    }
  }

  private addCubeWorldAsset(
    group: Group,
    key: CubeWorldAssetKey,
    placement: AssetPlacement
  ): void {
    const asset = this.createCubeWorldAssetInstance(key, { preserveResources: true });
    if (!asset) {
      return;
    }

    asset.position.set(placement.x, placement.y, placement.z);
    asset.rotation.set(
      placement.rotationX ?? 0,
      placement.rotationY ?? 0,
      placement.rotationZ ?? 0
    );
    asset.scale.setScalar(placement.scale ?? CELL_SIZE * 0.5);
    asset.traverse((child) => {
      if (child instanceof Mesh) {
        child.renderOrder = 4;
      }
    });
    group.add(asset);
  }

  private createCubeWorldAssetInstance(
    key: CubeWorldAssetKey,
    options: { preserveResources?: boolean; preserveGeometry?: boolean } = {}
  ): Group | null {
    const template = this.assetTemplates.get(key);
    if (!template) {
      return null;
    }

    const instance = template.clone(true) as Group;
    instance.traverse((child) => {
      if (!(child instanceof Mesh) && !(child instanceof LineSegments) && !(child instanceof Points)) {
        return;
      }
      if (options.preserveResources) {
        child.userData.preserveResources = true;
      }
      if (options.preserveGeometry) {
        child.userData.preserveGeometry = true;
      }
    });
    return instance;
  }

  private createLighting(): Group {
    const group = new Group();
    group.add(new AmbientLight(0xbadfff, 0.72));

    const key = new DirectionalLight(0xb6edff, 1.1);
    key.position.set(14, 22, 10);
    group.add(key);

    const rim = new DirectionalLight(0x4eaaff, 0.62);
    rim.position.set(-12, 16, -8);
    group.add(rim);

    const warm = new DirectionalLight(0xffd184, 0.22);
    warm.position.set(4, 8, 14);
    group.add(warm);

    return group;
  }

  private createDepthLandingGlow(): Group {
    const group = new Group();
    const { width, height, depth } = this.gameState.getDimensions();
    const origin = this.getFieldOrigin();
    const centerX = origin.x + (width * CELL_SIZE) / 2;
    const centerY = (height * CELL_SIZE) / 2;
    const landingZ = origin.z + depth * CELL_SIZE - 0.018;
    const fieldSpan = Math.max(width, height);

    for (let i = 0; i < 6; i += 1) {
      const innerRadius = fieldSpan * 0.42 + i * 0.35;
      const outerRadius = innerRadius + 0.055;
      const ring = new Mesh(
        new RingGeometry(innerRadius, outerRadius, 96),
        new MeshBasicMaterial({
          color: i % 2 === 0 ? 0x18d6ff : 0x7da7ff,
          transparent: true,
          opacity: i === 0 ? 0.22 : 0.075,
          depthWrite: false,
          side: DoubleSide
        })
      );
      ring.position.set(centerX, centerY, landingZ - i * 0.002);
      group.add(ring);
    }

    return group;
  }

  private getFieldOrigin(): { x: number; y: number; z: number } {
    const { width, depth } = this.gameState.getDimensions();
    return {
      x: -((width * CELL_SIZE) / 2),
      y: 0,
      z: -((depth * CELL_SIZE) / 2)
    };
  }

  private createGhostBlockMesh(color: number): Group {
    const group = new Group();
    const ghostColor = mixColorNumber(color, 0x42e8ff, 0.58);
    const core = new Mesh(
      new BoxGeometry(CELL_SIZE * 0.84, CELL_SIZE * 0.84, CELL_SIZE * 0.84),
      new MeshBasicMaterial({
        color: ghostColor,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
        side: DoubleSide
      })
    );
    core.renderOrder = 14;
    group.add(core);

    const edges = new LineSegments(
      new EdgesGeometry(new BoxGeometry(CELL_SIZE * 0.92, CELL_SIZE * 0.92, CELL_SIZE * 0.92)),
      new LineBasicMaterial({
        color: mixColorNumber(ghostColor, 0xffffff, 0.36),
        transparent: true,
        opacity: 0.72,
        depthWrite: false
      })
    );
    edges.renderOrder = 15;
    group.add(edges);
    return group;
  }

  private createFootprintCellMesh(): Group {
    const group = new Group();
    const fill = new Mesh(
      new PlaneGeometry(CELL_SIZE * 0.82, CELL_SIZE * 0.82),
      new MeshBasicMaterial({
        color: 0x1fe7ff,
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
        side: DoubleSide
      })
    );
    fill.renderOrder = 8;
    group.add(fill);

    const border = new LineSegments(
      new EdgesGeometry(new BoxGeometry(CELL_SIZE * 0.84, CELL_SIZE * 0.84, CELL_SIZE * 0.012)),
      new LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.62,
        depthWrite: false
      })
    );
    border.renderOrder = 9;
    group.add(border);
    return group;
  }

  private createBlockMesh(
    color: number,
    isActive: boolean,
    depthLayer = 0,
    settledAssetKey?: Extract<CubeWorldAssetKey, 'settledIceBlock'>
  ): Group {
    const cube = new Group();
    const isBehindSeparator = depthLayer > 0;
    const surfaceColor = isBehindSeparator ? mixColorNumber(color, 0x7fdcff, 0.08) : color;
    const wireColor = isActive ? 0xffffff : color;
    const assetCore = settledAssetKey
      ? this.createSettledBlockAssetCore(settledAssetKey)
      : this.createBlockAssetCore(surfaceColor, isActive);

    if (assetCore) {
      cube.add(assetCore);
    } else {
      const fallbackCoreSize = settledAssetKey
        ? SETTLED_BLOCK_FALLBACK_CORE_SIZE
        : DEFAULT_BLOCK_FALLBACK_CORE_SIZE;
      const fallbackCore = new Mesh(
        new BoxGeometry(fallbackCoreSize, fallbackCoreSize, fallbackCoreSize),
        new MeshBasicMaterial({
          color: mixColorNumber(surfaceColor, 0xffffff, isActive ? 0.24 : 0.12),
          transparent: true,
          opacity: isActive ? 0.035 : settledAssetKey ? 0.96 : 0.88,
          depthWrite: Boolean(settledAssetKey),
          side: DoubleSide
        })
      );
      fallbackCore.renderOrder = isActive ? 36 : 18;
      cube.add(fallbackCore);
    }

    if (!isActive) {
      cube.add(this.createThickCubeWireframe(wireColor, CELL_SIZE * 0.067, CELL_SIZE * 0.038, 35));

      const shadowEdges = new LineSegments(
        new EdgesGeometry(new BoxGeometry(CELL_SIZE * 0.94, CELL_SIZE * 0.94, CELL_SIZE * 0.94)),
        new LineBasicMaterial({
          color: mixColorNumber(wireColor, 0x001a34, 0.42),
          transparent: true,
          opacity: 0.72,
          depthWrite: false
        })
      );
      shadowEdges.renderOrder = 34;
      cube.add(shadowEdges);

      const outerEdges = new LineSegments(
        new EdgesGeometry(new BoxGeometry(CELL_SIZE * 0.96, CELL_SIZE * 0.96, CELL_SIZE * 0.96)),
        new LineBasicMaterial({
          color: wireColor,
          transparent: true,
          opacity: 1,
          depthWrite: false
        })
      );
      outerEdges.renderOrder = 36;
      cube.add(outerEdges);

      const highlightEdges = new LineSegments(
        new EdgesGeometry(new BoxGeometry(CELL_SIZE * 0.82, CELL_SIZE * 0.82, CELL_SIZE * 0.82)),
        new LineBasicMaterial({
          color: mixColorNumber(wireColor, 0xffffff, 0.38),
          transparent: true,
          opacity: 0.52,
          depthWrite: false
        })
      );
      highlightEdges.renderOrder = 35;
      cube.add(highlightEdges);
      return cube;
    }

    cube.add(
      this.createThickCubeWireframe(
        wireColor,
        CELL_SIZE * 0.066,
        CELL_SIZE * 0.033,
        43,
        0x000000
      )
    );

    const mainLineColor = wireColor;

    const shadowEdges = new LineSegments(
      new EdgesGeometry(new BoxGeometry(CELL_SIZE * 0.98, CELL_SIZE * 0.98, CELL_SIZE * 0.98)),
      new LineBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.96,
        depthWrite: false
      })
    );
    shadowEdges.renderOrder = 41;
    cube.add(shadowEdges);

    const outerEdges = new LineSegments(
      new EdgesGeometry(new BoxGeometry(CELL_SIZE * 0.94, CELL_SIZE * 0.94, CELL_SIZE * 0.94)),
      new LineBasicMaterial({
        color: mainLineColor,
        transparent: true,
        opacity: 1,
        depthWrite: false
      })
    );
    outerEdges.renderOrder = 42;
    cube.add(outerEdges);

    if (isBehindSeparator) {
      const depthShadowEdges = new LineSegments(
        new EdgesGeometry(new BoxGeometry(CELL_SIZE * 1.02, CELL_SIZE * 1.02, CELL_SIZE * 1.02)),
        new LineBasicMaterial({
          color: 0x000000,
          transparent: true,
          opacity: 0.86,
          depthWrite: false
        })
      );
      depthShadowEdges.renderOrder = 39;
      cube.add(depthShadowEdges);

      const depthEdges = new LineSegments(
        new EdgesGeometry(new BoxGeometry(CELL_SIZE * 0.98, CELL_SIZE * 0.98, CELL_SIZE * 0.98)),
        new LineBasicMaterial({
          color: wireColor,
          transparent: true,
          opacity: 0.82,
          depthWrite: false
        })
      );
      depthEdges.renderOrder = 40;
      cube.add(depthEdges);
    }

    const contactMarker = this.createSeparatorContactMarker(depthLayer, wireColor);
    if (contactMarker) {
      cube.add(contactMarker);
    }

    return cube;
  }

  private createBlockAssetCore(color: number, isActive: boolean): Group | null {
    const core = this.createCubeWorldAssetInstance('blockCore', { preserveGeometry: true });
    if (!core) {
      return null;
    }

    const material = new MeshBasicMaterial({
      color: mixColorNumber(color, isActive ? 0xffffff : 0xbff4ff, isActive ? 0.3 : 0.16),
      transparent: true,
      opacity: isActive ? 0.035 : 0.1,
      depthWrite: false,
      side: DoubleSide
    });
    core.scale.setScalar(CELL_SIZE * (isActive ? 0.44 : 0.42));
    core.traverse((child) => {
      if (!(child instanceof Mesh)) {
        return;
      }
      child.material = material;
      child.renderOrder = isActive ? 36 : 18;
      child.userData.preserveGeometry = true;
    });
    return core;
  }

  private createThickCubeWireframe(
    color: number,
    backingThickness: number,
    mainThickness: number,
    renderOrder: number,
    backingColor?: number
  ): Group {
    const group = new Group();
    const backingMaterial = new MeshBasicMaterial({
      color: backingColor ?? mixColorNumber(color, 0x001426, 0.5),
      transparent: true,
      opacity: 0.94,
      depthTest: true,
      depthWrite: false
    });
    const mainMaterial = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 1,
      depthTest: true,
      depthWrite: false
    });
    this.addCubeWireframeBeams(group, backingMaterial, CELL_SIZE * 0.99, backingThickness, renderOrder);
    this.addCubeWireframeBeams(group, mainMaterial, CELL_SIZE * 1.01, mainThickness, renderOrder + 1);

    return group;
  }

  private addCubeWireframeBeams(
    group: Group,
    material: MeshBasicMaterial,
    size: number,
    thickness: number,
    renderOrder: number
  ): void {
    const half = size / 2;
    const addBeam = (
      width: number,
      height: number,
      depth: number,
      x: number,
      y: number,
      z: number
    ) => {
      const mesh = new Mesh(CUBE_WIREFRAME_BEAM_GEOMETRY, material);
      mesh.position.set(x, y, z);
      mesh.scale.set(width, height, depth);
      mesh.renderOrder = renderOrder;
      mesh.userData.preserveGeometry = true;
      group.add(mesh);
    };

    [-half, half].forEach((y) => {
      [-half, half].forEach((z) => addBeam(size, thickness, thickness, 0, y, z));
    });
    [-half, half].forEach((x) => {
      [-half, half].forEach((z) => addBeam(thickness, size, thickness, x, 0, z));
    });
    [-half, half].forEach((x) => {
      [-half, half].forEach((y) => addBeam(thickness, thickness, size, x, y, 0));
    });
  }

  private createSettledBlockAssetCore(
    key: Extract<CubeWorldAssetKey, 'settledIceBlock'>
  ): Group | null {
    const core = this.createCubeWorldAssetInstance(key, { preserveResources: true });
    if (!core) {
      return null;
    }

    core.scale.setScalar(SETTLED_BLOCK_ASSET_SCALE);
    core.traverse((child) => {
      if (!(child instanceof Mesh)) {
        return;
      }
      child.renderOrder = 18;
    });
    return core;
  }

  private createSeparatorContactMarker(
    depthLayer: number,
    color: number
  ): Group | null {
    const { depth } = this.gameState.getDimensions();
    if (depth <= 1) {
      return null;
    }

    const faceOffsets: number[] = [];
    if (depthLayer > 0) {
      faceOffsets.push(-CELL_SIZE * 0.515);
    }
    if (depthLayer < depth - 1) {
      faceOffsets.push(CELL_SIZE * 0.515);
    }
    if (faceOffsets.length === 0) {
      return null;
    }

    const group = new Group();
    faceOffsets.forEach((faceZ) => {
      group.add(this.createSeparatorContactFrame(faceZ, color));
    });
    return group;
  }

  private createSeparatorContactFrame(faceZ: number, color: number): Group {
    const group = new Group();
    const lineMaterial = new MeshBasicMaterial({
      color: mixColorNumber(color, 0xffffff, 0.28),
      transparent: true,
      opacity: 0.72,
      depthTest: true,
      depthWrite: false,
      side: DoubleSide
    });
    const glowMaterial = new MeshBasicMaterial({
      color: mixColorNumber(color, 0x7fdcff, 0.22),
      transparent: true,
      opacity: 0.16,
      depthTest: true,
      depthWrite: false,
      side: DoubleSide
    });

    const coreLength = CELL_SIZE * 0.86;
    const glowLength = CELL_SIZE * 0.92;
    const coreWidth = CELL_SIZE * 0.018;
    const glowWidth = CELL_SIZE * 0.06;
    const edge = CELL_SIZE * 0.47;

    const strips = [
      new Mesh(new PlaneGeometry(glowLength, glowWidth), glowMaterial),
      new Mesh(new PlaneGeometry(glowLength, glowWidth), glowMaterial),
      new Mesh(new PlaneGeometry(glowWidth, glowLength), glowMaterial),
      new Mesh(new PlaneGeometry(glowWidth, glowLength), glowMaterial),
      new Mesh(new PlaneGeometry(coreLength, coreWidth), lineMaterial),
      new Mesh(new PlaneGeometry(coreLength, coreWidth), lineMaterial),
      new Mesh(new PlaneGeometry(coreWidth, coreLength), lineMaterial),
      new Mesh(new PlaneGeometry(coreWidth, coreLength), lineMaterial)
    ];

    strips[0].position.set(0, edge, faceZ);
    strips[1].position.set(0, -edge, faceZ);
    strips[2].position.set(-edge, 0, faceZ);
    strips[3].position.set(edge, 0, faceZ);
    strips[4].position.copy(strips[0].position);
    strips[5].position.copy(strips[1].position);
    strips[6].position.copy(strips[2].position);
    strips[7].position.copy(strips[3].position);

    strips.forEach((mesh) => {
      mesh.renderOrder = 32;
      group.add(mesh);
    });
    return group;
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
          opacity: 0.28,
          depthWrite: false
        })
      )
    );

    const lineMaterial = new LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.24,
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
          color: 0x42d8ff,
          transparent: true,
          opacity: 0.58,
          depthWrite: false
        })
      )
    );

    const depthLandingGeometry = new BufferGeometry().setFromPoints([
      new Vector3(0, 0, depth * CELL_SIZE),
      new Vector3(width * CELL_SIZE, 0, depth * CELL_SIZE),
      new Vector3(width * CELL_SIZE, 0, depth * CELL_SIZE),
      new Vector3(width * CELL_SIZE, height * CELL_SIZE, depth * CELL_SIZE),
      new Vector3(width * CELL_SIZE, height * CELL_SIZE, depth * CELL_SIZE),
      new Vector3(0, height * CELL_SIZE, depth * CELL_SIZE),
      new Vector3(0, height * CELL_SIZE, depth * CELL_SIZE),
      new Vector3(0, 0, depth * CELL_SIZE)
    ]);
    group.add(
      new LineSegments(
        depthLandingGeometry,
        new LineBasicMaterial({
          color: 0x28e8ff,
          transparent: true,
          opacity: 0.76,
          depthWrite: false
        })
      )
    );

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

      if (this.cameraOrbit.dragAxis === 'vertical') {
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
    const origin = this.getFieldOrigin();
    const halfWidth = (width * CELL_SIZE) / 2;
    const halfHeight = ((height + 0.6) * CELL_SIZE) / 2;
    const halfDepth = (depth * CELL_SIZE) / 2;
    const halfVerticalFov = (camera.fov * Math.PI) / 360;
    const halfHorizontalFov = Math.atan(Math.tan(halfVerticalFov) * camera.aspect);
    const fitHeightDistance = halfHeight / Math.tan(halfVerticalFov);
    const fitWidthDistance = halfWidth / Math.tan(halfHorizontalFov);
    const entranceFitDistance = Math.max(fitHeightDistance, fitWidthDistance);

    this.cameraOrbit.target.set(
      origin.x + (width * CELL_SIZE) / 2,
      height * CELL_SIZE * CAMERA_SETTINGS.targetHeightFactor,
      origin.z + (depth * CELL_SIZE) / 2
    );
    this.cameraOrbit.radius =
      halfDepth + entranceFitDistance * CAMERA_SETTINGS.initialRadiusMultiplier;
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

  private disposeActivePolyCubeGroup(): void {
    if (!this.scene || !this.activePolyCubeGroup) {
      return;
    }
    this.disposeObjectResources(this.activePolyCubeGroup);
    this.scene.remove(this.activePolyCubeGroup);
    this.activePolyCubeGroup = null;
  }

  private disposeLandingGhostGroup(): void {
    if (!this.scene || !this.landingGhostGroup) {
      return;
    }
    this.disposeObjectResources(this.landingGhostGroup);
    this.scene.remove(this.landingGhostGroup);
    this.landingGhostGroup = null;
  }

  private disposeFootprintGroup(): void {
    if (!this.scene || !this.footprintGroup) {
      return;
    }
    this.disposeObjectResources(this.footprintGroup);
    this.scene.remove(this.footprintGroup);
    this.footprintGroup = null;
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
    const textures = new Set<{ dispose: () => void }>();

    root.traverse((child) => {
      if (child instanceof Mesh || child instanceof LineSegments || child instanceof Points) {
        if (!child.userData.preserveResources && !child.userData.preserveGeometry) {
          geometries.add(child.geometry);
        }
      }

      if (
        !(child instanceof Mesh) &&
        !(child instanceof LineSegments) &&
        !(child instanceof Points) &&
        !(child instanceof Sprite)
      ) {
        return;
      }

      if (child.userData.preserveResources || child.userData.preserveMaterial) {
        return;
      }

      const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
      childMaterials.forEach((material) => {
        materials.add(material);
        const map = (material as Material & { map?: { dispose: () => void } | null }).map;
        if (map) {
          textures.add(map);
        }
      });
    });

    geometries.forEach((geometry) => geometry.dispose());
    textures.forEach((texture) => texture.dispose());
    materials.forEach((material) => material.dispose());
  }

  private disposeLoadedCubeWorldAssets(): void {
    this.assetTemplates.forEach((template) => {
      this.disposeObjectResources(template);
    });
    this.assetTemplates.clear();
    this.assetLoadPromise = null;
    this.assetsReady = false;
  }

  private syncSetupControls(root: ParentNode): void {
    const setup = this.gameState.getSetup();
    this.setInputValue(root, 'width', setup.dimensions.width);
    this.setInputValue(root, 'height', setup.dimensions.height);
    this.setInputValue(root, 'depth', setup.dimensions.depth);
    this.setInputValue(root, 'startLevel', setup.startLevel);

    root.querySelectorAll<HTMLButtonElement>('[data-block-set]').forEach((button) => {
      const isActive = button.dataset.blockSet === setup.blockSet;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });

    root.querySelectorAll<HTMLButtonElement>('[data-mission-mode]').forEach((button) => {
      const isActive = button.dataset.missionMode === setup.missionMode;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });
  }

  private collectSetupValues(root: ParentNode): GameStateOptions {
    const setup = this.gameState.getSetup();
    const activeBlockSet = root.querySelector<HTMLButtonElement>('[data-block-set].is-active')
      ?.dataset.blockSet;
    const blockSet = isBlockSet(activeBlockSet) ? activeBlockSet : setup.blockSet;
    const activeMissionMode = root.querySelector<HTMLButtonElement>('[data-mission-mode].is-active')
      ?.dataset.missionMode;
    const missionMode = isMissionMode(activeMissionMode)
      ? activeMissionMode
      : setup.missionMode;

    return {
      dimensions: {
        width: this.readSetupNumber(root, 'width', setup.dimensions.width, MIN_PIT_WIDTH, MAX_PIT_WIDTH),
        height: this.readSetupNumber(root, 'height', setup.dimensions.height, MIN_PIT_HEIGHT, MAX_PIT_HEIGHT),
        depth: this.readSetupNumber(root, 'depth', setup.dimensions.depth, MIN_PIT_DEPTH, MAX_PIT_DEPTH)
      },
      blockSet,
      startLevel: this.readSetupNumber(root, 'startLevel', setup.startLevel, 0, MAX_LEVEL - 1),
      missionMode
    };
  }

  private readSetupNumber(
    root: ParentNode,
    field: string,
    fallback: number,
    min: number,
    max: number
  ): number {
    const input = root.querySelector<HTMLInputElement>(`[data-setup-field="${field}"]`);
    const rawValue = input?.value.trim();
    if (!rawValue) {
      return fallback;
    }
    const value = Number(rawValue);
    if (!Number.isFinite(value)) {
      return fallback;
    }
    return Math.min(Math.max(Math.trunc(value), min), max);
  }

  private setInputValue(root: ParentNode, field: string, value: number): void {
    const input = root.querySelector<HTMLInputElement>(`[data-setup-field="${field}"]`);
    if (input) {
      input.value = String(value);
    }
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

  private setHidden(element: HTMLElement, hidden: boolean): void {
    element.hidden = hidden;
    if (hidden) {
      element.setAttribute('inert', '');
    } else {
      element.removeAttribute('inert');
    }
    element.querySelectorAll('button, input, select, textarea').forEach((control) => {
      if (
        control instanceof HTMLButtonElement ||
        control instanceof HTMLInputElement ||
        control instanceof HTMLSelectElement ||
        control instanceof HTMLTextAreaElement
      ) {
        control.disabled = hidden;
      }
    });
  }

  private syncDepthLayerGuide(root: ParentNode): void {
    const guide = root.querySelector<HTMLElement>('[data-role="layer-guide-list"]');
    if (!guide) {
      return;
    }

    const { depth } = this.gameState.getDimensions();
    const occupiedLayers = new Set(
      this.gameState.getSettledBlocks().map((block) => block.coordinate.z)
    );
    const occupiedLayerIndexes = Array.from(occupiedLayers).sort((a, b) => a - b);
    if (root instanceof HTMLElement) {
      root.dataset.depthLayers = String(occupiedLayerIndexes.length);
    }
    const occupiedSignature = occupiedLayerIndexes.join(',');
    const signature = `${depth}:${occupiedSignature}`;
    if (signature === this.depthLayerGuideSignature) {
      return;
    }

    this.depthLayerGuideSignature = signature;
    guide.style.setProperty('--layer-count', String(depth));
    guide.style.setProperty('--layer-stack-height', `${depth * 26 - 4}px`);
    guide.innerHTML = occupiedLayerIndexes.map((z) =>
      this.renderDepthLayerGuideRow(depth, z)
    ).join('');
  }

  private renderDepthLayerGuideRow(depth: number, z: number): string {
    const color = getBlockOutLayerColor(depth, z);
    const label = String(depth - z).padStart(2, '0');
    return [
      '<div class="layer-guide-row"',
      ` style="--layer-row: ${z + 1}; --layer-color: ${formatHexColor(color)}; --layer-soft: ${formatRgbaColor(color, 0.28)}"`,
      ` title="Z${String(z).padStart(2, '0')}">`,
      `<span class="layer-guide-index">${label}</span>`,
      '<span class="layer-guide-swatch" aria-hidden="true"></span>',
      '</div>'
    ].join('');
  }

  private syncQueue(root: ParentNode): void {
    const queue = root.querySelector<HTMLElement>('[data-role="queue-list"]');
    if (!queue) {
      return;
    }
    queue.innerHTML = this.hudState.queue
      .slice(0, 3)
      .map((id) => this.renderPolyCubePreview(id, 'queue'))
      .join('');
    if (this.hudState.queue.length === 0) {
      queue.innerHTML = '<span class="is-empty">--</span><span class="is-empty">--</span><span class="is-empty">--</span>';
    }
  }

  private syncHeldPiece(root: ParentNode): void {
    const hold = root.querySelector<HTMLElement>('[data-role="hold-piece"]');
    if (!hold) {
      return;
    }

    const heldPiece = this.gameState.getHeldPiece();
    hold.innerHTML =
      heldPiece === null
        ? '<span class="is-empty">--</span>'
        : this.renderPolyCubePreview(heldPiece, 'hold');
  }

  private syncMission(root: ParentNode): void {
    const mission = this.gameState.getMissionSnapshot();
    this.setText(root, '[data-role="mission-label"]', mission.label);

    const missionPill = root.querySelector<HTMLElement>('[data-role="mission-pill"]');
    if (missionPill) {
      missionPill.hidden = mission.mode === 'endless';
    }

    const progress = root.querySelector<HTMLElement>('[data-role="mission-progress"]');
    if (!progress) {
      return;
    }

    progress.hidden = mission.mode === 'endless';
    progress.dataset.complete = String(mission.complete);
    const percent =
      mission.targetPlanes === 0
        ? 0
        : Math.min(100, Math.round((mission.clearedPlanes / mission.targetPlanes) * 100));
    progress.style.setProperty('--mission-progress', `${percent}%`);
    progress.querySelector('span')?.replaceChildren(
      document.createTextNode(`${mission.clearedPlanes}/${mission.targetPlanes}`)
    );
  }

  private renderPolyCubePreview(id: number, variant: 'queue' | 'hold'): string {
    const definition = getPolyCubeDefinition(id);
    const projection = definition.cells.map((cell) => ({
      x: cell.x,
      y: cell.y,
      z: cell.z,
      sx: (cell.x - cell.z) * 10,
      sy: (cell.x + cell.z) * 5 - cell.y * 8
    }));
    const minX = Math.min(...projection.map((cell) => cell.sx));
    const minY = Math.min(...projection.map((cell) => cell.sy));
    const maxX = Math.max(...projection.map((cell) => cell.sx));
    const maxY = Math.max(...projection.map((cell) => cell.sy));
    const width = Math.max(30, maxX - minX + 20);
    const height = Math.max(28, maxY - minY + 20);
    const limit = PREVIEW_STAGE_LIMITS[variant];
    const scale = Math.min(1, limit.width / width, limit.height / height);
    const cells = projection
      .sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x)
      .map((cell) => {
        const left = cell.sx - minX + 5;
        const top = cell.sy - minY + 5;
        return `<span class="poly-preview-cell" style="left: ${left}px; top: ${top}px;"></span>`;
      })
      .join('');
    return [
      `<div class="poly-preview poly-preview-${variant}" style="--piece-color: ${formatHexColor(definition.color)}">`,
      `<div class="poly-preview-stage" style="width: ${width}px; height: ${height}px; --preview-scale: ${Number(scale.toFixed(3))};">${cells}</div>`,
      `<span class="poly-preview-label">${definition.label}</span>`,
      '</div>'
    ].join('');
  }

  private syncHudTimer(root: ParentNode): void {
    const elapsed = this.formatElapsed(this.hudState.elapsedMs);
    this.setText(root, '[data-role="timer"]', elapsed);
    this.setText(root, '[data-role="overlay-time"]', elapsed);
  }

  private getStatusLabel(): string {
    if (this.gameState.getMissionSnapshot().complete) {
      return 'MISSION CLEAR';
    }
    if (this.hudState.phase === 'game-over') {
      return 'GAME OVER';
    }
    if (this.hudState.settingsOpen) {
      return 'SETUP';
    }
    if (this.hudState.isPaused) {
      return 'PAUSED';
    }
    return 'RUNNING';
  }

  private formatNumber(value: number): string {
    return new Intl.NumberFormat('en-US').format(value);
  }

  private formatPitSize(): string {
    const { width, height, depth } = this.gameState.getDimensions();
    return `${width}x${height}x${depth}`;
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

function isBlockSet(value: string | undefined): value is BlockSet {
  return value !== undefined && (BLOCK_SETS as readonly string[]).includes(value);
}

function isMissionMode(value: string | undefined): value is MissionMode {
  return value !== undefined && (MISSION_MODES as readonly string[]).includes(value);
}

function deterministicNoise(index: number, salt: number): number {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function renderMeterSegments(count: number): string {
  return Array.from({ length: count }, () => '<span></span>').join('');
}

function renderKeyAssignmentRow(row: KeyAssignmentRow): string {
  const keys = row.keys.map(renderKeycap).join('');
  return `<div class="control-row"><span class="keys">${keys}</span><span>${row.label}</span></div>`;
}

function renderKeycap(label: string): string {
  const classNames: string[] = [];
  if (label.length > 1) {
    classNames.push('wide-key');
  }
  if (label.length > 8) {
    classNames.push('combo-key');
  }

  const classAttribute = classNames.length > 0 ? ` class="${classNames.join(' ')}"` : '';
  return `<b${classAttribute}>${label}</b>`;
}

function mixColorNumber(color: number, target: number, amount: number): number {
  const sourceRgb = numberToRgb(color);
  const targetRgb = numberToRgb(target);
  const mixed = sourceRgb.map((value, index) =>
    Math.round(value + (targetRgb[index] - value) * amount)
  );
  return (mixed[0] << 16) | (mixed[1] << 8) | mixed[2];
}

function numberToRgb(color: number): [number, number, number] {
  return [(color >> 16) & 255, (color >> 8) & 255, color & 255];
}

function formatHexColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function formatRgbaColor(color: number, alpha: number): string {
  const [r, g, b] = numberToRgb(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
