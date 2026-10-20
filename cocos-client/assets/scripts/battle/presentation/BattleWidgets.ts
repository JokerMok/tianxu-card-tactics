import { Node, UITransform, Graphics, Label, Color, Layers, Sprite, SpriteFrame, HorizontalTextAlignment, VerticalTextAlignment } from 'cc';
import { gameUiColors, gameUiFontFamily } from '../../ui/GameUiTheme';
export const battleColors=gameUiColors;
export function uiNode(parent:Node,name:string,x=0,y=0,w=0,h=0):Node{
 const node=new Node(name);node.layer=Layers.Enum.UI_2D;node.setParent(parent);node.setPosition(x,y);node.addComponent(UITransform).setContentSize(w,h);return node;
}
export function panel(parent:Node,name:string,x:number,y:number,w:number,h:number,fill=new Color(12,24,23,235),stroke?:Color,cut=8):Node{
 const node=uiNode(parent,name,x,y,w,h);const g=node.addComponent(Graphics);g.fillColor=fill;
 const radius=Math.min(12,Math.max(0,cut),h/5);
 g.roundRect(-w/2,-h/2,w,h,radius);g.fill();if(stroke){g.strokeColor=stroke;g.lineWidth=1.25;g.roundRect(-w/2+.625,-h/2+.625,w-1.25,h-1.25,radius);g.stroke();}return node;
}
export function label(parent:Node,name:string,value:string,x:number,y:number,w:number,h:number,size=22,color=battleColors.bone,align=HorizontalTextAlignment.CENTER):Label{
 const node=uiNode(parent,name,x,y,w,h);const text=node.addComponent(Label);text.string=value;text.fontSize=size;text.fontFamily=gameUiFontFamily;text.lineHeight=size+5;text.color=color;text.horizontalAlign=align;text.verticalAlign=VerticalTextAlignment.CENTER;text.overflow=Label.Overflow.SHRINK;text.enableWrapText=true;return text;
}
/** HUD captions must remain one line when their text or the browser font changes. */
export function singleLineLabel(parent:Node,name:string,value:string,x:number,y:number,w:number,h:number,size=22,color=battleColors.bone,align=HorizontalTextAlignment.CENTER):Label{
 const text=label(parent,name,value,x,y,w,h,size,color,align);
 text.enableWrapText=false;
 return text;
}
export function artwork(parent:Node,name:string,frame:SpriteFrame,x:number,y:number,w:number,h:number,tint=Color.WHITE):Node{
 const node=uiNode(parent,name,x,y,w,h);const sprite=node.addComponent(Sprite);sprite.sizeMode=Sprite.SizeMode.CUSTOM;sprite.spriteFrame=frame;node.getComponent(UITransform)!.setContentSize(w,h);sprite.color=tint;return node;
}
export function button(parent:Node,name:string,value:string,x:number,y:number,w:number,h:number,action:()=>void,active=true,emphasis=false):Node{
 const node=panel(parent,name,x,y,w,h,emphasis?new Color(43,154,111,235):battleColors.raised,active?battleColors.line:new Color(69,76,65));
 label(node,name+'Label',value,0,0,w-18,h-8,Math.min(19,Math.max(15,h*.32)),active?battleColors.bone:battleColors.muted);
 if(active){node.on(Node.EventType.TOUCH_END,action);node.on(Node.EventType.MOUSE_ENTER,()=>node.setScale(1.018,1.018,1));node.on(Node.EventType.MOUSE_LEAVE,()=>node.setScale(1,1,1));}
 return node;
}
export function ruleLine(parent:Node,x:number,y:number,w:number,alpha=150):void{const n=uiNode(parent,'Rule',x,y,w,1);const g=n.addComponent(Graphics);g.strokeColor=new Color(205,170,91,alpha);g.lineWidth=1;g.moveTo(-w/2,0);g.lineTo(w/2,0);g.stroke();}
