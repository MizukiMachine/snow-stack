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
import { getBlockOutLayerColor, POLYCUBE_DEFINITIONS } from '../constants/blockout';
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
  createDepthLandingGlow: () => Group;
  createFieldBounds: () => Group;
  createSnowWallTexture: () => CanvasTexture;
  syncDepthLayerGuide: (root: ParentNode) => void;
  syncQueue: (root: ParentNode) => void;
  syncHeldPiece: (root: ParentNode) => void;
  syncMission: (root: ParentNode) => void;
  collectSetupValues: (root: ParentNode) => unknown;
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
    expect(footprint?.children[0].position.z).toBeCloseTo(6 - 0.018);

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

  it('places the landing footprint on top of the first settled blocking surface', () => {
    const state = new GameState({ dimensions: { width: 5, height: 5, depth: 6 } });
    state.setCell({ x: 4, y: 0, z: 5 }, 0);
    state.spawnPolyCube(0);
    const renderer = new Renderer(state);
    const access = renderer as unknown as RendererAccess;
    const scene = new Scene();
    access.scene = scene;

    renderer.updateActivePolyCube(state.getActivePolyCube());

    const ghost = scene.getObjectByName('landing-ghost') as Group | undefined;
    const footprint = scene.getObjectByName('landing-footprint') as Group | undefined;
    const marker = footprint?.children[0] as Group | undefined;
    const fill = marker?.children[0] as Mesh | undefined;
    const whiteFrame = marker?.children[1] as Group | undefined;
    const whiteFrameMeshes: Mesh[] = [];
    whiteFrame?.traverse((child) => {
      if (child instanceof Mesh) {
        whiteFrameMeshes.push(child);
      }
    });
    expect(ghost?.children[0].position.z).toBeCloseTo(4.5);
    expect(footprint?.children[0].position.z).toBeCloseTo(5 - 0.018);
    expect(fill?.renderOrder).toBeGreaterThan(36);
    expect(fill?.renderOrder).toBeLessThan(41);
    expect(marker?.children).toHaveLength(2);
    expect(whiteFrameMeshes).toHaveLength(4);
    expect(whiteFrameMeshes[0]?.renderOrder).toBeGreaterThan(fill?.renderOrder ?? 0);

    if (!(fill?.material instanceof MeshBasicMaterial)) {
      throw new Error('Footprint fill should use MeshBasicMaterial');
    }
    if (!(whiteFrameMeshes[0]?.material instanceof MeshBasicMaterial)) {
      throw new Error('Footprint wire should use MeshBasicMaterial');
    }
    const fillGeometry = fill.geometry as PlaneGeometry;
    expect(fillGeometry.parameters.width).toBeCloseTo(CELL_SIZE * 0.82);
    expect(fillGeometry.parameters.height).toBeCloseTo(CELL_SIZE * 0.82);
    expect(whiteFrameMeshes[0].scale.x).toBeCloseTo(CELL_SIZE * 1.01);
    expect(whiteFrameMeshes[0].scale.y).toBeCloseTo(CELL_SIZE * 0.064);
    expect(Math.abs(whiteFrameMeshes[0].position.y) + whiteFrameMeshes[0].scale.y / 2).toBeCloseTo(
      (CELL_SIZE * 1.01) / 2
    );
    expect(whiteFrameMeshes[0].material.color.getHex()).toBe(0xffffff);
    expect(fill.material.depthTest).toBe(false);
    expect(whiteFrameMeshes[0].material.depthTest).toBe(false);
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

  it('marks the depth landing with a rectangular inner perimeter instead of a circle', () => {
    const state = new GameState({ dimensions: { width: 5, height: 5, depth: 9 } });
    const renderer = new Renderer(state);
    const perimeter = (renderer as unknown as RendererAccess).createDepthLandingGlow();
    const lowerLine = perimeter.getObjectByName(
      'depth-landing-inner-perimeter-line-lower'
    ) as Mesh | undefined;
    const upperLine = perimeter.getObjectByName(
      'depth-landing-inner-perimeter-line-upper'
    ) as Mesh | undefined;
    const leftLine = perimeter.getObjectByName(
      'depth-landing-inner-perimeter-line-left'
    ) as Mesh | undefined;
    const rightLine = perimeter.getObjectByName(
      'depth-landing-inner-perimeter-line-right'
    ) as Mesh | undefined;

    expect(perimeter.name).toBe('depth-landing-inner-perimeter');
    expect(perimeter.children).toHaveLength(8);
    expect(
      perimeter.children.some(
        (child) => child instanceof Mesh && child.geometry.type === 'RingGeometry'
      )
    ).toBe(false);
    expect(lowerLine?.scale.x).toBeGreaterThan(CELL_SIZE * 4.9);
    expect(upperLine?.scale.x).toBeCloseTo(lowerLine?.scale.x ?? 0);
    expect(leftLine?.scale.y).toBeGreaterThan(CELL_SIZE * 4.9);
    expect(rightLine?.scale.y).toBeCloseTo(leftLine?.scale.y ?? 0);
    expect(lowerLine?.position.z).toBeGreaterThan(CELL_SIZE * 4.45);
    expect(lowerLine?.position.z).toBeLessThan(CELL_SIZE * 4.5);
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

  it('does not expose pit dimension controls in the setup form', () => {
    const state = new GameState({ dimensions: { width: 5, height: 5, depth: 10 } });
    const renderer = new Renderer(state);
    const access = renderer as unknown as RendererAccess;
    const hud = access.createHudElement();

    expect(hud.querySelector('[data-setup-field="width"]')).toBeNull();
    expect(hud.querySelector('[data-setup-field="height"]')).toBeNull();
    expect(hud.querySelector('[data-setup-field="depth"]')).toBeNull();
    expect(hud.querySelector('[data-setup-field="startLevel"]')).toBeNull();
    expect(access.collectSetupValues(hud)).not.toHaveProperty('dimensions');
    expect(access.collectSetupValues(hud)).toHaveProperty('startLevel', 0);
  });

  it('does not render fixed pit size or level as player-facing metrics', () => {
    const renderer = new Renderer(new GameState());
    const hud = (renderer as unknown as RendererAccess).createHudElement();
    const metricCards = Array.from(hud.querySelectorAll<HTMLElement>('.telemetry-stack .metric-card'));

    expect(hud.querySelector('[data-role="pit-size"]')).toBeNull();
    expect(hud.querySelector('[data-role="level"]')).toBeNull();
    expect(hud.querySelector('[data-role="level-meter"]')).toBeNull();
    expect(hud.querySelector('[data-role="overlay-level"]')).toBeNull();
    expect(metricCards.some((card) => card.textContent?.includes('ピット'))).toBe(false);
    expect(metricCards.some((card) => card.textContent?.includes('レベル'))).toBe(false);
    expect(hud.querySelector('[data-role="overlay"]')?.textContent).not.toContain('到達レベル');
  });

  it('lays out difficulty and rule choices as setup panels', () => {
    const renderer = new Renderer(new GameState());
    const hud = (renderer as unknown as RendererAccess).createHudElement();
    const missionControl = hud.querySelector('[data-role="mission-mode-control"]');

    expect(hud.querySelector('[data-role="block-set-control"]')?.parentElement?.textContent).toContain(
      '難易度'
    );
    expect(hud.querySelector('[data-role="block-set"]')?.textContent).toBe('易しい');
    expect(hud.querySelectorAll('[data-role="block-set-control"] .setup-choice')).toHaveLength(3);
    expect(missionControl?.querySelectorAll('.setup-choice')).toHaveLength(5);
    expect(hud.querySelector('[data-mission-mode="endless"]')).toBeNull();
    expect(hud.querySelector('[data-mission-mode="cube-trial"]')?.textContent).toBe('120ブロック');
    expect(hud.querySelector('[data-block-set="flat"]')?.textContent).toBe('易しい');
    expect(hud.querySelector('[data-block-set="basic"]')?.textContent).toBe('普通');
    expect(hud.querySelector('[data-block-set="extended"]')?.textContent).toBe('難しい');
    expect(missionControl?.textContent).not.toContain('エンドレス');
    expect(missionControl?.textContent).not.toContain('120キューブ');
    expect(hud.textContent).not.toContain('ピースセット');
    expect(hud.textContent).not.toContain('開始レベル');
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

  it('leaves the hold slot blank when no piece is held', () => {
    const renderer = new Renderer(new GameState());
    const hud = (renderer as unknown as RendererAccess).createHudElement();
    const hold = hud.querySelector<HTMLElement>('[data-role="hold-piece"]');

    expect(hold?.textContent).toBe('');

    if (hold) {
      hold.innerHTML = '<span class="is-empty">--</span>';
    }

    (renderer as unknown as RendererAccess).syncHeldPiece(hud);

    expect(hold?.textContent).toBe('');
    expect(hold?.querySelector('.is-empty')).toBeNull();
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
    expect(root.querySelector<HTMLElement>('[data-role="mission-label"]')?.textContent).toBe('5面スプリント');
    expect(root.querySelector<HTMLElement>('[data-role="mission-progress"] span')?.textContent).toBe('0/5面');
  });

  it('hides the game-over overlay while the rule selection screen is open', () => {
    const state = new GameState();
    state.endGame();
    const renderer = new Renderer(state);
    const hud = (renderer as unknown as RendererAccess).createHudElement();

    renderer.updateHud(
      [],
      'game-over',
      0,
      0,
      state.getLevel(),
      state.getDropIntervalMs(),
      0,
      false,
      false,
      true
    );

    expect(hud.querySelector<HTMLElement>('[data-role="overlay"]')?.hidden).toBe(true);
    expect(hud.querySelector<HTMLElement>('[data-role="status-label"]')?.textContent).toBe(
      'ルール選択'
    );
  });

  it('updates the footer mission description from the rule selection buttons', () => {
    const state = new GameState();
    const renderer = new Renderer(state);
    const hud = (renderer as unknown as RendererAccess).createHudElement();

    renderer.updateHud(
      [],
      'running',
      0,
      0,
      state.getLevel(),
      state.getDropIntervalMs(),
      0,
      false,
      false,
      true
    );
    hud.querySelector<HTMLButtonElement>('[data-mission-mode="score-rush"]')?.click();

    expect(hud.querySelector<HTMLElement>('[data-role="footer-tip"]')?.textContent).toBe(
      'スコアラッシュ: スコア2,000点に到達する。'
    );

    hud.querySelector<HTMLButtonElement>('[data-mission-mode="cube-trial"]')?.click();

    expect(hud.querySelector<HTMLElement>('[data-role="footer-tip"]')?.textContent).toBe(
      'ブロックトライアル: ブロックを合計120個配置する。'
    );
  });

  it('keeps double-cut selectable while the easy difficulty is selected', () => {
    const state = new GameState();
    const renderer = new Renderer(state);
    const hud = (renderer as unknown as RendererAccess).createHudElement();
    const doubleCut = hud.querySelector<HTMLButtonElement>('[data-mission-mode="double-cut"]');
    const flat = hud.querySelector<HTMLButtonElement>('[data-block-set="flat"]');

    expect(doubleCut?.disabled).toBe(false);

    doubleCut?.click();
    expect(doubleCut?.classList.contains('is-active')).toBe(true);

    flat?.click();
    expect(doubleCut?.disabled).toBe(false);
    expect(doubleCut?.classList.contains('is-active')).toBe(true);
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

  it('keeps connected 3D preview cells in one projected cluster', () => {
    const state = new GameState();
    const renderer = new Renderer(state);
    const root = document.createElement('div');

    POLYCUBE_DEFINITIONS.forEach((definition) => {
      root.innerHTML = (renderer as unknown as RendererAccess).renderPolyCubePreview(
        definition.id,
        'queue'
      );
      const blockSize = Number(
        root.querySelector<SVGRectElement>('.preview-cube-front')?.getAttribute('width')
      );
      const anchors = new Map(
        Array.from(root.querySelectorAll<SVGGElement>('.preview-cube')).map((cube) => [
          cube.dataset.cell,
          {
            x: Number(cube.dataset.anchorX),
            y: Number(cube.dataset.anchorY)
          }
        ])
      );
      let checkedPairs = 0;

      definition.cells.forEach((cell, index) => {
        definition.cells.slice(index + 1).forEach((nextCell) => {
          const cellDistance =
            Math.abs(cell.x - nextCell.x) +
            Math.abs(cell.y - nextCell.y) +
            Math.abs(cell.z - nextCell.z);

          if (cellDistance !== 1) {
            return;
          }

          const cellKey = `${cell.x},${cell.y},${cell.z}`;
          const nextCellKey = `${nextCell.x},${nextCell.y},${nextCell.z}`;
          const anchor = anchors.get(cellKey);
          const nextAnchor = anchors.get(nextCellKey);

          expect(anchor, `${definition.label} ${cellKey} preview anchor`).toBeDefined();
          expect(nextAnchor, `${definition.label} ${nextCellKey} preview anchor`).toBeDefined();
          const projectedGap = Math.hypot(
            (anchor?.x ?? 0) - (nextAnchor?.x ?? 0),
            (anchor?.y ?? 0) - (nextAnchor?.y ?? 0)
          );
          expect(
            projectedGap,
            `${definition.label} ${cellKey} to ${nextCellKey} preview gap`
          ).toBeLessThanOrEqual(blockSize);
          checkedPairs += 1;
        });
      });

      if (definition.cells.length > 1) {
        expect(checkedPairs, `${definition.label} connected preview pairs`).toBeGreaterThan(0);
      }
    });
  });

  it('draws vertical preview stacks from bottom to top', () => {
    const state = new GameState();
    const renderer = new Renderer(state);
    const root = document.createElement('div');
    let checkedStacks = 0;

    POLYCUBE_DEFINITIONS.forEach((definition) => {
      root.innerHTML = (renderer as unknown as RendererAccess).renderPolyCubePreview(
        definition.id,
        'queue'
      );
      const drawIndexes = new Map(
        Array.from(root.querySelectorAll<SVGGElement>('.preview-cube')).map((cube, index) => [
          cube.dataset.cell,
          index
        ])
      );

      definition.cells.forEach((cell) => {
        const upperCell = definition.cells.find(
          (nextCell) =>
            nextCell.x === cell.x && nextCell.y === cell.y + 1 && nextCell.z === cell.z
        );

        if (!upperCell) {
          return;
        }

        const cellKey = `${cell.x},${cell.y},${cell.z}`;
        const upperCellKey = `${upperCell.x},${upperCell.y},${upperCell.z}`;
        expect(
          drawIndexes.get(cellKey),
          `${definition.label} ${cellKey} lower preview draw index`
        ).toBeLessThan(drawIndexes.get(upperCellKey) ?? -1);
        checkedStacks += 1;
      });
    });

    expect(checkedStacks).toBeGreaterThan(0);
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
