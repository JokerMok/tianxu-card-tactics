"""Authored low-poly tactical miniatures. Blender is the geometry compiler.
STAGED_FIDELITY: -- blockout / detail. Model units are metres; front is -Y.
Exports semantic rigid groups for deterministic animation independent of rules.
"""
import bpy, math, json, sys
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'cocos-client/assets/resources/demo/models'
QA=ROOT/'.ai-dev/results/demo-visual-20260909'
MODE=sys.argv[sys.argv.index('--')+1] if '--' in sys.argv else 'blockout'
DETAIL=MODE=='detail'
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
for mat in list(bpy.data.materials):bpy.data.materials.remove(mat)
PALETTE={'iron':(.065,.086,.09),'gold':(.5,.32,.115),'cloth':(.035,.14,.125),'red':(.34,.046,.026),'skin':(.55,.36,.23),'pale':(.64,.58,.42),'wood':(.17,.094,.046),'jade':(.12,.55,.4),'hair':(.025,.029,.027),'bone':(.4,.4,.31),'stone':(.19,.24,.22),'glow':(1,.24,.035)}
MATS={}
for key,col in PALETTE.items():
 m=bpy.data.materials.new(key);m.diffuse_color=(*col,1);m.use_nodes=True
 bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*col,1);bs.inputs['Metallic'].default_value=.65 if key in ['iron','gold'] else .05;bs.inputs['Roughness'].default_value=.36 if key in ['iron','gold'] else .72
 if key in ['glow','jade']:bs.inputs['Emission Color'].default_value=(*col,1);bs.inputs['Emission Strength'].default_value=.65
 MATS[key]=m
COL=None
PIVOTS={'body':(0,0,0),'head':(0,0,1.55),'armL':(-.3,0,1.42),'armR':(.3,0,1.42),'legL':(-.13,0,.88),'legR':(.13,0,.88),'wingL':(-.15,.12,1.35),'wingR':(.15,.12,1.35),'tail':(0,.25,.4)}
def tag(o,name,mat='iron',group='body'):
 o.name=name;o['group']=group;o.data.materials.append(MATS[mat]);
 for c in list(o.users_collection):c.objects.unlink(o)
 COL.objects.link(o)
 return o
def mesh(name,verts,faces,mat='iron',group='body',bevel=0):
 me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update();o=bpy.data.objects.new(name,me);COL.objects.link(o);o['group']=group;o.data.materials.append(MATS[mat])
 if bevel and DETAIL:
  mod=o.modifiers.new('Forged edge','BEVEL');mod.width=bevel;mod.segments=2
  mod=o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
 return o
def ell(name,pos,scale,mat='iron',group='body',segments=12):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=8,location=pos);o=bpy.context.object;o.scale=scale
 for p in o.data.polygons:p.use_smooth=True
 return tag(o,name,mat,group)
def rod(name,a,b,r,mat='gold',group='body',r2=None,verts=10):
 d=Vector(b)-Vector(a);bpy.ops.mesh.primitive_cone_add(vertices=verts,radius1=r,radius2=r if r2 is None else r2,depth=d.length,location=(Vector(a)+Vector(b))/2)
 o=bpy.context.object;o.rotation_euler=d.to_track_quat('Z','Y').to_euler();return tag(o,name,mat,group)
def box(name,pos,scale,mat='iron',group='body',bevel=.015):
 x,y,z=pos;a,b,c=[s/2 for s in scale]
 return mesh(name,[(x+i*a,y+j*b,z+k*c)for i,j,k in [(-1,-1,-1),(-1,-1,1),(-1,1,-1),(-1,1,1),(1,-1,-1),(1,-1,1),(1,1,-1),(1,1,1)]],[(0,4,6,2),(1,3,7,5),(0,1,5,4),(2,6,7,3),(0,2,3,1),(4,5,7,6)],mat,group,bevel)
def loft(name,rings,mat='iron',group='body',n=12):
 v=[]
 for z,rx,ry,cx,cy in rings:
  v.extend([(cx+rx*math.cos(2*math.pi*i/n),cy+ry*math.sin(2*math.pi*i/n),z)for i in range(n)])
 f=[tuple(reversed(range(n))),tuple(range((len(rings)-1)*n,len(rings)*n))]
 for j in range(len(rings)-1):
  for i in range(n):f.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
 o=mesh(name,v,f,mat,group)
 for p in o.data.polygons:p.use_smooth=True
 return o
def line(name,pts,r=.008,mat='gold',group='body'):
 for i,(a,b) in enumerate(zip(pts,pts[1:])):rod(name+str(i),a,b,r,mat,group,verts=6)
def plate(name,pts,depth=.025,mat='iron',group='body'):
 n=len(pts);verts=pts+[(x,y+depth,z)for x,y,z in pts];faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n)for i in range(n)]
 return mesh(name,verts,faces,mat,group,.008)
def shield(x=-.46,z=.97,group='armL',wide=.47,height=.95):
 p=[(x-wide/2,-.21,z+height*.5),(x+wide/2,-.21,z+height*.5),(x+wide/2,-.25,z-height*.24),(x,-.29,z-height*.6),(x-wide/2,-.25,z-height*.24)]
 plate('Tower shield',p,.075,'iron',group)
 if DETAIL:
  line('Shield rim',p+[p[0]],.012,'gold',group)
  ell('Shield boss',(x,-.255,z+.03),(.09,.035,.09),'gold',group)
  for s in [-1,1]:line('Engraved chevron',[(x+s*.16,-.27,z+.35),(x+s*.09,-.28,z+.12),(x+s*.15,-.29,z-.14),(x,-.30,z-.46)],.007,'gold',group)
def spear(group='armR',x=.41,staff=False):
 rod('Spear shaft',(x,-.05,.25),(x,-.05,2.16),.018,'wood',group)
 if staff:
  ell('Jade focus',(x,-.05,2.08),(.08,.05,.13),'jade',group);rod('Staff collar',(x,-.05,1.89),(x,-.05,1.98),.045,'gold',group)
 else:
  plate('Leaf spear point',[(x,-.085,2.40),(x-.06,-.085,2.16),(x,-.11,2.03),(x+.06,-.085,2.16)],.025,'pale',group)
  if DETAIL:
   for i in range(3):line('Red spear tassel',[(x,-.05,2.05),(x+.08+i*.025,-.06,1.94),(x+.09+i*.035,-.065,1.76)],.012,'red',group)
def bow():
 pts=[(.42,-.12,.67),(.57,-.17,.86),(.60,-.17,1.16),(.55,-.13,1.42),(.40,-.09,1.61)]
 line('Laminated bow',pts,.025,'wood','armR');line('Bowstring',[pts[0],(.40,-.24,1.15),pts[-1]],.004,'pale','armR');rod('Arrow',(.18,-.21,1.15),(.87,-.21,1.15),.008,'wood','armR')
def humanoid(kind):
 female=kind in ['guard','archer','healer','tide','spirit','engineer'];heavy=kind in ['guard','soldier','banner'];robe=kind in ['healer','spirit','tide']
 # realistic 7.5-head proportion, tapered soft anatomy beneath independent armor
 for sign,g in [(-1,'legL'),(1,'legR')]:
  x=sign*.13
  loft('Leg',[(.15,.065,.075,x,-.02),(.43,.075,.067,x,.005),(.51,.07,.065,x,.018),(.70,.095,.09,x,.015),(.93,.095,.10,x,0)],'iron' if heavy else 'cloth',g)
  ell('Boot',(x,-.06,.09),(.076,.14,.085),'iron',g)
  if DETAIL:
   plate('Greave',[(x-.055,-.068,.43),(x+.055,-.068,.43),(x+.045,-.1,.16),(x-.04,-.1,.13)],.018,'gold' if heavy else 'iron',g)
 loft('Torso',[(.86,.16,.105,0,0),(1.02,.17,.11,0,0),(1.14,.145,.105,0,0),(1.36,.235 if heavy else .20,.125,0,0),(1.47,.24 if heavy else .21,.10,0,0)],'iron' if heavy else 'cloth')
 rod('Neck',(0,0,1.44),(0,0,1.58),.055,'skin','head')
 ell('Face',(0,-.006,1.68),(.099,.09,.137),'skin','head',16)
 ell('Hair cap',(0,.02,1.74),(.106,.10,.099),'hair','head',16)
 ell('Topknot',(0,.06,1.88),(.055,.058,.063),'hair','head')
 if DETAIL:
  ell('Nose',(0,-.092,1.68),(.017,.029,.031),'skin','head')
  for s in [-1,1]:
   ell('Eye',(s*.035,-.085,1.707),(.019,.008,.006),'hair','head');line('Brow',[(s*.014,-.086,1.72),(s*.052,-.081,1.727)],.004,'hair','head')
  line('Lips',[(-.025,-.087,1.626),(0,-.092,1.623),(.023,-.087,1.626)],.003,'red','head')
  for s in [-1,1]:line('Hair locks',[(s*.08,-.018,1.76),(s*.09,-.067,1.66),(s*.07,-.049,1.58)],.018,'hair','head')
 for s,g in [(-1,'armL'),(1,'armR')]:
  # elbow bent slightly forward, discrete articulation at the shoulder
  rod('Upper sleeve',(s*.22,0,1.42),(s*.31,-.015,1.16),.074,'iron' if heavy else 'skin',g,r2=.057)
  rod('Forearm',(s*.31,-.015,1.16),(s*.39,-.10,.97),.059,'iron' if heavy else 'skin',g,r2=.041)
  ell('Hand',(s*.40,-.09,.93),(.049,.042,.067),'skin',g)
  if DETAIL:
   for j in range(3):
    plate('Layered shoulder',[(s*(.17+j*.035),-.09,1.46-j*.048),(s*(.31+j*.025),-.08,1.43-j*.048),(s*(.34+j*.024),-.09,1.35-j*.05),(s*(.19+j*.026),-.09,1.38-j*.05)],.17,'gold' if j==0 else 'iron',g)
 # Lower split coat, independent tailored panels, avoids solid primitive skirt
 for i in range(8 if heavy else 6):
  a=2*math.pi*i/(8 if heavy else 6);w=.058 if heavy else .09
  top=(.17*math.cos(a),.12*math.sin(a),.98);bottom=(.29*math.cos(a),.22*math.sin(a),.43 if robe else .59)
  tx=-math.sin(a);ty=math.cos(a)
  p=[(top[0]+tx*w,top[1]+ty*w,top[2]),(top[0]-tx*w,top[1]-ty*w,top[2]),(bottom[0]-tx*w*.85,bottom[1]-ty*w*.85,bottom[2]+.055),(bottom[0]+tx*w*.85,bottom[1]+ty*w*.85,bottom[2])]
  plate('Split coat panel',p,.02,'cloth' if not heavy else 'iron')
  if DETAIL:line('Coat piping',p+[p[0]],.004,'gold')
 if DETAIL:
  loft('Waist belt',[(.98,.181,.121,0,0),(1.045,.176,.119,0,0)],'red')
  ell('Belt buckle',(0,-.125,1.02),(.037,.012,.045),'gold')
  line('Cross collar',[(-.13,-.096,1.46),(.10,-.135,1.2),(-.08,-.119,1.04)],.025,'pale' if kind!='spirit' else 'gold')
  if heavy:
   for row in range(5):
    for col in range(5):
     x=(col-2)*.068;z=1.10+row*.057
     plate('Lamellar plate',[(x-.025,-.13,z+.022),(x+.025,-.13,z+.022),(x+.023,-.142,z-.024),(x-.023,-.142,z-.024)],.018,'gold' if row==4 else 'iron')
  if female:
   ell('Hair fall',(0,.08,1.55),(.085,.055,.16),'hair','head')
 if kind in ['guard','soldier']:
  shield()
  if kind=='guard':sword()
  else:spear()
 elif kind=='archer':bow();wings()
 elif kind=='banner':
  spear();plate('War banner',[(.42,0,2.07),(.9,0,2.07),(.85,.07,1.42),(.46,.02,1.51)],.02,'cloth','armR')
  if DETAIL:line('Banner gold border',[(.45,-.025,2.04),(.86,-.025,2.04),(.83,.03,1.48)],.012,'gold','armR')
 elif kind=='engineer':
  box('Crossbow stock',(.39,-.20,1.05),(.18,.52,.10),'wood','armR');line('Crossbow limbs',[(.12,-.40,1.06),(.39,-.49,1.07),(.65,-.4,1.06)],.025,'gold','armR')
 else:spear(staff=True)
 if kind=='tide':
  for s in [-1,1]:plate('Crest fin',[(s*.06,.04,1.72),(s*.22,.12,1.91),(s*.13,.10,1.61)],.015,'jade','head')
 if kind=='spirit':
  plate('Hanging ritual cloak',[(-.2,.10,1.43),(.2,.10,1.43),(.34,.24,.38),(0,.22,.51),(-.34,.24,.38)],.02,'cloth')
def wings():
 for s,g in [(-1,'wingL'),(1,'wingR')]:
  # Swept layered feathers; separated silhouette visible at a tactical camera
  for i in range(7 if DETAIL else 3):
   t=i/(6 if DETAIL else 2);a=(s*(.16+.24*t),.12,1.40+.04*t);b=(s*(.48+.39*t),.16+.13*t,1.10+.53*t)
   pts=[(a[0],a[1]-.045,a[2]+.04),(b[0],b[1],b[2]+.07),(s*(abs(b[0])+.10),b[1]+.12,b[2]-.28),(a[0],a[1]+.08,a[2]-.06)]
   plate('Flight feather',pts,.028,'iron' if i%2 else 'cloth',g)
def construct(siege=False):
 if siege:
  box('Arched chassis',(0,0,.85),(1.05,.88,.36),'iron');box('Temple core',(0,.08,1.24),(.75,.61,.72),'wood');ell('Furnace',(0,-.28,1.25),(.22,.05,.24),'glow')
  for s in [-1,1]:
   for y,g in [(-.28,'legL'),(.28,'legR')]:
    rod('Drive thigh',(s*.44,y,.88),(s*.64,y,.5),.105,'iron',g);ell('Jade bearing',(s*.64,y,.5),(.13,.11,.13),'gold',g);rod('Drive calf',(s*.64,y,.5),(s*.67,y-.06,.14),.085,'iron',g);box('Foot',(s*.67,y-.1,.07),(.22,.32,.12),'iron',g)
  plate('Front ram',[(-.30,-.47,.93),(.30,-.47,.93),(.20,-.61,.70),(0,-.76,.33),(-.20,-.61,.70)],.10,'iron')
  if DETAIL:
   for x in [-.33,.33]:
    for y in [-.25,.30]:rod('Temple pillar',(x,y,1.10),(x,y,1.66),.037,'gold')
   for x in [-.22,-.11,0,.11,.22]:box('Furnace grille',(x,-.333,1.29),(.021,.025,.42),'iron')
   for s in [-1,1]:line('Ram inlay',[(s*.24,-.49,.9),(s*.14,-.65,.62),(0,-.78,.39)],.017,'gold')
  roof(0,.06,1.64,.99,.89)
 else:
  box('Timber cuirass',(0,0,1.18),(.60,.34,.66),'wood');box('Back frame',(0,.20,1.25),(.70,.10,.80),'iron')
  for s,g in [(-1,'legL'),(1,'legR')]:
   x=s*.19;rod('Pillar leg',(x,0,.3),(x,0,.85),.105,'wood',g);ell('Knee bearing',(x,-.01,.54),(.12,.13,.11),'bone',g);box('Shoe',(x,-.06,.13),(.22,.34,.17),'iron',g)
  for s,g in [(-1,'armL'),(1,'armR')]:
   ell('Shoulder bearing',(s*.40,0,1.38),(.13,.14,.13),'bone',g);rod('Arm spar',(s*.4,0,1.37),(s*.46,0,1.01),.093,'wood',g);ell('Elbow bearing',(s*.46,0,1.01),(.10,.10,.10),'bone',g);rod('Forearm spar',(s*.46,0,1.01),(s*.46,-.07,.78),.088,'wood',g)
  box('Mask',(0,-.01,1.69),(.22,.21,.22),'iron','head');roof(0,.01,1.88,.43,.37,group='head');shield(-.47,.91,'armL',.49,1.10)
  if DETAIL:
   box('Jade visor',(0,-.12,1.69),(.14,.02,.026),'jade','head')
 if DETAIL:
  for s in [-1,1]:
   box('Rivet border',(s*(.34 if siege else .25),-.19,1.20),(.025,.03,.55),'gold')
   for z in [.99,1.15,1.30,1.44]:ell('Rivet',(s*(.34 if siege else .25),-.22,z),(.014,.014,.014),'gold',segments=8)
  box('Inlaid lock',(0,-.195,1.20),(.18,.022,.18),'gold');box('Jade seal',(0,-.216,1.20),(.12,.014,.12),'jade')
def roof(x,y,z,w,d,group='body'):
 verts=[(x-w*.58,y-d*.58,z+.055),(x+w*.58,y-d*.58,z+.055),(x-w*.24,y-d*.22,z+.17),(x+w*.24,y-d*.22,z+.17),(x-w*.58,y+d*.58,z+.055),(x+w*.58,y+d*.58,z+.055),(x-w*.24,y+d*.22,z+.17),(x+w*.24,y+d*.22,z+.17)]
 mesh('Curved temple roof',verts,[(0,1,3,2),(4,6,7,5),(0,2,6,4),(1,5,7,3),(2,3,7,6)],'iron',group)
 if DETAIL:
  line('Upturned eaves',[verts[0],(x,y-d*.55,z),verts[1]],.012,'gold',group)
  line('Ridge',[verts[2],verts[3]],.015,'gold',group)
  for s in [-1,1]:
   for t in [-1,1]:line('Raised roof horn',[(x+s*w*.43,y+t*d*.4,z+.04),(x+s*w*.57,y+t*d*.52,z+.095),(x+s*w*.61,y+t*d*.57,z+.18)],.018,'gold',group)
  for i in range(9):
   xx=x+(i-4)*w*.1
   line('Roof tile rib',[(xx,y-d*.49,z+.035),(xx*.48+x*.52,y-d*.20,z+.18)],.012,'iron',group)
def beast(kind):
 giant=kind in ['behemoth','rhino'];height=.75 if giant else .48;length=.88 if giant else .66
 ell('Animal thorax',(0,0,height),(.30 if giant else .17,length*.5,.28 if giant else .18),'stone' if giant else 'hair')
 ell('Powerful shoulders',(0,-length*.30,height+.08),(.31 if giant else .18,.27,.28 if giant else .18),'stone' if giant else 'hair')
 ell('Skull',(0,-length*.68,height+.09),(.20 if giant else .13,.28 if giant else .20,.21 if giant else .14),'stone' if giant else 'hair','head')
 ell('Muzzle',(0,-length*.90,height-.02),(.15 if giant else .08,.20 if giant else .14,.12 if giant else .065),'bone','head')
 for s in [-1,1]:
  for front,g in [(True,'legL'),(False,'legR')]:
   y=(-.28 if front else .28)*length/.7;x=s*(.21 if giant else .125)
   rod('Animal upper leg',(x,y,height),(x,y+.08,height*.49),.085 if giant else .042,'stone' if giant else 'hair',g,r2=.055 if giant else .027)
   rod('Animal lower leg',(x,y+.08,height*.49),(x,y-.015,.07),.05 if giant else .025,'stone' if giant else 'hair',g,r2=.04 if giant else .02)
   ell('Paw',(x,y-.07,.06),(.085,.11,.065)if giant else(.045,.07,.04),'bone',g)
  ell('Amber eye',(s*(.18 if giant else .104),-length*.73,height+.13),(.018,.018,.014),'glow','head')
  rod('Ear',(s*.10,-length*.5,height+.20),(s*.14,-length*.45,height+.39),.055,'hair','head',r2=.006)
 line('Articulated tail',[(0,length*.42,height),(0,length*.70,height-.06),(.16,length*.95,height+.04)],.05 if giant else .023,'hair','tail')
 if kind=='rhino':rod('Rhino horn',(0,-length*.94,height+.07),(0,-length*1.12,height+.52),.09,'bone','head',r2=.002)
 if giant:
  for y in [-.35,-.1,.15,.38]:
   for s in [-1,1]:rod('Mountain spine',(s*.17,y,height+.2),(s*.34,y+.12,height+.51),.10,'gold',r2=.003)
 if DETAIL:
  for s in [-1,1]:line('Ember flank',[(s*.15,-.16,height+.03),(s*.18,.02,height+.11),(s*.15,.19,height+.02)],.012,'jade' if giant else 'glow')
def stone():
 humanoid('soldier')
 for s in [-1,1]:ell('Rock shoulder',(s*.31,.02,1.43),(.16,.16,.16),'stone','armL' if s<0 else 'armR',8)
 box('Ancient stele',(0,.22,1.15),(.40,.17,.87),'stone')
 if DETAIL:
  for z in [1.0,1.15,1.30]:box('Stele engraving',(0,.313,z),(.21,.01,.025),'jade')

def bird(rider=False):
 ell('Avian breast',(0,0,.58),(.19,.24,.29),'cloth')
 ell('Avian skull',(0,-.14,.89),(.145,.15,.16),'bone','head')
 rod('Hooked beak',(0,-.27,.89),(0,-.42,.78),.08,'gold','head',r2=.004)
 for side in [-1,1]:
  ell('Owl eye',(side*.077,-.257,.918),(.035,.018,.037),'glow','head')
  rod('Talon leg',(side*.12,.01,.42),(side*.14,-.04,.13),.035,'gold','legL' if side<0 else 'legR')
  for toe in [-1,0,1]:rod('Curved talon',(side*.14,-.04,.13),(side*.14+toe*.035,-.16,.06),.009,'bone','legL' if side<0 else 'legR',r2=.003)
  for i in range(7 if DETAIL else 3):
   t=i/(6 if DETAIL else 2);x=side*(.22+.08*t);tip=side*(.64+.28*t)
   plate('Flight vane',[(x,.07,.69),(tip,.05,.68+t*.10),(tip+side*.1,.35+t*.17,.35),(x,.23,.45)],.023,'iron' if i%2 else 'cloth','wingL' if side<0 else 'wingR')
 for i in [-1,0,1]:plate('Tail feathers',[(i*.045,.13,.62),(i*.065+.055,.46,.51),(i*.08,.70,.37),(i*.065-.055,.46,.51)],.016,'iron','tail')
 if rider:
  before=set(COL.objects);humanoid('archer')
  for obj in set(COL.objects)-before:
   obj.scale*=.56;obj.location*=.56;obj.location.z+=.56

def sword():
 rod('Sword grip',(.41,-.05,.77),(.41,-.05,.98),.025,'wood','armR')
 rod('Sword guard',(.31,-.05,.99),(.51,-.05,.99),.018,'gold','armR')
 plate('Forged sword blade',[(.377,-.07,1.01),(.443,-.07,1.01),(.443,-.07,1.58),(.41,-.08,1.73),(.377,-.07,1.58)],.025,'pale','armR')

KINDS=['bird','rider','guard','soldier','archer','healer','banner','tide','spirit','engineer','construct','siege','hound','behemoth','rhino','stone']
ASSETS={}
for kind in KINDS:
 COL=bpy.data.collections.new(kind);bpy.context.scene.collection.children.link(COL)
 if kind in ['bird','rider']:bird(kind=='rider')
 elif kind in ['construct','siege']:construct(kind=='siege')
 elif kind in ['hound','behemoth','rhino']:beast(kind)
 elif kind=='stone':stone()
 else:humanoid(kind)
 ASSETS[kind]=COL
# Render staged representative lineup. Fixed camera across gates.
for col in ASSETS.values():col.hide_render=True
show=['guard','soldier','archer','construct','siege','hound'] if 'extras' not in sys.argv else ['bird','rider','guard','archer','siege','hound']
for i,kind in enumerate(show):
 col=ASSETS[kind];col.hide_render=False
 for o in col.objects:o.location.x+=(i-2.5)*1.85
# Ground and lighting only in QA, excluded from export
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.012));ground=bpy.context.object;ground.name='QA ground';ground.data.materials.append(MATS['stone'])
world=bpy.context.scene.world or bpy.data.worlds.new('World');bpy.context.scene.world=world;world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.14,.17,.18,1);world.node_tree.nodes['Background'].inputs[1].default_value=.5
for name,loc,power,size in [('Key',(-4,-5,7),1800,6),('Fill',(4,-2,5),1200,5),('Rim',(1,4,5),2300,4)]:
 bpy.ops.object.light_add(type='AREA',location=loc);lamp=bpy.context.object;lamp.name=name;lamp.data.energy=power;lamp.data.shape='DISK';lamp.data.size=size;lamp.rotation_euler=(Vector((0,0,1))-lamp.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(4,-12,5));cam=bpy.context.object;cam.rotation_euler=(Vector((0,0,1))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=12.3;bpy.context.scene.camera=cam
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.render.resolution_x=1800;scene.render.resolution_y=650;scene.render.resolution_percentage=100;scene.view_settings.view_transform='AgX';scene.render.filepath=str(QA/(f'{MODE}'+('-extras' if 'extras' in sys.argv else '')+'-lineup.png'));bpy.ops.render.render(write_still=True)
for view,location in [('front',(0,-14,2.7)),('side',(11,-5,4)),('threequarter',(4,-12,5))]:
 cam.location=location;cam.rotation_euler=(Vector((0,0,1))-cam.location).to_track_quat('-Z','Y').to_euler();scene.render.filepath=str(QA/f'{MODE}-{view}.png');bpy.ops.render.render(write_still=True)
# Restore local coordinates after QA.
for i,kind in enumerate(show):
 for o in ASSETS[kind].objects:o.location.x-=(i-2.5)*1.85
for col in ASSETS.values():col.hide_render=False
if DETAIL:
 deps=bpy.context.evaluated_depsgraph_get();catalog={}
 for kind,col in ASSETS.items():
  groups={}
  for obj in col.objects:
   if obj.type!='MESH':continue
   ev=obj.evaluated_get(deps);me=ev.to_mesh();me.calc_loop_triangles();mat=obj.data.materials[0].name;group=obj.get('group','body');pivot=Vector(PIVOTS.get(group,(0,0,0)))
   record=groups.setdefault(group+'|'+mat,{'group':group,'material':mat,'pivot':[pivot.x,pivot.z,-pivot.y],'positions':[],'normals':[],'indices':[]})
   normal_matrix=obj.matrix_world.to_3x3().inverted().transposed()
   for tri in me.loop_triangles:
    for li in tri.loops:
     vertex=me.vertices[me.loops[li].vertex_index];p=obj.matrix_world@vertex.co-pivot;n=(normal_matrix@vertex.normal).normalized()
     record['indices'].append(len(record['positions'])//3);record['positions'].extend([round(p.x,5),round(p.z,5),round(-p.y,5)]);record['normals'].extend([round(n.x,5),round(n.z,5),round(-n.y,5)])
   ev.to_mesh_clear()
  catalog[kind]=list(groups.values())
 OUT.mkdir(parents=True,exist_ok=True);(OUT/'characters.json').write_text(json.dumps({'version':1,'materials':PALETTE,'models':catalog},separators=(',',':')))
 bpy.ops.wm.save_as_mainfile(filepath=str(QA/'characters.blend'))
 (QA/'geometry-report.json').write_text(json.dumps({k:{'triangles':sum(len(g['indices'])//3 for g in v),'drawGroups':len(v)}for k,v in catalog.items()},indent=2))
print('ASSET_STAGE_COMPLETE',MODE)
