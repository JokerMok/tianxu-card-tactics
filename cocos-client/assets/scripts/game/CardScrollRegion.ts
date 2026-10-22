import { Node, Mask, EventMouse, EventTouch, Color } from 'cc';
import { CardManagementUi, palette } from './CardManagementUi.ts';
export type Point={x:number;y:number};
/** Independent wheel, touch/track drag and clipping; no whole-window scrolling. */
export class ScrollRegion {
 readonly clip:Node;readonly content:Node;readonly track:Node;private thumb:Node;private range=0;offset=0;private total=0;private thumbHeight=0;
 constructor(private ui:CardManagementUi,parent:Node,readonly name:string,readonly x:number,readonly y:number,readonly w:number,readonly h:number,private point:(e:EventTouch)=>Point,private changed:(offset:number)=>void){
 this.clip=ui.node(parent,name+':Clip',x,y,w,h);this.clip.addComponent(Mask).type=Mask.Type.GRAPHICS_RECT;this.content=ui.node(this.clip,name+':Content',0,0,w,h);
 this.clip.on(Node.EventType.MOUSE_WHEEL,(e:EventMouse)=>{e.propagationStopped=true;this.set(this.offset-e.getScrollY()*.45);});
 let lastY=0;this.clip.on(Node.EventType.TOUCH_START,(e:EventTouch)=>{lastY=this.point(e).y;});this.clip.on(Node.EventType.TOUCH_MOVE,(e:EventTouch)=>{if(e.target!==this.clip&&e.target!==this.content)return;let y=this.point(e).y;this.set(this.offset+lastY-y);lastY=y;});
 this.track=ui.rect(parent,name+':ScrollTrack',x+w+3,y,8,h,new Color(36,32,21,130),new Color(133,113,68,150));this.thumb=ui.rect(this.track,'Thumb',1,0,6,50,new Color(184,152,85),palette.gold,2);
 const drag=(e:EventTouch)=>{e.propagationStopped=true;let p=this.point(e);this.set((p.y-this.y-this.thumbHeight/2)/Math.max(1,this.h-this.thumbHeight)*this.range);};this.track.on(Node.EventType.TOUCH_START,drag);this.track.on(Node.EventType.TOUCH_MOVE,drag);
 this.track.on(Node.EventType.MOUSE_WHEEL,(e:EventMouse)=>{e.propagationStopped=true;this.set(this.offset-e.getScrollY()*.45);});
 }
 contains(p:Point){return p.x>=this.x&&p.x<=this.x+this.w&&p.y>=this.y&&p.y<=this.y+this.h;}
 setTotal(total:number){this.total=total;this.range=Math.max(0,total-this.h);this.track.active=this.range>1;this.thumbHeight=Math.min(this.h,Math.max(32,this.h*this.h/Math.max(this.h,total)));const t=this.thumb.getComponent('cc.UITransform') as any;if(t)t.setContentSize(6,this.thumbHeight);this.ui.destroy(this.thumb);this.thumb=this.ui.rect(this.track,'Thumb',1,0,6,this.thumbHeight,new Color(184,152,85),palette.gold,2);this.set(this.offset,false);}
 set(v:number,notify=true){const next=Math.max(0,Math.min(this.range,v));let moved=Math.abs(next-this.offset)>.05;this.offset=next;this.thumb.setPosition(1,-(this.range?next/this.range*(this.h-this.thumbHeight):0));if(notify&&moved)this.changed(next);}
 restore(v:number){this.set(v,false);this.changed(this.offset);}
 max(){return this.range;}
}
