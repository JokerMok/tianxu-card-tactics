import {
  assetManager, Button, Color, Graphics, HorizontalTextAlignment, ImageAsset, Label, Layers, Node, resources,
  Sprite, SpriteFrame, Texture2D, UITransform, VerticalTextAlignment, Mask,
} from 'cc';

type Attributes = Record<string, string>;

export interface OriginalUiElement {
  kind: string;
  id?: string;
  name?: string;
  xy?: [number, number];
  size?: [number, number];
  attributes: Attributes;
  children?: OriginalUiElement[];
}
export interface OriginalUiComponent {
  key: string;
  id: string;
  name: string;
  packageId: string;
  package: string;
  size: [number, number];
  attributes: Attributes;
  children: OriginalUiElement[];
  controllers: OriginalUiElement[];
  relations: OriginalUiElement[];
  transitions: OriginalUiElement[];
  settings: OriginalUiElement[];
  source: string;
}

export interface OriginalUiImage {
  id: string;
  packageId: string;
  package: string;
  name: string;
  size: [number, number];
  resourcePath: string;
  file: string;
  source: string;
  sha256: string;
}

export interface OriginalSkin {
  name: string;
  path?: string;
  width?: number;
  height?: number;
  sourceId?: string;
  file?: string;
  container?: string;
  resolution: string;
  variants: Record<string, { resourcePath: string; file: string; width?: number; height?: number }>;
}

export interface OriginalUiCatalog {
  version: 1;
  sourceManifest: '5254333315581813739';
  coordinateSystem: { source: string; designSize: [number, number] };
  fairygui: {
    roots: string[];
    aliases: Record<string, string>;
    components: Record<string, OriginalUiComponent>;
    images: Record<string, OriginalUiImage>;
    missingReferences: Array<{ owner: string; packageId: string; resourceId: string }>;
  };
  skins: Record<string, OriginalSkin>;
}

export interface OriginalUiMount {
  readonly node: Node;
  readonly sourceKey: string;
  child(nameOrIdOrPath: string): Node | null;
  requireChild(nameOrIdOrPath: string): Node;
  on(nameOrIdOrPath: string, event: string, handler: (...args: unknown[]) => void, target?: unknown): () => void;
  setText(nameOrIdOrPath: string, value: string | number): void;
  setVisible(nameOrIdOrPath: string, visible: boolean): void;
  setProgress(nameOrIdOrPath: string, value: number, max?: number): void;
  setSkin(nameOrIdOrPath: string, skin: string, containerVariant?: string): Promise<void>;
  setController(name: string, page: string | number): Promise<void>;
}

interface NodeSource {
  attributes: Attributes;
  id?: string;
  name?: string;
  kind: string;
  componentKey?: string;
  sourceWidth: number;
  sourceHeight: number;
  sourceX: number;
  sourceY: number;
  runtimeWidth: number;
  runtimeHeight: number;
  runtimeX: number;
  runtimeY: number;
  autoSize: boolean;
}

interface NodeVisibility {
  manual: boolean;
  gear: boolean;
  groupId?: string;
  scope: ComponentScope;
}

interface ControllerRuntime {
  source: OriginalUiElement;
  selected: string;
}

interface GearBinding {
  node: Node;
  gear: OriginalUiElement;
}

interface ComponentScope {
  root: Node;
  componentSize: [number, number];
  children: OriginalUiElement[];
  rootRelations: OriginalUiElement[];
  nodesById: Map<string, Node>;
  nodes: Node[];
  controllers: Map<string, ControllerRuntime>;
  gears: GearBinding[];
}

interface MountContext { parent: Node; scopes: ComponentScope[] }

const URI = /^ui:\/\/([A-Za-z0-9]{8})(.+)$/;

function parsePair(value?: string, fallback: [number, number] = [0, 0]): [number, number] {
  if (!value) return fallback;
  const values = value.split(',').slice(0, 2).map(Number);
  return values.length === 2 && values.every(Number.isFinite) ? [values[0], values[1]] as [number, number] : fallback;
}

function parseColor(value?: string, fallback = Color.WHITE): Color {
  if (!value?.startsWith('#')) return new Color(fallback.r, fallback.g, fallback.b, fallback.a);
  const hex = value.slice(1);
  if (hex.length === 6) return new Color(parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), 255);
  // FairyGUI serializes 8 digit colors as AARRGGBB.
  if (hex.length === 8) return new Color(parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), parseInt(hex.slice(6, 8), 16), parseInt(hex.slice(0, 2), 16));
  return new Color(fallback.r, fallback.g, fallback.b, fallback.a);
}

/**
 * Native Cocos adapter for the verified FairyGUI XML subset.
 *
 * Source coordinates remain top-left/x-right/y-down in the catalog.  Runtime
 * nodes use matching top-left anchors and `(sourceX, -sourceY)` positions unless
 * the source explicitly records a pivot/anchor.
 */
export class OriginalUi {
  private readonly frames = new Map<string, SpriteFrame>();
  private readonly framePromises = new Map<string, Promise<SpriteFrame>>();
  private readonly performance = { frameLoads: 0, frameCacheHits: 0, sharedInflightLoads: 0 };
  private readonly sourceByNode = new WeakMap<Node, NodeSource>();
  private readonly buttonFrames = new WeakMap<Node, Record<string, SpriteFrame>>();
  private readonly mountByNode = new WeakMap<Node, MountContext>();
  private readonly visibilityByNode = new WeakMap<Node, NodeVisibility>();
  private readonly scopeByRoot = new WeakMap<Node, ComponentScope>();

  constructor(readonly catalog: OriginalUiCatalog, private readonly baseUrl = '') {
    if (catalog.version !== 1 || catalog.sourceManifest !== '5254333315581813739') {
      throw new Error('Original UI catalog schema/source is invalid; rerun scripts/import-original-ui.py');
    }
  }

  /** Bounded, identity-free counters used by the local runtime diagnostics. */
  getPerformanceStats(): Readonly<typeof this.performance> {
    return { ...this.performance };
  }

  async mount(componentIdOrAlias: string, parent: Node): Promise<OriginalUiMount> {
    const sourceKey = this.resolveComponent(componentIdOrAlias);
    await this.prepareComponentFrames(sourceKey, parent);
    const context: MountContext = { parent, scopes: [] };
    const node = await this.buildComponent(sourceKey, parent, undefined, context);
    if (node.isValid) node.active = true;
    return this.handle(node, sourceKey);
  }

  /** Warm only this component's existing image dependencies. Build order stays serial. */
  private async prepareComponentFrames(sourceKey: string, parent: Node): Promise<void> {
    const seen = new Set<string>(), images = new Map<string, OriginalUiImage>();
    const uri = (value: string | undefined) => {
      const match = value && URI.exec(value);
      if (match) { const image = this.catalog.fairygui.images[`${match[1]}:${match[2]}`]; if (image) images.set(image.id + ':' + image.file, image); }
    };
    const element = (source: OriginalUiElement, pkg: string) => {
      if (source.kind === 'image' && source.attributes.src) uri(`ui://${source.attributes.pkg || pkg}${source.attributes.src}`);
      for (const value of Object.values(source.attributes)) uri(value);
      if (source.kind === 'component') component(`${source.attributes.pkg || pkg}:${source.attributes.src}`);
      for (const child of source.children ?? []) element(child, pkg);
      const item = URI.exec(source.attributes.defaultItem || '');
      if (item && source.children?.some(child => child.kind === 'item')) component(`${item[1]}:${item[2]}`);
    };
    const component = (key: string) => {
      if (seen.has(key)) return; seen.add(key);
      const source = this.catalog.fairygui.components[key]; if (!source) return;
      for (const child of source.children) element(child, source.packageId);
      for (const setting of source.settings) element(setting, source.packageId);
    };
    component(sourceKey); const queue = Array.from(images.values()); let cursor = 0;
    const worker = async () => { while (parent.isValid && cursor < queue.length) {
      const image = queue[cursor++];
      // Original build/applySkin reports a required-image failure. Speculative
      // button-state preparation must neither hide it nor reject an unused state.
      await this.loadFrame(image.resourcePath, image.file).catch(() => undefined);
    } };
    await Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker));
  }

  skin(name: string, containerVariant?: string): { path: string; file?: string; width?: number; height?: number } {
    const source = this.catalog.skins[name];
    if (!source) throw new Error(`Unknown original skin: ${name}`);
    if (containerVariant) {
      const variant = source.variants[containerVariant];
      if (!variant) throw new Error(`Unknown original skin variant: ${name}:${containerVariant}`);
      return { path: variant.resourcePath, file: variant.file, width: variant.width, height: variant.height };
    }
    if (!source.path) throw new Error(`Original skin is ambiguous; select a container variant: ${name}`);
    return { path: source.path, file: source.file, width: source.width, height: source.height };
  }

  private resolveComponent(value: string): string {
    const key = this.catalog.fairygui.components[value] ? value : this.catalog.fairygui.aliases[value];
    if (!key || !this.catalog.fairygui.components[key]) throw new Error(`Unknown original component: ${value}`);
    return key;
  }

  private createNode(parent: Node, source: OriginalUiElement | OriginalUiComponent,
      width: number, height: number, componentKey: string | undefined, context: MountContext): Node {
    const node = new Node(source.name || source.id || ('kind' in source ? source.kind : 'component'));
    node.layer = Layers.Enum.UI_2D;
    parent.addChild(node);
    const transform = node.addComponent(UITransform);
    transform.setContentSize(width, height);
    const attributes = source.attributes || {};
    const [pivotX, pivotY] = parsePair(attributes.pivot);
    transform.setAnchorPoint(pivotX, 1 - pivotY);
    const xy = 'xy' in source && source.xy ? source.xy : [0, 0];
    const anchored = attributes.anchor === 'true';
    const positionX = xy[0] + (anchored ? 0 : width * pivotX);
    const positionY = -(xy[1] + (anchored ? 0 : height * pivotY));
    node.setPosition(positionX, positionY);
    this.sourceByNode.set(node, {
      attributes,
      id: source.id, name: source.name, kind: 'kind' in source ? source.kind : 'component', componentKey,
      sourceWidth: width, sourceHeight: height, sourceX: xy[0], sourceY: xy[1],
      runtimeWidth: width, runtimeHeight: height, runtimeX: xy[0], runtimeY: xy[1],
      autoSize: attributes.autoSize === 'true',
    });
    this.mountByNode.set(node, context);
    return node;
  }

  private live(node: Node, context?: MountContext): boolean {
    const mount = context || this.mountByNode.get(node);
    return node.isValid && (!mount || mount.parent.isValid);
  }

  private cancelledNode(context: MountContext): Node {
    const node = new Node('OriginalUi:cancelled');
    this.mountByNode.set(node, context);
    return node;
  }

  private async buildComponent(key: string, parent: Node, instance?: OriginalUiElement,
      context: MountContext = { parent, scopes: [] }): Promise<Node> {
    if (!parent.isValid || !context.parent.isValid) return this.cancelledNode(context);
    const component = this.catalog.fairygui.components[key];
    if (!component) throw new Error(`Original component dependency is missing: ${key}`);
    const size = instance?.size || component.size || [0, 0];
    const nodeSource: OriginalUiElement = instance || {
      kind: 'component', id: component.id, name: component.name, attributes: {}, size,
    };
    const node = this.createNode(parent, nodeSource, size[0], size[1], key, context);
    if (!instance && context.scopes.length === 0) node.active = false;
    if (!instance) node.name = component.name;

    const scope: ComponentScope = {
      root: node, componentSize: component.size, children: component.children, rootRelations: component.relations,
      nodesById: new Map(), nodes: [], controllers: new Map(), gears: [],
    };
    this.scopeByRoot.set(node, scope);
    context.scopes.push(scope);
    for (const controller of component.controllers) {
      const name = controller.attributes.name || '';
      scope.controllers.set(name, { source: controller, selected: controller.attributes.selected || '0' });
    }
    for (const child of component.children) {
      if (!this.live(node, context)) break;
      await this.buildElement(component.packageId, child, node, scope, context);
    }
    if (!this.live(node, context)) return node;
    this.applyRelations(scope, component.children, component.size);
    this.applyComponentRelations(scope);
    this.refreshVisibility(scope);
    if (component.attributes.extention === 'Button' || component.settings.some(setting => setting.kind === 'Button')) {
      if (!node.getComponent(Button)) node.addComponent(Button);
    }
    if (instance?.children) {
      await this.applyInstanceSettings(node, instance.children, context);
      this.applyComponentRelations(scope);
    }
    this.configureButton(node);
    if (component.attributes.mask) {
      const stencil = component.children.find(child => child.id === component.attributes.mask);
      if (stencil?.attributes.type === 'eclipse') {
        const mask = node.addComponent(Mask); mask.type = Mask.Type.GRAPHICS_ELLIPSE;
        const maskNode = scope.nodesById.get(stencil.id!); if (maskNode) maskNode.active = false;
      }
    }
    return node;
  }

  private async buildElement(packageId: string, source: OriginalUiElement, parent: Node,
      scope: ComponentScope, context: MountContext): Promise<Node> {
    if (!this.live(parent, context)) return this.cancelledNode(context);
    if (source.kind === 'component') {
      const dependency = `${source.attributes.pkg || packageId}:${source.attributes.src}`;
      const node = await this.buildComponent(dependency, parent, source, context);
      if (this.live(node, context)) {
        this.registerScopeNode(scope, node, source);
        await this.applyGears(node, source, scope, context);
      }
      return node;
    }
    const resolvedSize = source.size || this.imageSize(packageId, source) || [0, 0];
    const node = this.createNode(parent, source, resolvedSize[0], resolvedSize[1], undefined, context);
    if (source.kind === 'image' && source.attributes.src) {
      await this.applySkin(node, `ui://${source.attributes.pkg || packageId}${source.attributes.src}`);
    } else if (source.kind === 'loader' && source.attributes.url) {
      await this.applySkin(node, source.attributes.url);
    } else if (source.kind === 'text' || source.kind === 'richtext') {
      this.createLabel(node, source.attributes);
    } else if (source.kind === 'graph') {
      this.createGraph(node, resolvedSize[0], resolvedSize[1], source.attributes);
    } else if (source.kind === 'list') {
      await this.buildList(packageId, source, node, context);
    }
    if (this.live(node, context)) {
      this.registerScopeNode(scope, node, source);
      await this.applyGears(node, source, scope, context);
    }
    return node;
  }

  private async buildList(packageId: string, source: OriginalUiElement, root: Node,
      context: MountContext): Promise<void> {
    const parsed = URI.exec(source.attributes.defaultItem || '');
    if (!parsed) return;
    const componentKey = `${parsed[1]}:${parsed[2]}`;
    const component = this.catalog.fairygui.components[componentKey];
    if (!component) return;
    const items = (source.children || []).filter(child => child.kind === 'item');
    const gapX = Number(source.attributes.colGap || 0);
    const gapY = Number(source.attributes.lineGap || 0);
    const isSourceRow = source.attributes.layout === 'row';
    const columns = Number(source.attributes.lineItemCount || source.attributes.lineItemCount2 || items.length || 1);
    const itemWidth = component.size[0];
    const itemHeight = component.size[1];
    const contentWidth = Math.min(columns, items.length) * itemWidth + Math.max(0, Math.min(columns, items.length) - 1) * gapX;
    const listWidth = source.size?.[0] || contentWidth;
    const offsetX = source.attributes.align === 'right' ? Math.max(0, listWidth - contentWidth)
      : source.attributes.align === 'center' ? Math.max(0, (listWidth - contentWidth) / 2) : 0;
    const mounted: Node[] = [];
    let cursorX = 0;
    for (let index = 0; index < items.length; index += 1) {
      if (!this.live(root, context)) return;
      const item = items[index];
      const instance: OriginalUiElement = {
        kind: 'component', id: `${source.id || 'list'}:item:${index}`, name: `${source.name || 'list'}Item${index}`,
        xy: isSourceRow ? [cursorX, 0]
          : [offsetX + (index % columns) * (itemWidth + gapX), Math.floor(index / columns) * (itemHeight + gapY)],
        size: [itemWidth, itemHeight], attributes: { src: parsed[2], pkg: parsed[1] },
      };
      const node = await this.buildComponent(componentKey, root, instance, context);
      if (!this.live(node, context)) return;
      const icon = item.attributes.icon;
      if (icon) {
        const target = this.find(node, 'icon') || this.find(node, 'up');
        if (target) await this.applySkin(target, icon);
      }
      const itemScope = context.scopes.find(candidate => candidate.root === node);
      if (itemScope) this.applyComponentRelations(itemScope);
      if (item.attributes.title) this.setNodeText(node, item.attributes.title);
      this.configureButton(node);
      if (isSourceRow) {
        this.setSourceGeometry(node, [cursorX, 0], undefined);
        cursorX += (node.getComponent(UITransform)?.contentSize.width || itemWidth) + gapX;
        mounted.push(node);
      }
    }
    if (isSourceRow && mounted.length) {
      const actualWidth = Math.max(0, cursorX - gapX);
      const rowOffset = source.attributes.align === 'right' ? Math.max(0, listWidth - actualWidth)
        : source.attributes.align === 'center' ? Math.max(0, (listWidth - actualWidth) / 2) : 0;
      if (rowOffset) {
        for (const node of mounted) {
          const geometry = this.sourceByNode.get(node);
          if (geometry) this.setSourceGeometry(node, [geometry.runtimeX + rowOffset, geometry.runtimeY], undefined);
        }
      }
    }
  }

  private registerScopeNode(scope: ComponentScope, node: Node, source: OriginalUiElement): void {
    scope.nodes.push(node);
    if (source.id) scope.nodesById.set(source.id, node);
    this.visibilityByNode.set(node, {
      manual: source.attributes.visible !== 'false', gear: true,
      groupId: source.attributes.group || undefined, scope,
    });
  }

  private async applyGears(node: Node, source: OriginalUiElement,
      scope: ComponentScope, context: MountContext): Promise<void> {
    for (const gear of source.children || []) {
      if (!this.live(node, context)) return;
      if (!gear.kind.startsWith('gear')) continue;
      scope.gears.push({ node, gear });
      await this.applyGear({ node, gear }, scope);
    }
  }

  private async applyGear(binding: GearBinding, scope: ComponentScope): Promise<void> {
    const controller = scope.controllers.get(binding.gear.attributes.controller || '');
    if (!controller) return;
    const { node, gear } = binding;
    const pages = (gear.attributes.pages || '').split(',').filter(Boolean);
    if (gear.kind === 'gearDisplay') {
      const state = this.visibilityByNode.get(node);
      if (state) state.gear = pages.includes(controller.selected);
      return;
    }
    const index = pages.indexOf(controller.selected);
    const values = (gear.attributes.values || '').split('|');
    const value = index >= 0 ? values[index] : gear.attributes.default;
    const base = this.sourceByNode.get(node);
    if (gear.kind === 'gearXY') this.setSourceGeometry(node, value ? parsePair(value) : base ? [base.sourceX, base.sourceY] : undefined, undefined);
    else if (gear.kind === 'gearSize') this.setSourceGeometry(node, undefined,
      value ? parsePair(value) : base ? [base.sourceWidth, base.sourceHeight] : undefined);
    else if (gear.kind === 'gearIcon' && value) await this.applySkin(node, value);
  }

  private setSourceGeometry(node: Node, xy?: [number, number], size?: [number, number]): void {
    const transform = node.getComponent(UITransform)!;
    const source = this.sourceByNode.get(node);
    const width = size?.[0] ?? source?.runtimeWidth ?? transform.contentSize.width;
    const height = size?.[1] ?? source?.runtimeHeight ?? transform.contentSize.height;
    const x = xy?.[0] ?? source?.runtimeX ?? 0;
    const y = xy?.[1] ?? source?.runtimeY ?? 0;
    if (size) transform.setContentSize(width, height);
    if (source) {
      source.runtimeWidth = width; source.runtimeHeight = height;
      source.runtimeX = x; source.runtimeY = y;
    }
    if (size && source?.kind === 'graph') this.createGraph(node, width, height, source.attributes);
    if (xy || size) node.setPosition(x + width * transform.anchorPoint.x, -(y + height * (1 - transform.anchorPoint.y)));
    const componentScope = size && this.scopeByRoot.get(node);
    if (componentScope) this.applyRelations(componentScope, componentScope.children, componentScope.componentSize);
  }

  /** Apply the verified size-relation subset used by source button/input skins. */
  private applyRelations(scope: ComponentScope, children: OriginalUiElement[], componentSize: [number, number]): void {
    for (const child of children) {
      if (!child.id) continue;
      const node = scope.nodesById.get(child.id);
      const nodeSource = node && this.sourceByNode.get(node);
      if (!node || !nodeSource) continue;
      for (const relation of child.children || []) {
        if (relation.kind !== 'relation') continue;
        const targetId = relation.attributes.target || '';
        const target = targetId ? scope.nodesById.get(targetId) : scope.root;
        const targetTransform = target?.getComponent(UITransform);
        if (!target || !targetTransform) continue;
        const targetSource = this.sourceByNode.get(target);
        const targetBaseWidth = target === scope.root ? componentSize[0] : targetSource?.sourceWidth ?? targetTransform.contentSize.width;
        const targetBaseHeight = target === scope.root ? componentSize[1] : targetSource?.sourceHeight ?? targetTransform.contentSize.height;
        const pairs = new Set((relation.attributes.sidePair || '').split(',').filter(Boolean));
        const width = pairs.has('width-width')
          ? nodeSource.sourceWidth + targetTransform.contentSize.width - targetBaseWidth : nodeSource.runtimeWidth;
        const height = pairs.has('height-height')
          ? nodeSource.sourceHeight + targetTransform.contentSize.height - targetBaseHeight : nodeSource.runtimeHeight;
        if (width !== nodeSource.runtimeWidth || height !== nodeSource.runtimeHeight) {
          this.setSourceGeometry(node, undefined, [width, height]);
        }
        const deltaX = target === scope.root ? 0 : (targetSource?.runtimeX ?? 0) - (targetSource?.sourceX ?? 0);
        const deltaY = target === scope.root ? 0 : (targetSource?.runtimeY ?? 0) - (targetSource?.sourceY ?? 0);
        let x = nodeSource.runtimeX, y = nodeSource.runtimeY;
        if (pairs.has('center-center')) x = nodeSource.sourceX + deltaX
          + (targetTransform.contentSize.width - targetBaseWidth - (nodeSource.runtimeWidth - nodeSource.sourceWidth)) / 2;
        else if (pairs.has('left-left')) x = nodeSource.sourceX + deltaX;
        else if (pairs.has('right-right')) x = nodeSource.sourceX + deltaX
          + targetTransform.contentSize.width - targetBaseWidth - (nodeSource.runtimeWidth - nodeSource.sourceWidth);
        if (pairs.has('middle-middle')) y = nodeSource.sourceY + deltaY
          + (targetTransform.contentSize.height - targetBaseHeight - (nodeSource.runtimeHeight - nodeSource.sourceHeight)) / 2;
        else if (pairs.has('top-top')) y = nodeSource.sourceY + deltaY;
        else if (pairs.has('bottom-bottom')) y = nodeSource.sourceY + deltaY
          + targetTransform.contentSize.height - targetBaseHeight - (nodeSource.runtimeHeight - nodeSource.sourceHeight);
        if (x !== nodeSource.runtimeX || y !== nodeSource.runtimeY) this.setSourceGeometry(node, [x, y]);
      }
    }
  }

  private applyComponentRelations(scope: ComponentScope): void {
    const rootSource = this.sourceByNode.get(scope.root);
    if (!rootSource) return;
    for (const relation of scope.rootRelations) {
      const target = scope.nodesById.get(relation.attributes.target || '');
      const targetSource = target && this.sourceByNode.get(target);
      const targetTransform = target?.getComponent(UITransform);
      if (!target || !targetSource || !targetTransform) continue;
      const pairs = new Set((relation.attributes.sidePair || '').split(',').filter(Boolean));
      const width = pairs.has('width-width')
        ? scope.componentSize[0] + targetTransform.contentSize.width - targetSource.sourceWidth : rootSource.runtimeWidth;
      const height = pairs.has('height-height')
        ? scope.componentSize[1] + targetTransform.contentSize.height - targetSource.sourceHeight : rootSource.runtimeHeight;
      if (width !== rootSource.runtimeWidth || height !== rootSource.runtimeHeight) {
        this.setSourceGeometry(scope.root, undefined, [width, height]);
      }
    }
  }

  private refreshVisibility(scope: ComponentScope): void {
    const visible = (node: Node, visiting: Set<Node>): boolean => {
      const state = this.visibilityByNode.get(node);
      if (!state) return node.active;
      if (!state.manual || !state.gear) return false;
      if (!state.groupId) return true;
      const group = scope.nodesById.get(state.groupId);
      if (!group || visiting.has(group)) return true;
      visiting.add(group);
      const result = visible(group, visiting);
      visiting.delete(group);
      return result;
    };
    for (const node of scope.nodes) {
      if (node.isValid) node.active = visible(node, new Set([node]));
    }
  }

  private controllerPage(controller: ControllerRuntime, value: string | number): string {
    const requested = String(value);
    const serialized = (controller.source.attributes.pages || '').split(',');
    for (let index = 0; index < serialized.length; index += 2) {
      if (serialized[index] === requested || serialized[index + 1] === requested) return serialized[index];
    }
    return requested;
  }

  private imageSize(packageId: string, source: OriginalUiElement): [number, number] | null {
    const id = source.attributes.src;
    if (!id) return null;
    return this.catalog.fairygui.images[`${source.attributes.pkg || packageId}:${id}`]?.size || null;
  }

  private createLabel(node: Node, attributes: Attributes): void {
    const label = node.addComponent(Label);
    label.string = attributes.text || '';
    label.fontSize = Number(attributes.fontSize || 14);
    label.lineHeight = Number(attributes.leading || 0) + label.fontSize;
    label.color = parseColor(attributes.color, Color.WHITE);
    label.fontFamily = attributes.font || 'Microsoft YaHei, PingFang SC, sans-serif';
    label.horizontalAlign = attributes.align === 'right' ? HorizontalTextAlignment.RIGHT
      : attributes.align === 'center' ? HorizontalTextAlignment.CENTER : HorizontalTextAlignment.LEFT;
    label.verticalAlign = attributes.vAlign === 'bottom' ? VerticalTextAlignment.BOTTOM
      : attributes.vAlign === 'middle' ? VerticalTextAlignment.CENTER : VerticalTextAlignment.TOP;
    label.overflow = attributes.autoSize === 'ellipsis' ? Label.Overflow.SHRINK
      : !attributes.autoSize || attributes.autoSize === 'both' ? Label.Overflow.NONE
      : attributes.autoSize === 'height' ? Label.Overflow.RESIZE_HEIGHT : Label.Overflow.CLAMP;
    label.enableWrapText = attributes.singleLine !== 'true';
    if (attributes.strokeColor) { label.enableOutline = true; label.outlineColor = parseColor(attributes.strokeColor); label.outlineWidth = Number(attributes.strokeSize || 1); }
    this.measureSourceText(label);
  }
  private measureSourceText(label: Label) {
    if (label.overflow !== Label.Overflow.NONE && label.overflow !== Label.Overflow.RESIZE_HEIGHT) return;
    label.updateRenderData(true);
    const size = label.node.getComponent(UITransform)!.contentSize;
    this.setSourceGeometry(label.node, undefined, [size.width, size.height]);
  }

  private createGraph(node: Node, width: number, height: number, attributes: Attributes): void {
    if (!attributes.fillColor || attributes.fillColor === '#00000000') return;
    const graph = node.getComponent(Graphics) || node.addComponent(Graphics); graph.clear();
    graph.fillColor = parseColor(attributes.fillColor, Color.TRANSPARENT);
    const anchor = node.getComponent(UITransform)!.anchorPoint;
    const left = -width * anchor.x;
    const bottom = -height * anchor.y;
    if (attributes.type === 'eclipse') graph.ellipse(left + width / 2, bottom + height / 2, width / 2, height / 2);
    else graph.roundRect(left, bottom, width, height, Number(attributes.corner || 0));
    graph.fill();
  }

  private async applyInstanceSettings(root: Node, settings: OriginalUiElement[], context: MountContext): Promise<void> {
    for (const setting of settings) {
      if (!this.live(root, context)) return;
      if (setting.kind === 'property') {
        const target = this.find(root, setting.attributes.target);
        if (!target) continue;
        if (setting.attributes.propertyId === '0') this.setNodeText(target, setting.attributes.value || '');
        else if (setting.attributes.propertyId === '1') await this.applySkin(target, setting.attributes.value || '');
      } else if (setting.kind === 'ProgressBar') {
        const value = Number(setting.attributes.value || 0);
        const max = Number(setting.attributes.max || value || 1);
        this.setNodeProgress(root, value, max);
      } else if (setting.kind === 'Button') {
        const icon = this.find(root, 'icon') || this.find(root, 'up');
        if (icon && setting.attributes.icon) await this.applySkin(icon, setting.attributes.icon);
      }
    }
  }

  private async applySkin(node: Node, source: string, containerVariant?: string): Promise<void> {
    let path = source;
    let file: string | undefined;
    let nativeSize: [number, number] | undefined;
    const uri = URI.exec(source);
    if (uri) {
      const image = this.catalog.fairygui.images[`${uri[1]}:${uri[2]}`];
      if (!image) return; // Source packages intentionally contain empty button-state URIs.
      path = image.resourcePath;
      file = image.file;
      nativeSize = image.size;
    } else if (this.catalog.skins[source]) {
      const skin = this.skin(source, containerVariant);
      path = skin.path;
      file = skin.file;
      if (skin.width !== undefined && skin.height !== undefined) nativeSize = [skin.width, skin.height];
    }
    let frame: SpriteFrame;
    try {
      frame = await this.loadFrame(path, file);
    } catch (error) {
      // A route change may destroy the mount while its remote image is in flight.
      // That cancelled subtree must not surface a stale load failure.
      if (!this.live(node)) return;
      throw error;
    }
    if (!this.live(node)) return;
    const sprite = node.getComponent(Sprite) || node.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.spriteFrame = frame;
    if (nativeSize && this.sourceByNode.get(node)?.autoSize) this.setSourceGeometry(node, undefined, nativeSize);
    const state = node.name === 'over' ? 'hover' : node.name === 'down' ? 'pressed'
      : node.name === 'disabled' ? 'disabled' : 'normal';
    const buttonRoot = this.buttonAncestor(node);
    if (buttonRoot) {
      const states = this.buttonFrames.get(buttonRoot) || {};
      states[state] = frame;
      this.buttonFrames.set(buttonRoot, states);
      this.configureButton(buttonRoot);
    }
  }

  private loadFrame(path: string, file?: string): Promise<SpriteFrame> {
    const remote = this.baseUrl && file ? `${this.baseUrl.replace(/\/$/, '')}/${file.replace(/^\//, '')}` : '';
    const key = remote || path;
    const cached = this.frames.get(key);
    if (cached) { this.performance.frameCacheHits++; return Promise.resolve(cached); }
    const inflight = this.framePromises.get(key);
    if (inflight) { this.performance.sharedInflightLoads++; return inflight; }
    this.performance.frameLoads++;
    const load = remote
      ? new Promise<SpriteFrame>((resolve, reject) => assetManager.loadRemote<ImageAsset>(remote,
        { ext: /\.jpe?g$/i.test(file || '') ? '.jpg' : '.png' }, (error, image) => {
          if (error) return reject(new Error(`Unable to load original UI skin ${remote}: ${error.message}`));
          const texture = new Texture2D();
          texture.image = image;
          const frame = new SpriteFrame();
          frame.texture = texture;
          this.frames.set(key, frame);
          resolve(frame);
        }))
      : new Promise<SpriteFrame>((resolve, reject) => resources.load(`${path}/spriteFrame`, SpriteFrame, (error, frame) => {
        if (error) return reject(new Error(`Unable to load original UI skin ${path}: ${error.message}`));
        this.frames.set(key, frame);
        resolve(frame);
      }));
    this.framePromises.set(key, load);
    void load.finally(() => this.framePromises.delete(key)).catch(() => undefined);
    return load;
  }

  private buttonAncestor(node: Node): Node | null {
    let current: Node | null = node;
    while (current) {
      if (current.getComponent(Button)) return current;
      current = current.parent;
    }
    return null;
  }

  private configureButton(node: Node): void {
    const button = node.getComponent(Button);
    if (!button) return;
    const up = this.find(node, 'up');
    if (!up) return;
    const states = this.buttonFrames.get(node) || {};
    for (const [name, state] of [['up', 'normal'], ['over', 'hover'], ['down', 'pressed'], ['disabled', 'disabled']] as const) {
      const frame = this.find(node, name)?.getComponent(Sprite)?.spriteFrame;
      if (frame) states[state] = frame;
    }
    this.buttonFrames.set(node, states);
    button.transition = Button.Transition.SPRITE;
    button.target = up;
    if (states.normal) button.normalSprite = states.normal;
    if (states.hover) button.hoverSprite = states.hover;
    if (states.pressed) button.pressedSprite = states.pressed;
    if (states.disabled) button.disabledSprite = states.disabled;
    for (const name of ['over', 'down', 'disabled']) {
      const child = this.find(node, name);
      if (child && child !== up) child.active = false;
    }
  }

  private handle(root: Node, sourceKey: string): OriginalUiMount {
    const require = (selector: string) => {
      const node = this.find(root, selector);
      if (!node) throw new Error(`Original UI child is missing: ${sourceKey}:${selector}`);
      return node;
    };
    return {
      node: root,
      sourceKey,
      child: selector => this.find(root, selector),
      requireChild: require,
      on: (selector, event, handler, target) => {
        const node = require(selector);
        node.on(event, handler, target);
        return () => { if (node.isValid) node.off(event, handler, target); };
      },
      setText: (selector, value) => this.setNodeText(require(selector), String(value)),
      setVisible: (selector, visible) => {
        const node = require(selector);
        const state = this.visibilityByNode.get(node);
        if (state) { state.manual = visible; this.refreshVisibility(state.scope); }
        else node.active = visible;
      },
      setProgress: (selector, value, max = 100) => this.setNodeProgress(require(selector), value, max),
      setSkin: (selector, skin, variant) => this.applySkin(require(selector), skin, variant),
      setController: async (name, page) => {
        const context = this.mountByNode.get(root);
        if (!context) return;
        const matching = context.scopes.filter(scope => scope.controllers.has(name));
        if (!matching.length) throw new Error(`Original UI controller is missing: ${sourceKey}:${name}`);
        for (const scope of matching) {
          const controller = scope.controllers.get(name)!;
          controller.selected = this.controllerPage(controller, page);
          for (const binding of scope.gears) {
            if (binding.gear.attributes.controller === name) await this.applyGear(binding, scope);
          }
          this.refreshVisibility(scope);
        }
      },
    };
  }

  private find(root: Node, selector: string): Node | null {
    if (!selector) return root;
    if (selector.includes('/') || selector.includes('.')) {
      const parts = selector.split(/[/.]/).filter(Boolean);
      let current: Node | null = root;
      for (const part of parts) current = current && this.directChild(current, part);
      return current;
    }
    const queue = [root];
    while (queue.length) {
      const node = queue.shift()!;
      const source = this.sourceByNode.get(node);
      if (node.name === selector || source?.id === selector || source?.name === selector) return node;
      queue.push(...node.children);
    }
    return null;
  }

  private directChild(parent: Node, selector: string): Node | null {
    return parent.children.find(node => {
      const source = this.sourceByNode.get(node);
      return node.name === selector || source?.id === selector || source?.name === selector;
    }) || null;
  }

  private setNodeText(node: Node, value: string): void {
    const label = node.getComponent(Label) || this.find(node, 'title')?.getComponent(Label);
    if (!label) throw new Error(`Original UI node has no text target: ${node.name}`);
    label.string = value;
    this.measureSourceText(label);
    const scope = this.visibilityByNode.get(label.node)?.scope;
    if (scope) { this.applyComponentRelations(scope); this.applyRelations(scope, scope.children, scope.componentSize); }
  }

  private setNodeProgress(node: Node, value: number, max: number): void {
    const ratio = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
    const bar = this.find(node, 'bar');
    if (bar) {
      bar.setScale(ratio, 1, 1);
    }
    const title = this.find(node, 'title')?.getComponent(Label);
    if (title) title.string = `${value}/${max}`;
  }
}
