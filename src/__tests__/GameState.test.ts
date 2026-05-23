import { describe, expect, it } from 'vitest';
import { GameState } from '../GameState';
import { POLYCUBE_DEFINITIONS } from '../constants/blockout';

describe('GameState BlockOut rules', () => {
  it('uses BlockOut default pit dimensions, block set, level, and speed', () => {
    const state = new GameState();

    expect(state.getDimensions()).toEqual({ width: 5, height: 5, depth: 12 });
    expect(state.getBlockSet()).toBe('flat');
    expect(state.getLevel()).toBe(0);
    expect(state.getDropIntervalMs()).toBe(5510);
  });

  it('clamps setup options to BlockOut limits', () => {
    const state = new GameState({
      dimensions: { width: 2, height: 9, depth: 99 },
      startLevel: 10
    });

    expect(state.getDimensions()).toEqual({ width: 3, height: 7, depth: 18 });
    expect(state.getLevel()).toBe(9);
  });

  it('applies BlockOut setup changes and resets the current run', () => {
    const state = new GameState({ randomSeed: 1 });
    state.spawnPolyCube(0);
    state.hardDropActivePolyCube();
    state.lockActivePolyCube();

    state.configure({
      dimensions: { width: 3, height: 3, depth: 10 },
      blockSet: 'basic',
      startLevel: 4,
      randomSeed: 99
    });

    expect(state.getSetup()).toEqual({
      dimensions: { width: 3, height: 3, depth: 10 },
      blockSet: 'basic',
      startLevel: 4,
      randomSeed: 99
    });
    expect(state.getLevel()).toBe(4);
    expect(state.getScore()).toBe(0);
    expect(state.getSettledBlocks()).toHaveLength(0);
    expect(state.getActivePolyCube()).toBeNull();
    expect([...state.getUpcomingQueue(7)].sort((a, b) => a - b)).toEqual([
      5, 7, 8, 9, 32, 33, 34
    ]);
  });

  it('preserves the configured seed when setup changes do not specify a new seed', () => {
    const state = new GameState({ randomSeed: 12345 });
    const originalSeed = state.getSetup().randomSeed;

    state.configure({ startLevel: 3 });

    expect(state.getSetup().randomSeed).toBe(originalSeed);
    expect(state.getLevel()).toBe(3);
    const queue = state.getUpcomingQueue(8);
    state.reset();
    expect(state.getUpcomingQueue(8)).toEqual(queue);
  });

  it('deals each eligible polycube once before refilling the random bag', () => {
    const state = new GameState();

    expect([...state.getUpcomingQueue(8)].sort((a, b) => a - b)).toEqual([
      0, 1, 2, 5, 6, 7, 8, 9
    ]);
  });

  it('uses a deterministic seeded LCG for shuffled bags', () => {
    const first = new GameState({ randomSeed: 12345 });
    const second = new GameState({ randomSeed: 12345 });
    const firstQueue = first.getUpcomingQueue(16);
    const secondQueue = second.getUpcomingQueue(16);

    expect(firstQueue).toEqual(secondQueue);
    expect([...firstQueue.slice(0, 8)].sort((a, b) => a - b)).toEqual([
      0, 1, 2, 5, 6, 7, 8, 9
    ]);
    expect([...firstQueue.slice(8, 16)].sort((a, b) => a - b)).toEqual([
      0, 1, 2, 5, 6, 7, 8, 9
    ]);

    first.reset();
    expect(first.getUpcomingQueue(16)).toEqual(firstQueue);
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

  it('prevents direct locking while the active polycube can still fall', () => {
    const state = new GameState({ dimensions: { width: 5, height: 5, depth: 6 } });
    state.spawnPolyCube(0);

    expect(state.lockActivePolyCube()).toBe(0);
    expect(state.getSettledBlocks()).toHaveLength(0);
    expect(state.getActivePolyCube()).toEqual({
      id: 0,
      label: 'P00',
      color: expect.any(Number),
      blocks: [{ x: 4, y: 0, z: 0 }]
    });
  });

  it('matches the BlockOut score table for a top-dropped single cube in Flat Fun', () => {
    const state = new GameState();
    state.spawnPolyCube(0);

    state.hardDropActivePolyCube();
    state.lockActivePolyCube();

    expect(state.getScore()).toBe(9);
  });

  it('uses the BlockOut depth cursor before moving multi-depth polycubes', () => {
    const state = new GameState({ dimensions: { width: 5, height: 5, depth: 6 } });
    state.spawnPolyCube(21);
    const startBlocks = state.getActivePolyCube()?.blocks ?? [];

    expect(state.stepActivePolyCube()).toBe('waiting');
    expect(state.getActivePolyCube()?.blocks).toEqual(startBlocks);

    expect(state.stepActivePolyCube()).toBe('moved');
    expect(state.getActivePolyCube()?.blocks).toEqual(translateBlocks(startBlocks, { x: 0, y: 0, z: 1 }));
  });

  it('keeps hard-drop score independent from invisible rotation correction', () => {
    const baseline = new GameState({ dimensions: { width: 5, height: 5, depth: 6 } });
    baseline.spawnPolyCube(0);
    baseline.hardDropActivePolyCube();
    baseline.lockActivePolyCube();

    const rotated = new GameState({ dimensions: { width: 5, height: 5, depth: 6 } });
    rotated.spawnPolyCube(0);
    rotated.rotateActivePolyCube('x', 1);
    rotated.hardDropActivePolyCube();
    rotated.lockActivePolyCube();

    expect(rotated.getScore()).toBe(baseline.getScore());
  });

  it('clears full Z planes and compacts shallower planes deeper into the pit', () => {
    const state = new GameState({ dimensions: { width: 3, height: 3, depth: 6 } });
    seedCells(state, [
      { x: 0, y: 0, z: 5 },
      { x: 1, y: 0, z: 5 },
      { x: 2, y: 0, z: 5 },
      { x: 0, y: 1, z: 5 },
      { x: 1, y: 1, z: 5 },
      { x: 2, y: 1, z: 5 },
      { x: 0, y: 2, z: 5 },
      { x: 1, y: 2, z: 5 },
      { x: 2, y: 2, z: 5 },
      { x: 0, y: 0, z: 4 }
    ]);

    expect(state.clearCompletedPlanes()).toBe(1);
    expect(state.getClearedPlaneCount()).toBe(1);
    expect(coordinates(state.getSettledBlocks())).toEqual([{ x: 0, y: 0, z: 5 }]);
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

  it('rotates every BlockOut polycube back to its original cells after four turns per axis', () => {
    for (const definition of POLYCUBE_DEFINITIONS) {
      for (const axis of ['x', 'y', 'z'] as const) {
        const state = new GameState({
          dimensions: { width: 7, height: 7, depth: 18 },
          blockSet: 'extended'
        });
        state.spawnPolyCube(definition.id);
        const spawnX = 7 - definition.width;
        const centeredX = Math.floor((7 - definition.width) / 2);
        expect(state.moveActivePolyCube({ x: centeredX - spawnX, y: 2, z: 4 })).toBe(true);
        const original = sortedBlocks(state.getActivePolyCube()?.blocks ?? []);

        for (let i = 0; i < 4; i += 1) {
          expect(state.rotateActivePolyCube(axis, 1)).toBe(true);
        }

        expect(sortedBlocks(state.getActivePolyCube()?.blocks ?? [])).toEqual(original);
      }
    }
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

function translateBlocks(
  blocks: NonNullable<ReturnType<GameState['getActivePolyCube']>>['blocks'],
  delta: { x: number; y: number; z: number }
) {
  return blocks.map((block) => ({
    x: block.x + delta.x,
    y: block.y + delta.y,
    z: block.z + delta.z
  }));
}

function sortedBlocks(blocks: NonNullable<ReturnType<GameState['getActivePolyCube']>>['blocks']) {
  return [...blocks].sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
}
