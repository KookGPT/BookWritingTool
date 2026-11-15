# Stones Hold: a mountain-range city in Blender (standalone, like cathedral.py). Reuses cathedral.py's helpers, kits and materials.
#   blender -b -P scripts/blender/stones_hold.py -- <out dir> [--shots a,b] [--samples N] [--res WxH] [--save f.blend] [--only terrain,city,walls,heroes,atmo] [--top]
# World layout, terrain and hero platforms: sh_world.py (pure numpy). City fabric: sh_city.py. Platform walls: sh_walls.py. Hero structures: sh_heroes.py.
import sys, os
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
_lib = open(os.path.join(HERE, 'cathedral.py'), encoding='utf8').read().split("make_materials(); log('materials')")[0]
exec(compile(_lib, 'cathedral_lib', 'exec'), globals())   # helpers, kits, Acc/B/F/lbox/statue/..., stone_mat, tile_mat, simple, glass_mat, MATS
import sh_world as W

ONLY = set(opt('--only', 'terrain,city,walls,heroes,atmo').split(','))
def load(name): exec(compile(open(os.path.join(HERE, name), encoding='utf8').read(), name, 'exec'), globals())

# ============================================================ vectorised mesh helper (non-shared vertices, any uniform face size)
def mk_obj(name, P, mat, uv=None, col=None, smooth=False, coll=None):
    """P: (N, k, 3) faces of k vertices. uv: (N, k, 2). col: (N, k, 4) or (N, 4) per face or per vertex-colour 'c'."""
    P = np.asarray(P, np.float32); N, k, _ = P.shape
    if N == 0: return None
    me = bpy.data.meshes.new(name); me.vertices.add(N * k); me.vertices.foreach_set('co', P.reshape(-1, 3).ravel())
    me.loops.add(N * k); me.loops.foreach_set('vertex_index', np.arange(N * k, dtype=np.int32))
    me.polygons.add(N); me.polygons.foreach_set('loop_start', np.arange(0, N * k, k, dtype=np.int32))
    me.update(calc_edges=True)
    if smooth: me.shade_smooth()
    if uv is not None:
        l = me.uv_layers.new(name='uv'); l.data.foreach_set('uv', np.asarray(uv, np.float32).reshape(-1, 2).ravel())
    if col is not None:
        c = np.asarray(col, np.float32)
        if c.ndim == 2: c = np.repeat(c[:, None, :], k, 1)
        ca = me.color_attributes.new('c', 'FLOAT_COLOR', 'POINT'); ca.data.foreach_set('color', c.reshape(-1, 4).ravel())
    me.materials.append(MATS[mat]); o = bpy.data.objects.new(name, me); scn.collection.objects.link(o); return o

def rotz(x, y, yaw): c, s = np.cos(yaw), np.sin(yaw); return x * c - y * s, x * s + y * c

# ============================================================ terrain mesh + sampling grid
GC = float(opt('--gc', 5.0)); GX0 = -3900.0; GX1 = 3900.0; GY0, GY1 = GX0, GX1
_gxs = np.arange(GX0, GX1 + GC, GC); _gys = np.arange(GY0, GY1 + GC, GC)
CACHE = os.path.join(HERE, '..', '..', 'test', 'out', 'sh', 'cache'); os.makedirs(CACHE, exist_ok=True)
import hashlib
_WKEY = W.TERRAIN_VERSION
def chunked_height(X, Y, step=400000):
    sh = X.shape; x = X.ravel(); y = Y.ravel(); out = np.empty(len(x), np.float32)
    for c in range(0, len(x), step): out[c:c + step] = W.height(x[c:c + step], y[c:c + step])
    return out.reshape(sh)
HG = None
def hgrid():
    global HG
    if HG is None:
        f = os.path.join(CACHE, f'hg_{_WKEY}_{GC}.npy')
        if os.path.exists(f): HG = np.load(f)
        else: X, Y = np.meshgrid(_gxs, _gys); HG = chunked_height(X, Y); np.save(f, HG)
        log(f'height grid {HG.shape}')
    return HG
def H(x, y):
    """Bilinear ground height at world x, y (arrays ok)."""
    g = hgrid(); fx = np.clip((np.asarray(x) - GX0) / GC, 0, g.shape[1] - 1.001); fy = np.clip((np.asarray(y) - GY0) / GC, 0, g.shape[0] - 1.001)
    ix = fx.astype(int); iy = fy.astype(int); tx = fx - ix; ty = fy - iy
    return (g[iy, ix] * (1 - tx) * (1 - ty) + g[iy, ix + 1] * tx * (1 - ty) + g[iy + 1, ix] * (1 - tx) * ty + g[iy + 1, ix + 1] * tx * ty)
def slope(x, y, d=4.0): return np.hypot(H(x + d, y) - H(x - d, y), H(x, y + d) - H(x, y - d)) / (2 * d)

def build_terrain2():
    n = int(opt('--tn', 2000)); u = np.linspace(-1, 1, n + 1); E_IN, E_OUT, U0 = 3500.0, 9500.0, 0.55; A = (E_OUT - E_IN - E_IN / U0 * (1 - U0)) / (1 - U0) ** 2
    a_ = np.abs(u); ax = np.sign(u) * np.where(a_ <= U0, E_IN / U0 * a_, E_IN + E_IN / U0 * (a_ - U0) + A * (a_ - U0) ** 2)
    f = os.path.join(CACHE, f'tm_{_WKEY}_{n}.npy')
    if os.path.exists(f): Z = np.load(f)
    else: X, Y = np.meshgrid(ax, ax); Z = chunked_height(X, Y); np.save(f, Z)
    X, Y = np.meshgrid(ax, ax); pos = np.stack([X, Y, Z], 2).reshape(-1, 3).astype(np.float32)
    ii, jj = np.meshgrid(np.arange(n), np.arange(n)); a = (jj * (n + 1) + ii).ravel(); b = a + 1; c = a + n + 1; d = c + 1
    tris = np.stack([a, d, b, a, c, d], 1).reshape(-1, 3).astype(np.int32)
    me = bpy.data.meshes.new('terrain'); me.vertices.add(len(pos)); me.vertices.foreach_set('co', pos.ravel())
    me.loops.add(len(tris) * 3); me.loops.foreach_set('vertex_index', tris.ravel())
    me.polygons.add(len(tris)); me.polygons.foreach_set('loop_start', np.arange(0, len(tris) * 3, 3, dtype=np.int32))
    me.update(calc_edges=True); me.shade_smooth(); return me

# ============================================================ materials
def terrain_mat2():
    m, nt, bs = base_mat('terrain'); g = NN(nt, 'ShaderNodeNewGeometry'); n = SEP(nt, g.outputs['Normal']); p = SEP(nt, g.outputs['Position'])
    nz = NN(nt, 'ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 0.012; nz.inputs['Detail'].default_value = 8; nt.links.new(g.outputs['Position'], nz.inputs['Vector'])
    n2 = NN(nt, 'ShaderNodeTexNoise'); n2.inputs['Scale'].default_value = 0.35; n2.inputs['Detail'].default_value = 10; nt.links.new(g.outputs['Position'], n2.inputs['Vector'])
    st = NN(nt, 'ShaderNodeTexNoise'); st.inputs['Scale'].default_value = 0.7; st.inputs['Detail'].default_value = 5; sv_ = NN(nt, 'ShaderNodeCombineXYZ')
    nt.links.new(MATH(nt, 'MULTIPLY', p['X'], 0.05), sv_.inputs[0]); nt.links.new(MATH(nt, 'MULTIPLY', p['Y'], 0.05), sv_.inputs[1]); nt.links.new(MATH(nt, 'MULTIPLY', p['Z'], 0.55), sv_.inputs[2]); nt.links.new(sv_.outputs[0], st.inputs['Vector'])
    rock = MIX(nt, (0.045, 0.046, 0.052, 1), (0.16, 0.15, 0.15, 1), st.outputs['Fac'])
    rock = MIX(nt, rock, (0.02, 0.02, 0.024, 1), RAMP(nt, nz.outputs['Fac'], [(0.45, (0, 0, 0, 1)), (0.7, (1, 1, 1, 1))]))
    rock = MIX(nt, rock, (0.20, 0.17, 0.13, 1), MATH(nt, 'MULTIPLY', RAMP(nt, n2.outputs['Fac'], [(0.55, (0, 0, 0, 1)), (0.8, (1, 1, 1, 1))]), 0.35))   # ochre scree
    flat = MATH(nt, 'ADD', n['Z'], MATH(nt, 'MULTIPLY', n2.outputs['Fac'], 0.16))
    pine = RAMP(nt, MATH(nt, 'MULTIPLY', RAMP(nt, flat, [(0.72, (0, 0, 0, 1)), (0.9, (1, 1, 1, 1))]), RAMP(nt, MATH(nt, 'SUBTRACT', 620.0, p['Z']), [(0.0, (0, 0, 0, 1)), (200.0, (1, 1, 1, 1))])), [(0.0, (0, 0, 0, 1)), (0.5, (1, 1, 1, 1))])
    col = MIX(nt, rock, MIX(nt, (0.015, 0.03, 0.02, 1), (0.04, 0.05, 0.03, 1), n2.outputs['Fac']), MATH(nt, 'MULTIPLY', pine, 0.9))
    snowline = MATH(nt, 'ADD', MATH(nt, 'MULTIPLY', MATH(nt, 'SUBTRACT', p['Z'], 640.0), 0.0019), MATH(nt, 'MULTIPLY', flat, 1.0))
    snow = RAMP(nt, MATH(nt, 'ADD', snowline, MATH(nt, 'MULTIPLY', st.outputs['Fac'], 0.35)), [(0.92, (0, 0, 0, 1)), (1.12, (1, 1, 1, 1))])
    col = MIX(nt, col, (0.42, 0.47, 0.56, 1), snow)
    depth = MATH(nt, 'SUBTRACT', float(W.LAKE_Z), p['Z']); inlake = MATH(nt, 'MULTIPLY', RAMP(nt, depth, [(-0.5, (0, 0, 0, 1)), (0.6, (1, 1, 1, 1))]), RAMP(nt, p['Y'], [(W.DAM_Y + 8.0, (0, 0, 0, 1)), (W.DAM_Y + 45.0, (1, 1, 1, 1))]))
    bed = RAMP(nt, depth, [(0.0, (0.5, 0.48, 0.4, 1)), (1.5, (0.42, 0.56, 0.5, 1)), (5.0, (0.12, 0.62, 0.6, 1)), (14.0, (0.04, 0.34, 0.44, 1)), (40.0, (0.01, 0.1, 0.2, 1))]); col = MIX(nt, col, bed, inlake)
    nt.links.new(col, bs.inputs['Base Color']); bs.inputs['Roughness'].default_value = 0.9
    bm_ = NN(nt, 'ShaderNodeBump'); bm_.inputs['Strength'].default_value = 1.0; bm_.inputs['Distance'].default_value = 1.5
    nt.links.new(MATH(nt, 'ADD', MATH(nt, 'MULTIPLY', n2.outputs['Fac'], 1.0), MATH(nt, 'MULTIPLY', st.outputs['Fac'], 1.6)), bm_.inputs['Height']); nt.links.new(bm_.outputs['Normal'], bs.inputs['Normal']); return m

def wallpaper(m, nt, bs, uvn, lit_p=0.24, strength=6.5, pal=((0.06, 0.055, 0.05), (0.12, 0.105, 0.09), (0.2, 0.17, 0.13)), win=(1.0, 1.4), cell=(2.7, 3.1)):
    """Wall colour + procedural lit windows from the face's own UV (u metres along the wall, v metres above the floor) and the vertex colour 'c' (r tone, g lit chance)."""
    at = NN(nt, 'ShaderNodeAttribute', attribute_name='c', attribute_type='GEOMETRY'); cr = SEP(nt, at.outputs['Vector'])
    u = SEP(nt, uvn.outputs['UV']); cu = MATH(nt, 'DIVIDE', MATH(nt, 'ADD', u['X'], MATH(nt, 'MULTIPLY', cr['X'], 37.0)), cell[0]); cv = MATH(nt, 'DIVIDE', u['Y'], cell[1])
    fu = MATH(nt, 'FRACT', cu); fv = MATH(nt, 'FRACT', cv)
    ax = MATH(nt, 'LESS_THAN', MATH(nt, 'ABSOLUTE', MATH(nt, 'SUBTRACT', fu, 0.5)), win[0] / cell[0] / 2); ay = MATH(nt, 'LESS_THAN', MATH(nt, 'ABSOLUTE', MATH(nt, 'SUBTRACT', fv, 0.58)), win[1] / cell[1] / 2)
    above = MATH(nt, 'GREATER_THAN', u['Y'], 1.6)
    wmask = MATH(nt, 'MULTIPLY', MATH(nt, 'MULTIPLY', ax, ay), above)
    idv = NN(nt, 'ShaderNodeCombineXYZ'); nt.links.new(MATH(nt, 'FLOOR', cu), idv.inputs[0]); nt.links.new(MATH(nt, 'FLOOR', cv), idv.inputs[1]); nt.links.new(MATH(nt, 'MULTIPLY', cr['X'], 91.0), idv.inputs[2])
    wn = NN(nt, 'ShaderNodeTexWhiteNoise', noise_dimensions='3D'); nt.links.new(idv.outputs[0], wn.inputs['Vector'])
    lit = MATH(nt, 'LESS_THAN', wn.outputs['Value'], MATH(nt, 'MULTIPLY', cr['Y'], lit_p))
    tone = RAMP(nt, cr['X'], [(0.0, rgb(pal[0])), (0.5, rgb(pal[1])), (1.0, rgb(pal[2]))])
    gz = NN(nt, 'ShaderNodeTexNoise'); gz.inputs['Scale'].default_value = 0.9; gz.inputs['Detail'].default_value = 6; gv = NN(nt, 'ShaderNodeCombineXYZ')
    nt.links.new(MATH(nt, 'MULTIPLY', u['X'], 0.6), gv.inputs[0]); nt.links.new(MATH(nt, 'MULTIPLY', u['Y'], 0.12), gv.inputs[1]); nt.links.new(gv.outputs[0], gz.inputs['Vector'])
    col = MIX(nt, tone, RAMP(nt, gz.outputs['Fac'], [(0.35, (0.45, 0.45, 0.45, 1)), (0.7, (1.15, 1.12, 1.1, 1))]), 1.0, 'MULTIPLY')
    col = MIX(nt, col, (0.012, 0.014, 0.02, 1), wmask)
    nt.links.new(col, bs.inputs['Base Color']); bs.inputs['Roughness'].default_value = 0.9
    nt.links.new(MIX(nt, (0, 0, 0, 1), (1.0, 0.5, 0.18, 1), MATH(nt, 'MULTIPLY', wmask, lit)), bs.inputs['Emission Color']); bs.inputs['Emission Strength'].default_value = strength
    return m

def roof_mat(name, pal, snow=0.25):
    m, nt, bs = base_mat(name); g = NN(nt, 'ShaderNodeNewGeometry'); n = SEP(nt, g.outputs['Normal']); p = SEP(nt, g.outputs['Position'])
    at = NN(nt, 'ShaderNodeAttribute', attribute_name='c', attribute_type='GEOMETRY'); cr = SEP(nt, at.outputs['Vector'])
    tone = RAMP(nt, cr['X'], [(0.0, rgb(pal[0])), (0.5, rgb(pal[1])), (1.0, rgb(pal[2]))])
    sv = NN(nt, 'ShaderNodeVectorMath', operation='MULTIPLY'); nt.links.new(g.outputs['Position'], sv.inputs[0]); sv.inputs[1].default_value = (1.1, 1.1, 1.1)
    nz = NN(nt, 'ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 0.8; nz.inputs['Detail'].default_value = 6; nt.links.new(sv.outputs[0], nz.inputs['Vector'])
    vo = NN(nt, 'ShaderNodeTexVoronoi', feature='DISTANCE_TO_EDGE'); vo.inputs['Scale'].default_value = 2.2; nt.links.new(g.outputs['Position'], vo.inputs['Vector'])
    col = MIX(nt, tone, RAMP(nt, vo.outputs['Distance'], [(0.0, (0.3, 0.3, 0.3, 1)), (0.12, (1, 1, 1, 1))]), 1.0, 'MULTIPLY')
    sn = RAMP(nt, MATH(nt, 'ADD', MATH(nt, 'MULTIPLY', n['Z'], 1.0), MATH(nt, 'MULTIPLY', nz.outputs['Fac'], 0.5)), [(0.78, (0, 0, 0, 1)), (0.98, (1, 1, 1, 1))])
    col = MIX(nt, col, (0.62, 0.68, 0.76, 1), MATH(nt, 'MULTIPLY', sn, snow)); nt.links.new(col, bs.inputs['Base Color']); bs.inputs['Roughness'].default_value = 0.85
    bm_ = NN(nt, 'ShaderNodeBump'); bm_.inputs['Strength'].default_value = 0.6; bm_.inputs['Distance'].default_value = 0.05; nt.links.new(vo.outputs['Distance'], bm_.inputs['Height']); nt.links.new(bm_.outputs['Normal'], bs.inputs['Normal']); return m

def smoke_mat():
    m, nt, bs = base_mat('smoke'); out = [n for n in nt.nodes if n.bl_idname == 'ShaderNodeOutputMaterial'][0]; nt.nodes.remove(bs)
    g = NN(nt, 'ShaderNodeNewGeometry'); lw = NN(nt, 'ShaderNodeLayerWeight'); lw.inputs['Blend'].default_value = 0.35
    nz = NN(nt, 'ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 0.35; nz.inputs['Detail'].default_value = 8; nt.links.new(g.outputs['Position'], nz.inputs['Vector'])
    a = MATH(nt, 'MULTIPLY', MATH(nt, 'SUBTRACT', 1.0, lw.outputs['Facing']), RAMP(nt, nz.outputs['Fac'], [(0.3, (0.2, 0.2, 0.2, 1)), (0.7, (1, 1, 1, 1))])); a = MATH(nt, 'MULTIPLY', a, 0.55, True)
    tr = NN(nt, 'ShaderNodeBsdfTransparent'); df = NN(nt, 'ShaderNodeBsdfDiffuse'); df.inputs['Color'].default_value = (0.2, 0.2, 0.22, 1)
    mx = NN(nt, 'ShaderNodeMixShader'); nt.links.new(a, mx.inputs[0]); nt.links.new(tr.outputs[0], mx.inputs[1]); nt.links.new(df.outputs[0], mx.inputs[2]); nt.links.new(mx.outputs[0], out.inputs['Surface']); return m

def foam_mat():
    """Falling water: white streaks, translucent."""
    m, nt, bs = base_mat('falls'); out = [n for n in nt.nodes if n.bl_idname == 'ShaderNodeOutputMaterial'][0]; nt.nodes.remove(bs)
    uvn = NN(nt, 'ShaderNodeTexCoord'); u = SEP(nt, uvn.outputs['UV']); sv = NN(nt, 'ShaderNodeCombineXYZ'); nt.links.new(MATH(nt, 'MULTIPLY', u['X'], 1.4), sv.inputs[0]); nt.links.new(MATH(nt, 'MULTIPLY', u['Y'], 0.12), sv.inputs[1])
    nz = NN(nt, 'ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 1.0; nz.inputs['Detail'].default_value = 5; nt.links.new(sv.outputs[0], nz.inputs['Vector'])
    a = RAMP(nt, nz.outputs['Fac'], [(0.3, (0.35, 0.35, 0.35, 1)), (0.65, (1, 1, 1, 1))])
    tr = NN(nt, 'ShaderNodeBsdfTransparent'); df = NN(nt, 'ShaderNodeBsdfPrincipled'); df.inputs['Base Color'].default_value = (0.85, 0.9, 0.95, 1); df.inputs['Roughness'].default_value = 0.4; df.inputs['Emission Color'].default_value = (0.5, 0.55, 0.6, 1); df.inputs['Emission Strength'].default_value = 0.25
    mx = NN(nt, 'ShaderNodeMixShader'); nt.links.new(MATH(nt, 'MULTIPLY', a, 0.85), mx.inputs[0]); nt.links.new(tr.outputs[0], mx.inputs[1]); nt.links.new(df.outputs[0], mx.inputs[2]); nt.links.new(mx.outputs[0], out.inputs['Surface']); return m

def make_materials2():
    MATS['stone'] = stone_mat('stone', (0.27, 0.25, 0.23), (0.34, 0.31, 0.28), (0.12, 0.11, 0.1), dirt=0.55)           # greyer, darker than the island cathedral
    MATS['pale'] = stone_mat('pale', (0.5, 0.46, 0.4), (0.58, 0.53, 0.46), (0.25, 0.23, 0.2), dirt=0.45)                # wealth: pale limestone
    MATS['dstone'] = stone_mat('dstone', (0.09, 0.085, 0.08), (0.13, 0.12, 0.11), (0.05, 0.045, 0.04), dirt=0.3)
    MATS['wallstone'] = stone_mat('wallstone', (0.2, 0.19, 0.18), (0.27, 0.26, 0.245), (0.09, 0.085, 0.08), bw=2.6, row=1.1, bump=0.9, dirt=0.7, bevel=0.12)   # huge ashlar for curtain walls
    MATS['slate'] = tile_mat('slate', (0.05, 0.06, 0.08), (0.12, 0.14, 0.18), 1.3, 0.55)
    MATS['tile'] = tile_mat('tile', (0.28, 0.09, 0.05), (0.42, 0.16, 0.08), 1.4, 0.75)
    MATS['copper'] = tile_mat('copper', (0.1, 0.35, 0.3), (0.18, 0.5, 0.42), 0.9, 0.5, 0.25, tint=(0.4, 0.22, 0.12))
    MATS['gold'] = simple('gold', (0.9, 0.62, 0.2), 0.3, 1.0); MATS['iron'] = simple('iron', (0.04, 0.04, 0.045), 0.45, 0.9, noise_bump=0.2)
    MATS['wood'] = simple('wood', (0.16, 0.09, 0.05), 0.65, noise_bump=0.4, scale=14.0); MATS['cloth'] = simple('cloth', (0.38, 0.03, 0.035), 0.75)
    MATS['lamp'] = simple('lamp', (1, 0.6, 0.25), 0.5, emit=((1.0, 0.55, 0.2), 60.0)); MATS['glass'] = glass_mat()
    MATS['plaster'] = simple('plaster', (0.3, 0.27, 0.22), 0.9, noise_bump=0.3, scale=12.0); MATS['road'] = cobble_mat(); MATS['cobble'] = MATS['road']
    MATS['bark'] = simple('bark', (0.07, 0.045, 0.03), 0.9); MATS['conifer'] = simple('conifer', (0.015, 0.04, 0.025), 0.8, noise_bump=0.3, scale=3.0); MATS['leaf'] = simple('leaf', (0.04, 0.07, 0.03), 0.8, noise_bump=0.3, scale=3.0)
    MATS['snow'] = simple('snow', (0.7, 0.75, 0.82), 0.8, noise_bump=0.2, scale=3.0); MATS['terrain'] = terrain_mat2()
    for nm, pal, lp, st in (('slumwall', ((0.03, 0.026, 0.024), (0.06, 0.05, 0.042), (0.11, 0.09, 0.07)), 0.3, 9.0), ('midwall', ((0.08, 0.072, 0.065), (0.16, 0.14, 0.115), (0.26, 0.22, 0.18)), 0.28, 8.0)):
        m, nt, bs = base_mat(nm); wallpaper(m, nt, bs, NN(nt, 'ShaderNodeTexCoord'), lit_p=lp, strength=st, pal=pal); MATS[nm] = m
    m, nt, bs = base_mat('upperwall'); wallpaper(m, nt, bs, NN(nt, 'ShaderNodeTexCoord'), lit_p=0.55, strength=9.0, pal=((0.2, 0.185, 0.16), (0.33, 0.3, 0.25), (0.46, 0.41, 0.34))); MATS['upperwall'] = m
    MATS['slumroof'] = roof_mat('slumroof', ((0.02, 0.022, 0.028), (0.05, 0.048, 0.05), (0.15, 0.06, 0.04)), 0.2); MATS['uproof'] = roof_mat('uproof', ((0.06, 0.1, 0.1), (0.12, 0.16, 0.15), (0.2, 0.11, 0.08)), 0.2); MATS['midroof'] = roof_mat('midroof', ((0.05, 0.06, 0.08), (0.16, 0.07, 0.05), (0.24, 0.1, 0.06)), 0.25)
    MATS['upflat'] = roof_mat('upflat', ((0.10, 0.095, 0.09), (0.16, 0.15, 0.13), (0.24, 0.2, 0.16)), 0.15); MATS['greenroof'] = roof_mat('greenroof', ((0.03, 0.07, 0.025), (0.05, 0.11, 0.035), (0.09, 0.15, 0.05)), 0.1)
    MATS['smoke'] = smoke_mat(); MATS['falls'] = foam_mat()
    wm, nt, bs = base_mat('water'); nz = NN(nt, 'ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 0.05; nz.inputs['Detail'].default_value = 6; g = NN(nt, 'ShaderNodeNewGeometry'); nt.links.new(g.outputs['Position'], nz.inputs['Vector'])
    bm_ = NN(nt, 'ShaderNodeBump'); bm_.inputs['Strength'].default_value = 0.1; bm_.inputs['Distance'].default_value = 0.5; nt.links.new(nz.outputs['Fac'], bm_.inputs['Height']); nt.links.new(bm_.outputs['Normal'], bs.inputs['Normal'])
    bs.inputs['Base Color'].default_value = (0.03, 0.07, 0.09, 1); bs.inputs['Roughness'].default_value = 0.08; bs.inputs['IOR'].default_value = 1.33; MATS['water'] = wm
    lm, nt, bs = base_mat('lakewater'); nz = NN(nt, 'ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 0.035; nz.inputs['Detail'].default_value = 8; g = NN(nt, 'ShaderNodeNewGeometry'); nt.links.new(g.outputs['Position'], nz.inputs['Vector'])
    bm_ = NN(nt, 'ShaderNodeBump'); bm_.inputs['Strength'].default_value = 0.06; bm_.inputs['Distance'].default_value = 0.3; nt.links.new(nz.outputs['Fac'], bm_.inputs['Height']); nt.links.new(bm_.outputs['Normal'], bs.inputs['Normal'])
    bs.inputs['Base Color'].default_value = (0.35, 0.75, 0.8, 1); bs.inputs['Roughness'].default_value = 0.03; bs.inputs['IOR'].default_value = 1.33; bs.inputs['Transmission Weight'].default_value = 0.9
    bs.inputs['Emission Color'].default_value = (0.04, 0.42, 0.46, 1); bs.inputs['Emission Strength'].default_value = 0.55; MATS['lakewater'] = lm
make_materials2()
MATS['winlit'] = simple('winlit', (1, 0.6, 0.25), 0.4, emit=((1.0, 0.5, 0.16), 14.0)); MATS['windark'] = simple('windark', (0.012, 0.014, 0.02), 0.2)
MATS['pave'] = simple('pave', (0.09, 0.085, 0.08), 0.8, noise_bump=0.35, scale=1.6); log('materials')

# ============================================================ finish: placed() transforms what a block adds; meshes from the Acc lists
class placed:
    """with placed(origin, yaw, scale): everything built inside is moved to origin and turned by yaw (about z)."""
    def __init__(s, o=(0, 0, 0), yaw=0.0, scale=1.0): s.o = o; s.yaw = yaw; s.k = scale
    def __enter__(s): s.at = {m: len(a.v) for m, a in BMS.items()}; return s
    def __exit__(s, *e):
        c, sn = math.cos(s.yaw), math.sin(s.yaw)
        for m, a in BMS.items():
            for i in range(s.at.get(m, 0), len(a.v)):
                x, y, z = a.v[i]; x *= s.k; y *= s.k; z *= s.k; a.v[i] = (x * c - y * sn + s.o[0], x * sn + y * c + s.o[1], z + s.o[2])

# ============================================================ scene: terrain, water, sky
def scene_terrain():
    me = build_terrain2(); me.materials.append(MATS['terrain']); scn.collection.objects.link(bpy.data.objects.new('terrain', me))
    zc = W.LAKE_Z; mk_obj('lake', [[(-1300, W.DAM_Y + 6, zc), (1800, W.DAM_Y + 6, zc), (1800, 6000, zc), (-1300, 6000, zc)]], 'lakewater')
    for v in W.VALLEYS:
        n = len(v.P) - 1; P = []; w = 9.0 if v.name == 'main' else 5.5
        for i in range(0, n - 1, 1):
            a_, b_ = v.P[i], v.P[i + 1]; na, nb_ = v.N[i], v.N[i + 1]; fa, fb = v.F[i] - 1.9, v.F[i + 1] - 1.9
            if v.name == 'main' and v.S[i] > W.DAM_S - 30: break
            P.append([(a_[0] - na[0] * w, a_[1] - na[1] * w, fa), (a_[0] + na[0] * w, a_[1] + na[1] * w, fa), (b_[0] + nb_[0] * w, b_[1] + nb_[1] * w, fb), (b_[0] - nb_[0] * w, b_[1] - nb_[1] * w, fb)])
        mk_obj('river_' + v.name, P, 'water')
    log('terrain + water')

def scene_sky():
    world = bpy.data.worlds.new('w'); scn.world = world; world.use_nodes = True; nt = world.node_tree; nt.nodes.clear()
    tc = NN(nt, 'ShaderNodeTexCoord'); d = SEP(nt, tc.outputs['Generated'])
    vv = NN(nt, 'ShaderNodeCombineXYZ'); nt.links.new(MATH(nt, 'MULTIPLY', d['X'], 1.3), vv.inputs[0]); nt.links.new(MATH(nt, 'MULTIPLY', d['Y'], 1.3), vv.inputs[1]); nt.links.new(MATH(nt, 'MULTIPLY', d['Z'], 3.2), vv.inputs[2])
    cl = NN(nt, 'ShaderNodeTexNoise'); cl.inputs['Scale'].default_value = float(opt('--cloudscale', 2.2)); cl.inputs['Detail'].default_value = 12; cl.inputs['Distortion'].default_value = 0.8; nt.links.new(vv.outputs[0], cl.inputs['Vector'])
    cl2 = NN(nt, 'ShaderNodeTexNoise'); cl2.inputs['Scale'].default_value = 7.0; cl2.inputs['Detail'].default_value = 6; nt.links.new(vv.outputs[0], cl2.inputs['Vector'])
    dens = MATH(nt, 'ADD', cl.outputs['Fac'], MATH(nt, 'MULTIPLY', MATH(nt, 'SUBTRACT', cl2.outputs['Fac'], 0.5), 0.35))
    sky = RAMP(nt, dens, [(0.38, (0.55, 0.62, 0.74, 1)), (0.5, (0.2, 0.23, 0.3, 1)), (0.62, (0.05, 0.06, 0.085, 1)), (0.78, (0.015, 0.02, 0.03, 1))])
    hz = RAMP(nt, MATH(nt, 'ABSOLUTE', d['Z']), [(0.0, (0.95, 0.65, 0.5, 1)), (0.25, (0.4, 0.43, 0.5, 1)), (0.6, (0.12, 0.14, 0.19, 1))])
    col = MIX(nt, sky, hz, MATH(nt, 'MULTIPLY', RAMP(nt, MATH(nt, 'ABSOLUTE', d['Z']), [(0.0, (1, 1, 1, 1)), (0.3, (0, 0, 0, 1))]), 0.55), 'MIX')
    bg = NN(nt, 'ShaderNodeBackground'); bg.inputs['Strength'].default_value = float(opt('--sky', 0.8)); wo = NN(nt, 'ShaderNodeOutputWorld')
    nt.links.new(col, bg.inputs[0]); nt.links.new(bg.outputs[0], wo.inputs['Surface'])
    ea, aa = math.radians(float(opt('--elev', 15.0))), math.radians(float(opt('--az', 255.0)))
    sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = float(opt('--sun', 4.0)); sun.angle = math.radians(5.0); sun.color = (1.0, 0.72, 0.52)
    so = bpy.data.objects.new('sun', sun); scn.collection.objects.link(so); so.rotation_euler = (-Vector((math.sin(aa) * math.cos(ea), math.cos(aa) * math.cos(ea), math.sin(ea)))).to_track_quat('-Z', 'Y').to_euler()
    fl = bpy.data.lights.new('fill', 'SUN'); fl.energy = float(opt('--fill', 1.6)); fl.angle = math.radians(25); fl.color = (0.62, 0.72, 1.0); fo = bpy.data.objects.new('fill', fl); scn.collection.objects.link(fo)
    fa, fe = math.radians(120), math.radians(32); fo.rotation_euler = (-Vector((math.sin(fa) * math.cos(fe), math.cos(fa) * math.cos(fe), math.sin(fe)))).to_track_quat('-Z', 'Y').to_euler()

def fog_box(name, c, size, dens, col=(0.7, 0.78, 0.9, 1), aniso=0.5):
    mm = bpy.data.materials.new(name); mm.use_nodes = True; mn = mm.node_tree; mn.nodes.clear(); vs = mn.nodes.new('ShaderNodeVolumeScatter'); mo = mn.nodes.new('ShaderNodeOutputMaterial')
    nz = mn.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 0.004; nz.inputs['Detail'].default_value = 6; g = mn.nodes.new('ShaderNodeNewGeometry'); mn.links.new(g.outputs['Position'], nz.inputs['Vector'])
    mu = mn.nodes.new('ShaderNodeMath'); mu.operation = 'MULTIPLY'; mu.inputs[1].default_value = dens * 2.2; mn.links.new(nz.outputs['Fac'], mu.inputs[0]); mn.links.new(mu.outputs[0], vs.inputs['Density'])
    vs.inputs['Color'].default_value = col; vs.inputs['Anisotropy'].default_value = aniso; mn.links.new(vs.outputs[0], mo.inputs['Volume'])
    bpy.ops.mesh.primitive_cube_add(size=1, location=c); o = bpy.context.active_object; o.scale = size; o.name = name; o.data.materials.append(mm); o.visible_shadow = False

def scene_atmo():
    fog_box('haze', (0, 300, 650), (12000, 12000, 1500), float(opt('--haze', 0.7e-4)), (0.55, 0.65, 0.84, 1), 0.4)
    fog_box('valleymist', (0, 0, 90), (7600, 7600, 200), float(opt('--mist', 6e-4)), (0.7, 0.78, 0.9, 1), 0.6)

# ============================================================ render
def render_shots2():
    w, h = [int(s) for s in opt('--res', '1920x1080').split('x')]
    scn.render.engine = 'CYCLES'; scn.render.resolution_x, scn.render.resolution_y = w, h; scn.render.resolution_percentage = 100
    cy = scn.cycles; cy.samples = int(opt('--samples', 96)); cy.use_denoising = True; cy.max_bounces = 5; cy.volume_bounces = 1; cy.volume_step_rate = 2.5; cy.transparent_max_bounces = 16
    scn.view_settings.view_transform = 'AgX'; scn.view_settings.look = 'AgX - Punchy'
    p = bpy.context.preferences.addons['cycles'].preferences
    for kind in ('OPTIX', 'CUDA'):
        try:
            p.compute_device_type = kind; p.get_devices(); [setattr(d, 'use', d.type != 'CPU') for d in p.devices]
            if any(d.use for d in p.devices): cy.device = 'GPU'; break
        except Exception: pass
    cam = bpy.data.cameras.new('cam'); cam.clip_start = 0.5; cam.clip_end = 30000; co = bpy.data.objects.new('cam', cam); scn.collection.objects.link(co); scn.camera = co
    os.makedirs(OUT, exist_ok=True)
    if opt('--save'): bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(opt('--save')))
    for name in opt('--shots', 'ref3').split(','):
        pos, tgt, lens = SH_SHOTS[name]; pos = tuple(pos)
        if len(pos) == 3 and pos[2] < 0: pos = (pos[0], pos[1], float(H(pos[0], pos[1])) - pos[2])      # negative z = metres above the ground
        co.location = pos; cam.lens = lens; co.rotation_euler = (Vector(tgt) - Vector(pos)).to_track_quat('-Z', 'Y').to_euler()
        scn.render.filepath = os.path.abspath(os.path.join(OUT, name + '.png')); log('render ' + name); bpy.ops.render.render(write_still=True)

SH_SHOTS = {
    'range': ((-2700, -3200, 1250), (100, 300, 300), 28),          # the whole range from the south-west
    'over': ((-3200, -3400, 1500), (0, 200, 300), 30),
    'maze': ((-900, -3300, 420), (500, -1800, 130), 30),          # low oblique over the under city's maze of benches
    'lake': ((-300, 1700, 600), (150, 3600, 230), 30),
    'top': ((0, 0, 9000), (0, 0, 0), 28),
    'maze2': ((200, -2800, 700), (350, -1700, 120), 32),
    'maze3': ((900, -1200, 520), (1300, -2000, 100), 34),
    'low': ((1100, -1800, -22), (1500, -2150, 150), 28),
    'sbridge2': ((1107, 1396, 769), (524, 1185, 589), 30),         # the statue bridge side-on over its valley
    'levels': ((2800, -2600, 1000), (-200, 300, 380), 34),
    'lake2': ((60, 2300, 420), (120, 3600, 200), 32),
    'mouth': ((60, -4200, 430), (0, -1800, 170), 30),
    'sbridge': ((647, 845, 632), (330, 1720, 690), 30),
    'sbridge3': ((538, 1145, 633), (330, 1720, 690), 30),
    'castle': ((622, 1383, 709), (330, 1720, 660), 30),
    'arena': ((1300, -100, 700), (1850, 250, 380), 32),
    'east': ((3300, -2400, 1100), (1300, 300, 420), 30),           # the eastern chain of blocks from the south-east
    'west': ((-3400, 1700, 1000), (-1300, 100, 420), 30),          # the western chain from the north-west
    'south': ((-200, -3400, 900), (500, -800, 400), 30),           # the southern blocks from the mouth
    'cathedral': ((-1100, -900, 800), (-600, -300, 560), 32),
    'lake3': ((-250, 2450, 330), (350, 4300, 300), 30),
    'maze_a': ((-1200, -1700, 430), (-200, -1200, 120), 34),
    'maze_b': ((1400, -2600, -300), (300, -1800, 120), 34),
    'range2': ((-1500, -7200, 1700), (0, 0, 250), 26),
}
if opt('--cam'): SH_SHOTS['c'] = (tuple(float(v) for v in opt('--cam').split(',')), tuple(float(v) for v in opt('--tgt', '0,0,0').split(',')), float(opt('--lens', 28)))

if opt('--hero'):
    ONLY = {'heroes'}; scene_sky(); mk_obj('ground', [[(-3000, -3000, -0.5), (3000, -3000, -0.5), (3000, 3000, -0.5), (-3000, 3000, -0.5)]], 'pave')
    def H(x, y): return np.zeros_like(np.asarray(x, float))
    SH_SHOTS['h'] = (tuple(float(v) for v in opt('--cam', '0,-300,80').split(',')), tuple(float(v) for v in opt('--tgt', '0,0,40').split(',')), float(opt('--lens', 28)))
if 'terrain' in ONLY and not opt('--hero'): scene_terrain(); scene_sky()
if 'atmo' in ONLY: scene_atmo()
if 'city' in ONLY: load('sh_city.py'); log('city')
if 'walls' in ONLY or opt('--hero'): load('sh_walls.py'); log('walls')
if 'heroes' in ONLY: load('sh_heroes.py'); load('sh_heroes2.py'); log('heroes')
finalize(); render_shots2(); log('done')
