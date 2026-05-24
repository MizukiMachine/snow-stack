import { describe, expect, it, vi } from 'vitest';
import { Group, Mesh, MeshBasicMaterial, Scene } from 'three';
import { Renderer } from '../Renderer';
import { GameState, type SettledBlockSnapshot } from '../GameState';
import { getBlockOutLayerColor } from '../constants/blockout';

type RendererAccess = {
  hudState: {
    queue: readonly number[];
  };
  scene: Scene | null;
  createBlockMesh: (
    color: number,
    isActive: boolean,
    depthLayer?: number,
    settledAssetKey?: 'settledIceBlock'
  ) => Group;
  syncDepthLayerGuide: (root: ParentNode) => void;
  syncQueue: (root: ParentNode) => void;
  syncHeldPiece: (root: ParentNode) => void;
  syncMission: (root: ParentNode) => void;
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
    expect(root.querySelector<HTMLElement>('[data-role="mission-progress"] span')?.textContent).toBe('0/5');
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
