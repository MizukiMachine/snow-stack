import { describe, expect, it } from 'vitest';
import { GameState } from '../GameState';

describe('GameState BlockOut rules', () => {
  it('uses BlockOut default pit dimensions, block set, level, and speed', () => {
    const state = new GameState();

    expect(state.getDimensions()).toEqual({ width: 5, height: 5, depth: 12 });
    expect(state.getBlockSet()).toBe('flat');
    expect(state.getLevel()).toBe(0);
    expect(state.getDropIntervalMs()).toBe(5510);
  });

  it('spawns polycubes at the front of the pit and prevents out-of-bounds movement', () => {
    const state = new GameState({ dimensions: { width: 5, height: 5, depth: 6 } });
    state.spawnPolyCube(2);

    expect(state.getActivePolyCube()?.blocks).toEqual([
      { x: 4, y: 0, z: 0 },
      { x: 4, y: 1, z: 0 },
      { x: 4, y: 2, z: 0 }
    ]);
    expect(state.moveActivePolyCube({ x: 1, y: 0, z: 0 })).toBe(false);
    expect(state.moveActivePolyCube({ x: -1, y: 0, z: 0 })).toBe(true);
  });

  it('hard drops along increasing Z depth and scores the locked polycube', () => {
    const state = new GameState({ dimensions: { width: 5, height: 5, depth: 6 } });
    state.spawnPolyCube(0);

    expect(state.hardDropActivePolyCube()).toBe(5);
    expect(state.getActivePolyCube()?.blocks).toEqual([{ x: 4, y: 0, z: 5 }]);

    expect(state.lockActivePolyCube()).toBe(0);
    expect(state.getSettledBlocks()).toEqual([
      {
        id: 0,
        label: 'P00',
        color: expect.any(Number),
        coordinate: { x: 4, y: 0, z: 5 }
      }
    ]);
    expect(state.getScore()).toBeGreaterThan(1);
  });

  it('clears full Z planes and compacts shallower planes deeper into the pit', () => {
    const state = new GameState({ dimensions: { width: 2, height: 2, depth: 3 } });
    seedCells(state, [
      { x: 0, y: 0, z: 2 },
      { x: 1, y: 0, z: 2 },
      { x: 0, y: 1, z: 2 },
      { x: 1, y: 1, z: 2 },
      { x: 0, y: 0, z: 1 }
    ]);

    expect(state.clearCompletedPlanes()).toBe(1);
    expect(state.getClearedPlaneCount()).toBe(1);
    expect(coordinates(state.getSettledBlocks())).toEqual([{ x: 0, y: 0, z: 2 }]);
    expect(state.getCell({ x: 0, y: 0, z: 0 })).toBe('empty');
  });

  it('sets game over when a newly spawned polycube overlaps the front plane', () => {
    const state = new GameState({ dimensions: { width: 5, height: 5, depth: 6 } });
    state.setCell({ x: 4, y: 0, z: 0 }, 0);

    state.spawnPolyCube(0);

    expect(state.getActivePolyCube()).toBeNull();
    expect(state.getPhase()).toBe('game-over');
    expect(state.isGameOver()).toBe(true);
  });
});

function seedCells(state: GameState, cells: { x: number; y: number; z: number }[]): void {
  cells.forEach((cell) => {
    expect(state.setCell(cell, 0)).toBe(true);
  });
}

function coordinates(blocks: ReturnType<GameState['getSettledBlocks']>) {
  return blocks
    .map((block) => block.coordinate)
    .sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
}
