"""Original Guard model/animation compiler. Blender 5.2; no external models/textures.
Run blender -b -t 2 --python this.py -- --stage blockout|detail|atlas --output DIR.
Blockout and detail share the locked game review camera. Atlas is 54 actual poses.
"""
import bpy, math, os, sys, json, argparse
from mathutils import Vector, Quaternion
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
p=argparse.ArgumentParser();p.add_argument('--stage',choices=['blockout','detail','atlas'],default='blockout');p.add_argument('--output',required=True);opt=p.parse_args(args);out=os.path.abspath(opt.output);os.makedirs(out,exist_ok=True)
CONFIG={'height':1.82,'shoulder_width':.64,'head_height':.24,'camera':(4.6,-7.8,4.1),'target':(0,0,.93),'ortho':3.15,'frame_size':256,'runtime_size':[170,170],'frames':54,'threads':2}
# Dedicated background process; never operates on the user's open Blender scene.
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
for data in list(bpy.data.materials):bpy.data.materials.remove(data)
col=bpy.data.collections.new('TianxuOriginalGuard');bpy.context.scene.collection.children.link(col)
def place(obj):
 for c in list(obj.users_collection):c.objects.unlink(obj)
 col.objects.link(obj);return obj

def mat(name,color,metal=0,rough=.5):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
 n=m.node_tree.nodes.get('Principled BSDF');n.inputs['Base Color'].default_value=(*color,1);n.inputs['Metallic'].default_value=metal;n.inputs['Roughness'].default_value=rough;return m
M={'steel':mat('Brushed cool steel',(.39,.49,.55),.78,.32),'edge':mat('Bright bevel steel',(.70,.77,.78),.8,.25),'blue':mat('Deep steel blue enamel',(.035,.16,.22),.48,.35),'cloth':mat('Blue wool',(.023,.075,.10),0,.8),'leather':mat('Oiled brown leather',(.09,.045,.025),0,.8),'gold':mat('Old brass',(.46,.31,.11),.75,.38),'skin':mat('Warm human skin',(.49,.28,.17),0,.58),'hair':mat('Dark hair',(.032,.023,.018),0,.82),'black':mat('Eye shadow',(.018,.025,.027),.1,.7)}
rigdata=bpy.data.armatures.new('Guard bones');rig=place(bpy.data.objects.new('GuardRig',rigdata));bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
B={}
def bone(name,h,t,parent=None):
 b=rigdata.edit_bones.new(name);b.head=h;b.tail=t
 if parent:b.parent=rigdata.edit_bones[parent]
 B[name]=(h,t);return b
bone('root',(0,0,.055),(0,0,.255));bone('pelvis',(0,0,.86),(0,0,1.08),'root');bone('chest',(0,0,1.03),(0,0,1.49),'pelvis');bone('head',(0,0,1.47),(0,0,1.81),'chest')
for side,y in [('R',-.28),('L',.28)]:
 bone('upper_arm.'+side,(0,y,1.44),(.025,y,1.12),'chest');bone('forearm.'+side,(.025,y,1.12),(.14,y,.88),'upper_arm.'+side);bone('hand.'+side,(.14,y,.88),(.19,y,.79),'forearm.'+side)
 bone('thigh.'+side,(0,y*.49,.91),(.015,y*.49,.52),'pelvis');bone('shin.'+side,(.015,y*.49,.52),(-.005,y*.49,.13),'thigh.'+side);bone('foot.'+side,(-.005,y*.49,.13),(.19,y*.49,.07),'shin.'+side)
bpy.ops.object.mode_set(mode='OBJECT');rig.select_set(False)
def finish(o,name,material,binding=None,bevel=0):
 o.name=name;place(o);o.data.materials.append(M[material]);bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.select_set(False)
 if bevel:
  mod=o.modifiers.new('Crafted rounded edges','BEVEL');mod.width=bevel;mod.segments=2
 if binding:
  group=o.vertex_groups.new(name=binding);group.add(list(range(len(o.data.vertices))),1.0,'REPLACE');a=o.modifiers.new('Rigid armour binding','ARMATURE');a.object=rig
 return o

def sphere(name,loc,scale,m,b,segments=20,rings=12):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,location=loc);o=bpy.context.object;o.scale=scale
 for f in o.data.polygons:f.use_smooth=True
 return finish(o,name,m,b)
def mesh(name,verts,faces,m,b,bevel=.012):
 me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update();o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o);return finish(o,name,m,b,bevel)
def shaped(name,zlevels,radii,m,b):
 verts=[];n=12
 for z,(rx,ry) in zip(zlevels,radii):
  for i in range(n):
   a=2*math.pi*i/n;verts.append((rx*math.cos(a),ry*math.sin(a),z))
 faces=[tuple(range(n-1,-1,-1))]
 for j in range(len(zlevels)-1):
  for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
 faces.append(tuple((len(zlevels)-1)*n+i for i in range(n)))
 return mesh(name,verts,faces,m,b)
def segment(name,h,t,r1,r2,m,b):
 d=Vector(t)-Vector(h);bpy.ops.mesh.primitive_cone_add(vertices=12,radius1=r1,radius2=r2,depth=d.length,location=(Vector(h)+Vector(t))/2);o=bpy.context.object;o.rotation_euler=d.to_track_quat('Z','Y').to_euler();return finish(o,name,m,b,.009)
# Blockout has all identity-bearing masses and weapon/shield, not tiny embellishments.
shaped('Tapered armoured cuirass',[1.01,1.18,1.39,1.47],[(.13,.21),(.18,.25),(.21,.27),(.10,.22)],'blue','chest')
shaped('Leather waist',[.84,.98,1.04],[(.13,.20),(.14,.21),(.13,.20)],'leather','pelvis')
sphere('Human head',(.015,0,1.66),(.105,.10,.143),'skin','head');sphere('Dark cropped hair',(-.015,0,1.73),(.105,.104,.095),'hair','head')
segment('Neck',(0,0,1.45),(0,0,1.56),.071,.073,'skin','head')
for side,y in [('R',-.28),('L',.28)]:
 s=.49*y
 sphere('Layered pauldron '+side,(0,y,1.43),(.15,.13,.13),'steel','upper_arm.'+side)
 segment('Upper arm '+side,(0,y,1.37),(.025,y,1.12),.075,.085,'cloth','upper_arm.'+side)
 segment('Steel vambrace '+side,(.025,y,1.12),(.14,y,.9),.075,.059,'steel','forearm.'+side)
 sphere('Glove '+side,(.155,y,.855),(.066,.058,.065),'leather','hand.'+side)
 segment('Upper leg '+side,(0,s,.91),(.015,s,.52),.09,.11,'cloth','thigh.'+side)
 segment('Greave '+side,(.015,s,.53),(-.005,s,.14),.07,.085,'steel','shin.'+side)
 sphere('Leather boot '+side,(.07,s,.10),(.15,.085,.08),'leather','foot.'+side)
# Sword rests angled down and outward, deliberately long enough to read at 90px height.
hand=Vector((.18,-.28,.83));tip=Vector((.66,-.28,.22));direction=(tip-hand).normalized();cross=Vector((direction.z,0,-direction.x))
base=hand+direction*.10;end=tip;verts=[]
for center,w in [(base,.038),(end-direction*.12,.022),(end,.001)]:
 verts.extend([tuple(center+cross*w+Vector((0,.012,0))),tuple(center-cross*w+Vector((0,.012,0))),tuple(center-cross*w-Vector((0,.012,0))),tuple(center+cross*w-Vector((0,.012,0)))])
mesh('Tapered diamond sword blade',verts,[(0,1,2,3),(0,4,5,1),(3,2,6,7),(0,3,7,4),(1,5,6,2),(4,8,9,5),(7,6,10,11),(4,7,11,8),(5,9,10,6)],'edge','hand.R',.004)
segment('Sword grip',tuple(hand-direction*.08),tuple(hand+direction*.10),.027,.027,'leather','hand.R');segment('Sword crossguard',tuple(hand+cross*.13+direction*.08),tuple(hand-cross*.13+direction*.08),.022,.022,'gold','hand.R')
# Convex kite shield: its plane faces the enemy (+X), silver border behind blue front.
outline=[(0,.31),(-.20,.19),(-.18,-.18),(0,-.38),(.18,-.18),(.20,.19)]
def shield(name,x,scale,m):
 verts=[(x,.31+u*scale,1.12+v*scale) for u,v in outline]+[(x+.055,.31,1.10)];faces=[(i,(i+1)%6,6) for i in range(6)];return mesh(name,verts,faces,m,'hand.L',.012)
shield('Steel kite shield rim',.28,1,'steel');shield('Blue enamel shield face',.292,.86,'blue')
if opt.stage!='blockout':
 # Intentionally shaped secondary plates, layered trim and readable face details.
 shaped('Cuirass collar',[1.46,1.49],[(.11,.23),(.11,.23)],'edge','chest')
 shaped('Waist brass trim',[1.025,1.047],[(.14,.22),(.14,.22)],'gold','pelvis')
 for side,y in [('R',-.28),('L',.28)]:
  sphere('Elbow articulation '+side,(.025,y,1.12),(.083,.079,.073),'blue','forearm.'+side)
  sphere('Knee cap '+side,(.08,y*.49,.52),(.074,.082,.085),'blue','shin.'+side)
  sphere('Pauldrons edge '+side,(.035,y,1.44),(.14,.137,.11),'blue','upper_arm.'+side)
  segment('Bright greave ridge '+side,(.075,y*.49,.47),(.058,y*.49,.18),.017,.012,'edge','shin.'+side)
  # Split knee-length tabard flaps bound to pelvis, not cylinders stacked on a torso.
  u=y*.64;mesh('Blue split tabard '+side,[(.15,u-.07,.99),(.15,u+.07,.99),(.14,u+.08,.69),(.13,u,.64),(.14,u-.08,.69)],[(0,1,2,3,4)],'blue','pelvis',.005)
 # Single detail patch: intentional shoulder/toe silhouettes instead of blockout balls.
 for side,y in [('R',-.28),('L',.28)]:
  for prefix in ['Layered pauldron ','Pauldrons edge ']:
   obj=bpy.data.objects.get(prefix+side)
   if obj:bpy.data.objects.remove(obj,do_unlink=True)
  for scale,dx,material in [(1,0,'steel'),(.85,.01,'blue')]:
   vs=[(dx+.145*math.cos(a)*scale,y+.143*math.sin(a)*scale,1.38+.13*math.sin(a/2)) for a in [i*2*math.pi/10 for i in range(10)]]
   vs.append((dx,y,1.54));mesh('Contoured shoulder '+side+material,vs,[(i,(i+1)%10,10) for i in range(10)],material,'upper_arm.'+side,.012)
  yy=y*.49
  mesh('Boot steel toe '+side,[(.03,yy-.071,.11),(.21,yy-.065,.07),(.23,yy+.065,.07),(.03,yy+.071,.11),(.07,yy-.061,.17),(.18,yy-.055,.14),(.18,yy+.055,.14),(.07,yy+.061,.17)],[(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],'steel','foot.'+side,.013)
 for y in [-.052,.052]:
  mesh('Angular brow '+str(y),[(.115,y-.024,1.716),(.125,y+.023,1.718),(.12,y+.019,1.731),(.113,y-.025,1.731)],[(0,1,2,3)],'hair','head',.002)
 for yy in [-.03,.018]:
  mesh('Swept hair crest '+str(yy),[(-.08,yy-.025,1.77),(.03,yy-.023,1.82),(.11,yy-.018,1.80),(.015,yy+.02,1.825),(-.06,yy+.02,1.795),(-.02,yy,1.85)],[(0,1,5),(1,2,5),(2,3,5),(3,4,5),(4,0,5)],'hair','head',.005)
 # Face at +X: small brow/nose/eyes/chin rather than a blank sphere.
 sphere('Nose',(.119,0,1.675),(.026,.026,.035),'skin','head',12,8)
 for y in [-.053,.053]:
  sphere('Eye dark '+str(y),(.109,y,1.70),(.013,.017,.009),'black','head',12,8)
  sphere('Eye glint '+str(y),(.119,y-.004,1.703),(.004,.006,.004),'edge','head',8,6)
 sphere('Squared chin',(.065,0,1.565),(.064,.070,.04),'skin','head')
 mesh('Chest silver crest',[(.202,-.065,1.25),(.225,0,1.33),(.202,.065,1.25),(.22,0,1.16)],[(0,1,2,3)],'edge','chest',.005)
 mesh('Shield brass diamond',[(.353,.31,1.30),(.36,.23,1.12),(.353,.31,.94),(.36,.39,1.12)],[(0,1,2,3)],'gold','hand.L',.007)
 for y in [-.16,.16]:
  segment('Belt strap '+str(y),(.14,y,1.02),(.14,y,1.37),.018,.018,'leather','chest')
# Locked camera, physical lighting, no downloaded assets.
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=12;scene.cycles.use_denoising=True;scene.render.threads_mode='FIXED';scene.render.threads=2
scene.render.film_transparent=True;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.render.resolution_percentage=100;scene.view_settings.view_transform='AgX'
scene.world.color=(.5,.5,.5)
def area(name,loc,power,size):
 bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.name=name;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector((0,0,1))-o.location).to_track_quat('-Z','Y').to_euler()
area('Soft warm key',(3,-4,6),550,4);area('Cool edge',(1,4,3),420,3);area('Front fill',(-3,-2,2.5),180,4)
bpy.ops.object.camera_add(location=CONFIG['camera']);camera=bpy.context.object;camera.name='Locked game review camera';camera.rotation_euler=(Vector(CONFIG['target'])-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=CONFIG['ortho'];scene.camera=camera
# Put the ground origin at exact foot anchor (128,220), independent of clip bounds.
# Orthographic camera target is adjusted from desired foot projection, keeping fixed orientation.
from bpy_extras.object_utils import world_to_camera_view
scene.render.resolution_x=256;scene.render.resolution_y=256
bpy.context.view_layer.update();v=world_to_camera_view(scene,camera,Vector((0,0,.02)))
# camera local Y axis is screen-up; shift to desired normalized y=(256-220)/256.
up=camera.matrix_world.to_quaternion()@Vector((0,1,0));camera.location += up*((v.y-(256-220)/256)*CONFIG['ortho']);bpy.context.view_layer.update()
CLIPS={'stand':{'start':0,'count':8,'fps':12,'loop':True},'walk':{'start':8,'count':12,'fps':16,'loop':True},'atk':{'start':20,'count':12,'fps':20,'loop':False,'cueFrame':5},'hit':{'start':32,'count':6,'fps':20,'loop':False},'die':{'start':38,'count':16,'fps':20,'loop':False}}
def rotation(name,axis,angle):
 b=rig.pose.bones[name];q=b.bone.matrix_local.to_quaternion();b.rotation_mode='QUATERNION';b.rotation_quaternion=q.inverted()@Quaternion(axis,angle)@q

def pose(status,t):
 for b in rig.pose.bones:b.rotation_mode='QUATERNION';b.rotation_quaternion=(1,0,0,0);b.location=(0,0,0)
 phase=t*2*math.pi
 if status=='stand':
  rotation('chest',(0,1,0),math.sin(phase)*.022);rotation('upper_arm.R',(0,1,0),.07+math.sin(phase)*.018);rotation('forearm.L',(0,1,0),-.55);rotation('head',(0,0,1),.045*math.sin(phase))
 elif status=='walk':
  for side,offset in [('R',0),('L',math.pi)]:
   a=phase+offset;rotation('thigh.'+side,(0,1,0),.48*math.sin(a));rotation('shin.'+side,(0,1,0),-.08+.48*max(0,-math.sin(a)));rotation('foot.'+side,(0,1,0),-.12*math.sin(a));rotation('upper_arm.'+side,(0,1,0),-.22*math.sin(a))
  rig.pose.bones['root'].location.z=.028*(1-math.cos(phase*2));rotation('forearm.L',(0,1,0),-.55);rotation('chest',(0,1,0),-.08)
 elif status=='atk':
  keys=[(0,.0),(.25,-2.4),(.455,-1.1),(.7,-.2),(1,0)]
  a=0
  for (u,av),(v,bv) in zip(keys,keys[1:]):
   if u<=t<=v:a=av+(bv-av)*(t-u)/(v-u);break
  rotation('upper_arm.R',(0,1,0),a);rotation('forearm.R',(0,1,0),-.25*math.sin(math.pi*t));rotation('chest',(0,0,1),.25*math.sin(2*math.pi*t));rotation('chest',(0,1,0),-.14*math.sin(math.pi*t));rotation('forearm.L',(0,1,0),-.45);rig.pose.bones['root'].location.x=.10*math.sin(math.pi*t)
 elif status=='hit':
  f=math.sin(math.pi*t);rotation('chest',(0,1,0),-.25*f);rotation('head',(0,1,0),-.12*f);rotation('upper_arm.L',(0,1,0),-.25*f);rotation('forearm.L',(0,1,0),-.55)
 elif status=='die':
  f=(1-math.cos(math.pi*t))*.5;rotation('root',(0,1,0),-1.50*f);rig.pose.bones['root'].location.z=.035*f;rig.pose.bones['root'].location.x=.48*f;rotation('thigh.R',(0,1,0),.35*f);rotation('shin.L',(0,1,0),.6*f);rotation('upper_arm.R',(0,1,0),-.8*f);rotation('upper_arm.L',(0,1,0),.6*f);rotation('forearm.L',(0,1,0),-.2)
 bpy.context.view_layer.update()
if opt.stage in ['blockout','detail']:
 pose('stand',0)
 # Four inspection views, main camera never changed between stages.
 for name,loc in [('main',CONFIG['camera']),('front',(6,0,2.8)),('side',(0,-6,2.8)),('three-quarter',(4,-6,3.5))]:
  if name!='main':camera.location=loc;camera.rotation_euler=(Vector(CONFIG['target'])-camera.location).to_track_quat('-Z','Y').to_euler()
  scene.render.resolution_x=512;scene.render.resolution_y=512;scene.render.filepath=os.path.join(out,opt.stage+'-'+name+'.png');bpy.ops.render.render(write_still=True)
 bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out,opt.stage+'.blend'))
else:
 scene.render.resolution_x=256;scene.render.resolution_y=256;scene.render.fps=20
 for status,clip in CLIPS.items():
  for i in range(clip['count']):
   frame=clip['start']+i;scene.frame_set(frame+1)
   t=i/clip['count'] if clip['loop'] else i/(clip['count']-1);pose(status,t)
   for bone in rig.pose.bones:bone.keyframe_insert('rotation_quaternion',frame=frame+1,group=bone.name);bone.keyframe_insert('location',frame=frame+1,group=bone.name)
   scene.render.filepath=os.path.join(out,f'{frame:03}-{status}.png');bpy.ops.render.render(write_still=True)
 scene.frame_start=1;scene.frame_end=54
 bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out,'guard-rig.blend'))
 report={'config':CONFIG,'clips':CLIPS,'objects':len(col.objects),'materials':len(M),'bones':len(rigdata.bones),'vertices':sum(len(o.data.vertices) for o in col.objects if o.type=='MESH'),'source':'Original Python-authored geometry, materials and skeletal animation; no downloaded model or texture','foot':[128,220]}
 with open(os.path.join(out,'guard-build.json'),'w')as f:json.dump(report,f,indent=2)
