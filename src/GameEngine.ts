import type { FieldCoordinate } from './constants/field';
import type { Axis } from './types/coordinates';
import { GameState } from './GameState';
import { Renderer } from './Renderer';

/**
 * ゲームループと主要コンポーネントのライフサイクルを管理するクラス。
 */
export class GameEngine {
  private readonly state: GameState;
  private readonly renderer: Renderer;
  private animationFrameId: number | null = null;
  private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
  private lastDropAt = 0;
  private startedAt = 0;
  private pausedAt = 0;
  private pausedDuration = 0;
  private lastHudElapsedSecond = -1;
  private paused = false;
  private settingsOpen = false;

  constructor(state: GameState = new GameState(), renderer?: Renderer) {
    this.state = state;
    this.renderer =
      renderer ??
      new Renderer(this.state, {
        onRestart: () => this.restart(),
        onTogglePause: () => this.togglePause(),
        onToggleSettings: () => this.toggleSettings()
      });
  }

  /**
   * 指定したコンテナに Three.js のキャンバスを初期化し、レンダリングループを開始する。
   */
  public start(container: HTMLElement): void {
    this.state.ensureActiveTetromino();
    this.startedAt = performance.now();
    this.pausedDuration = 0;
    this.pausedAt = 0;
    this.paused = false;
    this.renderer.initialize(container);
    this.syncScene();
    this.attachInputHandlers();
    this.beginRenderLoop();
  }

  /**
   * レンダリングループを停止し、各種リソースを解放する。
   */
  public stop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.detachInputHandlers();
    this.renderer.dispose();
  }

  /**
   * GameState インスタンスへの読み取りアクセスを提供する。
   */
  public getState(): GameState {
    return this.state;
  }

  /**
   * Renderer インスタンスを取得する。テストやデバッグ用。
   */
  public getRenderer(): Renderer {
    return this.renderer;
  }

  private beginRenderLoop(): void {
    const loop = (timestamp: number) => {
      this.advanceGame(timestamp);
      this.syncElapsedHud();
      this.animationFrameId = requestAnimationFrame(loop);
    };

    this.lastDropAt = performance.now();
    this.lastHudElapsedSecond = -1;
    this.animationFrameId = requestAnimationFrame(loop);
  }

  private attachInputHandlers(): void {
    if (this.keydownHandler) {
      return;
    }
    this.keydownHandler = (event: KeyboardEvent) => this.handleKeyDown(event);
    window.addEventListener('keydown', this.keydownHandler);
  }

  private detachInputHandlers(): void {
    if (!this.keydownHandler) {
      return;
    }
    window.removeEventListener('keydown', this.keydownHandler);
    this.keydownHandler = null;
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.code === 'KeyR') {
      event.preventDefault();
      this.restart();
      return;
    }

    if (event.code === 'KeyP' || event.code === 'Escape') {
      event.preventDefault();
      this.togglePause();
      return;
    }

    if (this.state.isGameOver()) {
      return;
    }

    if (this.paused) {
      return;
    }

    if (event.code === 'Space') {
      event.preventDefault();
      const distance = this.state.hardDropActiveTetromino();
      this.state.addHardDropScore(distance);
      if (this.state.getActiveTetromino()) {
        this.state.lockActiveTetromino();
        this.state.spawnTetromino();
      }
      this.lastDropAt = performance.now();
      this.syncScene();
      return;
    }

    if (event.code === 'KeyC') {
      event.preventDefault();
      if (this.state.holdActiveTetromino()) {
        this.lastDropAt = performance.now();
        this.syncScene({ settledBlocks: false });
      }
      return;
    }

    const move = MOVEMENT_OFFSETS[event.code];
    if (move) {
      event.preventDefault();
      if (this.state.moveActiveTetromino(move)) {
        if (event.code === 'KeyS') {
          this.state.addSoftDropScore();
          this.lastDropAt = performance.now();
        }
        this.syncScene({ settledBlocks: false });
      }
      return;
    }

    const rotation = ROTATION_COMMANDS[event.code];
    if (rotation) {
      event.preventDefault();
      if (this.state.rotateActiveTetromino(rotation.axis, rotation.direction)) {
        this.syncScene({ settledBlocks: false });
      }
    }
  }

  private advanceGame(timestamp: number): void {
    if (
      this.paused ||
      this.state.isGameOver() ||
      timestamp - this.lastDropAt < this.state.getDropIntervalMs()
    ) {
      return;
    }

    let settledBlocksChanged = false;
    if (!this.state.moveActiveTetromino(DROP_OFFSET) && this.state.getActiveTetromino()) {
      this.state.lockActiveTetromino();
      this.state.spawnTetromino();
      settledBlocksChanged = true;
    }

    this.lastDropAt = timestamp;
    this.syncScene({ settledBlocks: settledBlocksChanged });
  }

  private restart(): void {
    this.state.reset();
    this.state.ensureActiveTetromino();
    this.startedAt = performance.now();
    this.pausedDuration = 0;
    this.pausedAt = 0;
    this.lastHudElapsedSecond = -1;
    this.paused = false;
    this.settingsOpen = false;
    this.lastDropAt = performance.now();
    this.syncScene();
  }

  private syncScene(options: SyncSceneOptions = {}): void {
    const { settledBlocks = true } = options;
    const elapsedMs = this.getElapsedMs();

    if (settledBlocks) {
      this.renderer.updateSettledBlocks(this.state.getSettledBlocks());
    }
    this.renderer.updateActiveTetromino(this.state.getActiveTetromino());
    this.renderer.updateHud(
      this.state.getUpcomingQueue(),
      this.state.getPhase(),
      this.state.getClearedLayerCount(),
      this.state.getScore(),
      this.state.getLevel(),
      this.state.getDropIntervalMs(),
      elapsedMs,
      this.paused,
      this.settingsOpen,
      this.state.getHeldPiece()
    );
    this.lastHudElapsedSecond = Math.floor(elapsedMs / 1000);
    this.renderer.renderFrame();
  }

  private syncElapsedHud(): void {
    const elapsedMs = this.getElapsedMs();
    const elapsedSecond = Math.floor(elapsedMs / 1000);
    if (elapsedSecond === this.lastHudElapsedSecond) {
      return;
    }

    this.lastHudElapsedSecond = elapsedSecond;
    this.renderer.updateElapsedTime(elapsedMs);
  }

  private togglePause(): void {
    if (this.state.isGameOver()) {
      return;
    }

    if (this.paused) {
      this.paused = false;
      this.pausedDuration += performance.now() - this.pausedAt;
      this.lastDropAt = performance.now();
    } else {
      this.paused = true;
      this.pausedAt = performance.now();
    }

    this.syncScene({ settledBlocks: false });
  }

  private toggleSettings(): void {
    this.settingsOpen = !this.settingsOpen;
    this.syncScene({ settledBlocks: false });
  }

  private getElapsedMs(): number {
    if (this.startedAt === 0) {
      return 0;
    }

    const now = this.paused ? this.pausedAt : performance.now();
    return now - this.startedAt - this.pausedDuration;
  }
}

type RotationCommand = {
  axis: Axis;
  direction: RotationDirection;
};

type SyncSceneOptions = {
  settledBlocks?: boolean;
};

type RotationDirection = 1 | -1;

const MOVEMENT_OFFSETS: Record<string, FieldCoordinate> = {
  ArrowLeft: { x: -1, y: 0, z: 0 },
  ArrowRight: { x: 1, y: 0, z: 0 },
  ArrowUp: { x: 0, y: 0, z: -1 },
  ArrowDown: { x: 0, y: 0, z: 1 },
  KeyW: { x: 0, y: 1, z: 0 },
  KeyS: { x: 0, y: -1, z: 0 }
};

const DROP_OFFSET: FieldCoordinate = { x: 0, y: -1, z: 0 };

const ROTATION_COMMANDS: Record<string, RotationCommand> = {
  KeyQ: { axis: 'y', direction: -1 },
  KeyE: { axis: 'y', direction: 1 },
  KeyA: { axis: 'z', direction: -1 },
  KeyD: { axis: 'z', direction: 1 },
  KeyZ: { axis: 'x', direction: -1 },
  KeyX: { axis: 'x', direction: 1 }
};
