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
  ArrowDown: { x: 0, y: -1, z: 0 },
  Home: { x: 1, y: 1, z: 0 },
  PageUp: { x: -1, y: 1, z: 0 },
  End: { x: 1, y: -1, z: 0 },
  PageDown: { x: -1, y: -1, z: 0 },
  Numpad4: { x: 1, y: 0, z: 0 },
  Numpad6: { x: -1, y: 0, z: 0 },
  Numpad8: { x: 0, y: 1, z: 0 },
  Numpad2: { x: 0, y: -1, z: 0 },
  Numpad7: { x: 1, y: 1, z: 0 },
  Numpad9: { x: -1, y: 1, z: 0 },
  Numpad1: { x: 1, y: -1, z: 0 },
  Numpad3: { x: -1, y: -1, z: 0 },
  Digit4: { x: 1, y: 0, z: 0 },
  Digit6: { x: -1, y: 0, z: 0 },
  Digit8: { x: 0, y: 1, z: 0 },
  Digit2: { x: 0, y: -1, z: 0 },
  Digit7: { x: 1, y: 1, z: 0 },
  Digit9: { x: -1, y: 1, z: 0 },
  Digit1: { x: 1, y: -1, z: 0 },
  Digit3: { x: -1, y: -1, z: 0 }
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
  'KeyP',
  'Escape',
  'KeyR',
  ...HOLD_CODES
]);

export const KEY_ASSIGNMENT_ROWS: readonly KeyAssignmentRow[] = [
  { keys: ['←→↑↓', '2/4/6/8'], label: '面内移動' },
  { keys: ['1/3/7/9', 'Home/PgUp/End/PgDn'], label: '斜め移動' },
  { keys: ['Q/A'], label: 'X軸回転' },
  { keys: ['W/S'], label: 'Y軸回転' },
  { keys: ['E/D'], label: 'Z軸回転' },
  { keys: ['Shift', '5'], label: 'ソフトドロップ' },
  { keys: ['C/H'], label: 'ホールド' },
  { keys: ['Space'], label: 'ハードドロップ' },
  { keys: ['P'], label: '一時停止' },
  { keys: ['Esc'], label: '終了 / 設定を閉じる' },
  { keys: ['R'], label: 'リスタート' }
];

export function isRepeatableGameplayCode(code: string): boolean {
  return code in MOVEMENT_OFFSETS || code in ROTATION_COMMANDS || SOFT_DROP_CODES.has(code);
}
