import type {
  CoordinateSystemDescription,
  GridVector3,
  WorldVector3,
} from '../types/coordinates';

/**
 * Logical dimensions of the play field measured in whole grid cells.
 */
export const FIELD_DIMENSIONS = Object.freeze({
  width: 6,
  height: 6,
  depth: 9,
});

/**
 * Length of a single grid cell edge in world units (meters) for the Three.js scene.
 */
export const CELL_SIZE = 1;

const HALF_CELL = CELL_SIZE / 2;
const HALF_WIDTH = (FIELD_DIMENSIONS.width * CELL_SIZE) / 2;
const HALF_DEPTH = (FIELD_DIMENSIONS.depth * CELL_SIZE) / 2;

/**
 * Shared description of the BlockOut pit coordinate system. Semantic up/down
 * follows the fall axis, not the Three.js screen-vertical y axis.
 *
 * - +X: right, -X: left
 * - +Y: higher on the camera-facing pit face, -Y: lower on that face
 * - +Z: deeper into the pit toward the landing ground, -Z: sky/entry toward the camera
 */
export const COORDINATE_SYSTEM: CoordinateSystemDescription = Object.freeze({
  up: 'z-',
  down: 'z+',
  left: 'x-',
  right: 'x+',
  forward: 'z-',
  backward: 'z+',
});

/**
 * The minimum world-space corner (left, low-y, sky-side) of the field's bounding box.
 */
export const FIELD_MIN_CORNER: WorldVector3 = Object.freeze({
  x: -HALF_WIDTH,
  y: 0,
  z: -HALF_DEPTH,
});

/**
 * The maximum world-space corner (right, high-y, landing-ground side) of the field's bounding box.
 */
export const FIELD_MAX_CORNER: WorldVector3 = Object.freeze({
  x: HALF_WIDTH,
  y: FIELD_DIMENSIONS.height * CELL_SIZE,
  z: HALF_DEPTH,
});

/**
 * World-space position of the center of the grid cell located at (0, 0, 0).
 */
export const GRID_ORIGIN: WorldVector3 = Object.freeze({
  x: FIELD_MIN_CORNER.x + HALF_CELL,
  y: FIELD_MIN_CORNER.y + HALF_CELL,
  z: FIELD_MIN_CORNER.z + HALF_CELL,
});

/**
 * Converts grid-space coordinates (indexed from the sky-side left low-y corner) to world-space.
 */
export function gridToWorld(grid: GridVector3): WorldVector3 {
  return {
    x: GRID_ORIGIN.x + grid.x * CELL_SIZE,
    y: GRID_ORIGIN.y + grid.y * CELL_SIZE,
    z: GRID_ORIGIN.z + grid.z * CELL_SIZE,
  };
}

/**
 * Converts a world-space coordinate into grid-space. The result is not rounded to
 * the nearest integer so callers can decide how to handle interpolation.
 */
export function worldToGrid(world: WorldVector3): GridVector3 {
  return {
    x: (world.x - GRID_ORIGIN.x) / CELL_SIZE,
    y: (world.y - GRID_ORIGIN.y) / CELL_SIZE,
    z: (world.z - GRID_ORIGIN.z) / CELL_SIZE,
  };
}
