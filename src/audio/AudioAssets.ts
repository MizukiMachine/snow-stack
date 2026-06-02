export type BgmAssetId =
  | 'crystal-drift'
  | 'neon-snow-stack';

export type SfxAssetId =
  | 'move'
  | 'rotate'
  | 'softDrop'
  | 'hardDrop'
  | 'lock'
  | 'hold'
  | 'planeClear'
  | 'missionComplete'
  | 'gameOver'
  | 'pause'
  | 'resume'
  | 'start'
  | 'uiSelect';

export type BgmAsset = {
  readonly id: BgmAssetId;
  readonly label: string;
  readonly src: string;
  readonly durationMs: number;
  readonly volume: number;
};

export type SfxAsset = {
  readonly id: SfxAssetId;
  readonly label: string;
  readonly src: string;
  readonly volume: number;
};

export const BGM_ASSETS: readonly BgmAsset[] = Object.freeze([
  {
    id: 'crystal-drift',
    label: 'Crystal Drift',
    src: '/assets/bgm/crystal-drift.mp3',
    durationMs: 90_000,
    volume: 0.17
  },
  {
    id: 'neon-snow-stack',
    label: 'Neon Snow Stack',
    src: '/assets/bgm/neon-snow-stack.mp3',
    durationMs: 90_000,
    volume: 0.08
  }
]);

export const DEFAULT_BGM_ID: BgmAssetId = 'crystal-drift';

export const SFX_ASSETS: Readonly<Record<SfxAssetId, SfxAsset>> = Object.freeze({
  move: {
    id: 'move',
    label: 'Move',
    src: '/assets/sfx/move-slide.mp3',
    volume: 0.07
  },
  rotate: {
    id: 'rotate',
    label: 'Rotate',
    src: '/assets/sfx/rotate-click.mp3',
    volume: 0.07
  },
  softDrop: {
    id: 'softDrop',
    label: 'Soft Drop',
    src: '/assets/sfx/soft-drop.mp3',
    volume: 0.06
  },
  hardDrop: {
    id: 'hardDrop',
    label: 'Hard Drop',
    src: '/assets/sfx/hard-drop.mp3',
    volume: 0.1
  },
  lock: {
    id: 'lock',
    label: 'Lock',
    src: '/assets/sfx/lock.mp3',
    volume: 0.08
  },
  hold: {
    id: 'hold',
    label: 'Hold',
    src: '/assets/sfx/hold.mp3',
    volume: 0.07
  },
  planeClear: {
    id: 'planeClear',
    label: 'Plane Clear',
    src: '/assets/sfx/plane-clear.mp3',
    volume: 0.11
  },
  missionComplete: {
    id: 'missionComplete',
    label: 'Mission Complete',
    src: '/assets/sfx/mission-complete.mp3',
    volume: 0.12
  },
  gameOver: {
    id: 'gameOver',
    label: 'Game Over',
    src: '/assets/sfx/game-over.mp3',
    volume: 0.11
  },
  pause: {
    id: 'pause',
    label: 'Pause',
    src: '/assets/sfx/pause.mp3',
    volume: 0.06
  },
  resume: {
    id: 'resume',
    label: 'Resume',
    src: '/assets/sfx/resume.mp3',
    volume: 0.06
  },
  start: {
    id: 'start',
    label: 'Start',
    src: '/assets/sfx/start.mp3',
    volume: 0.09
  },
  uiSelect: {
    id: 'uiSelect',
    label: 'UI Select',
    src: '/assets/sfx/ui-select.mp3',
    volume: 0.1
  }
});

export function isBgmAssetId(value: string | undefined): value is BgmAssetId {
  return value !== undefined && BGM_ASSETS.some((asset) => asset.id === value);
}

export function getBgmAsset(id: BgmAssetId): BgmAsset {
  return BGM_ASSETS.find((asset) => asset.id === id) ?? BGM_ASSETS[0];
}
