import type { FieldCoordinate } from './constants/field';
import type { Axis } from './types/coordinates';
import type { GameStateOptions, RotationDirection } from './GameState';
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
  private endedAt = 0;
  private lastHudElapsedSecond = -1;
  private container: HTMLElement | null = null;
  private paused = false;
  private settingsOpen = false;
  private settingsOpenedAt = 0;
  private settingsDuration = 0;
  private pendingLockAt = 0;
  private repeatActionAllowedAt = 0;

  constructor(state: GameState = new GameState(), renderer?: Renderer) {
    this.state = state;
    this.renderer =
      renderer ??
      new Renderer(this.state, {
        onRestart: () => this.restart(),
        onTogglePause: () => this.togglePause(),
        onToggleSettings: () => this.toggleSettings(),
        onApplySetup: (setup) => this.applySetup(setup)
      });
  }

  /**
   * 指定したコンテナに Three.js のキャンバスを初期化し、レンダリングループを開始する。
   */
  public start(container: HTMLElement): void {
    this.container = container;
    this.state.ensureActivePolyCube();
    this.startedAt = performance.now();
    this.pausedDuration = 0;
    this.pausedAt = 0;
    this.endedAt = 0;
    this.paused = false;
    this.settingsOpen = false;
    this.settingsOpenedAt = 0;
    this.settingsDuration = 0;
    this.pendingLockAt = 0;
    this.repeatActionAllowedAt = 0;
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
    this.container = null;
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
    if (isInteractiveInputTarget(event.target)) {
      if (event.code === 'Escape' && this.settingsOpen) {
        event.preventDefault();
        this.toggleSettings();
      }
      return;
    }

    if (event.repeat && ONE_SHOT_CODES.has(event.code)) {
      event.preventDefault();
      return;
    }

    if (event.code === 'Escape' && this.settingsOpen) {
      event.preventDefault();
      this.toggleSettings();
      return;
    }

    if (this.settingsOpen) {
      return;
    }

    if (event.code === 'KeyR') {
      event.preventDefault();
      this.restart();
      return;
    }

    if (event.code === 'Escape') {
      event.preventDefault();
      this.endGame();
      return;
    }

    if (event.code === 'KeyP') {
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

    if (this.pendingLockAt !== 0) {
      return;
    }

    if (event.repeat && isRepeatableGameplayCode(event.code)) {
      event.preventDefault();
      if (performance.now() < this.repeatActionAllowedAt) {
        return;
      }
    }

    if (event.code === 'Space') {
      event.preventDefault();
      this.state.hardDropActivePolyCube();
      if (this.state.getActivePolyCube()) {
        this.scheduleActiveLock(HARD_DROP_LOCK_DELAY_MS);
      }
      this.lastDropAt = performance.now();
      this.syncScene();
      return;
    }

    const move = MOVEMENT_OFFSETS[event.code];
    if (move) {
      event.preventDefault();
      if (this.moveActivePolyCube(move)) {
        this.markRepeatActionCooldown();
        this.syncScene({ settledBlocks: false });
      }
      return;
    }

    const rotation = getRotationCommand(event);
    if (rotation) {
      event.preventDefault();
      if (this.state.rotateActivePolyCube(rotation.axis, rotation.direction)) {
        this.markRepeatActionCooldown();
        this.syncScene({ settledBlocks: false });
      }
    }
  }

  private advanceGame(timestamp: number): void {
    if (this.paused || this.settingsOpen || this.state.isGameOver()) {
      return;
    }

    if (this.pendingLockAt !== 0) {
      if (timestamp >= this.pendingLockAt) {
        this.lockActiveAndSpawnNext();
        this.lastDropAt = timestamp;
        this.syncScene({ settledBlocks: true });
      }
      return;
    }

    if (
      timestamp - this.lastDropAt < this.state.getDropIntervalMs()
    ) {
      return;
    }

    const stepResult = this.state.stepActivePolyCube();
    if (stepResult === 'blocked' && this.state.getActivePolyCube()) {
      this.scheduleActiveLock(NATURAL_LOCK_DELAY_MS, timestamp);
    }

    this.lastDropAt = timestamp;
    this.syncScene({ settledBlocks: false });
  }

  private restart(): void {
    this.state.reset();
    this.state.ensureActivePolyCube();
    this.resetRunClock();
    this.settingsOpen = false;
    this.syncScene();
  }

  private applySetup(setup: GameStateOptions): void {
    this.state.configure(setup);
    this.state.ensureActivePolyCube();
    this.resetRunClock();
    this.settingsOpen = false;
    this.settingsOpenedAt = 0;
    this.settingsDuration = 0;
    this.pendingLockAt = 0;
    this.repeatActionAllowedAt = 0;
    this.lastDropAt = performance.now();

    if (this.container) {
      this.renderer.dispose();
      this.renderer.initialize(this.container);
    }

    this.syncScene();
  }

  private resetRunClock(): void {
    this.startedAt = performance.now();
    this.pausedDuration = 0;
    this.pausedAt = 0;
    this.endedAt = 0;
    this.lastHudElapsedSecond = -1;
    this.paused = false;
    this.settingsOpen = false;
    this.settingsOpenedAt = 0;
    this.settingsDuration = 0;
    this.pendingLockAt = 0;
    this.repeatActionAllowedAt = 0;
    this.lastDropAt = performance.now();
  }

  private syncScene(options: SyncSceneOptions = {}): void {
    const { settledBlocks = true } = options;
    const elapsedMs = this.getElapsedMs();

    if (settledBlocks) {
      this.renderer.updateSettledBlocks(this.state.getSettledBlocks());
    }
    this.renderer.updateActivePolyCube(this.state.getActivePolyCube());
    this.renderer.updateHud(
      this.state.getUpcomingQueue(3),
      this.state.getPhase(),
      this.state.getClearedLayerCount(),
      this.state.getScore(),
      this.state.getLevel(),
      this.state.getDropIntervalMs(),
      elapsedMs,
      this.paused,
      this.settingsOpen
    );
    this.lastHudElapsedSecond = Math.floor(elapsedMs / 1000);
    this.renderer.renderFrame();
  }

  private syncElapsedHud(): void {
    if (this.state.isGameOver()) {
      return;
    }

    const elapsedMs = this.getElapsedMs();
    const elapsedSecond = Math.floor(elapsedMs / 1000);
    if (elapsedSecond === this.lastHudElapsedSecond) {
      return;
    }

    this.lastHudElapsedSecond = elapsedSecond;
    this.renderer.updateElapsedTime(elapsedMs);
  }

  private togglePause(): void {
    if (this.state.isGameOver() || this.settingsOpen) {
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
    const now = performance.now();
    if (this.settingsOpen) {
      this.settingsOpen = false;
      if (!this.paused && this.settingsOpenedAt !== 0) {
        const openDuration = now - this.settingsOpenedAt;
        this.settingsDuration += openDuration;
        if (this.pendingLockAt !== 0) {
          this.pendingLockAt += openDuration;
        }
      }
      this.settingsOpenedAt = 0;
      this.lastDropAt = now;
    } else {
      this.settingsOpen = true;
      this.settingsOpenedAt = now;
    }
    this.syncScene({ settledBlocks: false });
  }

  private endGame(): void {
    if (this.state.isGameOver()) {
      return;
    }

    const now = performance.now();
    if (this.paused) {
      this.pausedDuration += now - this.pausedAt;
      this.pausedAt = 0;
    }

    this.state.endGame();
    this.markGameEnded(now);
    this.paused = false;
    this.settingsOpen = false;
    this.settingsOpenedAt = 0;
    this.pendingLockAt = 0;
    this.repeatActionAllowedAt = 0;
    this.syncScene();
  }

  private lockActiveAndSpawnNext(): void {
    this.pendingLockAt = 0;
    this.repeatActionAllowedAt = 0;
    this.state.lockActivePolyCube();
    if (this.state.getActivePolyCube()) {
      return;
    }
    this.state.spawnPolyCube();
    if (this.state.isGameOver()) {
      this.markGameEnded();
    }
  }

  private scheduleActiveLock(delayMs: number, timestamp = performance.now()): void {
    this.pendingLockAt = timestamp + delayMs;
  }

  private markRepeatActionCooldown(timestamp = performance.now()): void {
    this.repeatActionAllowedAt = timestamp + INPUT_REPEAT_INTERVAL_MS;
  }

  private markGameEnded(timestamp = performance.now()): void {
    if (this.endedAt === 0) {
      this.endedAt = timestamp;
    }
  }

  private moveActivePolyCube(move: FieldCoordinate): boolean {
    if (this.state.moveActivePolyCube(move)) {
      return true;
    }

    if (move.x !== 0 && move.y !== 0 && move.z === 0) {
      return (
        this.state.moveActivePolyCube({ x: move.x, y: 0, z: 0 }) ||
        this.state.moveActivePolyCube({ x: 0, y: move.y, z: 0 })
      );
    }

    return false;
  }

  private getElapsedMs(): number {
    if (this.startedAt === 0) {
      return 0;
    }

    const now = this.endedAt !== 0 ? this.endedAt : this.paused ? this.pausedAt : performance.now();
    const activeSettingsDuration =
      this.settingsOpen && !this.paused && this.settingsOpenedAt !== 0
        ? now - this.settingsOpenedAt
        : 0;
    return now - this.startedAt - this.pausedDuration - this.settingsDuration - activeSettingsDuration;
  }
}

type RotationCommand = {
  axis: Axis;
  direction: RotationDirection;
};

type SyncSceneOptions = {
  settledBlocks?: boolean;
};

const MOVEMENT_OFFSETS: Record<string, FieldCoordinate> = {
  ArrowLeft: { x: 1, y: 0, z: 0 },
  ArrowRight: { x: -1, y: 0, z: 0 },
  ArrowUp: { x: 0, y: 1, z: 0 },
  ArrowDown: { x: 0, y: -1, z: 0 },
  Home: { x: 1, y: 1, z: 0 },
  PageUp: { x: -1, y: 1, z: 0 },
  End: { x: 1, y: -1, z: 0 },
  PageDown: { x: -1, y: -1, z: 0 },
  Numpad4: { x: 1, y: 0, z: 0 },
  Numpad6: { x: -1, y: 0, z: 0 },
  Numpad8: { x: 0, y: 1, z: 0 },
  Numpad2: { x: 0, y: -1, z: 0 },
  Numpad7: { x: 1, y: 1, z: 0 },
  Numpad9: { x: -1, y: 1, z: 0 },
  Numpad1: { x: 1, y: -1, z: 0 },
  Numpad3: { x: -1, y: -1, z: 0 },
  Digit4: { x: 1, y: 0, z: 0 },
  Digit6: { x: -1, y: 0, z: 0 },
  Digit8: { x: 0, y: 1, z: 0 },
  Digit2: { x: 0, y: -1, z: 0 },
  Digit7: { x: 1, y: 1, z: 0 },
  Digit9: { x: -1, y: 1, z: 0 },
  Digit1: { x: 1, y: -1, z: 0 },
  Digit3: { x: -1, y: -1, z: 0 }
};

const ONE_SHOT_CODES = new Set(['Space', 'KeyP', 'Escape', 'KeyR']);
const HARD_DROP_ANIMATION_MS = 160;
const HARD_DROP_SETTLE_MS = 50;
const HARD_DROP_LOCK_DELAY_MS = HARD_DROP_ANIMATION_MS + HARD_DROP_SETTLE_MS;
const NATURAL_LOCK_DELAY_MS = 50;
const INPUT_REPEAT_INTERVAL_MS = 80;

const ROTATION_COMMANDS: Record<string, RotationCommand> = {
  KeyQ: { axis: 'x', direction: -1 },
  KeyA: { axis: 'x', direction: 1 },
  KeyW: { axis: 'y', direction: -1 },
  KeyS: { axis: 'y', direction: 1 },
  KeyE: { axis: 'z', direction: -1 },
  KeyD: { axis: 'z', direction: 1 }
};

function getRotationCommand(event: KeyboardEvent): RotationCommand | null {
  return ROTATION_COMMANDS[event.code] ?? null;
}

function isRepeatableGameplayCode(code: string): boolean {
  return code in MOVEMENT_OFFSETS || code in ROTATION_COMMANDS;
}

function isInteractiveInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(target.closest('input, textarea, select, button, [contenteditable="true"]'));
}
