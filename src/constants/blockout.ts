import type { FieldCoordinate, FieldDimensions } from './field';

export type BlockSet = 'flat' | 'basic' | 'extended';

export interface PolyCubeDefinition {
  readonly id: number;
  readonly label: string;
  readonly color: number;
  readonly cells: readonly FieldCoordinate[];
  readonly highScore: number;
  readonly lowScore: number;
  readonly isFlat: boolean;
  readonly isBasic: boolean;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly maxDimension: number;
  readonly rotationCenter: FieldCoordinate;
}

export const BLOCK_SETS: readonly BlockSet[] = Object.freeze(['flat', 'basic', 'extended']);
export const DEFAULT_BLOCK_SET: BlockSet = 'flat';
export const DEFAULT_START_LEVEL = 0;
export const MAX_LEVEL = 10;
export const MIN_PIT_WIDTH = 3;
export const MAX_PIT_WIDTH = 7;
export const MIN_PIT_HEIGHT = 3;
export const MAX_PIT_HEIGHT = 7;
export const MIN_PIT_DEPTH = 6;
export const MAX_PIT_DEPTH = 18;

export const BLOCK_SET_LABELS: Record<BlockSet, string> = Object.freeze({
  flat: 'FLAT',
  basic: 'BASIC',
  extended: 'EXTENDED'
});

export const P_LEVEL_FACTOR = Object.freeze([
  0.06699, 0.139195, 0.2198, 0.308444, 0.403897, 0.507822,
  0.619062, 0.73863, 0.865802, 1, 1.133333
]);

export const DEPTH_FACTOR = Object.freeze([
  0, 0, 0, 0, 0, 0, 1.557692, 1.367521, 1.217949, 1.100427,
  1, 0.918803, 0.852564, 0.788996, 0.737714, 0.691774,
  0.651709, 0.61485, 0.583868
]);

export const LINE_LEVEL_FACTOR = Object.freeze([
  0.096478, 0.163873, 0.242913, 0.328261, 0.422329, 0.518394,
  0.630405, 0.747501, 0.867087, 1, 1.131653
]);

export const LINE_NUMBER_FACTOR = Object.freeze([
  0, 1, 3.703372, 8.104827, 14.188325, 22.144941
]);

export const LINE_BASE: Record<BlockSet, number> = Object.freeze({
  flat: 762.5,
  basic: 875.5,
  extended: 2886.25
});

export const BLOCKOUT_LAYER_COLORS: readonly number[] = Object.freeze([
  0xff2d55,
  0xff8a1f,
  0xffc400,
  0x78d12f,
  0xb33cff,
  0xff3fb7,
  0x5b2a86
]);

export function getBlockOutLayerColor(depth: number, z: number): number {
  const normalizedDepth = Math.max(1, Math.trunc(depth));
  const normalizedZ = Math.min(Math.max(0, Math.trunc(z)), normalizedDepth - 1);
  const paletteIndex = positiveModulo(
    normalizedDepth - normalizedZ - 1,
    BLOCKOUT_LAYER_COLORS.length
  );
  return BLOCKOUT_LAYER_COLORS[paletteIndex];
}

const POLYCUBE_COLORS = Object.freeze([
  0xb91c1c, 0x047857, 0x7e22ce, 0xbe185d, 0x0e7490, 0xa16207,
  0x4f46e5, 0x15803d, 0xc2410c, 0x86198f, 0x0f766e, 0x9f1239
]);

type RawPolyCube = readonly [
  highScore: number,
  lowScore: number,
  isFlat: boolean,
  isBasic: boolean,
  cells: readonly (readonly [number, number, number])[]
];

const RAW_POLYCUBES: readonly RawPolyCube[] = Object.freeze([
  [156, 14, true, false, [[0, 0, 0]]],
  [156, 14, true, false, [[0, 0, 0], [0, 1, 0]]],
  [307, 27, true, false, [[0, 0, 0], [0, 1, 0], [0, 2, 0]]],
  [307, 27, false, false, [[0, 0, 0], [0, 1, 0], [0, 2, 0], [0, 3, 0]]],
  [624, 53, false, false, [[0, 0, 0], [0, 1, 0], [0, 2, 0], [0, 3, 0], [0, 4, 0]]],
  [307, 27, true, true, [[0, 0, 0], [1, 0, 0], [1, 1, 0]]],
  [156, 14, true, false, [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]]],
  [461, 40, true, true, [[0, 0, 0], [1, 0, 0], [2, 0, 0], [1, 1, 0]]],
  [461, 40, true, true, [[1, 0, 0], [2, 0, 0], [0, 1, 0], [1, 1, 0]]],
  [307, 27, true, true, [[0, 0, 0], [1, 0, 0], [2, 0, 0], [2, 1, 0]]],
  [921, 79, false, false, [[0, 0, 0], [1, 0, 0], [2, 0, 0], [2, 1, 0], [2, 2, 0]]],
  [921, 79, false, false, [[2, 0, 0], [0, 1, 0], [1, 1, 0], [2, 1, 0], [2, 2, 0]]],
  [921, 79, false, false, [[2, 0, 0], [0, 1, 0], [1, 1, 0], [2, 1, 0], [1, 2, 0]]],
  [921, 79, false, false, [[1, 0, 0], [2, 0, 0], [1, 1, 0], [0, 2, 0], [1, 2, 0]]],
  [780, 66, false, false, [[0, 0, 0], [1, 0, 0], [1, 1, 0], [2, 1, 0], [2, 2, 0]]],
  [780, 66, false, false, [[0, 0, 0], [1, 0, 0], [1, 1, 0], [1, 2, 0], [1, 3, 0]]],
  [921, 79, false, false, [[1, 0, 0], [0, 1, 0], [1, 1, 0], [1, 2, 0], [1, 3, 0]]],
  [1248, 105, false, false, [[0, 0, 0], [1, 0, 0], [1, 1, 0], [1, 2, 0], [0, 2, 0]]],
  [461, 40, false, false, [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [1, 2, 0]]],
  [921, 79, false, false, [[1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 2, 0], [0, 3, 0]]],
  [1402, 118, false, false, [[1, 0, 0], [0, 1, 0], [1, 1, 0], [2, 1, 0], [1, 2, 0]]],
  [1379, 131, false, false, [[0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [1, 2, 1]]],
  [1379, 131, false, false, [[1, 0, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [0, 2, 1]]],
  [965, 92, false, false, [[0, 1, 0], [0, 1, 1], [1, 0, 1], [1, 1, 1], [1, 2, 1]]],
  [965, 92, false, false, [[1, 1, 0], [1, 0, 1], [1, 1, 1], [1, 2, 1], [0, 2, 1]]],
  [965, 92, false, false, [[1, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [1, 2, 1]]],
  [1379, 131, false, false, [[1, 0, 0], [1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 2, 1]]],
  [1379, 131, false, false, [[0, 0, 0], [0, 0, 1], [0, 1, 1], [1, 1, 1], [1, 2, 1]]],
  [1103, 105, false, false, [[1, 1, 0], [1, 2, 0], [0, 0, 1], [0, 1, 1], [1, 1, 1]]],
  [1103, 105, false, false, [[0, 1, 0], [0, 2, 0], [1, 0, 1], [1, 1, 1], [0, 1, 1]]],
  [1379, 131, false, false, [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 2, 1], [0, 2, 1]]],
  [1379, 131, false, false, [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 2, 1], [1, 2, 1]]],
  [552, 53, false, true, [[1, 0, 0], [1, 0, 1], [0, 0, 1], [0, 1, 1]]],
  [552, 53, false, true, [[1, 0, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1]]],
  [552, 53, false, true, [[1, 0, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1]]],
  [827, 79, false, false, [[1, 1, 0], [0, 1, 1], [1, 1, 1], [1, 0, 1], [1, 2, 1]]],
  [461, 40, false, false, [[1, 0, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]]],
  [1103, 105, false, false, [[1, 0, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [1, 2, 1]]],
  [1103, 105, false, false, [[1, 0, 0], [1, 1, 0], [0, 1, 1], [1, 1, 1], [1, 2, 1]]],
  [1103, 105, false, false, [[1, 1, 0], [1, 2, 0], [1, 0, 1], [1, 1, 1], [0, 1, 1]]],
  [1379, 131, false, false, [[0, 0, 0], [1, 1, 0], [0, 0, 1], [0, 1, 1], [1, 1, 1]]]
]);

export const POLYCUBE_DEFINITIONS: readonly PolyCubeDefinition[] = Object.freeze(
  RAW_POLYCUBES.map(([highScore, lowScore, isFlat, isBasic, rawCells], id) => {
    const cells = rawCells.map(([x, y, z]) => ({ x, y, z }));
    const width = Math.max(...cells.map((cell) => cell.x)) + 1;
    const height = Math.max(...cells.map((cell) => cell.y)) + 1;
    const depth = Math.max(...cells.map((cell) => cell.z)) + 1;
    return Object.freeze({
      id,
      label: `P${String(id).padStart(2, '0')}`,
      color: POLYCUBE_COLORS[id % POLYCUBE_COLORS.length],
      cells: Object.freeze(cells),
      highScore,
      lowScore,
      isFlat,
      isBasic,
      width,
      height,
      depth,
      maxDimension: Math.max(width, height, depth),
      rotationCenter: Object.freeze({ x: width - 1, y: 1, z: depth - 1 })
    });
  })
);

export function getPolyCubeDefinition(id: number): PolyCubeDefinition {
  const definition = POLYCUBE_DEFINITIONS[id];
  if (!definition) {
    throw new Error(`Unknown polycube id: ${id}`);
  }
  return definition;
}

export function isPolyCubeInBlockSet(definition: PolyCubeDefinition, blockSet: BlockSet): boolean {
  if (blockSet === 'extended') {
    return true;
  }
  if (blockSet === 'basic') {
    return definition.isBasic;
  }
  return definition.isFlat;
}

export function getEligiblePolyCubes(
  dimensions: Pick<FieldDimensions, 'width' | 'height'>,
  blockSet: BlockSet = DEFAULT_BLOCK_SET
): readonly PolyCubeDefinition[] {
  const minPlanarDimension = Math.min(dimensions.width, dimensions.height);
  return POLYCUBE_DEFINITIONS.filter(
    (definition) =>
      isPolyCubeInBlockSet(definition, blockSet) &&
      definition.maxDimension <= minPlanarDimension
  );
}

export function getBlockSetLabel(blockSet: BlockSet): string {
  return BLOCK_SET_LABELS[blockSet];
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
