import { describe, expect, it } from 'vitest';
import { GameState } from '../GameState';
import { POLYCUBE_DEFINITIONS } from '../constants/blockout';

describe('GameState BlockOut rules', () => {
  it('uses fixed default pit dimensions, block set, level, and speed', () => {
    const state = new GameState();

    expect(state.getDimensions()).toEqual({ width: 6, height: 6, depth: 9 });
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
      blockSet: 'extended',
      startLevel: 4,
      randomSeed: 99
    });

    expect(state.getSetup()).toEqual({
      dimensions: { width: 3, height: 3, depth: 10 },
      blockSet: 'extended',
      startLevel: 4,
      randomSeed: 99,
      missionMode: 'double-cut'
    });
    expect(state.getLevel()).toBe(4);
    expect(state.getScore()).toBe(0);
    expect(state.getSettledBlocks()).toHaveLength(0);
    expect(state.getActivePolyCube()).toBeNull();
    expect([...state.getUpcomingQueue(40)].sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 5, 6, 7, 11, 12, 13, 14, 15, 16, 17, 18, 20,
      21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34,
      35, 36, 37, 38, 39, 40, 41, 42, 43, 44
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

  it('generates a fresh bag seed when unseeded setup changes start a new run', () => {
    const state = new GameState();
    const originalSeed = state.getSetup().randomSeed;

    state.configure({ startLevel: 3 });

    expect(state.getSetup().randomSeed).not.toBe(originalSeed);
    expect(state.getLevel()).toBe(3);
  });

  it('deals each eligible polycube once before refilling the random bag', () => {
    const state = new GameState();

    expect([...state.getUpcomingQueue(8)].sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 8, 9, 10
    ]);
  });

  it('uses a deterministic seeded LCG for shuffled bags', () => {
    const first = new GameState({ randomSeed: 12345 });
    const second = new GameState({ randomSeed: 12345 });
    const firstQueue = first.getUpcomingQueue(16);
    const secondQueue = second.getUpcomingQueue(16);

    expect(firstQueue).toEqual(secondQueue);
    expect([...firstQueue.slice(0, 8)].sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 8, 9, 10
    ]);
    expect([...firstQueue.slice(8, 16)].sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 8, 9, 10
    ]);

    first.reset();
    expect(first.getUpcomingQueue(16)).toEqual(firstQueue);
  });

  it('spawns polycubes at the front of the pit and prevents out-of-bounds movement', () => {
    const state = new GameState({ dimensions: { width: 5, height: 5, depth: 6 } });
    state.spawnPolyCube(2);

    expect(state.getActivePolyCube()?.blocks).toEqual([
      { x: 3, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
      { x: 3, y: 1, z: 0 }
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

  it('projects the active polycube landing position and footprint without moving it', () => {
    const state = new GameState({ dimensions: { width: 5, height: 5, depth: 6 } });
    state.spawnPolyCube(5);

    expect(state.getProjectedActivePolyCube()?.blocks).toEqual([
      { x: 3, y: 0, z: 4 },
      { x: 4, y: 0, z: 4 },
      { x: 4, y: 0, z: 5 }
    ]);
    expect(state.getActiveFootprintCells()).toEqual([
      { x: 3, y: 0, contactZ: 5 },
      { x: 4, y: 0, contactZ: 6 }
    ]);
    expect(state.getActivePolyCube()?.blocks).toEqual([
      { x: 3, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
      { x: 4, y: 0, z: 1 }
    ]);
  });

  it('projects the active footprint onto the first blocking depth surface', () => {
    const state = new GameState({ dimensions: { width: 5, height: 5, depth: 6 } });
    state.setCell({ x: 4, y: 0, z: 5 }, 0);
    state.spawnPolyCube(0);

    expect(state.getProjectedActivePolyCube()?.blocks).toEqual([{ x: 4, y: 0, z: 4 }]);
    expect(state.getActiveFootprintCells()).toEqual([{ x: 4, y: 0, contactZ: 5 }]);
  });

  it('soft drops one depth cell at a time and reports blocked at the landing plane', () => {
    const state = new GameState({ dimensions: { width: 5, height: 5, depth: 6 } });
    state.spawnPolyCube(0);

    expect(state.softDropActivePolyCube()).toBe('moved');
    expect(state.getActivePolyCube()?.blocks).toEqual([{ x: 4, y: 0, z: 1 }]);

    for (let i = 0; i < 4; i += 1) {
      expect(state.softDropActivePolyCube()).toBe('moved');
    }
    expect(state.softDropActivePolyCube()).toBe('blocked');
    expect(state.getActivePolyCube()?.blocks).toEqual([{ x: 4, y: 0, z: 5 }]);
  });

  it('holds and swaps pieces once per locked polycube', () => {
    const state = new GameState({ randomSeed: 1 });
    state.spawnPolyCube(0);

    expect(state.swapHeldPiece()).toBe(true);
    expect(state.getHeldPiece()).toBe(0);
    const spawnedAfterHold = state.getActivePolyCube()?.id;
    expect(spawnedAfterHold).not.toBe(0);

    expect(state.swapHeldPiece()).toBe(false);
    state.hardDropActivePolyCube();
    state.lockActivePolyCube();
    state.spawnPolyCube(1);

    expect(state.swapHeldPiece()).toBe(true);
    expect(state.getActivePolyCube()?.id).toBe(0);
    expect(state.getHeldPiece()).toBe(1);
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

  it('scores a top-dropped single cube using the fixed default pit depth', () => {
    const state = new GameState();
    state.spawnPolyCube(0);

    state.hardDropActivePolyCube();
    state.lockActivePolyCube();

    expect(state.getScore()).toBe(11);
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
    expect(coordinates(state.getLastClearedPlaneBlocks())).toEqual([
      { x: 0, y: 0, z: 5 },
      { x: 1, y: 0, z: 5 },
      { x: 2, y: 0, z: 5 },
      { x: 0, y: 1, z: 5 },
      { x: 1, y: 1, z: 5 },
      { x: 2, y: 1, z: 5 },
      { x: 0, y: 2, z: 5 },
      { x: 1, y: 2, z: 5 },
      { x: 2, y: 2, z: 5 }
    ]);
    expect(coordinates(state.getSettledBlocks())).toEqual([{ x: 0, y: 0, z: 5 }]);
    expect(state.getCell({ x: 0, y: 0, z: 0 })).toBe('empty');
  });

  it('tracks plane sprint mission progress from cleared planes', () => {
    const state = new GameState({
      dimensions: { width: 3, height: 3, depth: 6 },
      missionMode: 'plane-sprint'
    });
    seedCells(state, [
      { x: 0, y: 0, z: 5 },
      { x: 1, y: 0, z: 5 },
      { x: 2, y: 0, z: 5 },
      { x: 0, y: 1, z: 5 },
      { x: 1, y: 1, z: 5 },
      { x: 2, y: 1, z: 5 },
      { x: 0, y: 2, z: 5 },
      { x: 1, y: 2, z: 5 },
      { x: 2, y: 2, z: 5 }
    ]);

    expect(state.clearCompletedPlanes()).toBe(1);
    expect(state.getMissionSnapshot()).toMatchObject({
      mode: 'plane-sprint',
      label: '5面消去タイム',
      targetValue: 5,
      progressValue: 1,
      remainingValue: 4,
      active: true,
      complete: false
    });
  });

  it('tracks redesigned mission progress for clean pit and double-cut goals', () => {
    const cleanPit = new GameState({
      dimensions: { width: 3, height: 3, depth: 6 },
      missionMode: 'clean-pit'
    });
    seedCells(cleanPit, [
      { x: 0, y: 0, z: 5 },
      { x: 1, y: 0, z: 5 },
      { x: 0, y: 1, z: 5 },
      { x: 1, y: 1, z: 5 },
      { x: 2, y: 1, z: 5 },
      { x: 0, y: 2, z: 5 },
      { x: 1, y: 2, z: 5 },
      { x: 2, y: 2, z: 5 }
    ]);
    cleanPit.spawnPolyCube(0);
    cleanPit.hardDropActivePolyCube();
    cleanPit.lockActivePolyCube();

    expect(cleanPit.getMissionSnapshot()).toMatchObject({
      mode: 'clean-pit',
      progressValue: 1,
      targetValue: 1,
      complete: true
    });

    const doubleCut = new GameState({
      dimensions: { width: 3, height: 3, depth: 6 },
      missionMode: 'double-cut'
    });
    seedPlane(doubleCut, 5);
    seedPlane(doubleCut, 4);

    expect(doubleCut.clearCompletedPlanes()).toBe(2);
    expect(doubleCut.getMissionSnapshot()).toMatchObject({
      mode: 'double-cut',
      progressValue: 1,
      targetValue: 1,
      complete: true
    });
  });

  it('allows double-cut on the easy difficulty', () => {
    const state = new GameState({ missionMode: 'double-cut' });

    expect(state.getSetup()).toMatchObject({
      blockSet: 'flat',
      missionMode: 'double-cut'
    });

    state.configure({ blockSet: 'flat' });

    expect(state.getSetup()).toMatchObject({
      blockSet: 'flat',
      missionMode: 'double-cut'
    });
  });

  it('tracks score-rush and cube-trial progress from actual run counters', () => {
    const scoreRush = new GameState({
      dimensions: { width: 3, height: 3, depth: 6 },
      blockSet: 'extended',
      startLevel: 9,
      missionMode: 'score-rush'
    });
    seedPlane(scoreRush, 5, { x: 2, y: 0 });
    scoreRush.spawnPolyCube(0);
    scoreRush.hardDropActivePolyCube();
    scoreRush.lockActivePolyCube();

    expect(scoreRush.getMissionSnapshot()).toMatchObject({
      mode: 'score-rush',
      progressValue: 2_000,
      targetValue: 2_000,
      complete: true
    });

    const cubeTrial = new GameState({
      dimensions: { width: 7, height: 7, depth: 18 },
      blockSet: 'extended',
      missionMode: 'cube-trial'
    });
    const trialPieceId = 14;
    const trialPieceSpawnX = 7 - POLYCUBE_DEFINITIONS[trialPieceId].width;
    for (const x of [0, 3]) {
      for (let i = 0; i < 15; i += 1) {
        cubeTrial.spawnPolyCube(trialPieceId);
        expect(cubeTrial.moveActivePolyCube({ x: x - trialPieceSpawnX, y: 0, z: 0 })).toBe(true);
        cubeTrial.hardDropActivePolyCube();
        expect(cubeTrial.lockActivePolyCube()).toBe(0);
      }
    }

    expect(cubeTrial.getMissionSnapshot()).toMatchObject({
      mode: 'cube-trial',
      progressValue: 120,
      targetValue: 120,
      complete: true
    });
  });

  it('sets game over when a newly spawned polycube overlaps the front plane', () => {
    const state = new GameState({ dimensions: { width: 5, height: 5, depth: 6 } });
    state.setCell({ x: 4, y: 0, z: 0 }, 0);

    state.spawnPolyCube(0);

    expect(state.getActivePolyCube()).toBeNull();
    expect(state.getPhase()).toBe('game-over');
    expect(state.isGameOver()).toBe(true);
  });

  it('rotates every custom polycube back to its original cells after four turns per axis', () => {
    for (const definition of POLYCUBE_DEFINITIONS) {
      for (const axis of ['x', 'y', 'z'] as const) {
        const state = new GameState({
          dimensions: { width: 7, height: 7, depth: 18 },
          blockSet: 'extended'
        });
        state.spawnPolyCube(definition.id);
        const spawnX = 7 - definition.width;
        const centeredX = Math.floor((7 - definition.width) / 2);
        expect(state.moveActivePolyCube({ x: centeredX - spawnX, y: 3, z: 6 })).toBe(true);
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

function seedPlane(state: GameState, z: number, except?: { x: number; y: number }): void {
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
