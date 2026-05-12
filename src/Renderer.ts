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
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
  GridHelper
} from 'three';
import type {
  ActiveTetrominoSnapshot,
  GamePhase,
  SettledBlockSnapshot
} from './GameState';
import type { TetrominoType } from './constants/tetromino';
import { GameState } from './GameState';
import { CELL_SIZE, FIELD_DIMENSIONS, FIELD_ORIGIN } from './constants/field';

/**
 * Three.js を用いてゲームフィールドを描画する View 層。
 */
export class Renderer {
  private readonly gameState: GameState;
  private scene: Scene | null = null;
  private camera: PerspectiveCamera | null = null;
  private renderer: WebGLRenderer | null = null;
  private container: HTMLElement | null = null;
  private resizeHandler: (() => void) | null = null;
  private activeTetrominoGroup: Group | null = null;
  private settledBlocksGroup: Group | null = null;
  private hudElement: HTMLDivElement | null = null;

  constructor(gameState: GameState) {
    this.gameState = gameState;
  }

  /**
   * 描画に必要な Three.js の初期化処理を行い、即座に 1 フレーム描画する。
   */
  public initialize(container: HTMLElement): void {
    this.container = container;

    const scene = new Scene();
    scene.background = new Color('#0f172a');

    const { width, height, depth } = this.gameState.getDimensions();

    const camera = new PerspectiveCamera(
      50,
      this.getAspectRatio(),
      0.1,
      1000
    );
    const cameraTarget = new Vector3(
      FIELD_ORIGIN.x + (width * CELL_SIZE) / 2,
      (height * CELL_SIZE) / 2,
      FIELD_ORIGIN.z + (depth * CELL_SIZE) / 2
    );
    camera.position.set(
      cameraTarget.x + width * 1.2,
      cameraTarget.y + height * 0.8,
      cameraTarget.z + depth * 1.8
    );
    camera.lookAt(cameraTarget);

    const renderer = new WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);

    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    container.appendChild(this.createHudElement());

    scene.add(this.createLighting());
    scene.add(this.createFieldBounds());
    scene.add(this.createGridHelper());

    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;

    this.resizeHandler = () => this.onResize();
    window.addEventListener('resize', this.resizeHandler);

    this.updateActiveTetromino(this.gameState.getActiveTetromino());
    this.updateSettledBlocks(this.gameState.getSettledBlocks());
    this.updateHud(
      this.gameState.getUpcomingQueue(),
      this.gameState.getPhase(),
      this.gameState.getClearedLayerCount()
    );
    this.renderFrame();
  }

  /**
   * 現在のシーンを 1 フレーム描画する。将来的にゲームループから呼び出される。
   */
  public renderFrame(): void {
    if (!this.scene || !this.camera || !this.renderer) {
      return;
    }

    this.renderer.render(this.scene, this.camera);
  }

  /**
   * リサイズ監視や Three.js リソースのクリーンアップを行う。
   */
  public dispose(): void {
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }

    this.renderer?.dispose();
    this.disposeActiveTetrominoGroup();
    this.disposeSettledBlocksGroup();
    this.hudElement?.remove();
    this.hudElement = null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.container = null;
  }

  public updateActiveTetromino(tetromino: ActiveTetrominoSnapshot | null): void {
    if (!this.scene) {
      return;
    }

    this.disposeActiveTetrominoGroup();

    if (!tetromino) {
      return;
    }

    const group = new Group();
    group.position.set(FIELD_ORIGIN.x, FIELD_ORIGIN.y, FIELD_ORIGIN.z);

    tetromino.blocks.forEach((block) => {
      const mesh = this.createBlockMesh(tetromino.color);
      mesh.position.set(
        (block.x + 0.5) * CELL_SIZE,
        (block.y + 0.5) * CELL_SIZE,
        (block.z + 0.5) * CELL_SIZE
      );
      group.add(mesh);
    });

    this.activeTetrominoGroup = group;
    this.scene.add(group);
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
      const mesh = this.createBlockMesh(block.color);
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
    clearedLayerCount: number
  ): void {
    if (!this.hudElement) {
      return;
    }

    const headline = phase === 'game-over' ? 'GAME OVER' : 'RUNNING';
    const queueText = queue.join('  ');
    const restartHint = phase === 'game-over' ? 'Press R to restart' : 'R to restart';

    this.hudElement.innerHTML = `
      <div style="font-size:12px;letter-spacing:0.18em;color:#7dd3fc;">${headline}</div>
      <div style="margin-top:8px;font-size:13px;color:#e2e8f0;">Next: ${queueText}</div>
      <div style="margin-top:6px;font-size:13px;color:#e2e8f0;">Cleared: ${clearedLayerCount}</div>
      <div style="margin-top:12px;font-size:12px;line-height:1.6;color:#cbd5e1;">
        Move: Arrow keys / W / S<br />
        Rotate: Q E / A D / Z X<br />
        ${restartHint}
      </div>
    `;
  }

  /**
   * Construct floor, walls, ceiling, and a translucent wireframe to visualize the playable volume.
   */
  private createFieldBounds(): Group {
    const group = new Group();
    group.position.set(FIELD_ORIGIN.x, FIELD_ORIGIN.y, FIELD_ORIGIN.z);

    const { width, height, depth } = this.gameState.getDimensions();

    const floorMaterial = new MeshStandardMaterial({
      color: 0x1f2937,
      metalness: 0.1,
      roughness: 0.8
    });
    const wallMaterial = new MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.05,
      roughness: 0.7,
      transparent: true,
      opacity: 0.9
    });
    const ceilingMaterial = wallMaterial.clone();
    ceilingMaterial.opacity = 0.35;

    const boundsMaterial = new LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.45
    });

    const floor = new Mesh(
      new PlaneGeometry(width * CELL_SIZE, depth * CELL_SIZE),
      floorMaterial
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.position.set(
      (width * CELL_SIZE) / 2,
      0,
      (depth * CELL_SIZE) / 2
    );

    const ceiling = new Mesh(
      new PlaneGeometry(width * CELL_SIZE, depth * CELL_SIZE),
      ceilingMaterial
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(
      (width * CELL_SIZE) / 2,
      height * CELL_SIZE,
      (depth * CELL_SIZE) / 2
    );

    const leftWall = new Mesh(
      new PlaneGeometry(depth * CELL_SIZE, height * CELL_SIZE),
      wallMaterial
    );
    leftWall.position.set(0, (height * CELL_SIZE) / 2, (depth * CELL_SIZE) / 2);
    leftWall.rotation.y = Math.PI / 2;

    const rightWall = leftWall.clone();
    rightWall.position.set(width * CELL_SIZE, (height * CELL_SIZE) / 2, (depth * CELL_SIZE) / 2);
    rightWall.rotation.y = -Math.PI / 2;

    const backWall = new Mesh(
      new PlaneGeometry(width * CELL_SIZE, height * CELL_SIZE),
      wallMaterial
    );
    backWall.position.set(
      (width * CELL_SIZE) / 2,
      (height * CELL_SIZE) / 2,
      depth * CELL_SIZE
    );
    backWall.rotation.y = Math.PI;

    const boundsGeometry = new BoxGeometry(
      width * CELL_SIZE,
      height * CELL_SIZE,
      depth * CELL_SIZE
    );
    boundsGeometry.translate(
      (width * CELL_SIZE) / 2,
      (height * CELL_SIZE) / 2,
      (depth * CELL_SIZE) / 2
    );
    const bounds = new LineSegments(new EdgesGeometry(boundsGeometry), boundsMaterial);

    group.add(floor, ceiling, leftWall, rightWall, backWall, bounds);

    return group;
  }

  private createLighting(): Group {
    const group = new Group();

    const ambient = new AmbientLight(0xf1f5f9, 0.35);

    const directional = new DirectionalLight(0xf8fafc, 0.8);
    directional.position.set(10, 18, 12);
    directional.castShadow = true;

    group.add(ambient, directional);
    return group;
  }

  private createGridHelper(): GridHelper {
    const { width, depth } = FIELD_DIMENSIONS;
    const helper = new GridHelper(
      Math.max(width, depth) * CELL_SIZE,
      Math.max(width, depth),
      0x38bdf8,
      0x1e293b
    );
    helper.position.set(
      FIELD_ORIGIN.x + (width * CELL_SIZE) / 2,
      FIELD_ORIGIN.y + 0.001,
      FIELD_ORIGIN.z + (depth * CELL_SIZE) / 2
    );
    return helper;
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

  private disposeGroupMeshes(group: Group): void {
    group.children.forEach((child) => {
      if (child instanceof Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((material) => material.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
  }

  private createBlockMesh(color: number): Mesh {
    const geometry = new BoxGeometry(CELL_SIZE, CELL_SIZE, CELL_SIZE);
    const material = new MeshStandardMaterial({
      color,
      metalness: 0.1,
      roughness: 0.35
    });
    const mesh = new Mesh(geometry, material);
    mesh.castShadow = true;
    return mesh;
  }

  private createHudElement(): HTMLDivElement {
    const hud = document.createElement('div');
    hud.style.position = 'absolute';
    hud.style.top = '16px';
    hud.style.left = '16px';
    hud.style.padding = '12px 14px';
    hud.style.background = 'rgba(15, 23, 42, 0.72)';
    hud.style.border = '1px solid rgba(56, 189, 248, 0.25)';
    hud.style.borderRadius = '10px';
    hud.style.backdropFilter = 'blur(10px)';
    hud.style.fontFamily = '"Segoe UI", sans-serif';
    hud.style.minWidth = '220px';
    hud.style.pointerEvents = 'none';
    this.hudElement = hud;
    return hud;
  }
}
