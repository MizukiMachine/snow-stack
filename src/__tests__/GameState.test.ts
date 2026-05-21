import { describe, expect, it } from 'vitest';
import { GameState } from '../GameState';

describe('GameState', () => {
  it('prevents active tetromino movement outside the field bounds', () => {
    const state = new GameState();
    state.spawnTetromino('I');

    expect(state.moveActiveTetromino({ x: -1, y: 0, z: 0 })).toBe(true);
    expect(state.moveActiveTetromino({ x: -1, y: 0, z: 0 })).toBe(true);
    expect(state.moveActiveTetromino({ x: -1, y: 0, z: 0 })).toBe(true);

    const blocksAtLeftWall = state.getActiveTetromino()?.blocks;

    expect(state.moveActiveTetromino({ x: -1, y: 0, z: 0 })).toBe(false);
    expect(state.getActiveTetromino()?.blocks).toEqual(blocksAtLeftWall);
  });

  it('locks the active tetromino into settled blocks', () => {
    const state = new GameState();
    state.spawnTetromino('O');

    const activeBlocks = state.getActiveTetromino()?.blocks ?? [];

    expect(state.lockActiveTetromino()).toBe(0);
    expect(state.getActiveTetromino()).toBeNull();
    expect(sortCoordinates(state.getSettledBlocks().map((block) => block.coordinate))).toEqual(
      sortCoordinates(activeBlocks)
    );
  });

  it('clears a filled layer and awards layer-clear score', () => {
    const state = new GameState({ width: 4, height: 4, depth: 1 });

    state.spawnTetromino('I');
    expect(state.lockActiveTetromino()).toBe(1);

    expect(state.getClearedLayerCount()).toBe(1);
    expect(state.getScore()).toBe(100);
    expect(state.getSettledBlocks()).toHaveLength(0);
  });

  it('adds soft-drop and hard-drop score without accepting negative steps', () => {
    const state = new GameState();

    state.addSoftDropScore();
    state.addHardDropScore(3);
    state.addSoftDropScore(-5);
    state.addHardDropScore(-5);

    expect(state.getScore()).toBe(7);
  });
});

function sortCoordinates(coordinates: { x: number; y: number; z: number }[]) {
  return [...coordinates].sort((a, b) => a.y - b.y || a.x - b.x || a.z - b.z);
}
