"""Blender 4.1: build an editable, six-second Microcraft outro."""
import bpy
import math
import random
import json
import sys
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'video' / 'output'
OUT.mkdir(parents=True, exist_ok=True)
random.seed(27)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.eevee.taa_render_samples = 32
scene.eevee.use_gtao = True
scene.eevee.gtao_distance = 3
scene.eevee.gtao_factor = 1.3
scene.eevee.use_soft_shadows = True
scene.render.resolution_x = 1920
scene.render.resolution_y = 1080
scene.render.resolution_percentage = 100
scene.render.fps = 24
scene.frame_start = 1
scene.frame_end = 144
scene.world.color = (0.035, 0.035, 0.035)
scene.view_settings.view_transform = 'AgX'
scene.render.film_transparent = False

def material(name, color, metallic=0, roughness=.45, emission=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metallic
    p.inputs['Roughness'].default_value = roughness
    p.inputs['Emission Color'].default_value = (*color, 1)
    p.inputs['Emission Strength'].default_value = emission
    return m

black = material('PCB / graphite', (.012, .024, .03), .45)
edge = material('Brushed metal', (.22, .29, .31), .8, .3)
gold = material('Gold edge contacts', (.92, .58, .11), .7, .3)
green = material('Signal / electric lime', (.48, 1, .10), .15, .25, 2)
white = material('Warm ivory', (.85, .94, .85), .05, .45, .25)
red = material('LED red', (1, .035, .06), .1, .3, 4)
off = material('Unlit LED', (.065, .013, .02))
dirt = material('Island earth', (.13, .071, .035))
grass = material('Island grass', (.20, .40, .055))
floor = material('Midnight stage', (.008, .016, .027), .22, .55)
wood = material('Oak planks', (.44, .26, .095))
log = material('Oak bark', (.18, .093, .032))
spruce = material('Spruce planks', (.22, .11, .045))
glass = material('Stylized window glass', (.16, .51, .64), .6, .15)
stones = [material('Stone tone %d' % i, (.26+i*.018, .30+i*.018, .32+i*.018)) for i in range(5)]

def cube(name, loc, scale, mat, bevel=0, parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.object
    o.name = name
    o.location = loc
    o.dimensions = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(mat)
    if bevel:
        m = o.modifiers.new('Soft machined edges', 'BEVEL'); m.width = bevel; m.segments = 2
        o.modifiers.new('Weighted corner normals', 'WEIGHTED_NORMAL')
    if parent: o.parent = parent
    return o

def empty(name, loc=(0,0,0)):
    o = bpy.data.objects.new(name, None); scene.collection.objects.link(o); o.location = loc; return o

def key(o, prop, value, frame):
    setattr(o, prop, value); o.keyframe_insert(data_path=prop, frame=frame)

def enter(o, delay=0, lift=5):
    dest = o.location.copy()
    key(o, 'location', dest + Vector((0,0,lift)), 1 + delay)
    key(o, 'location', dest, 32 + delay)

cube('Infinite midnight stage', (0,0,-.45), (200,200,.5), floor)
board = empty('MICROBIT / floating assembly', (-4.1, .2, 2.3))
board.rotation_euler[2] = -.10
cube('Microbit v2 PCB', (0,0,0), (3.5,.20,2.9), black, .16, board)
cube('Copper inset edge', (0,.025,-.08), (3.42,.08,2.84), gold, .15, board)
cube('LED matrix backplate', (0,-.15,.22), (1.80,.09,1.80), black, .08, board)
# A pixel pickaxe across the 5x5 display.
pattern = ['11110','00101','00100','01000','10000']
for row in range(5):
    for col in range(5):
        cube('LED %d,%d' % (row,col), ((col-2)*.29,-.22,.82-row*.29), (.14,.055,.14),
             red if pattern[row][col] == '1' else off, .02, board)
for x in [-1.34, 1.34]:
    cube('Button housing', (x,-.18,.25), (.48,.13,.48), edge, .06, board)
    cube('Button cap', (x,-.28,.25), (.28,.14,.28), black, .05, board)
for x in [-1.35,-.68,0,.68,1.35]:
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=.23, depth=.08)
    p=bpy.context.object; p.name='Gold connector'; p.parent=board
    p.location=(x,-.14,-1.15); p.rotation_euler[0]=math.pi/2; p.data.materials.append(gold)
cube('USB metal shell', (0,0,1.50), (.66,.34,.25), edge, .04, board)
cube('USB dark socket', (0,-.19,1.50), (.44,.05,.12), black, .02, board)
enter(board, 3, -6)
key(board, 'rotation_euler', (0,0,-.15), 1)
key(board, 'rotation_euler', (0,0,-.10), 50)
key(board, 'rotation_euler', (0,0,-.06), 144)

# Recreate the user's saved above-ground house, using its actual block positions.
saved = (ROOT / 'world/blocks.bin').read_bytes()
palette = json.loads((ROOT / 'host/data/palette.json').read_text())
blocks = [(i%32, i//1024, (i//32)%32, v) for i,v in enumerate(saved) if v and i//1024 >= 8]
minx,maxx = min(p[0] for p in blocks),max(p[0] for p in blocks)
minz,maxz = min(p[2] for p in blocks),max(p[2] for p in blocks)
cx,cz = (minx+maxx)/2,(minz+maxz)/2
unit = min(.46, 3.7/max(maxx-minx+1,maxz-minz+1))
island = empty('WORLD / saved Microcraft house', (3.4, .5, .35))
for ix in range(minx-1,maxx+2):
    for iz in range(minz-1,maxz+2):
        h = random.choice([.48,.62,.76])
        o=cube('Floating earth voxel', ((ix-cx)*unit,(iz-cz)*unit,-h/2), (unit*.99,unit*.99,h), dirt, .025, island)
        enter(o, random.randrange(4,20), -4)
        o=cube('Grass tile', ((ix-cx)*unit,(iz-cz)*unit,.035), (unit*.99,unit*.99,.15), grass, .012, island)
        enter(o, random.randrange(4,20), -4)
for x,y,z,v in blocks:
    name=palette[v]
    mat=glass if 'glass' in name else log if 'log' in name else spruce if 'spruce' in name else wood if 'planks' in name else random.choice(stones)
    o=cube('Saved block / '+name, ((x-cx)*unit,(z-cz)*unit,(y-8+.5)*unit+.11), (unit*.975,)*3, mat, .014, island)
    enter(o, random.randrange(4,24), 12)
key(island,'rotation_euler',(0,0,.10),1)
key(island,'rotation_euler',(0,0,-.07),144)

def curve(name, points, mat, depth):
    data=bpy.data.curves.new(name,'CURVE'); data.dimensions='3D'; data.bevel_depth=depth; data.bevel_resolution=4
    spline=data.splines.new('BEZIER'); spline.bezier_points.add(1)
    a,b=spline.bezier_points
    a.co=points[0]; b.co=points[3]
    for p in (a,b): p.handle_left_type='FREE'; p.handle_right_type='FREE'
    a.handle_left=points[0]; a.handle_right=points[1]
    b.handle_left=points[2]; b.handle_right=points[3]
    ob=bpy.data.objects.new(name,data); scene.collection.objects.link(ob); ob.data.materials.append(mat)
    data.bevel_depth=0; data.keyframe_insert(data_path='bevel_depth',frame=1)
    data.keyframe_insert(data_path='bevel_depth',frame=28)
    data.bevel_depth=depth; data.keyframe_insert(data_path='bevel_depth',frame=40)
    return ob
path=[(-2.5,-.2,1.3),(-1.45,-1.1,.2),(0,-1.35,.05),(1.4,-.7,.4)]
curve('USB tether / outer jacket',path,black,.095)
curve('USB tether / luminous signal',[(x,y-.07,z+.035) for x,y,z in path],green,.021)
def bezier(t):
    a,b,c,d=map(Vector,path)
    return (1-t)**3*a+3*(1-t)**2*t*b+3*(1-t)*t*t*c+t**3*d
for i in range(3):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,radius=.065)
    dot=bpy.context.object; dot.name='Data pulse %d'%i; dot.data.materials.append(green)
    for f in range(1,145,2):
        t=((f-32-i*14)%48)/48
        dot.location=bezier(t)+Vector((0,-.08,.04)); dot.keyframe_insert(data_path='location',frame=f)
        dot.scale=(1,1,1) if f>=41 else (0,0,0); dot.keyframe_insert(data_path='scale',frame=f)

# Orthographic camera and camera-aligned graphic typography.
bpy.ops.object.camera_add(location=(8,-22,13))
camera=bpy.context.object; camera.name='OUTRO / camera'; camera.rotation_euler=(Vector((0,0,1.9))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO'; camera.data.ortho_scale=19.2; scene.camera=camera
fontpath=Path('C:/Windows/Fonts/arialbd.ttf')
font=bpy.data.fonts.load(str(fontpath)) if fontpath.exists() else None
def text(name, body, loc, size, mat, spacing=1.05):
    d=bpy.data.curves.new(name,'FONT'); d.body=body; d.size=size; d.align_x='CENTER'; d.align_y='CENTER'; d.space_character=spacing
    if font: d.font=font
    o=bpy.data.objects.new(name,d); scene.collection.objects.link(o); o.parent=camera; o.location=loc; d.materials.append(mat)
    return o
glyphs={
'M':['10001','11011','10101','10101','10001','10001','10001'],
'I':['11111','00100','00100','00100','00100','00100','11111'],
'C':['01111','10000','10000','10000','10000','10000','01111'],
'R':['11110','10001','10001','11110','10100','10010','10001'],
'O':['01110','10001','10001','10001','10001','10001','01110'],
'A':['01110','10001','10001','11111','10001','10001','10001'],
'F':['11111','10000','10000','11110','10000','10000','10000'],
'T':['11111','00100','00100','00100','00100','00100','00100']}
pixel=.205
for i,char in enumerate('MICROCRAFT'):
    letter=empty('TITLE / '+str(i)+' '+char); letter.parent=camera; letter.location=((i*6-29.5)*pixel,3.00,-16)
    for row,line in enumerate(glyphs[char]):
        for col,on in enumerate(line):
            if on=='1': cube('Title voxel', (col*pixel,(6-row)*pixel,0), (pixel*.90,pixel*.90,.14), white if i<5 else green, .015, letter)
    dest=letter.location.copy()
    key(letter,'location',dest+Vector((0,4.5,0)),1+i*2)
    key(letter,'location',dest,28+i*2)
caption=text('Tagline','TINY BOARD. REAL BLOCKS.',(0,-3.20,-10),.54,white,1.14)
footer=text('Hybrid architecture credit','micro:bit logic   /   PC storage',(0,-4.06,-10),.26,white,1.15)
badge=text('Film label','THE EXPERIMENT CONTINUES',(0,-4.58,-10),.21,green,1.3)
for ob,f in [(caption,40),(footer,49),(badge,59)]:
    key(ob,'scale',(0,0,0),f)
    key(ob,'scale',(1,1,1),f+16)

def area(name,location,power,color,size):
    bpy.ops.object.light_add(type='AREA',location=location)
    o=bpy.context.object; o.name=name; o.data.energy=power; o.data.color=color; o.data.shape='DISK'; o.data.size=size
    o.rotation_euler=(Vector((0,0,1))-o.location).to_track_quat('-Z','Y').to_euler()
area('Key / soft mint',(-6,-8,12),1800,(.79,1,.88),8)
area('Rim / lime',(3,5,9),2200,(.46,1,.16),7)
area('Fill / blue',(8,-3,7),1500,(.27,.53,1),6)
scene.use_nodes=True
nodes=scene.node_tree.nodes; nodes.clear()
rl=nodes.new('CompositorNodeRLayers'); glow=nodes.new('CompositorNodeGlare'); glow.glare_type='FOG_GLOW'; glow.quality='MEDIUM'; glow.threshold=1.4
out=nodes.new('CompositorNodeComposite'); scene.node_tree.links.new(rl.outputs['Image'],glow.inputs['Image']); scene.node_tree.links.new(glow.outputs['Image'],out.inputs['Image'])
for ob in scene.objects:
    if ob.animation_data and ob.animation_data.action:
        for fc in ob.animation_data.action.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation='BEZIER'; kp.handle_left_type='AUTO_CLAMPED'; kp.handle_right_type='AUTO_CLAMPED'
scene.frame_set(112)
scene.render.image_settings.file_format='PNG'
scene.render.filepath=str(OUT/'preview.png')
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'Microcraft_Outro.blend'))
bpy.ops.render.render(write_still=True)
if '--render-video' in sys.argv:
    scene.render.image_settings.file_format='FFMPEG'
    scene.render.ffmpeg.format='MPEG4'; scene.render.ffmpeg.codec='H264'
    scene.render.ffmpeg.constant_rate_factor='MEDIUM'; scene.render.ffmpeg.ffmpeg_preset='GOOD'
    scene.render.filepath=str(OUT/'Microcraft_Outro_1080p.mp4')
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'Microcraft_Outro.blend'))
    bpy.ops.render.render(animation=True)
