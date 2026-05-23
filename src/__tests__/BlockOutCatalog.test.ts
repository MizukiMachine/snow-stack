import { describe, expect, it } from 'vitest';
import {
  getEligiblePolyCubes,
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
});
