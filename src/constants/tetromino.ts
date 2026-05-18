import type { FieldCoordinate } from './field';

export type TetrominoType = 'I' | 'J' | 'L' | 'O' | 'S' | 'T' | 'Z';

export interface TetrominoDefinition {
  readonly type: TetrominoType;
  readonly color: number;
  readonly cells: readonly FieldCoordinate[];
}

export const TETROMINO_TYPES: readonly TetrominoType[] = Object.freeze([
  'I',
  'J',
  'L',
  'O',
  'S',
  'T',
  'Z'
]);

const DEFINITIONS: Record<TetrominoType, TetrominoDefinition> = {
  I: {
    type: 'I',
    color: 0x42c9ff,
    cells: Object.freeze([
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 }
    ])
  },
  J: {
    type: 'J',
    color: 0x3b74ff,
    cells: Object.freeze([
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 }
    ])
  },
  L: {
    type: 'L',
    color: 0xffb22e,
    cells: Object.freeze([
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: -1, y: 0, z: 1 }
    ])
  },
  O: {
    type: 'O',
    color: 0xffcf3f,
    cells: Object.freeze([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 }
    ])
  },
  S: {
    type: 'S',
    color: 0x4de064,
    cells: Object.freeze([
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 }
    ])
  },
  T: {
    type: 'T',
    color: 0xb24bff,
    cells: Object.freeze([
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 }
    ])
  },
  Z: {
    type: 'Z',
    color: 0xff4f50,
    cells: Object.freeze([
      { x: -1, y: 0, z: 1 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 }
    ])
  }
};

export function getTetrominoDefinition(type: TetrominoType): TetrominoDefinition {
  return DEFINITIONS[type];
}

export function getRandomTetrominoType(): TetrominoType {
  const index = Math.floor(Math.random() * TETROMINO_TYPES.length);
  return TETROMINO_TYPES[index];
}
