import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameEngine } from '../GameEngine';
import { GameState, type GameStateOptions, type SettledBlockSnapshot } from '../GameState';
import { POLYCUBE_DEFINITIONS } from '../constants/blockout';
import type { Renderer } from '../Renderer';
import type { GameAudio } from '../audio/AudioManager';

type RendererMock = {
  initialize: ReturnType<typeof vi.fn>;
  updateSettledBlocks: ReturnType<typeof vi.fn>;
  updateActivePolyCube: ReturnType<typeof vi.fn>;
  updateHud: ReturnType<typeof vi.fn>;
  updateElapsedTime: ReturnType<typeof vi.fn>;
  playPlaneClearEffect: ReturnType<typeof vi.fn>;
  renderFrame: ReturnType<typeof vi.fn>;
  handleCameraInspectionKey: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};

type AudioMock = {
  getSelectedBgmId: ReturnType<typeof vi.fn>;
  isMuted: ReturnType<typeof vi.fn>;
  selectBgm: ReturnType<typeof vi.fn>;
  toggleMute: ReturnType<typeof vi.fn>;
  startBgm: ReturnType<typeof vi.fn>;
  stopBgm: ReturnType<typeof vi.fn>;
  pauseBgm: ReturnType<typeof vi.fn>;
  resumeBgm: ReturnType<typeof vi.fn>;
  playSfx: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};

const startedEngines: GameEngine[] = [];

describe('GameEngine BlockOut controls', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    for (const engine of startedEngines.splice(0)) {
      engine.stop();
    }
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('moves the polycube across the camera-facing pit plane with arrow keys', () => {
    const { state } = startEngineWithPiece(0);

    pressKey('ArrowRight');
    expect(state.getActivePolyCube()?.blocks).toEqual([{ x: 4, y: 0, z: 0 }]);

    pressKey('ArrowUp');
    expect(state.getActivePolyCube()?.blocks).toEqual([{ x: 4, y: 1, z: 0 }]);

    pressKey('ArrowDown');
    expect(state.getActivePolyCube()?.blocks).toEqual([{ x: 4, y: 0, z: 0 }]);
  });

  it('ignores removed numeric and diagonal movement keys', () => {
    const { state } = startEngineWithPiece(0);
    const blocksBeforeKeys = state.getActivePolyCube()?.blocks;

    for (const code of ['Digit8', 'Numpad8', 'Digit9', 'Numpad9', 'PageUp']) {
      pressKey(code);
    }

    expect(state.getActivePolyCube()?.blocks).toEqual(blocksBeforeKeys);
  });

  it('soft drops with Shift without locking immediately', () => {
    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValue(1_000);
    const { state } = startEngineWithPiece(0);

    pressKey('ShiftLeft');

    expect(state.getActivePolyCube()?.blocks).toEqual([{ x: 5, y: 0, z: 1 }]);
    expect(state.getSettledBlocks()).toHaveLength(0);
  });

  it('locks shortly after a soft drop reaches the landing plane without extending on repeat', () => {
    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValue(1_000);
    const { engine, state } = startEngineWithPiece(0);

    for (let i = 0; i < 8; i += 1) {
      pressKey('ShiftLeft');
    }

    expect(state.getActivePolyCube()?.blocks).toEqual([{ x: 5, y: 0, z: 8 }]);

    nowSpy.mockReturnValue(1_200);
    pressKey('ShiftLeft', { repeat: true });

    advanceGame(engine, 1_449);
    expect(state.getSettledBlocks()).toHaveLength(0);

    advanceGame(engine, 1_450);
    expect(state.getSettledBlocks()).toHaveLength(1);
  });

  it('holds the active piece with C and blocks repeated holds until lock', () => {
    const { state } = startEngineWithPiece(0);

    pressKey('KeyC');
    const heldPiece = state.getHeldPiece();
    const activeAfterHold = state.getActivePolyCube()?.id;

    expect(heldPiece).toBe(0);
    expect(state.getActivePolyCube()).not.toBeNull();

    pressKey('KeyC');

    expect(state.getHeldPiece()).toBe(heldPiece);
    expect(state.getActivePolyCube()?.id).toBe(activeAfterHold);
  });

  it('ends the run when a sprint mission is complete after a lock', () => {
    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValue(1_000);
    const state = new GameState({ missionMode: 'plane-sprint' });
    state.spawnPolyCube(0);
    vi.spyOn(state, 'getMissionSnapshot').mockReturnValue({
      mode: 'plane-sprint',
      label: 'PLANE SPRINT',
      shortLabel: '5 PLANES',
      progressLabel: 'PLANES',
      targetValue: 5,
      progressValue: 5,
      remainingValue: 0,
      active: true,
      complete: true,
      hint: '0 planes left in the sprint',
      completionMessage: 'Plane sprint complete'
    });
    const { engine, renderer } = startEngine(state);

    pressKey('Space');
    advanceGame(engine, 1_210);

    expect(state.isGameOver()).toBe(true);
    expect(state.getActivePolyCube()).toBeNull();
    expect(lastHudCall(renderer)[1]).toBe('game-over');
  });

  it('ends a sprint run after the target planes are actually cleared', () => {
    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValue(1_000);
    const state = new GameState({
      dimensions: { width: 3, height: 3, depth: 6 },
      missionMode: 'plane-sprint'
    });
    for (let i = 0; i < 4; i += 1) {
      seedPlane(state, 5);
      expect(state.clearCompletedPlanes()).toBe(1);
    }
    seedPlane(state, 5, { x: 2, y: 0 });
    state.spawnPolyCube(0);
    const { engine, renderer } = startEngine(state);

    pressKey('Space');
    advanceGame(engine, 1_210);

    expect(state.getMissionSnapshot().complete).toBe(true);
    expect(state.isGameOver()).toBe(true);
    expect(state.getActivePolyCube()).toBeNull();
    expect(lastHudCall(renderer)[1]).toBe('game-over');
  });

  it('ends a score-rush run after the score target is actually reached', () => {
    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValue(1_000);
    const state = new GameState({
      dimensions: { width: 3, height: 3, depth: 6 },
      blockSet: 'extended',
      startLevel: 9,
      missionMode: 'score-rush'
    });
    seedPlane(state, 5, { x: 2, y: 0 });
    state.spawnPolyCube(0);
    const { engine, renderer } = startEngine(state);

    pressKey('Space');
    advanceGame(engine, 1_210);

    expect(state.getMissionSnapshot()).toMatchObject({
      mode: 'score-rush',
      complete: true
    });
    expect(state.isGameOver()).toBe(true);
    expect(lastHudCall(renderer)[1]).toBe('game-over');
  });

  it('ends a cube-trial run when the cube placement target is reached', () => {
    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValue(1_000);
    const state = new GameState({
      dimensions: { width: 7, height: 7, depth: 18 },
      blockSet: 'extended',
      missionMode: 'cube-trial'
    });
    const trialPieceSpawnX = 7 - POLYCUBE_DEFINITIONS[4].width;
    for (const x of [0, 4]) {
      for (let i = 0; i < 12; i += 1) {
        state.spawnPolyCube(4);
        expect(state.moveActivePolyCube({ x: x - trialPieceSpawnX, y: 0, z: 0 })).toBe(true);
        state.hardDropActivePolyCube();
        if (x === 4 && i === 11) {
          break;
        }
        expect(state.lockActivePolyCube()).toBe(0);
      }
    }
    expect(state.getMissionSnapshot().progressValue).toBe(115);
    const { engine, renderer } = startEngine(state);

    pressKey('Space');
    advanceGame(engine, 1_210);

    expect(state.getMissionSnapshot()).toMatchObject({
      mode: 'cube-trial',
      complete: true
    });
    expect(state.isGameOver()).toBe(true);
    expect(lastHudCall(renderer)[1]).toBe('game-over');
  });

  it('throttles held movement keys without slowing deliberate key presses', () => {
    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValue(1_000);
    const { state } = startEngineWithPiece(0);

    pressKey('ArrowRight');
    expect(state.getActivePolyCube()?.blocks).toEqual([{ x: 4, y: 0, z: 0 }]);

    nowSpy.mockReturnValue(1_020);
    pressKey('ArrowRight', { repeat: true });
    expect(state.getActivePolyCube()?.blocks).toEqual([{ x: 4, y: 0, z: 0 }]);

    nowSpy.mockReturnValue(1_080);
    pressKey('ArrowRight', { repeat: true });
    expect(state.getActivePolyCube()?.blocks).toEqual([{ x: 3, y: 0, z: 0 }]);

    pressKey('ArrowUp');
    expect(state.getActivePolyCube()?.blocks).toEqual([{ x: 3, y: 1, z: 0 }]);
  });

  it.each([
    ['KeyQ', 'x', -1],
    ['KeyA', 'x', 1],
    ['KeyW', 'y', -1],
    ['KeyS', 'y', 1],
    ['KeyE', 'z', -1],
    ['KeyD', 'z', 1]
  ] as const)('maps %s to %s-axis rotation direction %s', (code, axis, direction) => {
    const state = new GameState();
    state.spawnPolyCube(5);
    const rotateSpy = vi.spyOn(state, 'rotateActivePolyCube');
    startEngine(state);

    pressKey(code);

    expect(rotateSpy).toHaveBeenCalledWith(axis, direction);
  });

  it('hard drops with Space, waits briefly, locks the current polycube, and spawns the next one', () => {
    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValue(1_000);
    const { engine, state } = startEngineWithPiece(0);

    pressKey('Space');

    expect(state.getSettledBlocks()).toHaveLength(0);
    expect(state.getActivePolyCube()?.blocks).toEqual([{ x: 5, y: 0, z: 8 }]);

    advanceGame(engine, 1_209);
    expect(state.getSettledBlocks()).toHaveLength(0);

    advanceGame(engine, 1_210);
    expect(state.getSettledBlocks()).toHaveLength(1);
    expect(state.getSettledBlocks()[0].coordinate.z).toBe(8);
    expect(state.getActivePolyCube()).not.toBeNull();
    expect(state.getScore()).toBeGreaterThan(1);
  });

  it('ignores repeated Space keydown events after a hard drop', () => {
    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValue(1_000);
    const { engine, state } = startEngineWithPiece(0);

    pressKey('Space');
    pressKey('Space', { repeat: true });

    expect(state.getSettledBlocks()).toHaveLength(0);
    advanceGame(engine, 1_210);
    expect(state.getSettledBlocks()).toHaveLength(1);
  });

  it('plays a clear effect for the completed plane after a lock', () => {
    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValue(1_000);
    const state = new GameState({
      dimensions: { width: 3, height: 3, depth: 6 },
      missionMode: 'plane-sprint'
    });
    seedPlane(state, 5, { x: 2, y: 0 });
    state.spawnPolyCube(0);
    const { engine, renderer } = startEngine(state);

    pressKey('Space');
    advanceGame(engine, 1_210);

    expect(renderer.playPlaneClearEffect).toHaveBeenCalledTimes(1);
    const [clearedBlocks] = (renderer.playPlaneClearEffect.mock.calls[0] ?? []) as [
      SettledBlockSnapshot[]
    ];
    expect(clearedBlocks).toHaveLength(9);
    expect(clearedBlocks.map((block) => block.coordinate.z)).toEqual(Array(9).fill(5));
  });

  it('routes successful gameplay actions to sound effects', () => {
    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValue(1_000);
    const { engine, audio } = startEngineWithPiece(0);

    pressKey('ArrowRight');
    pressKey('KeyC');
    pressKey('Space');
    advanceGame(engine, 1_210);

    expect(audio.playSfx).toHaveBeenCalledWith('move');
    expect(audio.playSfx).toHaveBeenCalledWith('hold');
    expect(audio.playSfx).toHaveBeenCalledWith('hardDrop');
    expect(audio.playSfx).toHaveBeenCalledWith('lock');
  });

  it('alternates the adopted BGM tracks every time a run starts', () => {
    const renderer = createRendererMock();
    const audio = createAudioMock();
    const state = new GameState();
    const engine = new GameEngine(state, renderer as unknown as Renderer, {
      audio: audio as unknown as GameAudio
    });
    const container = document.createElement('div');
    document.body.appendChild(container);

    engine.start(container);
    startedEngines.push(engine);
    audio.selectBgm.mockClear();
    audio.startBgm.mockClear();
    audio.playSfx.mockClear();

    applySetup(engine, { missionMode: 'plane-sprint' });
    restart(engine);
    applySetup(engine, { missionMode: 'score-rush' });

    expect(audio.selectBgm.mock.calls.map(([id]) => id)).toEqual([
      'crystal-drift',
      'neon-snow-stack',
      'crystal-drift'
    ]);
    expect(audio.startBgm).toHaveBeenCalledTimes(3);
    expect(audio.playSfx.mock.calls.filter(([id]) => id === 'start')).toHaveLength(3);
  });

  it('starts BGM while the opening settings screen is shown', () => {
    const renderer = createRendererMock();
    const audio = createAudioMock();
    const state = new GameState();
    const engine = new GameEngine(state, renderer as unknown as Renderer, {
      audio: audio as unknown as GameAudio
    });
    const container = document.createElement('div');
    document.body.appendChild(container);

    engine.start(container);
    startedEngines.push(engine);

    expect(lastHudCall(renderer)[9]).toBe(true);
    expect(audio.selectBgm).toHaveBeenCalledWith('crystal-drift');
    expect(audio.startBgm).toHaveBeenCalledTimes(1);
  });

  it('plays UI select and retries BGM playback for settings panel choices', () => {
    const renderer = createRendererMock();
    const audio = createAudioMock();
    const state = new GameState();
    const engine = new GameEngine(state, renderer as unknown as Renderer, {
      showStartScreen: false,
      audio: audio as unknown as GameAudio
    });

    applyUiSelection(engine);

    expect(audio.startBgm).toHaveBeenCalledTimes(1);
    expect(audio.playSfx).toHaveBeenCalledWith('uiSelect');
  });

  it('starts BGM when the in-game settings panel opens', () => {
    const { engine, audio } = startEngineWithPiece(0);
    audio.startBgm.mockClear();

    toggleSettings(engine);

    expect(audio.startBgm).toHaveBeenCalledTimes(1);
    expect(audio.playSfx).toHaveBeenCalledWith('uiSelect');
  });

  it('toggles audio mute state and publishes it to the HUD', () => {
    const { engine, audio, renderer } = startEngineWithPiece(0);

    toggleMute(engine);

    expect(audio.toggleMute).toHaveBeenCalledTimes(1);
    expect(lastHudCall(renderer)[10]).toBe(true);
  });

  it('ignores the removed KeyP pause shortcut', () => {
    const { state, renderer } = startEngineWithPiece(0);

    pressKey('KeyP');
    pressKey('ArrowRight');

    expect(state.getActivePolyCube()?.blocks).toEqual([{ x: 4, y: 0, z: 0 }]);
    expect(lastHudCall(renderer)[7]).toBe(false);
  });

  it('ends the current run when Escape is pressed', () => {
    const { state, renderer } = startEngineWithPiece(0);

    pressKey('Escape');

    expect(state.isGameOver()).toBe(true);
    expect(state.getActivePolyCube()).toBeNull();
    expect(lastHudCall(renderer)[1]).toBe('game-over');
    expect(lastHudCall(renderer)[7]).toBe(false);
  });

  it('does not count paused time when Escape ends the current run', () => {
    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValue(1_000);
    const { engine, renderer } = startEngineWithPiece(0);

    nowSpy.mockReturnValue(2_000);
    togglePause(engine);

    nowSpy.mockReturnValue(7_000);
    pressKey('Escape');

    expect(lastHudCall(renderer)[6]).toBe(1_000);
    expect(lastHudCall(renderer)[7]).toBe(false);
  });

  it('routes arrow keys to camera inspection while paused without moving the active piece', () => {
    const { engine, state, renderer } = startEngineWithPiece(0);
    const blocksBeforeCameraKey = state.getActivePolyCube()?.blocks;
    renderer.handleCameraInspectionKey.mockReturnValue(true);

    togglePause(engine);
    renderer.handleCameraInspectionKey.mockClear();
    pressKey('ArrowLeft');

    expect(renderer.handleCameraInspectionKey).toHaveBeenCalledWith('ArrowLeft');
    expect(state.getActivePolyCube()?.blocks).toEqual(blocksBeforeCameraKey);
  });

  it('routes arrow keys to camera inspection after game over', () => {
    const { renderer } = startEngineWithPiece(0);
    renderer.handleCameraInspectionKey.mockReturnValue(true);

    pressKey('Escape');
    renderer.handleCameraInspectionKey.mockClear();
    pressKey('ArrowUp');

    expect(renderer.handleCameraInspectionKey).toHaveBeenCalledWith('ArrowUp');
  });

  it('ignores the removed KeyR restart shortcut', () => {
    const { state } = startEngineWithPiece(0);
    pressKey('ArrowRight');
    const blocksBeforeRestartShortcut = state.getActivePolyCube()?.blocks;

    pressKey('KeyR');

    expect(state.getScore()).toBe(0);
    expect(state.getSettledBlocks()).toHaveLength(0);
    expect(state.getActivePolyCube()?.blocks).toEqual(blocksBeforeRestartShortcut);
  });

  it('opens the rule selection screen by default and holds the run', () => {
    const renderer = createRendererMock();
    const audio = createAudioMock();
    const state = new GameState();
    const engine = new GameEngine(state, renderer as unknown as Renderer, {
      audio: audio as unknown as GameAudio
    });
    const container = document.createElement('div');
    document.body.appendChild(container);

    engine.start(container);
    startedEngines.push(engine);
    pressKey('Space');
    advanceGame(engine, 10_000);

    expect(state.getActivePolyCube()).toBeNull();
    expect(lastHudCall(renderer)[9]).toBe(true);
  });

  it('holds the run and ignores gameplay keys while settings are open', () => {
    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValue(1_000);
    const { engine, state, renderer } = startEngineWithPiece(0);
    const blocksBeforeSettings = state.getActivePolyCube()?.blocks;

    toggleSettings(engine);
    pressKey('ArrowRight');
    pressKey('Space');
    advanceGame(engine, 1_000 + state.getDropIntervalMs() + 1);

    expect(state.getActivePolyCube()?.blocks).toEqual(blocksBeforeSettings);
    expect(state.getSettledBlocks()).toHaveLength(0);
    expect(lastHudCall(renderer)[8]).toBe(true);

    nowSpy.mockReturnValue(3_500);
    toggleSettings(engine);
    expect(lastHudCall(renderer)[6]).toBe(0);
    expect(lastHudCall(renderer)[8]).toBe(false);
  });

  it('ignores game shortcuts from focused form controls', () => {
    const { state } = startEngineWithPiece(0);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    const blocksBeforeInput = state.getActivePolyCube()?.blocks;

    pressKeyOn(input, 'ArrowRight');
    pressKeyOn(input, 'Space');

    expect(state.getActivePolyCube()?.blocks).toEqual(blocksBeforeInput);
    expect(state.getSettledBlocks()).toHaveLength(0);
  });

  it('disposes the renderer, detaches input handlers, and ignores keys after stop', () => {
    const { engine, state, renderer } = startEngineWithPiece(0);
    const blocksBeforeStop = state.getActivePolyCube()?.blocks;

    engine.stop();
    renderer.updateActivePolyCube.mockClear();
    pressKey('ArrowRight');

    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(state.getActivePolyCube()?.blocks).toEqual(blocksBeforeStop);
    expect(renderer.updateActivePolyCube).not.toHaveBeenCalled();
  });

  it('preserves loaded renderer assets when applying setup', () => {
    const { engine, state, renderer } = startEngineWithPiece(0);

    applySetup(engine, { missionMode: 'plane-sprint' });

    expect(state.getMissionSnapshot().mode).toBe('plane-sprint');
    expect(renderer.dispose).toHaveBeenCalledWith({ preserveAssets: true });
    expect(renderer.initialize).toHaveBeenCalledTimes(2);
  });
});

function startEngineWithPiece(id: number): {
  engine: GameEngine;
  state: GameState;
  renderer: RendererMock;
  audio: AudioMock;
} {
  const state = new GameState();
  state.spawnPolyCube(id);
  return startEngine(state);
}

function startEngine(state: GameState): {
  engine: GameEngine;
  state: GameState;
  renderer: RendererMock;
  audio: AudioMock;
} {
  const renderer = createRendererMock();
  const audio = createAudioMock();
  const engine = new GameEngine(state, renderer as unknown as Renderer, {
    showStartScreen: false,
    audio: audio as unknown as GameAudio
  });
  const container = document.createElement('div');
  document.body.appendChild(container);

  engine.start(container);
  startedEngines.push(engine);
  return { engine, state, renderer, audio };
}

function createRendererMock(): RendererMock {
  return {
    initialize: vi.fn(),
    updateSettledBlocks: vi.fn(),
    updateActivePolyCube: vi.fn(),
    updateHud: vi.fn(),
    updateElapsedTime: vi.fn(),
    playPlaneClearEffect: vi.fn(),
    renderFrame: vi.fn(),
    handleCameraInspectionKey: vi.fn(() => false),
    dispose: vi.fn()
  };
}

function createAudioMock(): AudioMock {
  let muted = false;
  return {
    getSelectedBgmId: vi.fn(() => 'crystal-drift'),
    isMuted: vi.fn(() => muted),
    selectBgm: vi.fn(),
    toggleMute: vi.fn(() => {
      muted = !muted;
      return muted;
    }),
    startBgm: vi.fn(),
    stopBgm: vi.fn(),
    pauseBgm: vi.fn(),
    resumeBgm: vi.fn(),
    playSfx: vi.fn(),
    dispose: vi.fn()
  };
}

function pressKey(code: string, options: { repeat?: boolean } = {}): void {
  window.dispatchEvent(
    new KeyboardEvent('keydown', {
      code,
      repeat: options.repeat ?? false,
      bubbles: true,
      cancelable: true
    })
  );
}

function pressKeyOn(target: HTMLElement, code: string, options: { repeat?: boolean } = {}): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      code,
      repeat: options.repeat ?? false,
      bubbles: true,
      cancelable: true
    })
  );
}

function advanceGame(engine: GameEngine, timestamp: number): void {
  (engine as unknown as { advanceGame: (timestamp: number) => void }).advanceGame(timestamp);
}

function toggleSettings(engine: GameEngine): void {
  (engine as unknown as { toggleSettings: () => void }).toggleSettings();
}

function togglePause(engine: GameEngine): void {
  (engine as unknown as { togglePause: () => void }).togglePause();
}

function toggleMute(engine: GameEngine): void {
  (engine as unknown as { toggleMute: () => void }).toggleMute();
}

function applySetup(engine: GameEngine, setup: GameStateOptions): void {
  (engine as unknown as { applySetup: (setup: GameStateOptions) => void }).applySetup(setup);
}

function restart(engine: GameEngine): void {
  (engine as unknown as { restart: () => void }).restart();
}

function applyUiSelection(engine: GameEngine): void {
  (engine as unknown as { applyUiSelection: () => void }).applyUiSelection();
}

function seedPlane(
  state: GameState,
  z: number,
  except?: { x: number; y: number }
): void {
  const { width, height } = state.getDimensions();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (except && x === except.x && y === except.y) {
        continue;
      }
      expect(state.setCell({ x, y, z }, 0)).toBe(true);
    }
  }
}

function lastHudCall(renderer: RendererMock): unknown[] {
  const calls = renderer.updateHud.mock.calls;
  return calls[calls.length - 1] ?? [];
}
