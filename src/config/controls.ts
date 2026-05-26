import type { FieldCoordinate } from '../constants/field';
import type { RotationDirection } from '../GameState';
import type { Axis } from '../types/coordinates';

export type RotationCommand = {
  axis: Axis;
  direction: RotationDirection;
};

export type KeyAssignmentRow = {
  keys: readonly string[];
  label: string;
};

export const MOVEMENT_OFFSETS: Record<string, FieldCoordinate> = {
  ArrowLeft: { x: 1, y: 0, z: 0 },
  ArrowRight: { x: -1, y: 0, z: 0 },
  ArrowUp: { x: 0, y: 1, z: 0 },
  ArrowDown: { x: 0, y: -1, z: 0 }
};

export const ROTATION_COMMANDS: Record<string, RotationCommand> = {
  KeyQ: { axis: 'x', direction: -1 },
  KeyA: { axis: 'x', direction: 1 },
  KeyW: { axis: 'y', direction: -1 },
  KeyS: { axis: 'y', direction: 1 },
  KeyE: { axis: 'z', direction: -1 },
  KeyD: { axis: 'z', direction: 1 }
};

export const SOFT_DROP_CODES: ReadonlySet<string> = new Set([
  'ShiftLeft',
  'ShiftRight',
  'Digit5',
  'Numpad5'
]);

export const HOLD_CODES: ReadonlySet<string> = new Set(['KeyC', 'KeyH']);

export const ONE_SHOT_CODES: ReadonlySet<string> = new Set([
  'Space',
  'Escape',
  ...HOLD_CODES
]);

export const KEY_ASSIGNMENT_ROWS: readonly KeyAssignmentRow[] = [
  { keys: ['←→↑↓'], label: '面内移動' },
  { keys: ['Q/A'], label: '左右軸まわり (X)' },
  { keys: ['W/S'], label: '上下軸まわり (Y)' },
  { keys: ['E/D'], label: '前後軸まわり (Z)' },
  { keys: ['Shift', '5'], label: 'ソフトドロップ' },
  { keys: ['C/H'], label: 'Hold' },
  { keys: ['Space'], label: 'ハードドロップ' },
  { keys: ['Esc'], label: '終了 / 設定を閉じる' }
];

export function isRepeatableGameplayCode(code: string): boolean {
  return code in MOVEMENT_OFFSETS || code in ROTATION_COMMANDS || SOFT_DROP_CODES.has(code);
}
