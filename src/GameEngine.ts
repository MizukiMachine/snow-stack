import type { FieldCoordinate } from './constants/field';
import type { GameStateOptions, RotationDirection } from './GameState';
import type { Axis } from './types/coordinates';
import {
  HOLD_CODES,
  MOVEMENT_OFFSETS,
  ONE_SHOT_CODES,
  ROTATION_COMMANDS,
  SOFT_DROP_CODES,
  isRepeatableGameplayCode
} from './config/controls';
import { GameState } from './GameState';
import { Renderer } from './Renderer';
import { BGM_ASSETS, DEFAULT_BGM_ID } from './audio/AudioAssets';
import { AudioManager, type GameAudio } from './audio/AudioManager';

type GameEngineOptions = {
  readonly showStartScreen?: boolean;
  readonly audio?: GameAudio;
};

/**
 * ゲームループと主要コンポーネントのライフサイクルを管理するクラス。
 */
export class GameEngine {
  private readonly state: GameState;
  private readonly renderer: Renderer;
  private readonly audio: GameAudio;
  private readonly showStartScreen: boolean;
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
  private startMenuOpen = false;
  private settingsOpenedAt = 0;
  private settingsDuration = 0;
  private pendingLockAt = 0;
  private pendingLockAllowsAdjustment = false;
  private repeatActionAllowedAt = 0;
  private nextGameplayBgmIndex = 0;
  private appSuspended = false;
  private appSuspendedAt = 0;

  constructor(
    state: GameState = new GameState(),
    renderer?: Renderer,
    options: GameEngineOptions = {}
  ) {
    this.state = state;
    this.audio = options.audio ?? new AudioManager();
    this.showStartScreen = options.showStartScreen ?? true;
    this.renderer =
      renderer ??
      new Renderer(this.state, {
        onRestart: () => this.restart(),
        onTogglePause: () => this.togglePause(),
        onToggleSettings: () => this.toggleSettings(),
        onToggleMute: () => this.toggleMute(),
        onApplySetup: (setup) => this.applySetup(setup),
        onMove: (move) => this.applyMoveInput(move),
        onRotate: (axis, direction) => this.applyRotateInput(axis, direction),
        onSoftDrop: () => this.applySoftDropInput(),
        onHardDrop: () => this.applyHardDropInput(),
        onHold: () => this.applyHoldInput(),
        onUiSelect: () => this.applyUiSelection()
      });
  }

  /**
   * 指定したコンテナに Three.js のキャンバスを初期化し、レンダリングループを開始する。
   */
  public start(container: HTMLElement): void {
    this.container = container;
    this.startMenuOpen = this.showStartScreen;
    if (!this.startMenuOpen) {
      this.state.ensureActivePolyCube();
    }
    this.startedAt = performance.now();
    this.pausedDuration = 0;
    this.pausedAt = 0;
    this.endedAt = 0;
    this.paused = false;
    this.settingsOpen = false;
    this.settingsOpenedAt = 0;
    this.settingsDuration = 0;
    this.pendingLockAt = 0;
    this.pendingLockAllowsAdjustment = false;
    this.repeatActionAllowedAt = 0;
    this.renderer.initialize(container);
    this.syncScene();
    if (this.startMenuOpen) {
      this.previewNextGameplayBgm();
    }
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
    this.audio.dispose();
    this.renderer.dispose();
    this.container = null;
    this.appSuspended = false;
    this.appSuspendedAt = 0;
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

  public suspendForAppPause(): void {
    if (this.appSuspended || !this.container) {
      return;
    }

    this.appSuspended = true;
    this.appSuspendedAt = performance.now();
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.audio.pauseBgm();
  }

  public resumeFromAppPause(): void {
    if (!this.appSuspended || !this.container) {
      return;
    }

    const now = performance.now();
    const suspendedDuration = now - this.appSuspendedAt;
    this.appSuspended = false;
    this.appSuspendedAt = 0;
    if (!this.paused && !this.settingsOpen && !this.startMenuOpen && !this.state.isGameOver()) {
      this.pausedDuration += suspendedDuration;
    }
    this.lastDropAt = now;
    this.lastHudElapsedSecond = -1;
    if (this.animationFrameId === null) {
      this.beginRenderLoop();
    }
    if (!this.paused && !this.state.isGameOver()) {
      this.audio.resumeBgm();
    }
  }

  public handleBackButton(): boolean {
    if (this.settingsOpen) {
      this.toggleSettings();
      return true;
    }
    if (this.paused) {
      this.togglePause();
      return true;
    }
    return false;
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

    if (this.startMenuOpen) {
      event.preventDefault();
      return;
    }

    if (event.code === 'Escape') {
      event.preventDefault();
      this.endGame();
      return;
    }

    if (this.state.isGameOver()) {
      if (this.renderer.handleCameraInspectionKey(event.code)) {
        event.preventDefault();
      }
      return;
    }

    if (this.paused) {
      if (this.renderer.handleCameraInspectionKey(event.code)) {
        event.preventDefault();
      }
      return;
    }

    if (event.repeat && isRepeatableGameplayCode(event.code)) {
      event.preventDefault();
      if (performance.now() < this.repeatActionAllowedAt) {
        return;
      }
    }

    if (HOLD_CODES.has(event.code)) {
      event.preventDefault();
      this.applyHoldInput();
      return;
    }

    if (event.code === 'Space') {
      event.preventDefault();
      this.applyHardDropInput();
      return;
    }

    if (SOFT_DROP_CODES.has(event.code)) {
      event.preventDefault();
      this.applySoftDropInput();
      return;
    }

    const move = MOVEMENT_OFFSETS[event.code];
    if (move) {
      event.preventDefault();
      this.applyMoveInput(move);
      return;
    }

    const rotation = ROTATION_COMMANDS[event.code];
    if (rotation) {
      event.preventDefault();
      this.applyRotateInput(rotation.axis, rotation.direction);
    }
  }

  private canApplyGameplayInput(): boolean {
    return (
      !this.settingsOpen &&
      !this.startMenuOpen &&
      !this.paused &&
      !this.state.isGameOver() &&
      (this.pendingLockAt === 0 || this.pendingLockAllowsAdjustment)
    );
  }

  private applyMoveInput(move: FieldCoordinate): void {
    if (!this.canApplyGameplayInput()) {
      return;
    }

    if (this.moveActivePolyCube(move)) {
      this.audio.playSfx('move');
      this.markRepeatActionCooldown();
      this.refreshPendingLockAfterAdjustment();
      this.syncScene({ settledBlocks: false });
    }
  }

  private applyRotateInput(axis: Axis, direction: RotationDirection): void {
    if (!this.canApplyGameplayInput()) {
      return;
    }

    if (this.state.rotateActivePolyCube(axis, direction)) {
      this.audio.playSfx('rotate');
      this.markRepeatActionCooldown();
      this.refreshPendingLockAfterAdjustment();
      this.syncScene({ settledBlocks: false });
    }
  }

  private applySoftDropInput(): void {
    if (!this.canApplyGameplayInput()) {
      return;
    }

    const now = performance.now();
    const stepResult = this.state.softDropActivePolyCube();
    if (stepResult === 'moved') {
      this.audio.playSfx('softDrop');
      this.pendingLockAt = 0;
      this.pendingLockAllowsAdjustment = false;
      this.markRepeatActionCooldown(now);
      this.lastDropAt = now;
      if (!this.state.canActivePolyCubeFall() && this.state.getActivePolyCube()) {
        this.scheduleActiveLock(NATURAL_LOCK_DELAY_MS, now, true);
      }
      this.syncScene({ settledBlocks: false });
    } else if (stepResult === 'blocked' && this.state.getActivePolyCube()) {
      if (this.pendingLockAt === 0) {
        this.scheduleActiveLock(NATURAL_LOCK_DELAY_MS, now, true);
      }
    }
  }

  private applyHardDropInput(): void {
    if (!this.canApplyGameplayInput() || this.pendingLockAt !== 0) {
      return;
    }

    this.state.hardDropActivePolyCube();
    if (this.state.getActivePolyCube()) {
      this.audio.playSfx('hardDrop');
      this.scheduleActiveLock(HARD_DROP_LOCK_DELAY_MS, performance.now(), false);
    }
    this.lastDropAt = performance.now();
    this.syncScene();
  }

  private applyHoldInput(): void {
    if (!this.canApplyGameplayInput() || this.pendingLockAt !== 0) {
      return;
    }

    if (this.state.swapHeldPiece()) {
      this.audio.playSfx('hold');
      this.lastDropAt = performance.now();
      this.syncScene({ settledBlocks: false });
    }
  }

  private advanceGame(timestamp: number): void {
    if (this.paused || this.settingsOpen || this.startMenuOpen || this.state.isGameOver()) {
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
      this.scheduleActiveLock(NATURAL_LOCK_DELAY_MS, timestamp, true);
    }

    this.lastDropAt = timestamp;
    this.syncScene({ settledBlocks: false });
  }

  private restart(): void {
    this.state.reset();
    this.state.ensureActivePolyCube();
    this.resetRunClock();
    this.settingsOpen = false;
    this.audio.playSfx('start');
    this.startNextGameplayBgm();
    this.syncScene();
  }

  private applySetup(setup: GameStateOptions): void {
    this.state.configure(setup);
    this.state.ensureActivePolyCube();
    this.resetRunClock();
    this.startMenuOpen = false;
    this.settingsOpen = false;
    this.settingsOpenedAt = 0;
    this.settingsDuration = 0;
    this.pendingLockAt = 0;
    this.pendingLockAllowsAdjustment = false;
    this.repeatActionAllowedAt = 0;
    this.lastDropAt = performance.now();
    this.audio.playSfx('start');
    this.startNextGameplayBgm();

    if (this.container) {
      this.renderer.dispose({ preserveAssets: true });
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
    this.startMenuOpen = false;
    this.settingsOpenedAt = 0;
    this.settingsDuration = 0;
    this.pendingLockAt = 0;
    this.pendingLockAllowsAdjustment = false;
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
      this.settingsOpen,
      this.startMenuOpen,
      this.audio.isMuted()
    );
    this.lastHudElapsedSecond = Math.floor(elapsedMs / 1000);
    this.renderer.renderFrame();
  }

  private syncElapsedHud(): void {
    if (this.state.isGameOver() || this.startMenuOpen) {
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
    if (this.state.isGameOver() || this.settingsOpen || this.startMenuOpen) {
      return;
    }

    if (this.paused) {
      this.paused = false;
      this.pausedDuration += performance.now() - this.pausedAt;
      this.lastDropAt = performance.now();
      this.audio.playSfx('resume');
      this.audio.resumeBgm();
    } else {
      this.paused = true;
      this.pausedAt = performance.now();
      this.audio.playSfx('pause');
      this.audio.pauseBgm();
    }

    this.syncScene({ settledBlocks: false });
  }

  private toggleSettings(): void {
    if (this.startMenuOpen) {
      return;
    }

    if (this.state.isGameOver() && !this.settingsOpen) {
      this.startMenuOpen = true;
      this.previewNextGameplayBgm();
      this.audio.playSfx('uiSelect');
      this.syncScene({ settledBlocks: false });
      return;
    }

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
      this.audio.startBgm();
    }
    this.audio.playSfx('uiSelect');
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
    this.startMenuOpen = false;
    this.settingsOpenedAt = 0;
    this.pendingLockAt = 0;
    this.pendingLockAllowsAdjustment = false;
    this.repeatActionAllowedAt = 0;
    this.audio.stopBgm();
    this.audio.playSfx('gameOver');
    this.syncScene();
  }

  private lockActiveAndSpawnNext(): void {
    this.pendingLockAt = 0;
    this.pendingLockAllowsAdjustment = false;
    this.repeatActionAllowedAt = 0;
    const clearedPlanes = this.state.lockActivePolyCube();
    if (clearedPlanes > 0) {
      this.audio.playSfx('planeClear');
      this.renderer.playPlaneClearEffect(this.state.getLastClearedPlaneBlocks());
    } else {
      this.audio.playSfx('lock');
    }
    if (this.state.getMissionSnapshot().complete) {
      this.state.endGame();
      this.markGameEnded();
      this.audio.stopBgm();
      this.audio.playSfx('missionComplete');
      return;
    }
    if (this.state.getActivePolyCube()) {
      return;
    }
    this.state.spawnPolyCube();
    if (this.state.isGameOver()) {
      this.markGameEnded();
      this.audio.stopBgm();
      this.audio.playSfx('gameOver');
    }
  }

  private previewNextGameplayBgm(): void {
    this.audio.selectBgm(this.getNextGameplayBgmId());
    this.audio.startBgm();
  }

  private startNextGameplayBgm(): void {
    this.previewNextGameplayBgm();
    this.nextGameplayBgmIndex = (this.nextGameplayBgmIndex + 1) % BGM_ASSETS.length;
  }

  private applyUiSelection(): void {
    this.previewNextGameplayBgm();
    this.audio.playSfx('uiSelect');
  }

  private toggleMute(): void {
    this.audio.toggleMute();
    if (this.settingsOpen) {
      this.previewNextGameplayBgm();
    }
    this.syncScene({ settledBlocks: false });
  }

  private getNextGameplayBgmId(): (typeof BGM_ASSETS)[number]['id'] {
    return BGM_ASSETS[this.nextGameplayBgmIndex]?.id ?? DEFAULT_BGM_ID;
  }

  private scheduleActiveLock(
    delayMs: number,
    timestamp = performance.now(),
    allowsAdjustment = false
  ): void {
    this.pendingLockAt = timestamp + delayMs;
    this.pendingLockAllowsAdjustment = allowsAdjustment;
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

  private refreshPendingLockAfterAdjustment(timestamp = performance.now()): void {
    if (this.pendingLockAt === 0 || !this.pendingLockAllowsAdjustment) {
      return;
    }

    if (this.state.canActivePolyCubeFall()) {
      this.pendingLockAt = 0;
      this.pendingLockAllowsAdjustment = false;
      this.lastDropAt = timestamp;
      return;
    }

    this.scheduleActiveLock(NATURAL_LOCK_DELAY_MS, timestamp, true);
  }

  private getElapsedMs(): number {
    if (this.startedAt === 0 || this.startMenuOpen) {
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

type SyncSceneOptions = {
  settledBlocks?: boolean;
};

const HARD_DROP_ANIMATION_MS = 160;
const HARD_DROP_SETTLE_MS = 50;
const HARD_DROP_LOCK_DELAY_MS = HARD_DROP_ANIMATION_MS + HARD_DROP_SETTLE_MS;
const NATURAL_LOCK_DELAY_MS = 450;
const INPUT_REPEAT_INTERVAL_MS = 80;

function isInteractiveInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(target.closest('input, textarea, select, button, [contenteditable="true"]'));
}
