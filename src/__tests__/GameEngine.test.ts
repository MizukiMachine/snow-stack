import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameEngine } from '../GameEngine';
import { GameState, type GameStateOptions } from '../GameState';
import type { Renderer } from '../Renderer';

type RendererMock = {
  initialize: ReturnType<typeof vi.fn>;
  updateSettledBlocks: ReturnType<typeof vi.fn>;
  updateActivePolyCube: ReturnType<typeof vi.fn>;
  updateHud: ReturnType<typeof vi.fn>;
  updateElapsedTime: ReturnType<typeof vi.fn>;
  renderFrame: ReturnType<typeof vi.fn>;
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
    expect(state.getActivePolyCube()?.blocks).toEqual([{ x: 3, y: 0, z: 0 }]);

    pressKey('ArrowUp');
    expect(state.getActivePolyCube()?.blocks).toEqual([{ x: 3, y: 1, z: 0 }]);

    pressKey('ArrowDown');
    expect(state.getActivePolyCube()?.blocks).toEqual([{ x: 3, y: 0, z: 0 }]);
  });

  it('supports BlockOut diagonal movement with numeric keys', () => {
    const { state } = startEngineWithPiece(0);

    pressKey('Digit9');

    expect(state.getActivePolyCube()?.blocks).toEqual([{ x: 3, y: 1, z: 0 }]);
  });

  it('soft drops with Shift without locking immediately', () => {
    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValue(1_000);
    const { state } = startEngineWithPiece(0);

    pressKey('ShiftLeft');

    expect(state.getActivePolyCube()?.blocks).toEqual([{ x: 4, y: 0, z: 1 }]);
    expect(state.getSettledBlocks()).toHaveLength(0);
  });

  it('locks shortly after a soft drop reaches the landing plane without extending on repeat', () => {
    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValue(1_000);
    const { engine, state } = startEngineWithPiece(0);

    for (let i = 0; i < 8; i += 1) {
      pressKey('ShiftLeft');
    }

    expect(state.getActivePolyCube()?.blocks).toEqual([{ x: 4, y: 0, z: 8 }]);

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
      hint: '0 planes left in the sprint.',
      completionMessage: 'Plane sprint complete.'
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
    for (const x of [0, 1]) {
      for (let i = 0; i < 12; i += 1) {
        state.spawnPolyCube(4);
        expect(state.moveActivePolyCube({ x: x - 6, y: 0, z: 0 })).toBe(true);
        state.hardDropActivePolyCube();
        if (x === 1 && i === 11) {
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
    expect(state.getActivePolyCube()?.blocks).toEqual([{ x: 3, y: 0, z: 0 }]);

    nowSpy.mockReturnValue(1_020);
    pressKey('ArrowRight', { repeat: true });
    expect(state.getActivePolyCube()?.blocks).toEqual([{ x: 3, y: 0, z: 0 }]);

    nowSpy.mockReturnValue(1_080);
    pressKey('ArrowRight', { repeat: true });
    expect(state.getActivePolyCube()?.blocks).toEqual([{ x: 2, y: 0, z: 0 }]);

    pressKey('ArrowUp');
    expect(state.getActivePolyCube()?.blocks).toEqual([{ x: 2, y: 1, z: 0 }]);
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
    expect(state.getActivePolyCube()?.blocks).toEqual([{ x: 4, y: 0, z: 8 }]);

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

  it('syncs paused HUD state when KeyP toggles pause', () => {
    const { renderer } = startEngineWithPiece(0);

    pressKey('KeyP');

    expect(lastHudCall(renderer)[7]).toBe(true);
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
    const { renderer } = startEngineWithPiece(0);

    nowSpy.mockReturnValue(2_000);
    pressKey('KeyP');

    nowSpy.mockReturnValue(7_000);
    pressKey('Escape');

    expect(lastHudCall(renderer)[6]).toBe(1_000);
    expect(lastHudCall(renderer)[7]).toBe(false);
  });

  it('restarts with KeyR and resets BlockOut score state', () => {
    const { state } = startEngineWithPiece(0);
    pressKey('Space');

    pressKey('KeyR');

    expect(state.getScore()).toBe(0);
    expect(state.getSettledBlocks()).toHaveLength(0);
    expect(state.getActivePolyCube()).not.toBeNull();
  });

  it('opens the rule selection screen by default and holds the run', () => {
    const renderer = createRendererMock();
    const state = new GameState();
    const engine = new GameEngine(state, renderer as unknown as Renderer);
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
} {
  const state = new GameState();
  state.spawnPolyCube(id);
  return startEngine(state);
}

function startEngine(state: GameState): {
  engine: GameEngine;
  state: GameState;
  renderer: RendererMock;
} {
  const renderer = createRendererMock();
  const engine = new GameEngine(state, renderer as unknown as Renderer, {
    showStartScreen: false
  });
  const container = document.createElement('div');
  document.body.appendChild(container);

  engine.start(container);
  startedEngines.push(engine);
  return { engine, state, renderer };
}

function createRendererMock(): RendererMock {
  return {
    initialize: vi.fn(),
    updateSettledBlocks: vi.fn(),
    updateActivePolyCube: vi.fn(),
    updateHud: vi.fn(),
    updateElapsedTime: vi.fn(),
    renderFrame: vi.fn(),
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

function applySetup(engine: GameEngine, setup: GameStateOptions): void {
  (engine as unknown as { applySetup: (setup: GameStateOptions) => void }).applySetup(setup);
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
