import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameEngine } from '../GameEngine';
import { GameState } from '../GameState';
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

  it('hard drops with Space, locks the current polycube, and spawns the next one', () => {
    const { state } = startEngineWithPiece(0);

    pressKey('Space');

    expect(state.getSettledBlocks()).toHaveLength(1);
    expect(state.getSettledBlocks()[0].coordinate.z).toBe(9);
    expect(state.getActivePolyCube()).not.toBeNull();
    expect(state.getScore()).toBeGreaterThan(1);
  });

  it('ignores repeated Space keydown events after a hard drop', () => {
    const { state } = startEngineWithPiece(0);

    pressKey('Space');
    pressKey('Space', { repeat: true });

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
  const engine = new GameEngine(state, renderer as unknown as Renderer);
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

function lastHudCall(renderer: RendererMock): unknown[] {
  const calls = renderer.updateHud.mock.calls;
  return calls[calls.length - 1] ?? [];
}
