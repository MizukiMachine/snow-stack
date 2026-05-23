import type { FieldCoordinate, FieldDimensions } from './constants/field';
import { FIELD_DIMENSIONS } from './constants/field';
import type { Axis } from './types/coordinates';
import {
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
  P_LEVEL_FACTOR,
  type BlockSet,
  type PolyCubeDefinition
} from './constants/blockout';

export type CellState = 'empty' | number;
export type GamePhase = 'running' | 'game-over';
export type RotationDirection = 1 | -1;

export interface GameStateOptions {
  readonly dimensions?: FieldDimensions;
  readonly blockSet?: BlockSet;
  readonly startLevel?: number;
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

export interface ScoreStatistics {
  readonly placedCubes: number;
  readonly emptyPitCount: number;
  readonly clearedPlanesByCount: readonly number[];
}

/**
 * BlockOut-style rules model. The pit is indexed as x/y on the visible plane and
 * z as depth; pieces fall toward increasing z and full x/y planes are removed.
 */
export class GameState {
  private readonly dimensions: FieldDimensions;
  private readonly blockSet: BlockSet;
  private readonly startLevel: number;
  private grid: CellState[][][];
  private activePolyCube: ActivePolyCube | null = null;
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
    this.dimensions = options.dimensions ?? FIELD_DIMENSIONS;
    this.blockSet = options.blockSet ?? DEFAULT_BLOCK_SET;
    this.startLevel = clampInteger(options.startLevel ?? DEFAULT_START_LEVEL, 0, MAX_LEVEL);
    this.level = this.startLevel;
    this.grid = this.createEmptyGrid();
  }

  public getDimensions(): FieldDimensions {
    return this.dimensions;
  }

  public getBlockSet(): BlockSet {
    return this.blockSet;
  }

  public getBlockSetLabel(): string {
    return getBlockSetLabel(this.blockSet);
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
    this.grid = this.createEmptyGrid();
    this.activePolyCube = null;
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

  public getHeldPiece(): null {
    return null;
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

  public hardDropActivePolyCube(): number {
    if (!this.activePolyCube) {
      return 0;
    }

    const dropScorePosition = Math.max(0, this.dimensions.depth - 1 - this.activePolyCube.position.z);
    let moved = 0;
    while (this.moveActivePolyCube(DEPTH_DROP_VECTOR)) {
      moved += 1;
    }
    if (moved > 0 || dropScorePosition > 0) {
      this.activePolyCube = {
        ...this.activePolyCube,
        wasDropped: true,
        dropScorePosition
      };
    }
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
      dropScorePosition: 0
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
    this.getAbsoluteBlocks(active).forEach((block) => {
      this.grid[block.z][block.y][block.x] = active.id;
    });
    this.activePolyCube = null;

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
    return getPolyCubeDefinition(nextId ?? this.getRandomEligibleDefinition().id);
  }

  private refillQueue(minLength: number): void {
    while (this.queue.length < minLength) {
      this.queue.push(this.getRandomEligibleDefinition().id);
    }
  }

  private getRandomEligibleDefinition(): PolyCubeDefinition {
    const eligible = getEligiblePolyCubes(this.dimensions, this.blockSet);
    if (eligible.length === 0) {
      throw new Error('No BlockOut polycubes fit the current pit setup.');
    }
    return eligible[Math.floor(Math.random() * eligible.length)];
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
}

const DEPTH_DROP_VECTOR: FieldCoordinate = { x: 0, y: 0, z: 1 };
const TIME_BASE_MS = 5510;
const TIME_LEVEL_FACTOR = 0.64;

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

function isFieldDimensions(value: GameStateOptions | FieldDimensions): value is FieldDimensions {
  return (
    typeof value === 'object' &&
    value !== null &&
    'width' in value &&
    'height' in value &&
    'depth' in value
  );
}
