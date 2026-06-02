import { describe, expect, it } from 'vitest';
import {
  BLOCKOUT_LAYER_COLORS,
  getEligiblePolyCubes,
  getBlockOutLayerColor,
  getPolyCubeDefinition,
  POLYCUBE_DEFINITIONS
} from '../constants/blockout';

describe('custom polycube catalog', () => {
  it('defines the complete custom 41-piece polycube set', () => {
    expect(POLYCUBE_DEFINITIONS).toHaveLength(41);
    expect(getPolyCubeDefinition(0).cells).toEqual([{ x: 0, y: 0, z: 0 }]);
    expect(getPolyCubeDefinition(40).cells).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 1, z: 1 },
      { x: 1, y: 1, z: 1 },
      { x: 1, y: 1, z: 2 }
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
      '6:156/14/0/1:000.010.110.111',
      '7:461/40/0/1:000.100.200.101',
      '8:461/40/1/1:000.100.010.110',
      '9:307/27/1/1:000.100.110.210',
      '10:921/79/1/1:000.100.200.110.120',
      '11:921/79/0/0:000.001.101.111',
      '12:921/79/0/0:000.100.101.111',
      '13:921/79/0/0:000.010.011.111',
      '14:780/66/0/0:000.100.200.201',
      '15:780/66/0/0:000.100.110.111.011',
      '16:921/79/0/0:000.010.020.120.121',
      '17:1248/105/0/0:000.100.200.110.111',
      '18:461/40/0/0:000.100.010.110.111',
      '19:921/79/0/0:000.100.200.300.301',
      '20:1402/118/0/0:000.100.110.210.211',
      '21:1379/131/0/0:000.100.101.111.011',
      '22:1379/131/0/0:000.010.011.111.211',
      '23:965/92/0/0:000.100.101.201.211',
      '24:965/92/0/0:000.001.011.111.121',
      '25:965/92/0/0:000.010.110.111.112',
      '26:1379/131/0/0:000.100.200.201.202',
      '27:1379/131/0/0:000.010.020.021.121',
      '28:1103/105/0/0:000.100.101.111.211',
      '29:1103/105/0/0:000.100.110.011.111',
      '30:1379/131/0/0:000.010.110.210.211',
      '31:1379/131/0/0:000.001.101.111.112',
      '32:552/53/0/0:000.100.200.210.211',
      '33:552/53/0/0:000.100.010.020.120',
      '34:552/53/0/0:000.100.200.010.110',
      '35:827/79/0/0:000.100.001.002.102',
      '36:461/40/0/0:000.001.101.201.211',
      '37:1103/105/0/0:000.100.101.111.121',
      '38:1103/105/0/0:000.010.110.111.211',
      '39:1103/105/0/0:000.100.200.201.211',
      '40:1379/131/0/0:000.010.011.111.112'
    ].join('|'));
  });

  it('filters FLAT, BASIC, and EXTENDED sets by the custom difficulty flags', () => {
    const dimensions = { width: 5, height: 5 };

    expect(getEligiblePolyCubes(dimensions, 'flat').map((piece) => piece.id)).toEqual([
      0, 1, 2, 3, 4, 8, 9, 10
    ]);
    expect(getEligiblePolyCubes(dimensions, 'basic').map((piece) => piece.id)).toEqual([
      2, 5, 6, 7, 8, 9, 10
    ]);
    expect(getEligiblePolyCubes(dimensions, 'extended')).toHaveLength(41);
  });

  it('filters pieces by maximum dimension against the visible pit plane', () => {
    const ids = getEligiblePolyCubes({ width: 3, height: 3 }, 'extended').map((piece) => piece.id);

    expect(ids).not.toContain(19);
    expect(ids).toContain(4);
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
