import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameEngine } from '../GameEngine';
import { GameState } from '../GameState';
import type { Renderer } from '../Renderer';
import type { TetrominoType } from '../constants/tetromino';

type RendererMock = {
  initialize: ReturnType<typeof vi.fn>;
  updateSettledBlocks: ReturnType<typeof vi.fn>;
  updateActiveTetromino: ReturnType<typeof vi.fn>;
  updateHud: ReturnType<typeof vi.fn>;
  updateElapsedTime: ReturnType<typeof vi.fn>;
  renderFrame: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};

const startedEngines: GameEngine[] = [];

describe('GameEngine', () => {
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

  it('does not map Shift by itself to movement', () => {
    const { state } = startEngineWithPiece('I');
    const beforeBlocks = state.getActiveTetromino()?.blocks ?? [];

    pressKey('ShiftLeft');

    expect(state.getActiveTetromino()?.blocks).toEqual(beforeBlocks);
    expect(state.getScore()).toBe(0);
  });

  it('maps KeyD to a downward Y-axis soft drop and awards score', () => {
    const { state, renderer } = startEngineWithPiece('I');
    const beforeBlocks = state.getActiveTetromino()?.blocks ?? [];

    pressKey('KeyD');

    const afterBlocks = state.getActiveTetromino()?.blocks ?? [];
    expect(afterBlocks).toEqual(translateBlocks(beforeBlocks, { x: 0, y: -1, z: 0 }));
    expect(state.getScore()).toBe(1);
    expect(lastHudCall(renderer)[3]).toBe(1);
  });

  it('maps ArrowUp and ArrowDown to Z-axis movement', () => {
    const state = new GameState();
    state.spawnTetromino('I');
    expect(state.moveActiveTetromino({ x: 0, y: 0, z: -1 })).toBe(true);
    startEngine(state);
    const startBlocks = state.getActiveTetromino()?.blocks ?? [];

    pressKey('ArrowUp');
    const movedUpBlocks = state.getActiveTetromino()?.blocks ?? [];
    expect(movedUpBlocks).toEqual(translateBlocks(startBlocks, { x: 0, y: 0, z: 1 }));

    pressKey('ArrowDown');
    expect(state.getActiveTetromino()?.blocks).toEqual(startBlocks);
  });

  it('maps ArrowLeft and ArrowRight to the front-view horizontal direction', () => {
    const { state } = startEngineWithPiece('I');
    const startBlocks = state.getActiveTetromino()?.blocks ?? [];

    pressKey('ArrowLeft');
    const movedLeftBlocks = state.getActiveTetromino()?.blocks ?? [];
    expect(movedLeftBlocks).toEqual(translateBlocks(startBlocks, { x: 1, y: 0, z: 0 }));

    pressKey('ArrowRight');
    expect(state.getActiveTetromino()?.blocks).toEqual(startBlocks);
  });

  it('does not map KeyW to upward Y-axis movement', () => {
    const state = new GameState();
    state.spawnTetromino('I');
    expect(state.moveActiveTetromino({ x: 0, y: -1, z: 0 })).toBe(true);

    startEngine(state);
    const beforeBlocks = state.getActiveTetromino()?.blocks ?? [];

    pressKey('KeyW');

    expect(state.getActiveTetromino()?.blocks).toEqual(beforeBlocks);
  });

  it.each([
    ['KeyQ', false, 'y', -1],
    ['KeyQ', true, 'y', 1],
    ['KeyA', false, 'z', -1],
    ['KeyA', true, 'z', 1],
    ['KeyZ', false, 'x', -1],
    ['KeyZ', true, 'x', 1]
  ] as const)(
    'maps %s with shift=%s to %s-axis rotation direction %s',
    (code, shiftKey, axis, direction) => {
      const state = new GameState();
      state.spawnTetromino('L');
      const rotateSpy = vi.spyOn(state, 'rotateActiveTetromino');
      startEngine(state);

      pressKey(code, { shiftKey });

      expect(rotateSpy).toHaveBeenCalledWith(axis, direction);
    }
  );

  it('hard drops with KeyE, locks the current tetromino, and spawns the next one', () => {
    const { state } = startEngineWithPiece('I');

    pressKey('KeyE');

    expect(state.getSettledBlocks()).toHaveLength(4);
    expect(state.getActiveTetromino()).not.toBeNull();
    expect(state.getScore()).toBe(28);
  });

  it('ignores repeated KeyE keydown events after a hard drop', () => {
    const { state } = startEngineWithPiece('I');

    pressKey('KeyE');
    pressKey('KeyE', { repeat: true });

    expect(state.getSettledBlocks()).toHaveLength(4);
  });

  it('reflects KeyC hold state in GameState and HUD sync', () => {
    const { state, renderer } = startEngineWithPiece('I');

    pressKey('KeyC');

    expect(state.getHeldPiece()).toBe('I');
    expect(state.getActiveTetromino()).not.toBeNull();
    expect(lastHudCall(renderer)[9]).toBe('I');
  });

  it.each(['KeyP', 'Escape'])('syncs paused HUD state when %s toggles pause', (code) => {
    const { renderer } = startEngineWithPiece('I');

    pressKey(code);

    expect(lastHudCall(renderer)[7]).toBe(true);
  });

  it('disposes the renderer, detaches input handlers, and ignores keys after stop', () => {
    const { engine, state, renderer } = startEngineWithPiece('I');
    const blocksBeforeStop = state.getActiveTetromino()?.blocks;

    engine.stop();
    renderer.updateActiveTetromino.mockClear();
    pressKey('ArrowDown');

    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(state.getActiveTetromino()?.blocks).toEqual(blocksBeforeStop);
    expect(state.getScore()).toBe(0);
    expect(renderer.updateActiveTetromino).not.toHaveBeenCalled();
  });
});

function startEngineWithPiece(type: TetrominoType): {
  engine: GameEngine;
  state: GameState;
  renderer: RendererMock;
} {
  const state = new GameState();
  state.spawnTetromino(type);
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
    updateActiveTetromino: vi.fn(),
    updateHud: vi.fn(),
    updateElapsedTime: vi.fn(),
    renderFrame: vi.fn(),
    dispose: vi.fn()
  };
}

function pressKey(code: string, options: { repeat?: boolean; shiftKey?: boolean } = {}): void {
  window.dispatchEvent(
    new KeyboardEvent('keydown', {
      code,
      repeat: options.repeat ?? false,
      shiftKey: options.shiftKey ?? false,
      bubbles: true,
      cancelable: true
    })
  );
}

function translateBlocks(
  blocks: NonNullable<ReturnType<GameState['getActiveTetromino']>>['blocks'],
  delta: { x: number; y: number; z: number }
) {
  return blocks.map((block) => ({
    x: block.x + delta.x,
    y: block.y + delta.y,
    z: block.z + delta.z
  }));
}

function lastHudCall(renderer: RendererMock): unknown[] {
  const calls = renderer.updateHud.mock.calls;
  return calls[calls.length - 1] ?? [];
}
