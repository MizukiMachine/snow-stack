import { describe, expect, it } from 'vitest';
import {
  BLOCKOUT_LAYER_COLORS,
  getEligiblePolyCubes,
  getBlockOutLayerColor,
  getPolyCubeDefinition,
  POLYCUBE_DEFINITIONS
} from '../constants/blockout';

describe('BlockOut polycube catalog', () => {
  it('ports all 41 BlockOut II polycubes', () => {
    expect(POLYCUBE_DEFINITIONS).toHaveLength(41);
    expect(getPolyCubeDefinition(0).cells).toEqual([{ x: 0, y: 0, z: 0 }]);
    expect(getPolyCubeDefinition(40).cells).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 1, z: 1 },
      { x: 1, y: 1, z: 1 }
    ]);
  });

  it('keeps every BlockOut II polycube score, set flag, and cube coordinate aligned', () => {
    expect(catalogSignature()).toBe([
      '0:156/14/1/0:000',
      '1:156/14/1/0:000.010',
      '2:307/27/1/0:000.010.020',
      '3:307/27/0/0:000.010.020.030',
      '4:624/53/0/0:000.010.020.030.040',
      '5:307/27/1/1:000.100.110',
      '6:156/14/1/0:000.100.010.110',
      '7:461/40/1/1:000.100.200.110',
      '8:461/40/1/1:100.200.010.110',
      '9:307/27/1/1:000.100.200.210',
      '10:921/79/0/0:000.100.200.210.220',
      '11:921/79/0/0:200.010.110.210.220',
      '12:921/79/0/0:200.010.110.210.120',
      '13:921/79/0/0:100.200.110.020.120',
      '14:780/66/0/0:000.100.110.210.220',
      '15:780/66/0/0:000.100.110.120.130',
      '16:921/79/0/0:100.010.110.120.130',
      '17:1248/105/0/0:000.100.110.120.020',
      '18:461/40/0/0:000.100.010.110.120',
      '19:921/79/0/0:100.110.010.020.030',
      '20:1402/118/0/0:100.010.110.210.120',
      '21:1379/131/0/0:000.001.101.111.121',
      '22:1379/131/0/0:100.001.101.011.021',
      '23:965/92/0/0:010.011.101.111.121',
      '24:965/92/0/0:110.101.111.121.021',
      '25:965/92/0/0:110.001.101.111.121',
      '26:1379/131/0/0:100.101.111.011.021',
      '27:1379/131/0/0:000.001.011.111.121',
      '28:1103/105/0/0:110.120.001.011.111',
      '29:1103/105/0/0:010.020.101.111.011',
      '30:1379/131/0/0:100.101.111.121.021',
      '31:1379/131/0/0:000.001.011.021.121',
      '32:552/53/0/1:100.101.001.011',
      '33:552/53/0/1:100.101.011.111',
      '34:552/53/0/1:100.001.101.111',
      '35:827/79/0/0:110.011.111.101.121',
      '36:461/40/0/0:100.001.101.011.111',
      '37:1103/105/0/0:100.001.101.111.121',
      '38:1103/105/0/0:100.110.011.111.121',
      '39:1103/105/0/0:110.120.101.111.011',
      '40:1379/131/0/0:000.110.001.011.111'
    ].join('|'));
  });

  it('filters FLAT, BASIC, and EXTENDED sets like BlockOut', () => {
    const dimensions = { width: 5, height: 5 };

    expect(getEligiblePolyCubes(dimensions, 'flat').map((piece) => piece.id)).toEqual([
      0, 1, 2, 5, 6, 7, 8, 9
    ]);
    expect(getEligiblePolyCubes(dimensions, 'basic').map((piece) => piece.id)).toEqual([
      5, 7, 8, 9, 32, 33, 34
    ]);
    expect(getEligiblePolyCubes(dimensions, 'extended')).toHaveLength(41);
  });

  it('filters pieces by maximum dimension against the visible pit plane', () => {
    const ids = getEligiblePolyCubes({ width: 3, height: 3 }, 'extended').map((piece) => piece.id);

    expect(ids).not.toContain(3);
    expect(ids).not.toContain(4);
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
