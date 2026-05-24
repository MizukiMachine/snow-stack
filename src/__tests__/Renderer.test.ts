import { describe, expect, it, vi } from 'vitest';
import {
  BoxGeometry,
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  Scene
} from 'three';
import { Renderer } from '../Renderer';
import { GameState, type SettledBlockSnapshot } from '../GameState';
import { getBlockOutLayerColor } from '../constants/blockout';
import { CELL_SIZE } from '../constants/field';

type RendererAccess = {
  hudState: {
    queue: readonly number[];
  };
  scene: Scene | null;
  assetsReady: boolean;
  assetTemplates: Map<string, Group>;
  createBlockMesh: (
    color: number,
    isActive: boolean,
    depthLayer?: number,
    settledAssetKey?: 'settledIceBlock'
  ) => Group;
  createFieldBounds: () => Group;
  createSnowWallTexture: () => CanvasTexture;
  syncDepthLayerGuide: (root: ParentNode) => void;
  syncQueue: (root: ParentNode) => void;
  syncHeldPiece: (root: ParentNode) => void;
  syncMission: (root: ParentNode) => void;
  createHudElement: () => HTMLDivElement;
  renderPolyCubePreview: (id: number, variant: 'queue' | 'hold') => string;
};

describe('Renderer BlockOut layer coloring', () => {
  it('renders the active falling block with a white wireframe and black backing edge', () => {
    const state = new GameState({ dimensions: { width: 5, height: 5, depth: 12 } });
    const renderer = new Renderer(state);

    const block = (renderer as unknown as RendererAccess).createBlockMesh(0xff0000, true, 0);
    const meshColors: number[] = [];
    block.traverse((child) => {
      if (!(child instanceof Mesh) || !(child.material instanceof MeshBasicMaterial)) {
        return;
      }
      meshColors.push(child.material.color.getHex());
    });

    expect(meshColors).toContain(0xffffff);
    expect(meshColors).toContain(0x000000);
  });

  it('renders settled blocks with depth-layer wire colors instead of piece colors', () => {
    const state = new GameState({ dimensions: { width: 5, height: 5, depth: 12 } });
    const renderer = new Renderer(state);
    const createBlockMesh = vi.fn<RendererAccess['createBlockMesh']>(() => new Group());
    const access = renderer as unknown as RendererAccess;
    access.scene = new Scene();
    access.createBlockMesh = createBlockMesh;

    const blocks: SettledBlockSnapshot[] = [
      {
        id: 0,
        label: 'P00',
        color: 0x123456,
        coordinate: { x: 1, y: 2, z: 11 }
      },
      {
        id: 1,
        label: 'P01',
        color: 0x654321,
        coordinate: { x: 2, y: 3, z: 10 }
      }
    ];

    renderer.updateSettledBlocks(blocks);

    expect(createBlockMesh).toHaveBeenNthCalledWith(
      1,
      getBlockOutLayerColor(12, 11),
      false,
      11,
      'settledIceBlock'
    );
    expect(createBlockMesh).toHaveBeenNthCalledWith(
      2,
      getBlockOutLayerColor(12, 10),
      false,
      10,
      'settledIceBlock'
    );
    expect(createBlockMesh.mock.calls.map(([color]) => color)).not.toContain(0x123456);
    expect(createBlockMesh.mock.calls.map(([color]) => color)).not.toContain(0x654321);
  });

  it('projects settled block reflections onto the inside ice walls', () => {
    const state = new GameState({ dimensions: { width: 5, height: 5, depth: 12 } });
    const renderer = new Renderer(state);
    const access = renderer as unknown as RendererAccess;
    const scene = new Scene();
    access.scene = scene;

    renderer.updateSettledBlocks([
      {
        id: 0,
        label: 'P00',
        color: 0x123456,
        coordinate: { x: 0, y: 0, z: 11 }
      }
    ]);

    const reflections = scene.getObjectByName('settled-block-reflections') as Group | undefined;
    const leftReflection = reflections?.getObjectByName(
      'left-wall-block-reflection'
    ) as Group | undefined;
    const rightReflection = reflections?.getObjectByName(
      'right-wall-block-reflection'
    ) as Group | undefined;
    const lowerReflection = reflections?.getObjectByName(
      'lower-wall-block-reflection'
    ) as Group | undefined;
    const landingReflection = reflections?.getObjectByName(
      'landing-wall-block-reflection'
    ) as Group | undefined;
    const fill = leftReflection?.children.find((child): child is Mesh => child instanceof Mesh);
    const farWallFill = rightReflection?.children.find((child): child is Mesh => child instanceof Mesh);

    expect(reflections).toBeDefined();
    expect(leftReflection).toBeDefined();
    expect(rightReflection).toBeDefined();
    expect(lowerReflection).toBeDefined();
    expect(landingReflection).toBeDefined();
    expect(leftReflection?.position.x).toBeGreaterThan(0);
    expect(leftReflection?.position.x).toBeLessThan(CELL_SIZE * 0.08);
    expect(leftReflection?.position.y).toBeCloseTo(CELL_SIZE * 0.5);
    expect(leftReflection?.position.z).toBeCloseTo(CELL_SIZE * 11.5);
    expect(leftReflection?.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(leftReflection?.scale.x).toBeCloseTo(1);
    expect(leftReflection?.scale.y).toBeCloseTo(1);
    expect(fill?.renderOrder).toBeLessThan(18);

    if (!fill || !(fill.material instanceof MeshBasicMaterial)) {
      throw new Error('Reflection fill should use MeshBasicMaterial');
    }

    const reflectionGeometry = fill.geometry as PlaneGeometry;
    expect(reflectionGeometry.parameters.width).toBeCloseTo(CELL_SIZE);
    expect(reflectionGeometry.parameters.height).toBeCloseTo(CELL_SIZE);
    expect(fill.material.transparent).toBe(true);
    expect(fill.material.depthTest).toBe(false);
    expect(fill.material.depthWrite).toBe(false);
    expect(fill.material.opacity).toBeCloseTo(0.18);
    if (!(farWallFill?.material instanceof MeshBasicMaterial)) {
      throw new Error('Far wall reflection fill should use MeshBasicMaterial');
    }
    expect(farWallFill.material.opacity).toBeCloseTo(fill.material.opacity);
  });

  it('keeps distant reflections the same size without fading their color or opacity', () => {
    const state = new GameState({ dimensions: { width: 5, height: 5, depth: 15 } });
    const renderer = new Renderer(state);
    const access = renderer as unknown as RendererAccess;
    const scene = new Scene();
    access.scene = scene;

    renderer.updateSettledBlocks([
      {
        id: 0,
        label: 'P00',
        color: 0x123456,
        coordinate: { x: 0, y: 0, z: 0 }
      },
      {
        id: 1,
        label: 'P01',
        color: 0x654321,
        coordinate: { x: 1, y: 1, z: 14 }
      }
    ]);

    const reflections = scene.getObjectByName('settled-block-reflections') as Group | undefined;
    const leftReflections =
      reflections?.children
        .filter((child): child is Group => child instanceof Group)
        .filter((child) => child.name === 'left-wall-block-reflection')
        .sort((a, b) => a.position.z - b.position.z) ?? [];
    const [nearReflection, farReflection] = leftReflections;
    const nearFill = nearReflection?.children.find((child): child is Mesh => child instanceof Mesh);
    const farFill = farReflection?.children.find((child): child is Mesh => child instanceof Mesh);

    expect(leftReflections).toHaveLength(2);
    expect(nearReflection?.scale.x).toBeCloseTo(1);
    expect(nearReflection?.scale.y).toBeCloseTo(1);
    expect(farReflection?.scale.x).toBeCloseTo(1);
    expect(farReflection?.scale.y).toBeCloseTo(1);

    if (
      !(nearFill?.material instanceof MeshBasicMaterial) ||
      !(farFill?.material instanceof MeshBasicMaterial)
    ) {
      throw new Error('Reflection fills should use MeshBasicMaterial');
    }

    expect(farFill.material.opacity).toBeCloseTo(nearFill.material.opacity);
    expect(farFill.material.depthTest).toBe(false);
    expect(nearFill.material.depthTest).toBe(false);
    expect(farFill.material.color.getHex()).toBe(nearFill.material.color.getHex());
    expect(nearFill.material.color.getHex()).toBe(getBlockOutLayerColor(15, 0));
  });

  it('does not stack reflection opacity for blocks sharing the same wall projection', () => {
    const state = new GameState({ dimensions: { width: 5, height: 5, depth: 12 } });
    const renderer = new Renderer(state);
    const access = renderer as unknown as RendererAccess;
    const scene = new Scene();
    access.scene = scene;

    renderer.updateSettledBlocks([
      {
        id: 0,
        label: 'P00',
        color: 0x123456,
        coordinate: { x: 0, y: 0, z: 11 }
      },
      {
        id: 1,
        label: 'P01',
        color: 0x654321,
        coordinate: { x: 0, y: 1, z: 11 }
      },
      {
        id: 2,
        label: 'P02',
        color: 0xabcdef,
        coordinate: { x: 0, y: 2, z: 11 }
      }
    ]);

    const reflections = scene.getObjectByName('settled-block-reflections') as Group | undefined;
    const upperReflections =
      reflections?.children
        .filter((child): child is Group => child instanceof Group)
        .filter((child) => child.name === 'upper-wall-block-reflection') ?? [];
    const upperFill = upperReflections[0]?.children.find(
      (child): child is Mesh => child instanceof Mesh
    );

    expect(upperReflections).toHaveLength(1);
    expect(upperReflections[0]?.position.x).toBeCloseTo(CELL_SIZE * 0.5);
    expect(upperReflections[0]?.position.z).toBeCloseTo(CELL_SIZE * 11.5);

    if (!(upperFill?.material instanceof MeshBasicMaterial)) {
      throw new Error('Upper wall reflection fill should use MeshBasicMaterial');
    }

    expect(upperFill.material.opacity).toBeCloseTo(0.18);
    expect(upperFill.material.color.getHex()).toBe(getBlockOutLayerColor(12, 11));
  });

  it('refreshes landing ghost and footprint groups from the active projection', () => {
    const state = new GameState({ dimensions: { width: 5, height: 5, depth: 6 } });
    state.spawnPolyCube(5);
    const renderer = new Renderer(state);
    const access = renderer as unknown as RendererAccess;
    const scene = new Scene();
    access.scene = scene;

    renderer.updateActivePolyCube(state.getActivePolyCube());

    const ghost = scene.getObjectByName('landing-ghost') as Group | undefined;
    const footprint = scene.getObjectByName('landing-footprint') as Group | undefined;
    expect(ghost?.children).toHaveLength(3);
    expect(footprint?.children).toHaveLength(3);
    expect(ghost?.children[0].position.x).toBe(3.5);
    expect(ghost?.children[0].position.z).toBe(5.5);

    state.moveActivePolyCube({ x: -1, y: 0, z: 0 });
    renderer.updateActivePolyCube(state.getActivePolyCube());

    const updatedGhost = scene.getObjectByName('landing-ghost') as Group | undefined;
    const updatedFootprint = scene.getObjectByName('landing-footprint') as Group | undefined;
    expect(updatedGhost).not.toBe(ghost);
    expect(updatedGhost?.children[0].position.x).toBe(2.5);
    expect(updatedFootprint?.children).toHaveLength(3);

    renderer.updateActivePolyCube(null);

    expect(scene.getObjectByName('landing-ghost')).toBeUndefined();
    expect(scene.getObjectByName('landing-footprint')).toBeUndefined();
  });

  it('keeps wall backing and guide grids off Cube World wall asset planes', () => {
    const dimensions = { width: 5, height: 5, depth: 12 };
    const state = new GameState({ dimensions });
    const renderer = new Renderer(state);
    vi.spyOn(renderer as unknown as RendererAccess, 'createSnowWallTexture').mockReturnValue(
      new CanvasTexture(document.createElement('canvas'))
    );

    const fieldBounds = (renderer as unknown as RendererAccess).createFieldBounds();
    const leftWall = fieldBounds.getObjectByName('left-wall-backing') as Mesh | undefined;
    const rightWall = fieldBounds.getObjectByName('right-wall-backing') as Mesh | undefined;
    const depthLanding = fieldBounds.getObjectByName('depth-landing-backing') as Mesh | undefined;

    expect(leftWall?.position.x).toBeLessThan(0);
    expect(rightWall?.position.x).toBeGreaterThan(dimensions.width * CELL_SIZE);
    expect(depthLanding?.position.z).toBeGreaterThan(dimensions.depth * CELL_SIZE);

    expect(readFirstPointCoordinate(fieldBounds, 'left-wall-guide-grid', 'x')).toBeGreaterThan(0);
    expect(readFirstPointCoordinate(fieldBounds, 'right-wall-guide-grid', 'x')).toBeLessThan(
      dimensions.width * CELL_SIZE
    );
    expect(readFirstPointCoordinate(fieldBounds, 'landing-guide-grid', 'z')).toBeLessThan(
      dimensions.depth * CELL_SIZE
    );
  });

  it('can preserve loaded Cube World templates across a setup reset', () => {
    const state = new GameState({ dimensions: { width: 5, height: 5, depth: 12 } });
    const renderer = new Renderer(state);
    const access = renderer as unknown as RendererAccess;
    const template = new Group();
    template.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));
    access.assetTemplates.set('wallIce', template);
    access.assetsReady = true;

    renderer.dispose({ preserveAssets: true });

    expect(access.assetTemplates.size).toBe(1);
    expect(access.assetsReady).toBe(true);

    renderer.dispose();

    expect(access.assetTemplates.size).toBe(0);
    expect(access.assetsReady).toBe(false);
  });

  it('shows only depth guide rows that already contain settled blocks', () => {
    const state = new GameState({ dimensions: { width: 5, height: 5, depth: 12 } });
    state.setCell({ x: 1, y: 1, z: 11 }, 0);
    state.setCell({ x: 2, y: 2, z: 9 }, 1);
    const renderer = new Renderer(state);
    const root = document.createElement('div');
    root.innerHTML = '<div data-role="layer-guide-list"></div>';

    (renderer as unknown as RendererAccess).syncDepthLayerGuide(root);

    const rows = Array.from(root.querySelectorAll<HTMLElement>('.layer-guide-row'));
    const guide = root.querySelector<HTMLElement>('[data-role="layer-guide-list"]');
    expect(root.dataset.depthLayers).toBe('2');
    expect(guide?.style.getPropertyValue('--layer-count')).toBe('12');
    expect(guide?.style.getPropertyValue('--layer-stack-height')).toBe('308px');
    expect(rows.map((row) => row.textContent)).toEqual(['03', '01']);
    expect(rows.map((row) => row.style.getPropertyValue('--layer-row'))).toEqual(['10', '12']);
    expect(root.querySelectorAll('.layer-guide-swatch')).toHaveLength(2);
    expect(root.querySelector('.layer-guide-mini')).toBeNull();
    expect(root.textContent).not.toContain('12');
    expect(root.textContent).not.toContain('02');
  });

  it('marks the depth guide as empty when no layers are occupied', () => {
    const state = new GameState({ dimensions: { width: 5, height: 5, depth: 12 } });
    const renderer = new Renderer(state);
    const root = document.createElement('div');
    root.innerHTML = '<div data-role="layer-guide-list"></div>';

    (renderer as unknown as RendererAccess).syncDepthLayerGuide(root);

    expect(root.dataset.depthLayers).toBe('0');
    expect(root.querySelector<HTMLElement>('[data-role="layer-guide-list"]')?.style.getPropertyValue('--layer-count')).toBe('12');
    expect(root.querySelectorAll('.layer-guide-row')).toHaveLength(0);
  });

  it('renders a held piece preview into the HUD slot', () => {
    const state = new GameState({ randomSeed: 1 });
    state.spawnPolyCube(0);
    state.swapHeldPiece();
    const renderer = new Renderer(state);
    const root = document.createElement('div');
    root.innerHTML = '<div data-role="hold-piece"></div>';

    (renderer as unknown as RendererAccess).syncHeldPiece(root);

    expect(root.querySelector('.poly-preview-hold')).not.toBeNull();
    expect(root.querySelector('.piece-preview-svg')).not.toBeNull();
    expect(root.querySelectorAll('.preview-cube')).toHaveLength(1);
    expect(root.querySelector('.poly-preview-hold')?.getAttribute('role')).toBe('img');
    expect(root.querySelector('.poly-preview-hold')?.getAttribute('aria-label')).toBe('P00');
  });

  it('renders sprint mission progress in the status pill', () => {
    const state = new GameState({ missionMode: 'plane-sprint' });
    const renderer = new Renderer(state);
    const root = document.createElement('div');
    root.innerHTML = `
      <div data-role="mission-pill" hidden>
        <span data-role="mission-label"></span>
        <div data-role="mission-progress"><span></span></div>
      </div>
    `;

    (renderer as unknown as RendererAccess).syncMission(root);

    expect(root.querySelector<HTMLElement>('[data-role="mission-pill"]')?.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('[data-role="mission-label"]')?.textContent).toBe('PLANE SPRINT');
    expect(root.querySelector<HTMLElement>('[data-role="mission-progress"] span')?.textContent).toBe('0/5 PLANES');
  });

  it('keeps double-cut unavailable while the flat block set is selected', () => {
    const state = new GameState();
    const renderer = new Renderer(state);
    const hud = (renderer as unknown as RendererAccess).createHudElement();
    const doubleCut = hud.querySelector<HTMLButtonElement>('[data-mission-mode="double-cut"]');
    const basic = hud.querySelector<HTMLButtonElement>('[data-block-set="basic"]');
    const flat = hud.querySelector<HTMLButtonElement>('[data-block-set="flat"]');
    const endless = hud.querySelector<HTMLButtonElement>('[data-mission-mode="endless"]');

    expect(doubleCut?.disabled).toBe(true);

    basic?.click();
    expect(doubleCut?.disabled).toBe(false);

    doubleCut?.click();
    expect(doubleCut?.classList.contains('is-active')).toBe(true);

    flat?.click();
    expect(doubleCut?.disabled).toBe(true);
    expect(doubleCut?.classList.contains('is-active')).toBe(false);
    expect(endless?.classList.contains('is-active')).toBe(true);
  });

  it('builds polycube preview markup with one cell per cube', () => {
    const state = new GameState();
    const renderer = new Renderer(state);
    const html = (renderer as unknown as RendererAccess).renderPolyCubePreview(5, 'queue');
    const root = document.createElement('div');
    root.innerHTML = html;

    expect(root.querySelector('.poly-preview-queue')).not.toBeNull();
    expect(root.querySelector('.piece-preview-svg')).not.toBeNull();
    expect(root.querySelectorAll('.preview-cube')).toHaveLength(3);
    expect(root.querySelector('.poly-preview-queue')?.getAttribute('role')).toBe('img');
    expect(root.querySelector('.poly-preview-queue')?.getAttribute('aria-label')).toBe('P05');
  });

  it('renders only the next queued piece in the HUD queue slot', () => {
    const state = new GameState();
    const renderer = new Renderer(state);
    const access = renderer as unknown as RendererAccess;
    const root = document.createElement('div');
    root.innerHTML = '<div data-role="queue-list"><span>--</span></div>';

    access.hudState.queue = [5, 0, 21];
    access.syncQueue(root);

    expect(root.querySelectorAll('.poly-preview-queue')).toHaveLength(1);
    expect(root.querySelector('.poly-preview-queue')?.getAttribute('aria-label')).toBe('P05');
    expect(root.querySelectorAll('.preview-cube')).toHaveLength(3);

    access.hudState.queue = [];
    access.syncQueue(root);

    expect(root.querySelector('.poly-preview-queue')).toBeNull();
    expect(root.querySelector('.is-empty')?.textContent).toBe('--');
  });

  it('builds SVG previews from current multi-depth polycube cells', () => {
    const state = new GameState();
    const renderer = new Renderer(state);
    const html = (renderer as unknown as RendererAccess).renderPolyCubePreview(21, 'queue');
    const root = document.createElement('div');
    root.innerHTML = html;

    const svg = root.querySelector<SVGElement>('.piece-preview-svg');
    expect(root.querySelectorAll('.preview-cube')).toHaveLength(5);
    expect(svg?.getAttribute('viewBox')?.split(' ')).toHaveLength(4);
  });
});

function readFirstPointCoordinate(root: Group, name: string, axis: 'x' | 'z'): number {
  const group = root.getObjectByName(name) as Group | undefined;
  const points = group?.children.find((child): child is Points => child instanceof Points);
  const attribute = points?.geometry.getAttribute('position');
  if (!attribute) {
    throw new Error(`Guide grid ${name} has no point positions`);
  }
  return axis === 'x' ? attribute.getX(0) : attribute.getZ(0);
}
