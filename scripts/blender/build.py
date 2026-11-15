# Builds a location exported by scripts/loc-export.ts into a Blender scene and renders it with Cycles.
#   blender -b -P scripts/blender/build.py -- <scene dir> <out.png> [--view N|x,y,alt,heading,pitch] [--samples 64]
#       [--res 1920x1080] [--hour H] [--cpu] [--save file.blend]
# World (x east, y up, z = -north) -> Blender (x east, y north, z up) is (x, -z, y).
import bpy, json, math, sys, os
import numpy as np

A = sys.argv[sys.argv.index('--') + 1:]
D, OUT = A[0], A[1]
def opt(k, d=None):
    return A[A.index(k) + 1] if k in A else d
M = json.load(open(os.path.join(D, 'scene.json')))
BIN = np.fromfile(os.path.join(D, 'scene.bin'), dtype=np.uint8)
DT = {'Float32Array': 'f4', 'Uint8Array': 'u1', 'Int32Array': 'i4'}
def arr(r):
    return np.frombuffer(BIN, dtype=DT[r['type']], count=r['len'], offset=r['off'])
def v3(a):  # world (x,y,z) -> blender (x,-z,y)
    a = np.asarray(a, dtype=np.float32).reshape(-1, 3)
    return np.ascontiguousarray(np.stack([a[:, 0], -a[:, 2], a[:, 1]], 1))
def lin(c):  # sRGB bytes 0..1 -> linear
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene
COL = bpy.data.collections.new('city'); scn.collection.children.link(COL)
HID = bpy.data.collections.new('templates'); scn.collection.children.link(HID)
HID.hide_render = True; HID.hide_viewport = True

# ---------- materials ----------
def windows(nt, bs, col):
    """Procedural windows on a wall box: a grid in metres (instance size 'scl' x generated 0..1 coords), side faces only,
    above the ground floor. Windows are dark, glossy and slightly sunk (via colour only)."""
    N = nt.nodes
    def mathn(op, a=None, b=None, clamp=False):
        n = N.new('ShaderNodeMath'); n.operation = op; n.use_clamp = clamp
        for i, v in enumerate((a, b)):
            if v is None: continue
            if isinstance(v, (int, float)): n.inputs[i].default_value = v
            else: nt.links.new(v, n.inputs[i])
        return n.outputs[0]
    def sep(v):
        s = N.new('ShaderNodeSeparateXYZ'); nt.links.new(v, s.inputs[0]); return s.outputs
    tc = N.new('ShaderNodeTexCoord'); sc = N.new('ShaderNodeAttribute'); sc.attribute_name = 'scl'; sc.attribute_type = 'INSTANCER'
    g, n, s = sep(tc.outputs['Generated']), sep(tc.outputs['Normal']), sep(sc.outputs['Vector'])
    # metres along the wall (x faces use y, y faces use x) and up from the ground
    along = mathn('ADD', mathn('MULTIPLY', mathn('MULTIPLY', g['X'], s['X']), mathn('ABSOLUTE', n['Y'])), mathn('MULTIPLY', mathn('MULTIPLY', g['Y'], s['Y']), mathn('ABSOLUTE', n['X'])))
    up = mathn('MULTIPLY', g['Z'], s['Z'])
    cx = mathn('FRACT', mathn('DIVIDE', along, 3.0)); cz = mathn('FRACT', mathn('DIVIDE', up, 3.2))
    inx = mathn('MULTIPLY', mathn('GREATER_THAN', cx, 0.3), mathn('LESS_THAN', cx, 0.68))
    inz = mathn('MULTIPLY', mathn('GREATER_THAN', cz, 0.38), mathn('LESS_THAN', cz, 0.8))
    side = mathn('LESS_THAN', mathn('ABSOLUTE', n['Z']), 0.5)
    above = mathn('GREATER_THAN', up, 0.9)
    wall_h = mathn('GREATER_THAN', s['Z'], 2.2)  # not on sheds
    mask = mathn('MULTIPLY', mathn('MULTIPLY', mathn('MULTIPLY', inx, inz), mathn('MULTIPLY', side, above)), wall_h)
    mx = N.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.inputs[7].default_value = (0.03, 0.04, 0.06, 1)
    nt.links.new(mask, mx.inputs[0]); nt.links.new(col, mx.inputs[6]); nt.links.new(mx.outputs[2], bs.inputs['Base Color'])
    nt.links.new(mathn('SUBTRACT', 0.9, mathn('MULTIPLY', mask, 0.8)), bs.inputs['Roughness'])

def material(name, rough=0.85, metal=0.0, bump=0.0, scale=40.0, inst=False, trans=0.0, ior=1.45, emit=None):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); bs = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bs.outputs['BSDF'], out.inputs['Surface'])
    bs.inputs['Roughness'].default_value = rough; bs.inputs['Metallic'].default_value = metal
    bs.inputs['IOR'].default_value = ior
    if trans: bs.inputs['Transmission Weight'].default_value = trans
    a = nt.nodes.new('ShaderNodeAttribute'); a.attribute_name = 'col'; a.attribute_type = 'GEOMETRY'
    col = a.outputs['Color']
    if inst:
        b = nt.nodes.new('ShaderNodeAttribute'); b.attribute_name = 'icol'; b.attribute_type = 'INSTANCER'
        mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs[0].default_value = 1.0
        nt.links.new(a.outputs['Color'], mx.inputs[6]); nt.links.new(b.outputs['Color'], mx.inputs[7]); col = mx.outputs[2]
    if name == 'water':
        bs.inputs['Base Color'].default_value = (0.05, 0.12, 0.13, 1)
    elif name == 'wall':
        windows(nt, bs, col)
    else:
        nt.links.new(col, bs.inputs['Base Color'])
    if bump:
        tc = nt.nodes.new('ShaderNodeTexCoord'); nz = nt.nodes.new('ShaderNodeTexNoise'); bm = nt.nodes.new('ShaderNodeBump')
        nz.inputs['Scale'].default_value = scale; nz.inputs['Detail'].default_value = 8; nz.inputs['Roughness'].default_value = 0.6
        nt.links.new(tc.outputs['Object'], nz.inputs['Vector']); nt.links.new(nz.outputs['Fac'], bm.inputs['Height'])
        bm.inputs['Strength'].default_value = bump; bm.inputs['Distance'].default_value = 0.2
        nt.links.new(bm.outputs['Normal'], bs.inputs['Normal'])
    if emit:
        bs.inputs['Emission Color'].default_value = emit; bs.inputs['Emission Strength'].default_value = 3.0
    return m

MAT = {
    'terrain': material('terrain', 0.95, bump=0.35, scale=0.6),
    'stone': material('stone', 0.8, bump=0.5, scale=3), 'roof': material('roof', 0.7, bump=0.3, scale=4),
    'dark': material('dark', 0.9), 'glass': material('glass', 0.05, trans=0.0), 'stained': material('stained', 0.1),
    'metal': material('metal', 0.35, metal=0.9), 'water': material('water', 0.02, trans=1.0, ior=1.33),
    'leaf': material('leaf', 0.6), 'road': material('road', 0.9, bump=0.3, scale=6), 'cloth': material('cloth', 0.9),
    'rock': material('rock', 0.9, bump=0.8, scale=0.8), 'wood': material('wood', 0.8, bump=0.2, scale=8),
    'wall': material('wall', 0.9, bump=0.25, scale=5, inst=True), 'roofi': material('roofi', 0.65, bump=0.2, scale=6, inst=True),
    'part': material('part', 0.8, inst=True), 'tree': material('tree', 0.75, bump=0.2, scale=10, inst=True),
    'rocki': material('rocki', 0.95, bump=0.8, scale=1.2, inst=True),
}

# ---------- meshes ----------
def new_obj(name, me, mat, coll=None):
    me.materials.append(mat)
    o = bpy.data.objects.new(name, me); (coll or COL).objects.link(o)
    return o

def tri_mesh(name, pos, nor=None, col=None):
    """Non-indexed triangles: pos (n,3) in blender coords, n % 3 == 0."""
    n = len(pos); me = bpy.data.meshes.new(name)
    me.vertices.add(n); me.vertices.foreach_set('co', pos.ravel())
    me.loops.add(n); me.loops.foreach_set('vertex_index', np.arange(n, dtype=np.int32))
    me.polygons.add(n // 3); me.polygons.foreach_set('loop_start', np.arange(0, n, 3, dtype=np.int32))
    me.update(calc_edges=True)
    if col is not None:
        ca = me.color_attributes.new('col', 'FLOAT_COLOR', 'POINT')
        ca.data.foreach_set('color', np.concatenate([col, np.ones((n, 1), np.float32)], 1).ravel())
    if nor is not None:
        try: me.normals_split_custom_set_from_vertices(nor.tolist())
        except Exception: pass
    return me

def grid_mesh(name, n, size, heights, colors, drop=0.0):
    w = n + 1; ii, jj = np.meshgrid(np.arange(w), np.arange(w))
    pos = np.stack([-size / 2 + ii * size / n, -(-size / 2 + jj * size / n), heights.reshape(w, w) - drop], 2).reshape(-1, 3).astype(np.float32)
    a = (jj[:-1, :-1] * w + ii[:-1, :-1]).ravel(); b = a + 1; c = a + w; d = c + 1
    # flip so faces point up in blender coords
    tris = np.stack([a, b, c, b, d, c], 1).reshape(-1, 3).astype(np.int32)
    me = bpy.data.meshes.new(name); me.vertices.add(len(pos)); me.vertices.foreach_set('co', pos.ravel())
    me.loops.add(len(tris) * 3); me.loops.foreach_set('vertex_index', tris.ravel())
    me.polygons.add(len(tris)); me.polygons.foreach_set('loop_start', np.arange(0, len(tris) * 3, 3, dtype=np.int32))
    me.update(calc_edges=True)
    ca = me.color_attributes.new('col', 'FLOAT_COLOR', 'POINT')
    c3 = lin(colors.reshape(-1, 3).astype(np.float32) / 255.0)
    ca.data.foreach_set('color', np.concatenate([c3, np.ones((len(c3), 1), np.float32)], 1).ravel())
    me.shade_smooth()
    return me

N, SIZE = M['N'], M['size']
H = arr(M['terrain']['heights']).reshape(N + 1, N + 1)
new_obj('terrain', grid_mesh('terrain', N, SIZE, arr(M['terrain']['heights']), arr(M['terrain']['colors'])), MAT['terrain'])
o = M['outer']
new_obj('outer', grid_mesh('outer', o['n'], o['size'], arr(o['heights']), arr(o['colors']), drop=3.0), MAT['terrain'])

def ground(x, north):  # bilinear terrain height at world (x east, north)
    c = SIZE / N; fx = (x + SIZE / 2) / c; fz = (-north + SIZE / 2) / c
    i = int(np.clip(math.floor(fx), 0, N - 1)); j = int(np.clip(math.floor(fz), 0, N - 1)); u = min(max(fx - i, 0), 1); v = min(max(fz - j, 0), 1)
    return float(H[j, i] * (1 - u) * (1 - v) + H[j, i + 1] * u * (1 - v) + H[j + 1, i] * (1 - u) * v + H[j + 1, i + 1] * u * v)

# merged structures, roads, rock, water: one object per material
for m, g in M['geo'].items():
    pos = v3(arr(g['pos'])); nor = v3(arr(g['nor'])); col = lin(arr(g['col']).reshape(-1, 3))
    new_obj(m, tri_mesh(m, pos, nor, col), MAT[m])
if '--no-detail' not in A:
    for t, tier in enumerate(M['detail']):
        for m, g in tier.items():
            new_obj(f'{m}-detail{t}', tri_mesh(m, v3(arr(g['pos'])), v3(arr(g['nor'])), lin(arr(g['col']).reshape(-1, 3))), MAT[m])
for key, src in (('lakes', M['water']), ('rivers', M['rivers']['pos'])):
    p = arr(src)
    if len(p) >= 9: new_obj(key, tri_mesh(key, v3(p[: len(p) // 9 * 9])), MAT['water'])

# ---------- instancing (geometry nodes: Instance on Points) ----------
def gn_group():
    g = bpy.data.node_groups.new('inst', 'GeometryNodeTree')
    g.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
    g.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
    inp = g.nodes.new('NodeGroupInput'); out = g.nodes.new('NodeGroupOutput')
    iop = g.nodes.new('GeometryNodeInstanceOnPoints'); oi = g.nodes.new('GeometryNodeObjectInfo'); oi.transform_space = 'RELATIVE'
    rot = g.nodes.new('FunctionNodeEulerToRotation'); na = g.nodes.new('GeometryNodeInputNamedAttribute'); na.data_type = 'FLOAT_VECTOR'; na.inputs['Name'].default_value = 'rot'
    ns = g.nodes.new('GeometryNodeInputNamedAttribute'); ns.data_type = 'FLOAT_VECTOR'; ns.inputs['Name'].default_value = 'scl'
    g.links.new(inp.outputs[0], iop.inputs['Points']); g.links.new(oi.outputs['Geometry'], iop.inputs['Instance'])
    g.links.new(na.outputs['Attribute'], rot.inputs['Euler']); g.links.new(rot.outputs['Rotation'], iop.inputs['Rotation'])
    g.links.new(ns.outputs['Attribute'], iop.inputs['Scale']); g.links.new(iop.outputs['Instances'], out.inputs[0])
    return g, oi

def instancer(name, geo, mat, pos, yaw, scl, icol, hide_shadow=False):
    """pos world (n,3), yaw radians about world up, scl (n,3), icol (n,3) linear."""
    n = len(pos)
    if n == 0: return
    tpl = bpy.data.meshes.new(name + '-t'); gp = v3(arr(geo['pos'])); gn = v3(arr(geo['nor']))
    t = tri_mesh(name + '-t', gp, gn, lin(arr(geo['col']).reshape(-1, 3)) if geo['col'] else np.ones_like(gp))
    to = new_obj(name + '-t', t, mat, HID)
    pts = bpy.data.meshes.new(name); pts.vertices.add(n); pts.vertices.foreach_set('co', v3(pos).ravel())
    r = pts.attributes.new('rot', 'FLOAT_VECTOR', 'POINT'); e = np.zeros((n, 3), np.float32); e[:, 2] = -yaw; r.data.foreach_set('vector', e.ravel())
    s = pts.attributes.new('scl', 'FLOAT_VECTOR', 'POINT'); sv = np.asarray(scl, np.float32).reshape(n, 3)[:, [0, 2, 1]]; s.data.foreach_set('vector', np.ascontiguousarray(sv).ravel())
    c = pts.attributes.new('icol', 'FLOAT_COLOR', 'POINT'); c.data.foreach_set('color', np.concatenate([icol, np.ones((n, 1), np.float32)], 1).ravel())
    ob = bpy.data.objects.new(name, pts); COL.objects.link(ob)
    g, oi = gn_group(); oi.inputs['Object'].default_value = to
    md = ob.modifiers.new('inst', 'NODES'); md.node_group = g
    if hide_shadow: ob.visible_shadow = False

# camera first (trees pick detail level by distance to it)
def camera():
    v = opt('--view', '0')
    if ',' in v:
        x, y, alt, hd, pt = [float(s) for s in v.split(',')]
    else:
        vw = M['views'][int(v)]; x, y, alt = vw['at']; hd, pt = vw['heading'], vw['pitch']
    z = ground(x, y) - alt if alt < 0 else alt
    c = bpy.data.cameras.new('cam'); c.lens = 28; c.clip_start = 0.5; c.clip_end = 200000
    c.dof.use_dof = False
    ob = bpy.data.objects.new('cam', c); COL.objects.link(ob)
    ob.location = (x, y, z); ob.rotation_euler = (math.radians(90 + pt), 0, math.radians(-hd))
    scn.camera = ob
    return x, y
CX, CY = camera()

# house parts
PS = M['PSTRIDE']; P = arr(M['parts']).reshape(-1, PS); PT = M['PART']
ROOFS = {PT[k] for k in ('gable', 'hip', 'flat', 'dome', 'onion', 'spire', 'mansard', 'pyramid', 'shed')}
for ty in range(len(M['partGeos'])):
    q = P[P[:, 0] == ty]
    if not len(q): continue
    mat = MAT['wall'] if ty == PT['wall'] else MAT['roofi'] if ty in ROOFS else MAT['part']
    instancer(f'part{ty}', M['partGeos'][ty], mat, q[:, 1:4], q[:, 4], q[:, 5:8], q[:, 8:11])

# trees: detailed within 3 km of the camera, simple beyond
TS = M['TSTRIDE']; T = arr(M['trees']).reshape(-1, TS)
near = np.hypot(T[:, 0] - CX, -T[:, 2] - CY) < 3000
yaw_all = (np.arange(len(T)) * 2.399) % 6.28
for kind in range(len(M['treeGeos'])):
    for lvl, sel in ((0, near), (1, ~near)):
        q = T[(T[:, 4] == kind) & sel]; yw = yaw_all[(T[:, 4] == kind) & sel]
        if not len(q): continue
        idx = np.nonzero((T[:, 4] == kind) & sel)[0]
        sy = q[:, 3] * (0.85 + ((idx * 0.37) % 0.3))
        instancer(f'tree{kind}-{lvl}', M['treeGeos'][kind][lvl], MAT['tree'], q[:, 0:3], yw, np.stack([q[:, 3], sy, q[:, 3]], 1), np.repeat(lin(q[:, 5:6]), 3, 1))
R = arr(M['rocks']).reshape(-1, 5)
if len(R): instancer('rocks', M['rockGeo'], MAT['rocki'], R[:, 0:3], R[:, 4], np.repeat(R[:, 3:4], 3, 1), np.full((len(R), 3), 0.3, np.float32))

# ---------- sky, sun, render ----------
hour = float(opt('--hour', M['hour']))
elev = max(math.degrees(math.asin(max(0.0, math.sin(math.pi * (hour - 6) / 12)))), 2.0) if 6 < hour < 18 else 2.0
az = 90 + 15 * (hour - 6)  # compass: east at 6h, south at 12h, west at 18h
world = bpy.data.worlds.new('w'); scn.world = world; world.use_nodes = True
nt = world.node_tree; nt.nodes.clear()
sky = nt.nodes.new('ShaderNodeTexSky'); sky.sky_type = 'MULTIPLE_SCATTERING'; sky.sun_elevation = math.radians(elev)
sky.sun_rotation = math.radians(float(opt('--sunrot', 180 - az)))  # compass -> blender; checked by a probe render
sky.altitude = max(0.0, M['minH']); sky.air_density = 1.0; sky.sun_size = math.radians(0.6); sky.sun_intensity = 1.0
bg = nt.nodes.new('ShaderNodeBackground'); wo = nt.nodes.new('ShaderNodeOutputWorld')
nt.links.new(sky.outputs[0], bg.inputs[0]); nt.links.new(bg.outputs[0], wo.inputs['Surface'])
if '--no-haze' not in A:  # a bounded sphere of thin scattering round the place (a world volume would swallow the sky)
    hm = bpy.data.materials.new('haze'); hm.use_nodes = True; hn = hm.node_tree; hn.nodes.clear()
    vs = hn.nodes.new('ShaderNodeVolumeScatter'); ho = hn.nodes.new('ShaderNodeOutputMaterial')
    vs.inputs['Density'].default_value = float(opt('--haze', 6e-6)); vs.inputs['Color'].default_value = (0.8, 0.88, 1.0, 1); vs.inputs['Anisotropy'].default_value = 0.5
    hn.links.new(vs.outputs[0], ho.inputs['Volume'])
    bpy.ops.mesh.primitive_uv_sphere_add(radius=45000, segments=32, ring_count=16, location=(0, 0, M['minH']))
    hz = bpy.context.active_object; hz.name = 'haze'; hz.data.materials.append(hm); hz.visible_shadow = False
    COL.objects.link(hz); bpy.context.scene.collection.objects.unlink(hz)

w, h = [int(s) for s in opt('--res', '1920x1080').split('x')]
scn.render.engine = 'CYCLES'; scn.render.resolution_x, scn.render.resolution_y = w, h; scn.render.resolution_percentage = 100
cy = scn.cycles; cy.samples = int(opt('--samples', 64)); cy.use_denoising = True; cy.max_bounces = 6; cy.volume_bounces = 1
scn.view_settings.view_transform = 'AgX'; scn.view_settings.look = 'AgX - Punchy'
if '--cpu' not in A:
    p = bpy.context.preferences.addons['cycles'].preferences
    for kind in ('OPTIX', 'CUDA'):
        try:
            p.compute_device_type = kind; p.get_devices(); [setattr(d, 'use', d.type != 'CPU') for d in p.devices]
            if any(d.use for d in p.devices): scn.cycles.device = 'GPU'; break
        except Exception: pass
scn.render.image_settings.file_format = 'PNG'; scn.render.filepath = os.path.abspath(OUT)
if opt('--save'): bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(opt('--save')))
print('rendering', M['name'], w, h, 'samples', cy.samples, 'device', scn.cycles.device, 'sun', elev, az)
bpy.ops.render.render(write_still=True)
print('done', OUT)
