import { describe, expect, it } from 'vitest';
import {
  BLOCKOUT_LAYER_COLORS,
  getEligiblePolyCubes,
  getBlockOutLayerColor,
  getPolyCubeDefinition,
  POLYCUBE_DEFINITIONS,
  type BlockSet
} from '../constants/blockout';

describe('custom polycube catalog', () => {
  it('defines the complete custom polycube catalog', () => {
    expect(POLYCUBE_DEFINITIONS).toHaveLength(45);
    expect(getPolyCubeDefinition(0).cells).toEqual([{ x: 0, y: 0, z: 0 }]);
    expect(getPolyCubeDefinition(40).cells).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
      { x: 1, y: 1, z: 1 }
    ]);
    expect(getPolyCubeDefinition(44).cells).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 1, y: 1, z: 0 }
    ]);
  });

  it('keeps every custom polycube score, set flag, and cube coordinate aligned', () => {
    expect(catalogSignature()).toBe([
      '0:156/14/1/0:000',
      '1:156/14/1/0:000.100',
      '2:307/27/1/1:000.100.010',
      '3:307/27/1/0:000.100.200',
      '4:624/53/1/0:000.100.200.010.020',
      '5:307/27/0/1:000.100.101',
      '6:156/14/0/1:000.010.011',
      '7:461/40/0/1:000.100.200.101',
      '8:461/40/1/1:000.100.010.110',
      '9:307/27/1/1:000.100.110.210',
      '10:921/79/1/1:000.100.200.110.120',
      '11:921/79/0/0:000.001.101.111',
      '12:921/79/0/0:000.100.101.111',
      '13:921/79/0/0:000.010.011.111',
      '14:780/66/0/0:000.100.200.110',
      '15:780/66/0/0:000.100.010.011',
      '16:921/79/0/0:000.010.020.110',
      '17:1248/105/0/0:000.100.200.201',
      '18:461/40/0/0:000.100.010.110',
      '19:921/79/0/0:000.100.200.300',
      '20:1402/118/0/0:000.100.110.111',
      '21:1379/131/0/0:000.100.101.111.011',
      '22:1379/131/0/0:000.010.011.111',
      '23:965/92/0/0:000.100.101.201',
      '24:965/92/0/0:000.001.011.111',
      '25:965/92/0/0:000.010.110.111',
      '26:1379/131/0/0:000.100.010.110.111',
      '27:1379/131/0/0:000.010.020.021',
      '28:1103/105/0/0:000.100.101.111',
      '29:1103/105/0/0:000.100.110.111',
      '30:1379/131/0/0:000.010.110.210',
      '31:1379/131/0/0:000.001.101.111',
      '32:552/53/0/0:000.100.110',
      '33:552/53/0/0:000.010.110',
      '34:552/53/0/0:000.100.200.010.110',
      '35:827/79/0/0:000.100.001.101',
      '36:461/40/0/0:000.001.101',
      '37:1103/105/0/0:000.100.101.110',
      '38:1103/105/0/0:000.010.110.111',
      '39:1103/105/0/0:000.100.200.210',
      '40:1379/131/0/0:000.001.101.111',
      '41:624/53/0/0:000.010.020',
      '42:461/40/0/0:000.010',
      '43:307/27/0/0:000.100.110',
      '44:921/79/0/0:000.010.110'
    ].join('|'));
  });

  it('keeps easy on the restored original shapes and hard on the accepted easier set', () => {
    const flat = summarizeCubeCounts('flat');
    const extended = summarizeCubeCounts('extended');

    expect(flat.average).toBe(3.375);
    expect(flat.bySize).toEqual({ 1: 1, 2: 1, 3: 2, 4: 2, 5: 2 });
    expect(extended.average).toBeCloseTo(3.66, 2);
    expect(extended.bySize).toEqual({ 1: 1, 2: 2, 3: 10, 4: 25, 5: 3 });
  });

  it('filters EASY and HARD sets by the custom difficulty flags', () => {
    const dimensions = { width: 5, height: 5 };

    expect(getEligiblePolyCubes(dimensions, 'flat').map((piece) => piece.id)).toEqual([
      0, 1, 2, 3, 4, 8, 9, 10
    ]);
    expect(getEligiblePolyCubes(dimensions, 'extended').map((piece) => piece.id)).toEqual([
      0, 1, 2, 3, 5, 6, 7, 11, 12, 13, 14, 15, 16, 17, 18, 19,
      20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33,
      34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44
    ]);
  });

  it('filters pieces by maximum dimension against the visible pit plane', () => {
    const ids = getEligiblePolyCubes({ width: 3, height: 3 }, 'extended').map((piece) => piece.id);

    expect(ids).not.toContain(19);
    expect(ids).not.toContain(4);
    expect(ids).toContain(41);
    expect(ids).toContain(40);
  });

  it('uses a high-contrast depth palette for the ice pit', () => {
    expect(BLOCKOUT_LAYER_COLORS).toEqual([
      0xff2d55,
      0xff8a1f,
      0xffc400,
      0x78d12f,
      0xb33cff,
      0xff3fb7,
      0x5b2a86
    ]);
  });

  it('keeps reflected depth colors separated from the ice wall color', () => {
    const iceWallColor = 0xb9e5ee;
    const reflectedColors = BLOCKOUT_LAYER_COLORS.map((color) => mixColorNumber(color, 0xffffff, 0.32));

    expect(reflectedColors.every((color) => colorDistance(color, iceWallColor) > 100)).toBe(true);
  });

  it('maps depth layers to the repeating high-contrast pit colors', () => {
    const depth = 12;
    const landingOutward = Array.from({ length: 8 }, (_, offset) =>
      getBlockOutLayerColor(depth, depth - 1 - offset)
    );

    expect(landingOutward).toEqual([
      ...BLOCKOUT_LAYER_COLORS,
      BLOCKOUT_LAYER_COLORS[0]
    ]);
  });
});

function catalogSignature(): string {
  return POLYCUBE_DEFINITIONS.map((definition) =>
    [
      definition.id,
      [
        definition.highScore,
        definition.lowScore,
        definition.isFlat ? 1 : 0,
        definition.isBasic ? 1 : 0
      ].join('/'),
      definition.cells.map((cell) => `${cell.x}${cell.y}${cell.z}`).join('.')
    ].join(':')
  ).join('|');
}

function summarizeCubeCounts(blockSet: BlockSet): {
  average: number;
  bySize: Record<number, number>;
} {
  const pieces = getEligiblePolyCubes({ width: 6, height: 6 }, blockSet);
  const bySize = pieces.reduce<Record<number, number>>((counts, piece) => {
    counts[piece.cells.length] = (counts[piece.cells.length] ?? 0) + 1;
    return counts;
  }, {});
  return {
    average: pieces.reduce((sum, piece) => sum + piece.cells.length, 0) / pieces.length,
    bySize
  };
}

function mixColorNumber(color: number, target: number, amount: number): number {
  const sourceRgb = numberToRgb(color);
  const targetRgb = numberToRgb(target);
  const mixed = sourceRgb.map((value, index) =>
    Math.round(value + (targetRgb[index] - value) * amount)
  );
  return (mixed[0] << 16) | (mixed[1] << 8) | mixed[2];
}

function colorDistance(color: number, target: number): number {
  const sourceRgb = numberToRgb(color);
  const targetRgb = numberToRgb(target);
  const squared = sourceRgb.map((value, index) => (value - targetRgb[index]) ** 2);
  return Math.sqrt(squared[0] + squared[1] + squared[2]);
}

function numberToRgb(color: number): [number, number, number] {
  return [(color >> 16) & 255, (color >> 8) & 255, color & 255];
}
