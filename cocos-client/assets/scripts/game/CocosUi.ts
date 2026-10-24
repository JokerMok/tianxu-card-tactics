import { ArtSkin,type ButtonKind } from './ArtSkin.ts';
import { Node, UITransform, Layers, Graphics, Color, Label, Button, EditBox,
  HorizontalTextAlignment, VerticalTextAlignment, Sprite, SpriteFrame, assetManager, ImageAsset, Texture2D, UIOpacity } from 'cc';
import type { OriginalUi } from './OriginalUi.ts';

export const Theme = { ink: new Color(18, 27, 28), panel: new Color(26, 41, 43, 244),
  raised: new Color(38, 59, 59, 245), gold: new Color(220, 193, 132), text: new Color(239, 231, 207),
  dim: new Color(158, 176, 171), green: new Color(92, 200, 146), red: new Color(218, 103, 89) };
export interface ClickTarget { name: string; x: number; y: number; width: number; height: number; disabled: boolean }
export class CocosUi {
  private original?: OriginalUi;
  private resourceBase = '';
  configureOriginal(original: OriginalUi, base: string) { this.original = original; this.resourceBase = base; }
  targets: ClickTarget[] = [];
  readonly frames = new Map<string, SpriteFrame>();
  node(parent: Node, name: string, width: number, height: number, x = 0, y = 0): Node {
    const node = new Node(name); node.layer = Layers.Enum.UI_2D; parent.addChild(node);
    node.addComponent(UITransform).setContentSize(width, height); node.setPosition(x, y); return node;
  }
  panel(parent: Node, name: string, width: number, height: number, x = 0, y = 0, fill = Theme.panel, border?: Color): Node {
    const node = this.node(parent, name, width, height, x, y);
    if(ArtSkin.image('panel') && (border || /Modal|Dialog|Panel|Frame/.test(name)) && !/Shade|Backdrop|Base|Legal/.test(name)){void ArtSkin.paint(node,'panel');return node;}
    const g = node.addComponent(Graphics);
    g.fillColor = fill; g.roundRect(-width / 2, -height / 2, width, height, 5); g.fill();
    if (border) { g.strokeColor = border; g.lineWidth = 1; g.stroke(); } return node;
  }
  label(parent: Node, name: string, text: string, x: number, y: number, width = 300, height = 30, size = 16, color = Theme.text, left = false): Label {
    const node = this.node(parent, name, width, height, x, y); const label = node.addComponent(Label);
    label.string = text; label.fontSize = size; label.lineHeight = size + 4; label.color = color;
    label.horizontalAlign = left ? HorizontalTextAlignment.LEFT : HorizontalTextAlignment.CENTER;
    label.verticalAlign = VerticalTextAlignment.CENTER; label.overflow = Label.Overflow.SHRINK;
    label.enableWrapText = true; label.fontFamily = 'Microsoft YaHei, PingFang SC, sans-serif';
    if (this.original) { label.enableOutline = true; label.outlineColor = new Color(0, 0, 0, 220); label.outlineWidth = 1; }
    return label;
  }
  skin(parent: Node, name: string, skin: string, x: number, y: number, width?: number, height?: number, variant?: string): Node {
    if (!this.original) throw new Error('Original UI has not been loaded');
    const source = this.original.skin(skin, variant);
    const node = this.node(parent, name, width ?? source.width ?? 1, height ?? source.height ?? 1, x, y);
    const replacement=ArtSkin.sourceKey(skin);
    if(replacement){void ArtSkin.paint(node,replacement);return node;}
    void this.image(node, name + ':asset', this.resourceBase + (source.file ?? source.path + '.png'),
      width ?? source.width ?? 1, height ?? source.height ?? 1);
    return node;
  }
  sourceButton(parent: Node, name: string, skin: string, pressed: string, text: string, x: number, y: number,
      width: number, height: number, callback: () => void, disabled = false, variant?: string, kind:ButtonKind='secondary', selected=false): Node {
    if(ArtSkin.image('button-normal') && text && width>=60){
      const node=this.node(parent,name,width,height,x,y);ArtSkin.button(node,disabled,selected||text.startsWith('✓'),kind);
      const button=node.addComponent(Button);button.interactable=!disabled;
      this.label(node,name+':text',text,0,0,width-10,height-2,13,disabled?Theme.dim:Theme.text);
      node.on(Button.EventType.CLICK,callback);return node;
    }
    const node = this.skin(parent, name, skin, x, y, width, height, variant);
    const button = node.addComponent(Button); button.interactable = !disabled;
    if (text) this.label(node, name + ':text', text, 0, 0, width - 8, height - 2, 13, new Color(255, 245, 210));
    const normal = node.children[0]; let down: Node | undefined;
    if (pressed) { try { down = this.skin(node, name + ':pressed', pressed, 0, 0, width, height, variant); down.active = false;
      if (text) this.label(down, name + ':pressedText', text, 0, -1, width - 8, height - 2, 13); } catch { /* Source may only define the normal icon. */ } }
    if (disabled) { button.enabled = false; node.addComponent(UIOpacity).opacity = 115; return node; }
    node.on(Node.EventType.TOUCH_START, () => { if (!button.interactable) return;
      if (down) { normal.active = false; down.active = true; } else node.setScale(.95, .95, 1); });
    const reset = () => { if (normal.isValid) normal.active = true; if (down?.isValid) down.active = false; if (node.isValid) node.setScale(1, 1, 1); };
    node.on(Node.EventType.TOUCH_END, reset); node.on(Node.EventType.TOUCH_CANCEL, reset);
    node.on(Button.EventType.CLICK, callback);
    return node;
  }
  button(parent: Node, name: string, text: string, x: number, y: number, width: number, height: number,
      callback: () => void, disabled = false, transparent = false, kind:ButtonKind='secondary', selected=false): Node {
    if (this.original?.catalog.skins.ajda_1?.path && text && !transparent) {
      return this.sourceButton(parent, name, 'ajda_1', '', text, x, y, width, height, callback, disabled, undefined, kind, selected);
    }
    const node = transparent && this.original ? this.node(parent, name, width, height, x, y) : this.panel(parent, name, width, height, x, y,
      transparent ? new Color(220, 193, 132, 35) : disabled ? new Color(34, 42, 43) : Theme.raised,
      disabled ? Theme.dim : Theme.gold);
    this.label(node, name + ':text', text, 0, 0, width - 10, height - 4, 15, disabled ? Theme.dim : Theme.text);
    const button = node.addComponent(Button); button.interactable = !disabled;
    node.on(Button.EventType.CLICK, callback);
    // A read-only design-coordinate map supports actual pointer tests of the canvas UI.
    let px = x; let py = y; let ancestor = parent;
    while (ancestor.parent && ancestor.name !== 'TianxuRoot') { px += ancestor.position.x; py += ancestor.position.y; ancestor = ancestor.parent; }
    this.targets.push({ name, x: px + 600, y: 300 - py, width, height, disabled });
    return node;
  }
  input(parent: Node, name: string, placeholder: string, x: number, y: number, width = 280, value = '', password = false, height = 38, transparent = false): EditBox {
    const node = transparent ? this.node(parent, name, width, height, x, y) : this.panel(parent, name, width, height, x, y, new Color(12, 23, 24), Theme.dim);
    node.active = false;
    const box = node.addComponent(EditBox);
    box.textLabel = this.label(node, name + ':value', '', 0, 0, width - 10, height - 4, Math.min(17, height - 8), Theme.text, true);
    box.placeholderLabel = this.label(node, name + ':placeholder', placeholder, 0, 0, width - 10, height - 4, Math.min(16, height - 8), Theme.dim, true);
    box.textLabel.node.getComponent(UITransform)!.setAnchorPoint(0, 1);
    box.placeholderLabel.node.getComponent(UITransform)!.setAnchorPoint(0, 1);
    box.placeholder = placeholder;
    box.inputMode = EditBox.InputMode.SINGLE_LINE;
    box.inputFlag = password ? EditBox.InputFlag.PASSWORD : EditBox.InputFlag.DEFAULT;
    box.maxLength = 128; box.string = value; node.active = true; return box;
  }
  async image(parent: Node, name: string, url: string, width: number, height: number, x = 0, y = 0) {
    const node = this.node(parent, name, width, height, x, y);
    const sprite = node.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    try {
      let frame = this.frames.get(url);
      if (!frame) {
        const image = await new Promise<ImageAsset>((resolve, reject) => assetManager.loadRemote<ImageAsset>(url,
          { ext: url.endsWith('.jpg') || url.endsWith('.jpeg') ? '.jpg' : '.png' }, (error, asset) => error ? reject(error) : resolve(asset)));
        const texture = new Texture2D(); texture.image = image; frame = new SpriteFrame(); frame.texture = texture;
        this.frames.set(url, frame);
      }
      if (node.isValid) sprite.spriteFrame = frame;
    } catch { if (node.isValid) this.label(node, 'MissingImage', '图像缺失', 0, 0, width, height, 11, Theme.dim); }
    return node;
  }
}
