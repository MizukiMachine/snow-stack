import { describe, expect, it } from 'vitest';
import assetsManifest from '../../public/assets/assets.json';
import {
  BGM_ASSETS,
  DEFAULT_BGM_ID,
  SFX_ASSETS,
  isBgmAssetId
} from '../audio/AudioAssets';

describe('audio asset catalog', () => {
  it('defines the two adopted long BGM tracks for gameplay rotation', () => {
    expect(BGM_ASSETS).toHaveLength(2);
    expect(BGM_ASSETS.map((asset) => asset.id)).toEqual([
      'crystal-drift',
      'neon-snow-stack'
    ]);
    expect(BGM_ASSETS.every((asset) => asset.durationMs === 90_000)).toBe(true);
    expect(BGM_ASSETS.every((asset) => asset.src.startsWith('/assets/bgm/'))).toBe(true);
    expect(BGM_ASSETS.find((asset) => asset.id === 'neon-snow-stack')?.volume).toBeLessThan(
      BGM_ASSETS.find((asset) => asset.id === 'crystal-drift')?.volume ?? 0
    );
    expect(isBgmAssetId(DEFAULT_BGM_ID)).toBe(true);
  });

  it('covers the main gameplay sound effect events', () => {
    expect(Object.keys(SFX_ASSETS).sort()).toEqual([
      'gameOver',
      'hardDrop',
      'hold',
      'lock',
      'missionComplete',
      'move',
      'pause',
      'planeClear',
      'resume',
      'rotate',
      'softDrop',
      'start',
      'uiSelect'
    ]);
    expect(Object.values(SFX_ASSETS).every((asset) => asset.src.startsWith('/assets/sfx/'))).toBe(
      true
    );
    expect(Math.max(...Object.values(SFX_ASSETS).map((asset) => asset.volume))).toBeLessThanOrEqual(
      0.24
    );
  });

  it('keeps the public assets manifest aligned with the typed catalog', () => {
    expect(assetsManifest.bgm.map((asset) => asset.id)).toEqual(
      BGM_ASSETS.map((asset) => asset.id)
    );
    expect(assetsManifest.sfx.map((asset) => asset.id).sort()).toEqual(
      Object.keys(SFX_ASSETS).sort()
    );
  });
});
