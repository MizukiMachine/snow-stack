import type { FieldCoordinate, FieldDimensions } from './constants/field';
import { FIELD_DIMENSIONS } from './constants/field';
import type { Axis } from './types/coordinates';
import {
  BLOCK_SETS,
  DEFAULT_BLOCK_SET,
  DEFAULT_START_LEVEL,
  DEPTH_FACTOR,
  getBlockSetLabel,
  getEligiblePolyCubes,
  getPolyCubeDefinition,
  LINE_BASE,
  LINE_LEVEL_FACTOR,
  LINE_NUMBER_FACTOR,
  MAX_LEVEL,
  MAX_PIT_DEPTH,
  MAX_PIT_HEIGHT,
  MAX_PIT_WIDTH,
  MIN_PIT_DEPTH,
  MIN_PIT_HEIGHT,
  MIN_PIT_WIDTH,
  P_LEVEL_FACTOR,
  type BlockSet,
  type PolyCubeDefinition
} from './constants/blockout';

export type CellState = 'empty' | number;
export type GamePhase = 'running' | 'game-over';
export type RotationDirection = 1 | -1;
export type ActivePolyCubeStepResult = 'moved' | 'waiting' | 'blocked' | 'none';
export type MissionMode =
  | 'endless'
  | 'plane-sprint'
  | 'score-rush'
  | 'clean-pit'
  | 'double-cut'
  | 'cube-trial';

export interface GameStateOptions {
  readonly dimensions?: FieldDimensions;
  readonly blockSet?: BlockSet;
  readonly startLevel?: number;
  readonly randomSeed?: number;
  readonly missionMode?: MissionMode;
}

export interface GameSetup {
  readonly dimensions: FieldDimensions;
  readonly blockSet: BlockSet;
  readonly startLevel: number;
  readonly randomSeed: number;
  readonly missionMode: MissionMode;
}

export interface ActivePolyCubeSnapshot {
  readonly id: number;
  readonly label: string;
  readonly color: number;
  readonly blocks: FieldCoordinate[];
}

export interface SettledBlockSnapshot {
  readonly id: number;
  readonly label: string;
  readonly color: number;
  readonly coordinate: FieldCoordinate;
}

export interface FootprintCellSnapshot {
  readonly x: number;
  readonly y: number;
  readonly contactZ: number;
}

export interface ScoreStatistics {
  readonly placedCubes: number;
  readonly emptyPitCount: number;
  readonly clearedPlanesByCount: readonly number[];
}

export interface MissionSnapshot {
  readonly mode: MissionMode;
  readonly label: string;
  readonly shortLabel: string;
  readonly progressLabel: string;
  readonly targetValue: number;
  readonly progressValue: number;
  readonly remainingValue: number;
  readonly active: boolean;
  readonly complete: boolean;
  readonly hint: string;
  readonly completionMessage: string;
}

type MissionProgressContext = {
  readonly clearedPlanes: number;
  readonly score: number;
  readonly placedCubes: number;
  readonly emptyPitCount: number;
  readonly multiPlaneClearCount: number;
};

type MissionDefinition = {
  readonly label: string;
  readonly shortLabel: string;
  readonly progressLabel: string;
  readonly targetValue: number;
  readonly active: boolean;
  readonly description: string;
  readonly getProgress: (context: MissionProgressContext) => number;
  readonly getHint: (remainingValue: number) => string;
  readonly completionMessage: string;
};

const PLANE_SPRINT_TARGET_PLANES = 5;
const SCORE_RUSH_TARGET_SCORE = 2_000;
const CLEAN_PIT_TARGET_COUNT = 1;
const DOUBLE_CUT_TARGET_COUNT = 1;
const BLOCK_TRIAL_TARGET_BLOCKS = 120;
export const DEFAULT_MISSION_MODE: MissionMode = 'plane-sprint';
export const MISSION_MODES: readonly MissionMode[] = Object.freeze([
  'plane-sprint',
  'score-rush',
  'clean-pit',
  'double-cut',
  'cube-trial'
]);

const MISSION_DEFINITIONS: Readonly<Record<MissionMode, MissionDefinition>> = Object.freeze({
  endless: {
    label: 'エンドレス',
    shortLabel: 'エンドレス',
    progressLabel: '面',
    targetValue: 0,
    active: false,
    description: 'ゲームオーバーまでスコアを伸ばす。',
    getProgress: (context) => context.clearedPlanes,
    getHint: () => '奥まで埋まった面をそろえると消去できます。',
    completionMessage: 'さらに高いスコアを狙えます。'
  },
  'plane-sprint': {
    label: '5面スプリント',
    shortLabel: '5面消去',
    progressLabel: '面',
    targetValue: PLANE_SPRINT_TARGET_PLANES,
    active: true,
    description: '消去面を合計5面に到達させる。',
    getProgress: (context) => context.clearedPlanes,
    getHint: (remainingValue) =>
      remainingValue === 1
        ? 'あと1面消去で達成。'
        : `あと${remainingValue}面消去で達成。`,
    completionMessage: '5面スプリント達成。'
  },
  'score-rush': {
    label: 'スコアラッシュ',
    shortLabel: '2,000点',
    progressLabel: '点',
    targetValue: SCORE_RUSH_TARGET_SCORE,
    active: true,
    description: 'スコア2,000点に到達する。',
    getProgress: (context) => context.score,
    getHint: (remainingValue) =>
      `あと${formatMissionValue(remainingValue)}点で達成。`,
    completionMessage: 'スコアラッシュ達成。'
  },
  'clean-pit': {
    label: 'クリーンピット',
    shortLabel: '全消し',
    progressLabel: '回',
    targetValue: CLEAN_PIT_TARGET_COUNT,
    active: true,
    description: 'ピット内の固定ブロックを一度すべて消す。',
    getProgress: (context) => context.emptyPitCount,
    getHint: () => '固定ブロックを一度すべて消すと達成。',
    completionMessage: 'ピットを空にしました。'
  },
  'double-cut': {
    label: 'ダブルカット',
    shortLabel: '2面同時',
    progressLabel: '回',
    targetValue: DOUBLE_CUT_TARGET_COUNT,
    active: true,
    description: '1回の固定で2面以上を同時に消す。',
    getProgress: (context) => context.multiPlaneClearCount,
    getHint: () => '1回の固定で2面以上を同時に消すと達成。',
    completionMessage: 'ダブルカット達成。'
  },
  'cube-trial': {
    label: 'ブロックトライアル',
    shortLabel: '120ブロック',
    progressLabel: '個',
    targetValue: BLOCK_TRIAL_TARGET_BLOCKS,
    active: true,
    description: 'ブロックを合計120個配置する。',
    getProgress: (context) => context.placedCubes,
    getHint: (remainingValue) => `あと${formatMissionValue(remainingValue)}個配置で達成。`,
    completionMessage: 'ブロックトライアル達成。'
  }
});

export function getMissionModeLabel(mode: MissionMode): string {
  return MISSION_DEFINITIONS[mode].label;
}

export function getMissionModeOptionLabel(mode: MissionMode): string {
  return MISSION_DEFINITIONS[mode].shortLabel;
}

export function getMissionModeDescription(mode: MissionMode): string {
  return MISSION_DEFINITIONS[mode].description;
}

export function isMissionModeCompatibleWithBlockSet(
  mode: MissionMode,
  blockSet: BlockSet
): boolean {
  return MISSION_MODES.includes(mode) && BLOCK_SETS.includes(blockSet);
}

/**
 * BlockOut-style rules model. The pit is indexed as x/y on the camera-facing
 * entry plane and z as depth. Camera-near z=0 is the sky/entry side; pieces fall
 * toward increasing z, where the far z side is the landing ground.
 */
export class GameState {
  private dimensions: FieldDimensions;
  private blockSet: BlockSet;
  private startLevel: number;
  private randomSeed: number;
  private fixedRandomSeed: boolean;
  private missionMode: MissionMode;
  private rngState: number;
  private grid: CellState[][][];
  private activePolyCube: ActivePolyCube | null = null;
  private heldPieceId: number | null = null;
  private holdUsedThisTurn = false;
  private queue: number[] = [];
  private phase: GamePhase = 'running';
  private clearedPlaneCount = 0;
  private score = 0;
  private level: number;
  private placedCubeCount = 0;
  private emptyPitCount = 0;
  private clearedPlanesByCount = [0, 0, 0, 0, 0, 0];

  constructor();
  constructor(options: GameStateOptions);
  constructor(dimensions: FieldDimensions);
  constructor(optionsOrDimensions: GameStateOptions | FieldDimensions = {}) {
    const options = isFieldDimensions(optionsOrDimensions)
      ? { dimensions: optionsOrDimensions }
      : optionsOrDimensions;
    const setup = normalizeSetup(options);
    this.dimensions = setup.dimensions;
    this.blockSet = setup.blockSet;
    this.startLevel = setup.startLevel;
    this.randomSeed = setup.randomSeed;
    this.missionMode = setup.missionMode;
    this.fixedRandomSeed = options.randomSeed !== undefined;
    this.rngState = this.randomSeed;
    this.level = this.startLevel;
    this.grid = this.createEmptyGrid();
  }

  public getDimensions(): FieldDimensions {
    return { ...this.dimensions };
  }

  public getBlockSet(): BlockSet {
    return this.blockSet;
  }

  public getSetup(): GameSetup {
    return {
      dimensions: this.getDimensions(),
      blockSet: this.blockSet,
      startLevel: this.startLevel,
      randomSeed: this.randomSeed,
      missionMode: this.missionMode
    };
  }

  public getBlockSetLabel(): string {
    return getBlockSetLabel(this.blockSet);
  }

  public configure(options: GameStateOptions): void {
    const nextSeed =
      options.randomSeed ?? (this.fixedRandomSeed ? this.randomSeed : createRandomSeed());
    const setup = normalizeSetup({
      dimensions: options.dimensions ?? this.dimensions,
      blockSet: options.blockSet ?? this.blockSet,
      startLevel: options.startLevel ?? this.startLevel,
      missionMode: options.missionMode ?? this.missionMode,
      randomSeed: nextSeed
    });
    this.dimensions = setup.dimensions;
    this.blockSet = setup.blockSet;
    this.startLevel = setup.startLevel;
    this.randomSeed = setup.randomSeed;
    this.missionMode = setup.missionMode;
    this.fixedRandomSeed =
      options.randomSeed !== undefined ? true : this.fixedRandomSeed;
    this.rngState = this.randomSeed;
    this.resetRuntimeState();
  }

  public getCell(coordinate: FieldCoordinate): CellState | undefined {
    if (!this.isWithinBounds(coordinate)) {
      return undefined;
    }
    const { x, y, z } = coordinate;
    return this.grid[z][y][x];
  }

  public setCell(coordinate: FieldCoordinate, state: CellState): boolean {
    if (!this.isWithinBounds(coordinate)) {
      return false;
    }
    const { x, y, z } = coordinate;
    this.grid[z][y][x] = state;
    return true;
  }

  public reset(): void {
    if (!this.fixedRandomSeed) {
      this.randomSeed = createRandomSeed();
    }
    this.rngState = this.randomSeed;
    this.resetRuntimeState();
  }

  private resetRuntimeState(): void {
    this.grid = this.createEmptyGrid();
    this.activePolyCube = null;
    this.heldPieceId = null;
    this.holdUsedThisTurn = false;
    this.queue = [];
    this.phase = 'running';
    this.clearedPlaneCount = 0;
    this.score = 0;
    this.level = this.startLevel;
    this.placedCubeCount = 0;
    this.emptyPitCount = 0;
    this.clearedPlanesByCount = [0, 0, 0, 0, 0, 0];
  }

  public getPhase(): GamePhase {
    return this.phase;
  }

  public isGameOver(): boolean {
    return this.phase === 'game-over';
  }

  public endGame(): void {
    this.activePolyCube = null;
    this.phase = 'game-over';
  }

  public getClearedPlaneCount(): number {
    return this.clearedPlaneCount;
  }

  public getClearedLayerCount(): number {
    return this.getClearedPlaneCount();
  }

  public getScore(): number {
    return this.score;
  }

  public getLevel(): number {
    return this.level;
  }

  public getDropIntervalMs(): number {
    return Math.round(TIME_BASE_MS * Math.pow(TIME_LEVEL_FACTOR, this.level));
  }

  public getScoreStatistics(): ScoreStatistics {
    return {
      placedCubes: this.placedCubeCount,
      emptyPitCount: this.emptyPitCount,
      clearedPlanesByCount: [...this.clearedPlanesByCount]
    };
  }

  public isWithinBounds({ x, y, z }: FieldCoordinate): boolean {
    const { width, height, depth } = this.dimensions;
    return x >= 0 && x < width && y >= 0 && y < height && z >= 0 && z < depth;
  }

  public ensureActivePolyCube(): void {
    if (!this.activePolyCube && !this.isGameOver()) {
      this.spawnPolyCube();
    }
  }

  public getActivePolyCube(): ActivePolyCubeSnapshot | null {
    if (!this.activePolyCube) {
      return null;
    }
    return this.toActiveSnapshot(this.activePolyCube);
  }

  public getUpcomingQueue(length = 3): number[] {
    this.refillQueue(length);
    return this.queue.slice(0, length);
  }

  public getHeldPiece(): number | null {
    return this.heldPieceId;
  }

  public getProjectedActivePolyCube(): ActivePolyCubeSnapshot | null {
    if (!this.activePolyCube) {
      return null;
    }

    const projected = {
      ...this.activePolyCube,
      position: addCoordinates(this.activePolyCube.position, {
        x: 0,
        y: 0,
        z: this.getDropDistance(this.activePolyCube)
      })
    };
    return this.toActiveSnapshot(projected);
  }

  public getActiveFootprintCells(): FootprintCellSnapshot[] {
    const projected = this.getProjectedActivePolyCube();
    if (!projected) {
      return [];
    }

    const uniqueCells = new Map<string, FootprintCellSnapshot>();
    projected.blocks.forEach((block) => {
      const key = `${block.x},${block.y}`;
      const contactZ = block.z + 1;
      const existing = uniqueCells.get(key);
      if (!existing || contactZ > existing.contactZ) {
        uniqueCells.set(key, { x: block.x, y: block.y, contactZ });
      }
    });
    return Array.from(uniqueCells.values()).sort((a, b) => a.y - b.y || a.x - b.x);
  }

  public getMissionSnapshot(): MissionSnapshot {
    const definition = MISSION_DEFINITIONS[this.missionMode];
    const rawProgress = Math.max(0, definition.getProgress(this.getMissionProgressContext()));
    const progressValue =
      definition.targetValue === 0
        ? rawProgress
        : Math.min(rawProgress, definition.targetValue);
    const remainingValue = Math.max(0, definition.targetValue - progressValue);
    const complete =
      definition.active &&
      definition.targetValue > 0 &&
      progressValue >= definition.targetValue;
    return {
      mode: this.missionMode,
      label: definition.label,
      shortLabel: definition.shortLabel,
      progressLabel: definition.progressLabel,
      targetValue: definition.targetValue,
      progressValue,
      remainingValue,
      active: definition.active,
      complete,
      hint: definition.getHint(remainingValue),
      completionMessage: definition.completionMessage
    };
  }

  public getSettledBlocks(): SettledBlockSnapshot[] {
    const blocks: SettledBlockSnapshot[] = [];
    for (let z = 0; z < this.dimensions.depth; z += 1) {
      for (let y = 0; y < this.dimensions.height; y += 1) {
        for (let x = 0; x < this.dimensions.width; x += 1) {
          const cell = this.grid[z][y][x];
          if (cell === 'empty') {
            continue;
          }
          const definition = getPolyCubeDefinition(cell);
          blocks.push({
            id: definition.id,
            label: definition.label,
            color: definition.color,
            coordinate: { x, y, z }
          });
        }
      }
    }
    return blocks;
  }

  public moveActivePolyCube(delta: FieldCoordinate): boolean {
    if (!this.activePolyCube) {
      return false;
    }
    const candidatePosition = addCoordinates(this.activePolyCube.position, delta);
    if (!this.canOccupy(candidatePosition, this.activePolyCube.cells)) {
      return false;
    }
    this.activePolyCube = {
      ...this.activePolyCube,
      position: candidatePosition
    };
    return true;
  }

  public softDropActivePolyCube(): ActivePolyCubeStepResult {
    if (!this.activePolyCube) {
      return 'none';
    }

    if (!this.canActivePolyCubeFall()) {
      return 'blocked';
    }

    const nextPosition = addCoordinates(this.activePolyCube.position, DEPTH_DROP_VECTOR);
    const active = {
      ...this.activePolyCube,
      position: nextPosition,
      dropScorePosition: Math.max(0, this.activePolyCube.dropScorePosition - 1)
    };
    this.activePolyCube = {
      ...active,
      fallCursor: Math.max(active.fallCursor, this.getBottomDepth(active))
    };
    return 'moved';
  }

  public canActivePolyCubeFall(): boolean {
    if (!this.activePolyCube) {
      return false;
    }
    return this.canOccupy(
      addCoordinates(this.activePolyCube.position, DEPTH_DROP_VECTOR),
      this.activePolyCube.cells
    );
  }

  public swapHeldPiece(): boolean {
    if (!this.activePolyCube || this.holdUsedThisTurn || this.isGameOver()) {
      return false;
    }

    const activeId = this.activePolyCube.id;
    const heldId = this.heldPieceId;
    this.heldPieceId = activeId;
    this.activePolyCube = null;
    this.holdUsedThisTurn = true;

    if (heldId === null) {
      this.spawnPolyCube();
      return true;
    }

    this.spawnPolyCube(heldId);
    return true;
  }

  public rotateActivePolyCube(axis: Axis, direction: RotationDirection): boolean {
    if (!this.activePolyCube) {
      return false;
    }
    const active = this.activePolyCube;

    const rotatedCells = active.cells.map((cell) =>
      rotateCellAroundBlockOutCenter(
        cell,
        active.definition.rotationCenter,
        axis,
        direction
      )
    );

    if (this.canOccupy(active.position, rotatedCells)) {
      this.activePolyCube = {
        ...active,
        cells: rotatedCells
      };
      return true;
    }

    const correction = this.getOutOfBoundsCorrection(active.position, rotatedCells);
    if (
      !isZeroCoordinate(correction) &&
      this.canOccupy(addCoordinates(active.position, correction), rotatedCells)
    ) {
      this.activePolyCube = {
        ...active,
        position: addCoordinates(active.position, correction),
        cells: rotatedCells
      };
      return true;
    }

    return false;
  }

  public stepActivePolyCube(): ActivePolyCubeStepResult {
    if (!this.activePolyCube) {
      return 'none';
    }

    const active = {
      ...this.activePolyCube,
      fallCursor: this.activePolyCube.fallCursor + 1,
      dropScorePosition: Math.max(0, this.activePolyCube.dropScorePosition - 1)
    };
    this.activePolyCube = active;

    if (!this.isBelowFallCursor(active)) {
      return 'waiting';
    }

    const candidatePosition = addCoordinates(active.position, DEPTH_DROP_VECTOR);
    if (!this.canOccupy(candidatePosition, active.cells)) {
      return 'blocked';
    }

    this.activePolyCube = {
      ...active,
      position: candidatePosition
    };
    return 'moved';
  }

  public hardDropActivePolyCube(): number {
    if (!this.activePolyCube) {
      return 0;
    }

    let active = this.activePolyCube;
    let moved = 0;
    while (this.canOccupy(addCoordinates(active.position, DEPTH_DROP_VECTOR), active.cells)) {
      active = {
        ...active,
        position: addCoordinates(active.position, DEPTH_DROP_VECTOR)
      };
      moved += 1;
    }
    this.activePolyCube = {
      ...active,
      wasDropped: true,
      fallCursor: this.getBottomDepth(active)
    };
    return moved;
  }

  public spawnPolyCube(forcedId?: number): void {
    if (this.isGameOver()) {
      return;
    }

    const definition = forcedId === undefined
      ? this.dequeueNextDefinition()
      : getPolyCubeDefinition(forcedId);
    const position = this.getSpawnPosition(definition);
    const instance: ActivePolyCube = {
      id: definition.id,
      label: definition.label,
      color: definition.color,
      definition,
      position,
      cells: definition.cells.map((cell) => ({ ...cell })),
      wasDropped: false,
      dropScorePosition: this.dimensions.depth - 1,
      fallCursor: 0
    };

    if (!this.canOccupy(instance.position, instance.cells)) {
      this.activePolyCube = null;
      this.phase = 'game-over';
      return;
    }

    this.activePolyCube = instance;
  }

  public lockActivePolyCube(): number {
    if (!this.activePolyCube) {
      return 0;
    }

    const active = this.activePolyCube;
    if (this.canOccupy(addCoordinates(active.position, DEPTH_DROP_VECTOR), active.cells)) {
      return 0;
    }

    this.getAbsoluteBlocks(active).forEach((block) => {
      this.grid[block.z][block.y][block.x] = active.id;
    });
    this.activePolyCube = null;
    this.holdUsedThisTurn = false;

    const clearedPlanes = this.clearCompletedPlanes();
    const pitEmpty = this.isPitEmpty();
    this.applyBlockOutScore(active, clearedPlanes, pitEmpty);
    this.updateLevel();
    return clearedPlanes;
  }

  private canOccupy(position: FieldCoordinate, cells: readonly FieldCoordinate[]): boolean {
    return cells.every((cell) => this.isCellAvailable(addCoordinates(position, cell)));
  }

  private isCellAvailable(coordinate: FieldCoordinate): boolean {
    if (!this.isWithinBounds(coordinate)) {
      return false;
    }
    const { x, y, z } = coordinate;
    return this.grid[z][y][x] === 'empty';
  }

  private getAbsoluteBlocks(polyCube: ActivePolyCube): FieldCoordinate[] {
    return polyCube.cells.map((cell) => addCoordinates(polyCube.position, cell));
  }

  private toActiveSnapshot(polyCube: ActivePolyCube): ActivePolyCubeSnapshot {
    return {
      id: polyCube.id,
      label: polyCube.label,
      color: polyCube.color,
      blocks: this.getAbsoluteBlocks(polyCube)
    };
  }

  private getSpawnPosition(definition: PolyCubeDefinition): FieldCoordinate {
    return {
      x: Math.max(0, this.dimensions.width - definition.width),
      y: 0,
      z: 0
    };
  }

  private dequeueNextDefinition(): PolyCubeDefinition {
    this.refillQueue(1);
    const nextId = this.queue.shift();
    if (nextId === undefined) {
      throw new Error('No BlockOut polycube is available in the spawn queue.');
    }
    return getPolyCubeDefinition(nextId);
  }

  private refillQueue(minLength: number): void {
    while (this.queue.length < minLength) {
      this.queue.push(...this.createShuffledBag());
    }
  }

  private createShuffledBag(): number[] {
    const eligible = getEligiblePolyCubes(this.dimensions, this.blockSet);
    if (eligible.length === 0) {
      throw new Error('No BlockOut polycubes fit the current pit setup.');
    }
    const bag = eligible.map((definition) => definition.id);
    for (let i = bag.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.nextRandom() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    return bag;
  }

  private nextRandom(): number {
    this.rngState = (Math.imul(1664525, this.rngState) + 1013904223) >>> 0;
    return this.rngState / 0x100000000;
  }

  private createEmptyGrid(): CellState[][][] {
    const { width, height, depth } = this.dimensions;
    return Array.from({ length: depth }, () =>
      Array.from({ length: height }, () =>
        Array.from({ length: width }, () => 'empty' as CellState)
      )
    );
  }

  private createEmptyPlane(): CellState[][] {
    const { width, height } = this.dimensions;
    return Array.from({ length: height }, () =>
      Array.from({ length: width }, () => 'empty' as CellState)
    );
  }

  public clearCompletedPlanes(): number {
    let clearedPlanes = 0;
    let z = this.dimensions.depth - 1;

    while (z >= 0) {
      if (this.isPlaneFilled(z)) {
        this.removePlane(z);
        clearedPlanes += 1;
      } else {
        z -= 1;
      }
    }

    this.clearedPlaneCount += clearedPlanes;
    if (clearedPlanes > 0) {
      const bucket = Math.min(clearedPlanes, this.clearedPlanesByCount.length - 1);
      this.clearedPlanesByCount[bucket] += 1;
    }
    return clearedPlanes;
  }

  private isPlaneFilled(z: number): boolean {
    return this.grid[z].every((row) => row.every((cell) => cell !== 'empty'));
  }

  private removePlane(index: number): void {
    for (let z = index; z > 0; z -= 1) {
      this.grid[z] = this.clonePlane(this.grid[z - 1]);
    }
    this.grid[0] = this.createEmptyPlane();
  }

  private clonePlane(plane: CellState[][]): CellState[][] {
    return plane.map((row) => [...row]);
  }

  private isPitEmpty(): boolean {
    return this.grid.every((plane) =>
      plane.every((row) => row.every((cell) => cell === 'empty'))
    );
  }

  private applyBlockOutScore(active: ActivePolyCube, clearedPlanes: number, pitEmpty: boolean): void {
    const level = clampInteger(this.level, 0, MAX_LEVEL);
    const dropPosition = active.wasDropped ? active.dropScorePosition : 0;
    const dropRatio = dropPosition / Math.max(1, this.dimensions.depth - 1);
    const pieceScore =
      (active.definition.lowScore +
        (active.definition.highScore - active.definition.lowScore) * dropRatio) *
      P_LEVEL_FACTOR[level];
    const lineScore =
      LINE_BASE[this.blockSet] *
      LINE_LEVEL_FACTOR[level] *
      (LINE_NUMBER_FACTOR[Math.min(clearedPlanes, 5)] ?? LINE_NUMBER_FACTOR[5]);
    const emptyPitScore = pitEmpty
      ? LINE_BASE[this.blockSet] * LINE_LEVEL_FACTOR[level] * LINE_NUMBER_FACTOR[2]
      : 0;
    const depthFactor = DEPTH_FACTOR[this.dimensions.depth] ?? 1;
    const scoreDelta = Math.max(1, Math.round((pieceScore + lineScore + emptyPitScore) * depthFactor));

    this.score += scoreDelta;
    this.placedCubeCount += active.cells.length;
    if (pitEmpty) {
      this.emptyPitCount += 1;
    }
  }

  private updateLevel(): void {
    const cubesPerLevel = (this.dimensions.height + this.dimensions.width) * 15;
    while (
      this.level < MAX_LEVEL &&
      this.placedCubeCount >= cubesPerLevel * (this.level + 1)
    ) {
      this.level += 1;
    }
  }

  private isBelowFallCursor(active: ActivePolyCube): boolean {
    return this.getAbsoluteBlocks(active).every((block) => block.z < active.fallCursor);
  }

  private getBottomDepth(active: ActivePolyCube): number {
    return Math.max(...this.getAbsoluteBlocks(active).map((block) => block.z));
  }

  private getDropDistance(active: ActivePolyCube): number {
    let distance = 0;
    let candidatePosition = active.position;
    while (this.canOccupy(addCoordinates(candidatePosition, DEPTH_DROP_VECTOR), active.cells)) {
      candidatePosition = addCoordinates(candidatePosition, DEPTH_DROP_VECTOR);
      distance += 1;
    }
    return distance;
  }

  private getOutOfBoundsCorrection(
    position: FieldCoordinate,
    cells: readonly FieldCoordinate[]
  ): FieldCoordinate {
    return cells.reduce<FieldCoordinate>(
      (correction, cell) => {
        const absolute = addCoordinates(position, cell);
        const local = getOutOfBoundsOffset(absolute, this.dimensions);
        return {
          x: Math.abs(local.x) > Math.abs(correction.x) ? local.x : correction.x,
          y: Math.abs(local.y) > Math.abs(correction.y) ? local.y : correction.y,
          z: Math.abs(local.z) > Math.abs(correction.z) ? local.z : correction.z
        };
      },
      { x: 0, y: 0, z: 0 }
    );
  }

  private getMissionProgressContext(): MissionProgressContext {
    const multiPlaneClearCount = this.clearedPlanesByCount
      .slice(2)
      .reduce((sum, count) => sum + count, 0);
    return {
      clearedPlanes: this.clearedPlaneCount,
      score: this.score,
      placedCubes: this.placedCubeCount,
      emptyPitCount: this.emptyPitCount,
      multiPlaneClearCount
    };
  }
}

interface ActivePolyCube {
  readonly id: number;
  readonly label: string;
  readonly color: number;
  readonly definition: PolyCubeDefinition;
  position: FieldCoordinate;
  cells: FieldCoordinate[];
  readonly wasDropped: boolean;
  readonly dropScorePosition: number;
  readonly fallCursor: number;
}

const DEPTH_DROP_VECTOR: FieldCoordinate = { x: 0, y: 0, z: 1 };
const BLOCKOUT_TIME_BASE_MS = 5510;
const TIME_BASE_MS = BLOCKOUT_TIME_BASE_MS;
const TIME_LEVEL_FACTOR = 0.64;
const MAX_START_LEVEL = MAX_LEVEL - 1;

function rotateCellAroundBlockOutCenter(
  cell: FieldCoordinate,
  center: FieldCoordinate,
  axis: Axis,
  direction: RotationDirection
): FieldCoordinate {
  const translated = {
    x: cell.x - center.x + 0.5,
    y: cell.y - center.y + 0.5,
    z: cell.z - center.z + 0.5
  };
  const rotated = rotateVector(translated, axis, direction);
  return {
    x: Math.round(rotated.x - 0.5) + center.x,
    y: Math.round(rotated.y - 0.5) + center.y,
    z: Math.round(rotated.z - 0.5) + center.z
  };
}

function rotateVector(
  vector: FieldCoordinate,
  axis: Axis,
  direction: RotationDirection
): FieldCoordinate {
  const { x, y, z } = vector;
  if (axis === 'x') {
    return direction === 1 ? { x, y: -z, z: y } : { x, y: z, z: -y };
  }
  if (axis === 'y') {
    return direction === 1 ? { x: -z, y, z: x } : { x: z, y, z: -x };
  }
  return direction === 1 ? { x: -y, y: x, z } : { x: y, y: -x, z };
}

function getOutOfBoundsOffset(
  { x, y, z }: FieldCoordinate,
  { width, height, depth }: FieldDimensions
): FieldCoordinate {
  return {
    x: x < 0 ? -x : x >= width ? width - x - 1 : 0,
    y: y < 0 ? -y : y >= height ? height - y - 1 : 0,
    z: z < 0 ? -z : z >= depth ? depth - z - 1 : 0
  };
}

function addCoordinates(a: FieldCoordinate, b: FieldCoordinate): FieldCoordinate {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z
  };
}

function isZeroCoordinate({ x, y, z }: FieldCoordinate): boolean {
  return x === 0 && y === 0 && z === 0;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function formatMissionValue(value: number): string {
  return Math.trunc(value).toLocaleString('ja-JP');
}

function normalizeDimensions(dimensions: FieldDimensions): FieldDimensions {
  return {
    width: clampInteger(dimensions.width, MIN_PIT_WIDTH, MAX_PIT_WIDTH),
    height: clampInteger(dimensions.height, MIN_PIT_HEIGHT, MAX_PIT_HEIGHT),
    depth: clampInteger(dimensions.depth, MIN_PIT_DEPTH, MAX_PIT_DEPTH)
  };
}

function normalizeSetup(options: GameStateOptions): GameSetup {
  const missionMode = normalizeMissionMode(options.missionMode);
  const blockSet = normalizeMissionBlockSet(options.blockSet ?? DEFAULT_BLOCK_SET, missionMode);
  return {
    dimensions: normalizeDimensions(options.dimensions ?? FIELD_DIMENSIONS),
    blockSet,
    startLevel: clampInteger(options.startLevel ?? DEFAULT_START_LEVEL, 0, MAX_START_LEVEL),
    randomSeed: normalizeSeed(options.randomSeed ?? createRandomSeed()),
    missionMode
  };
}

function normalizeMissionMode(mode: MissionMode | undefined): MissionMode {
  return mode && (MISSION_MODES as readonly string[]).includes(mode)
    ? mode
    : DEFAULT_MISSION_MODE;
}

function normalizeMissionBlockSet(blockSet: BlockSet, missionMode: MissionMode): BlockSet {
  return isMissionModeCompatibleWithBlockSet(missionMode, blockSet) ? blockSet : 'basic';
}

function normalizeSeed(seed: number): number {
  return Math.max(1, Math.trunc(seed) >>> 0);
}

function createRandomSeed(): number {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.getRandomValues) {
    const values = new Uint32Array(1);
    cryptoApi.getRandomValues(values);
    return normalizeSeed(values[0]);
  }

  return normalizeSeed(Date.now());
}

function isFieldDimensions(value: GameStateOptions | FieldDimensions): value is FieldDimensions {
  return (
    typeof value === 'object' &&
    value !== null &&
    'width' in value &&
    'height' in value &&
    'depth' in value
  );
}
