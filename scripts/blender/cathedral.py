# A fortified Gothic cathedral on a rock island in a lake, built procedurally in Blender and rendered with Cycles.
#   blender -b -P scripts/blender/cathedral.py -- <out dir> [--shots hero,front,...] [--samples 128] [--res 1920x1080] [--save f.blend]
# Everything is built from a few helpers in a LOCAL FRAME (u along a wall, v up, w out of the wall) so every wall,
# window, buttress and statue is placed the same way. Units are metres, x east, y north, z up. Yaw 0 faces south (-y).
import bpy, bmesh, math, random, sys, os, time
import numpy as np
from mathutils import Matrix, Vector

A = sys.argv[sys.argv.index('--') + 1:]
OUT = A[0]
def opt(k, d=None): return A[A.index(k) + 1] if k in A else d
PI = math.pi
RNG = random.Random(11)
T0 = time.time()
def log(s): print(f'[{time.time() - T0:6.1f}s] {s}', flush=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene

# ============================================================ geometry helpers
class Acc:
    """Collects vertices and faces for one material; turned into a Blender mesh once at the end (far faster than bmesh ops)."""
    __slots__ = ('v', 'f', 's')
    def __init__(self): self.v = []; self.f = []; self.s = []
    def add(self, pts, faces, smooth=False):
        n = len(self.v); self.v.extend(pts); self.f.extend([tuple(n + i for i in fc) for fc in faces]); self.s.extend([smooth] * len(faces))
BMS = {}
def B(m):
    if m not in BMS: BMS[m] = Acc()
    return BMS[m]

def prism3d(m, pts, vec):
    """Closed prism: polygon pts (world xyz) extruded by vec. The winding is fixed from the polygon's own normal."""
    n = len(pts); nx = ny = nz = 0.0
    for i in range(n):
        p, q = pts[i], pts[(i + 1) % n]
        nx += (p[1] - q[1]) * (p[2] + q[2]); ny += (p[2] - q[2]) * (p[0] + q[0]); nz += (p[0] - q[0]) * (p[1] + q[1])
    up = nx * vec[0] + ny * vec[1] + nz * vec[2] > 0
    P = [tuple(p) for p in pts] + [(p[0] + vec[0], p[1] + vec[1], p[2] + vec[2]) for p in pts]
    a = list(range(n)); b = list(range(n, 2 * n)); fs = [a[::-1], b] if up else [a, b[::-1]]
    for i in range(n):
        j = (i + 1) % n; fs.append((i, j, n + j, n + i) if up else (j, i, n + i, n + j))
    B(m).add(P, fs)

class F:
    """Local frame: u along the wall, v up, w out of the wall. yaw 0 faces -y (south), pi/2 faces east."""
    def __init__(s, o, yaw=0.0):
        s.o = Vector(o); s.yaw = yaw
        s.M = Matrix.Translation(o) @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(PI / 2, 4, 'X')
    def p(s, u, v, w): return tuple(s.M @ Vector((u, v, w)))

def lpoly(f, pts, w0, w1, m):
    ar = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
    if abs(ar) < 1e-9: return
    P = [f.p(u, v, w0) for u, v in pts]; e = Vector(f.p(0, 0, w1)) - Vector(f.p(0, 0, w0))
    prism3d(m, P, tuple(e))
def lbox(f, u0, u1, v0, v1, w0, w1, m):
    if u1 - u0 < 1e-6 or v1 - v0 < 1e-6 or w1 - w0 < 1e-6: return
    lpoly(f, [(u0, v0), (u1, v0), (u1, v1), (u0, v1)], w0, w1, m)
def fprism(f, pts_wv, u0, u1, m):
    """Polygon given in (w, v), extruded along u: flyers and gables seen from the side."""
    prism3d(m, [f.p(u0, v, w) for w, v in pts_wv], tuple(Vector(f.p(u1, 0, 0)) - Vector(f.p(u0, 0, 0))))

def mat_between(p0, p1):
    p0 = Vector(p0); p1 = Vector(p1); d = p1 - p0; L = d.length
    if L < 1e-9: return None, 0
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    return Matrix.Translation((p0 + p1) / 2) @ q.to_matrix().to_4x4(), L
def frustum(m, M, r1, r2, L, seg, caps=True, rot=0.0):
    """Cone / cylinder along local z, centred on the origin, transformed by M. Sides smooth, caps flat."""
    r2 = max(r2, 0.0); tip = r2 < 1e-3; ang = [rot + 2 * PI * i / seg for i in range(seg)]
    pts = [tuple(M @ Vector((r1 * math.cos(a), r1 * math.sin(a), -L / 2))) for a in ang]
    if tip:
        pts.append(tuple(M @ Vector((0, 0, L / 2)))); fs = [(i, (i + 1) % seg, seg) for i in range(seg)]
    else:
        pts += [tuple(M @ Vector((r2 * math.cos(a), r2 * math.sin(a), L / 2))) for a in ang]; fs = [(i, (i + 1) % seg, seg + (i + 1) % seg, seg + i) for i in range(seg)]
    B(m).add(pts, fs, True)
    if caps:
        B(m).add(pts[:seg], [tuple(range(seg))[::-1]])
        if not tip: B(m).add(pts[seg:2 * seg], [tuple(range(seg))])
def cone_between(m, p0, p1, r0, r1, seg=8, caps=True):
    M, L = mat_between(p0, p1)
    if M is None: return
    frustum(m, M, r0, r1, L, seg, caps)
def sph(m, c, r, s=(1, 1, 1), rz=0.0, rx=0.0, seg=10):
    M = Matrix.Translation(c) @ Matrix.Rotation(rz, 4, 'Z') @ Matrix.Rotation(rx, 4, 'X') @ Matrix.Diagonal((s[0], s[1], s[2], 1))
    rings = max(3, seg // 2); pts = [tuple(M @ Vector((0, 0, -r)))]
    for j in range(1, rings):
        t = PI * j / rings
        for i in range(seg): a = 2 * PI * i / seg; pts.append(tuple(M @ Vector((r * math.sin(t) * math.cos(a), r * math.sin(t) * math.sin(a), -r * math.cos(t)))))
    pts.append(tuple(M @ Vector((0, 0, r)))); top = len(pts) - 1; fs = [(0, 1 + (i + 1) % seg, 1 + i) for i in range(seg)]
    for j in range(rings - 2):
        for i in range(seg): a0 = 1 + j * seg + i; a1 = 1 + j * seg + (i + 1) % seg; fs.append((a0, a1, a1 + seg, a0 + seg))
    base = 1 + (rings - 2) * seg; fs += [(top, base + i, base + (i + 1) % seg) for i in range(seg)]
    B(m).add(pts, fs, True)
_CUBE = [(-.5, -.5, -.5), (.5, -.5, -.5), (.5, .5, -.5), (-.5, .5, -.5), (-.5, -.5, .5), (.5, -.5, .5), (.5, .5, .5), (-.5, .5, .5)]
_CF = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (3, 0, 4, 7)]
def box(m, c, sx, sy, sz, rz=0.0, base=True):
    M = Matrix.Translation((c[0], c[1], c[2] + (sz / 2 if base else 0))) @ Matrix.Rotation(rz, 4, 'Z') @ Matrix.Diagonal((sx, sy, sz, 1))
    B(m).add([tuple(M @ Vector(v)) for v in _CUBE], _CF)
def cyl(m, c, r1, r2, h, seg=12, rot=0.0):
    """Vertical cone/cylinder, base centre c."""
    frustum(m, Matrix.Translation((c[0], c[1], c[2] + h / 2)), r1, r2, h, seg, True, rot)
def torus(m, M, R, r, seg=28, tseg=6):
    pts = []
    for i in range(seg):
        a = 2 * PI * i / seg
        for j in range(tseg):
            b = 2 * PI * j / tseg; pts.append(tuple(M @ Vector(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b)))))
    fs = [(i * tseg + j, ((i + 1) % seg) * tseg + j, ((i + 1) % seg) * tseg + (j + 1) % tseg, i * tseg + (j + 1) % tseg) for i in range(seg) for j in range(tseg)]
    B(m).add(pts, fs, True)
def ltorus(f, u, v, w, R, r, m, seg=28):
    torus(m, f.M @ Matrix.Translation((u, v, w)), R, r, seg)
def ppoly(m, pts): B(m).add([tuple(p) for p in pts], [tuple(range(len(pts)))])

def arch_pts(uc, ww, sill, spring, rise, n=8):
    a = ww / 2; R = (a * a + rise * rise) / (2 * a); te = math.atan2(rise, a - R); cL = uc - a + R
    left = [(uc - a, spring)] + [(cL + R * math.cos(PI - (PI - te) * i / n), spring + R * math.sin(PI - (PI - te) * i / n)) for i in range(1, n + 1)]
    right = [(2 * uc - u, v) for u, v in reversed(left[:-1])]
    return [(uc - a, sill)] + left + right + [(uc + a, sill)]
def arch_h(o, u):
    pts = arch_pts(o['uc'], o['ww'], o['sill'], o['spring'], o['rise'], 24)[1:-1]
    best = o['spring']
    for (u0, v0), (u1, v1) in zip(pts, pts[1:]):
        if u0 <= u <= u1 or u1 <= u <= u0:
            t = 0 if u1 == u0 else (u - u0) / (u1 - u0); best = max(best, v0 + t * (v1 - v0))
    return best

def wall_face(f, u0, u1, v0, v1, w0, w1, ops, m='stone'):
    """A wall panel [u0,u1] x [v0,v1], depth w0..w1, with pointed-arch openings: piers are boxes, the head is one polygon."""
    cur = u0
    for o in sorted(ops, key=lambda o: o['uc']):
        a = o['ww'] / 2; L = o['uc'] - a; Rr = o['uc'] + a
        if L > cur + 1e-6: lbox(f, cur, L, v0, v1, w0, w1, m)
        if o['sill'] > v0 + 1e-6: lbox(f, L, Rr, v0, o['sill'], w0, w1, m)
        top = arch_pts(o['uc'], o['ww'], o['sill'], o['spring'], o['rise'], o.get('n', 8))[1:-1]
        lpoly(f, top + [(Rr, v1), (L, v1)], w0, w1, m)
        cur = Rr
    if u1 > cur + 1e-6: lbox(f, cur, u1, v0, v1, w0, w1, m)

def op(uc, ww, sill, spring, rise=None, n=8):
    return dict(uc=uc, ww=ww, sill=sill, spring=spring, rise=ww * 0.95 if rise is None else rise, n=n)

def arch_band(f, o, off, w0, w1, m='stone', grow=0.0):
    """A moulded arch ring round an opening (hood mould / archivolt)."""
    inner = arch_pts(o['uc'], o['ww'], o['sill'], o['spring'], o['rise'], o.get('n', 8))
    outer = arch_pts(o['uc'], o['ww'] + 2 * off, o['sill'], o['spring'], o['rise'] + off * 0.9 + grow, o.get('n', 8))
    lpoly(f, inner + outer[::-1], w0, w1, m)

def window(f, o, glass=True, depth=1.0, mullions=None, hood=True, sill_ledge=True, tracery=True, t=1.6):
    """Glass, mullions, transoms, tracery circles, hood mould and sill for an opening in a wall of thickness t."""
    uc, ww, sill, sp, rise = o['uc'], o['ww'], o['sill'], o['spring'], o['rise']
    if glass: lpoly(f, arch_pts(uc, ww, sill, sp, rise, o.get('n', 8))[:], -depth, -depth + 0.05, 'glass')
    nm = (1 if ww < 3.0 else 2) if mullions is None else mullions
    if ww >= 1.4 and tracery:
        gaps = [uc - ww / 2 + ww * (i + 1) / (nm + 1) for i in range(nm)]
        for g in gaps: lbox(f, g - 0.09, g + 0.09, sill, arch_h(o, g) - 0.05, -depth - 0.1, -depth + 0.35, 'stone')
        lbox(f, uc - ww / 2, uc + ww / 2, sp - 0.06, sp + 0.06, -depth - 0.1, -depth + 0.3, 'stone')  # transom
        lw = ww / (nm + 1)
        if lw > 0.9:
            for i in range(nm + 1):
                cu = uc - ww / 2 + lw * (i + 0.5); ltorus(f, cu, sp + lw * 0.62, -depth + 0.1, lw * 0.28, 0.06, 'stone', 16)
        if rise > ww * 1.1: ltorus(f, uc, sp + rise * 0.62, -depth + 0.1, ww * 0.2, 0.07, 'stone', 20)
    if hood: arch_band(f, o, 0.38, 0.0, 0.28)
    if sill_ledge: lbox(f, uc - ww / 2 - 0.25, uc + ww / 2 + 0.25, sill - 0.3, sill, 0, 0.4, 'stone')

# ============================================================ figures
def cube_at(m, c, sx, sy, sz, rz=0.0): box(m, c, sx, sy, sz, rz, base=False)
def statue(x, y, z, h, yaw=0.0, kind='saint', m='stone', plinth=True):
    """A standing figure of height h whose feet are at z. Front is local -y (south at yaw 0)."""
    c, s = math.cos(yaw), math.sin(yaw)
    def P(dx, dy, dz): return (x + dx * c - dy * s, y + dx * s + dy * c, z + dz)
    if plinth: cube_at(m, P(0, 0, 0.03 * h), 0.3 * h, 0.3 * h, 0.06 * h, yaw); z0 = 0.06 * h
    else: z0 = 0.0
    if kind == 'gargoyle':
        cone_between(m, P(0, 0.15 * h, 0.1 * h), P(0, -0.55 * h, 0.05 * h), 0.2 * h, 0.12 * h, 8)
        sph(m, P(0, -0.65 * h, 0.12 * h), 0.17 * h, (1, 1.2, 0.9), yaw)
        cone_between(m, P(0, -0.75 * h, 0.1 * h), P(0, -1.0 * h, 0.02 * h), 0.09 * h, 0.04 * h, 6)
        for sx in (-1, 1):
            cone_between(m, P(sx * 0.1 * h, -0.62 * h, 0.27 * h), P(sx * 0.15 * h, -0.7 * h, 0.5 * h), 0.03 * h, 0.01 * h, 4)  # horns
            sph(m, P(sx * 0.27 * h, 0.1 * h, 0.3 * h), 0.2 * h, (0.1, 0.9, 1.0), yaw + sx * 0.5, 0.3, 6)  # wings
            cone_between(m, P(sx * 0.1 * h, -0.4 * h, 0.0), P(sx * 0.12 * h, -0.65 * h, -0.18 * h), 0.05 * h, 0.03 * h, 5)  # forelegs
        return
    if kind == 'knight':
        for sx in (-1, 1): cone_between(m, P(sx * 0.05 * h, 0, z0), P(sx * 0.05 * h, 0, 0.45 * h), 0.045 * h, 0.04 * h, 6)
        cone_between(m, P(0, 0, 0.3 * h), P(0, 0, 0.5 * h), 0.12 * h, 0.1 * h, 10)  # tabard
        cube_at(m, P(0, 0, 0.62 * h), 0.2 * h, 0.12 * h, 0.2 * h, yaw)
        sph(m, P(0, 0, 0.8 * h), 0.065 * h, (1, 1, 1.15), yaw); cube_at(m, P(0, -0.05 * h, 0.8 * h), 0.08 * h, 0.04 * h, 0.012 * h, yaw)
        cone_between('iron', P(0, -0.13 * h, 0.1 * h), P(0, -0.13 * h, 0.78 * h), 0.012 * h, 0.012 * h, 4)  # sword
        cube_at('iron', P(0, -0.13 * h, 0.34 * h), 0.14 * h, 0.02 * h, 0.02 * h, yaw)
        cone_between(m, P(0.11 * h, -0.07 * h, 0.55 * h), P(0.09 * h, -0.11 * h, 0.35 * h), 0.03 * h, 0.03 * h, 5)
        cube_at('gold', P(-0.14 * h, -0.08 * h, 0.5 * h), 0.02 * h, 0.12 * h, 0.2 * h, yaw)  # shield
        return
    cone_between(m, P(0, 0, z0), P(0, 0, 0.62 * h), 0.17 * h, 0.1 * h, 12)  # robe
    for k in range(6):
        a = k * PI / 3 + 0.3; r = 0.15 * h
        cone_between(m, P(r * math.cos(a), r * math.sin(a), z0), P(0.9 * r * math.cos(a), 0.9 * r * math.sin(a), 0.5 * h), 0.03 * h, 0.012 * h, 4)  # folds
    cone_between(m, P(0, 0, 0.6 * h), P(0, 0, 0.8 * h), 0.1 * h, 0.075 * h, 8)
    for sx in (-1, 1):
        sph(m, P(sx * 0.095 * h, 0, 0.78 * h), 0.04 * h, seg=6)
        cone_between(m, P(sx * 0.095 * h, 0, 0.78 * h), P(sx * 0.04 * h, -0.1 * h, 0.64 * h), 0.032 * h, 0.026 * h, 5)  # arms
    sph(m, P(0, 0, 0.875 * h), 0.062 * h, (1, 1, 1.15), yaw)
    if kind == 'saint':
        cone_between('gold', P(0, 0.07 * h, 0.88 * h), P(0, 0.085 * h, 0.88 * h), 0.11 * h, 0.11 * h, 14)  # halo
        cube_at(m, P(0, -0.1 * h, 0.62 * h), 0.1 * h, 0.03 * h, 0.13 * h, yaw)  # book
        sph(m, P(0, 0.03 * h, 0.9 * h), 0.07 * h, (1, 1, 0.9), yaw, seg=8)  # hood
    elif kind == 'king':
        for k in range(5):
            a = k * 2 * PI / 5; cone_between('gold', P(0.045 * h * math.cos(a), 0.045 * h * math.sin(a), 0.925 * h), P(0.05 * h * math.cos(a), 0.05 * h * math.sin(a), 0.99 * h), 0.014 * h, 0.004 * h, 4)
        cone_between('gold', P(0.12 * h, -0.1 * h, 0.4 * h), P(0.12 * h, -0.1 * h, 0.98 * h), 0.008 * h, 0.008 * h, 4); sph('gold', P(0.12 * h, -0.1 * h, 1.0 * h), 0.022 * h, seg=6)
        cone_between(m, P(0, 0.06 * h, 0.78 * h), P(0, 0.1 * h, 0.1 * h), 0.06 * h, 0.17 * h, 8)  # mantle
    elif kind == 'angel':
        for sx in (-1, 1): sph(m, P(sx * 0.2 * h, 0.08 * h, 0.72 * h), 0.3 * h, (0.07, 0.35, 1.0), yaw + sx * 0.35, 0.0, 6)
        cone_between('gold', P(0.1 * h, -0.14 * h, 0.7 * h), P(0.12 * h, -0.3 * h, 0.86 * h), 0.016 * h, 0.05 * h, 6)  # trumpet
        cone_between('gold', P(0, 0.07 * h, 0.92 * h), P(0, 0.085 * h, 0.92 * h), 0.09 * h, 0.09 * h, 12)

def gargoyle(x, y, z, yaw, h=1.7): statue(x, y, z, h, yaw, 'gargoyle', 'stone', plinth=False)

def lstatue(f, u, v, w, h, kind='saint', m='stone', yaw_extra=0.0, plinth=True):
    x, y, z = f.p(u, v, w); statue(x, y, z, h, f.yaw + yaw_extra, kind, m, plinth)

# ============================================================ gothic parts
def crockets(p0, p1, n, size, m='stone', side=((1, 0, 0),), tilt=0.9):
    """Little leaf-shaped crockets climbing the edge p0 -> p1 (the spires and gables carry them)."""
    p0 = Vector(p0); p1 = Vector(p1)
    for i in range(n):
        t = (i + 0.5) / n; c = p0.lerp(p1, t); k = size * (1.0 - 0.45 * t)
        for d in side:
            d = Vector(d); cone_between(m, c, c + d * k * 1.1 + Vector((0, 0, k * 0.8)), k * 0.3, k * 0.04, 4)

def pinnacle(x, y, z, shaft_h, r, spire_h, m='stone', cm='stone', cro=True, finial=True):
    cyl(m, (x, y, z), r * 1.1, r, shaft_h, 8, PI / 8)
    for k in range(4):
        a = k * PI / 2 + PI / 4; cone_between(m, (x + r * 1.05 * math.cos(a), y + r * 1.05 * math.sin(a), z + shaft_h * 0.55), (x + r * 1.05 * math.cos(a), y + r * 1.05 * math.sin(a), z + shaft_h + r * 1.2), r * 0.28, r * 0.04, 4)
    cyl(m, (x, y, z + shaft_h), r * 1.18, r * 1.18, r * 0.18, 8, PI / 8)
    z1 = z + shaft_h + r * 0.18; cyl(cm, (x, y, z1), r * 1.0, 0.03, spire_h, 8, PI / 8)
    if cro:
        for k in range(8):
            a = k * PI / 4 + PI / 8
            for t in (0.25, 0.5, 0.75):
                rr = r * (1 - t) * 0.98; cone_between(cm, (x + rr * math.cos(a), y + rr * math.sin(a), z1 + spire_h * t), (x + (rr + r * 0.3) * math.cos(a), y + (rr + r * 0.3) * math.sin(a), z1 + spire_h * t + r * 0.35), r * 0.1, r * 0.02, 4)
    if finial: sph('gold', (x, y, z1 + spire_h + r * 0.05), r * 0.22, seg=6); cone_between('gold', (x, y, z1 + spire_h), (x, y, z1 + spire_h + r * 0.9), r * 0.07, 0.01, 4)

def crenel(f, u0, u1, v, thick, mh=1.2, mw=1.1, gap=0.9, w_out=0.0, m='stone'):
    """Merlons along a wall top (v = top of the wall), plus a machicolation course of corbels below."""
    n = int((u1 - u0) / (mw + gap)); step = (u1 - u0) / max(n, 1)
    for i in range(n):
        uc = u0 + step * (i + 0.5); lbox(f, uc - mw / 2, uc + mw / 2, v, v + mh, w_out - 0.55, w_out, m)
        lbox(f, uc - mw / 2 - 0.0, uc + mw / 2, v + mh, v + mh + 0.12, w_out - 0.62, w_out + 0.06, m)  # cap

def corbels(f, u0, u1, v, m='stone', proj=0.55, sp=0.9, size=0.34, rows=3):
    n = int((u1 - u0) / sp)
    for i in range(n):
        u = u0 + (i + 0.5) * (u1 - u0) / n
        for r in range(rows):
            pr = proj * (r + 1) / rows; lbox(f, u - size / 2, u + size / 2, v - 0.28 * (r + 1), v - 0.28 * r, 0, pr, m)
    lbox(f, u0, u1, v - 0.02, v + 0.3, 0, proj + 0.1, m)

def string_course(f, u0, u1, v, h=0.35, proj=0.3, m='stone'): lbox(f, u0, u1, v, v + h, 0, proj, m)

def lancet_slit(f, u, v0, v1, w=0.38):
    lpoly(f, arch_pts(u, w, v0, v1 - w * 1.2, w * 1.2, 4)[:], -0.2, 0.04, 'dstone')

def banner(x, y, z, hgt, yaw, wid=2.2, ln=5.0, col='cloth'):
    """A pole and a hanging pennant with a wave in it."""
    cone_between('wood', (x, y, z), (x, y, z + hgt), 0.09, 0.05, 6); sph('gold', (x, y, z + hgt + 0.08), 0.14, seg=6)
    n = 10; top = z + hgt - 0.4; c, s_ = math.cos(yaw), math.sin(yaw)
    def Pq(d, h):
        wv = math.sin(d * 1.3) * 0.25 * d / ln
        return (x + d * c - wv * s_, y + d * s_ + wv * c, top - h)
    for i in range(n):
        d0, d1 = ln * i / n, ln * (i + 1) / n; t0 = wid * (1 - 0.55 * i / n); t1 = wid * (1 - 0.55 * (i + 1) / n)
        q = [Pq(d0, 0), Pq(d1, 0), Pq(d1, t1), Pq(d0, t0)]; B(col).add(q, [(0, 1, 2, 3), (3, 2, 1, 0)])

def lamp(x, y, z, r=0.22): sph('lamp', (x, y, z), r, seg=6)

# ============================================================ site: terrain, water
WALL = [(-62, -100), (62, -100), (86, -60), (90, 10), (72, 68), (0, 96), (-72, 68), (-90, 10), (-84, -60)]
def offset_poly(pts, d):
    cx = sum(p[0] for p in pts) / len(pts); cy = sum(p[1] for p in pts) / len(pts)
    out = []
    for x, y in pts:
        l = math.hypot(x - cx, y - cy); out.append((x + (x - cx) / l * d, y + (y - cy) / l * d))
    return out
ROCK_POLY = offset_poly(WALL, 15.0)
HILL = [(40 * math.cos(2 * PI * i / 14) , -222 + 40 * math.sin(2 * PI * i / 14)) for i in range(14)]
WATER_Z = -38.0

def hnoise(x, y, seed):
    return np.abs(np.modf(np.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453)[0])
def vnoise(x, y, seed=0):
    xi = np.floor(x); yi = np.floor(y); xf = x - xi; yf = y - yi
    u = xf * xf * (3 - 2 * xf); v = yf * yf * (3 - 2 * yf)
    a = hnoise(xi, yi, seed); b = hnoise(xi + 1, yi, seed); c = hnoise(xi, yi + 1, seed); d = hnoise(xi + 1, yi + 1, seed)
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
def fbm(x, y, seed=0, o=5):
    s = np.zeros_like(x); amp = 0.5; tot = 0
    for i in range(o):
        s = s + amp * vnoise(x * 2 ** i, y * 2 ** i, seed + i); tot += amp; amp *= 0.5
    return s / tot
def poly_sdf(X, Y, pts):
    d = np.full(X.shape, 1e9); inside = np.zeros(X.shape, bool)
    for i in range(len(pts)):
        x0, y0 = pts[i]; x1, y1 = pts[(i + 1) % len(pts)]; ex, ey = x1 - x0, y1 - y0
        t = np.clip(((X - x0) * ex + (Y - y0) * ey) / (ex * ex + ey * ey), 0, 1)
        d = np.minimum(d, np.hypot(X - (x0 + t * ex), Y - (y0 + t * ey)))
        inside ^= ((y0 > Y) != (y1 > Y)) & (X < (x1 - x0) * (Y - y0) / (y1 - y0 + 1e-12) + x0)
    return np.where(inside, -d, d)
def sstep(a, b, x): t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
def terrain_h(X, Y):
    d = np.minimum(poly_sdf(X, Y, ROCK_POLY), poly_sdf(X, Y, HILL))
    r = np.hypot(X, Y)
    crag = (fbm(X * 0.09, Y * 0.09, 3) - 0.5) * 16 + (fbm(X * 0.3, Y * 0.3, 8, 3) - 0.5) * 4
    plate = np.where(d <= 0, 0.0, -np.clip(d, 0, None) * 2.7 + crag * np.clip(d / 5, 0, 1) - np.clip(d / 5, 0, 1) * 1.0)
    plate = np.minimum(plate, 0.0)
    floor = (-44 + 4 * fbm(X * 0.01, Y * 0.01, 21) + 70 * sstep(380, 900, r) * (0.35 + fbm(X * 0.004, Y * 0.004, 31))
             + 380 * sstep(900, 2000, r) * (0.25 + np.abs(fbm(X * 0.0016, Y * 0.0016, 41, 6) - 0.5) * 2.2))
    return np.maximum(plate, floor)

def build_terrain():
    n = 640; u = np.linspace(-1, 1, n + 1); ax = 2300 * (0.1 * u + 0.9 * u ** 3)
    X, Y = np.meshgrid(ax, ax); Z = terrain_h(X, Y)
    pos = np.stack([X, Y, Z], 2).reshape(-1, 3).astype(np.float32)
    ii, jj = np.meshgrid(np.arange(n), np.arange(n)); a = (jj * (n + 1) + ii).ravel(); b = a + 1; c = a + n + 1; d = c + 1
    tris = np.stack([a, b, d, a, d, c], 1).reshape(-1, 3).astype(np.int32)
    me = bpy.data.meshes.new('terrain'); me.vertices.add(len(pos)); me.vertices.foreach_set('co', pos.ravel())
    me.loops.add(len(tris) * 3); me.loops.foreach_set('vertex_index', tris.ravel())
    me.polygons.add(len(tris)); me.polygons.foreach_set('loop_start', np.arange(0, len(tris) * 3, 3, dtype=np.int32))
    me.update(calc_edges=True); me.shade_smooth()
    return me

# ============================================================ the castle
def wall_segments(pts):
    out = []
    for i in range(len(pts)):
        p0 = pts[i]; p1 = pts[(i + 1) % len(pts)]; dx, dy = p1[0] - p0[0], p1[1] - p0[1]; L = math.hypot(dx, dy)
        n = (dy / L, -dx / L); out.append((p0, p1, L, math.atan2(n[0], -n[1])))
    return out

def round_tower(x, y, z0, r, h, cone_h, seg=20, slits=True, machic=True, mc='slate', lamps=True, flag=True):
    cyl('stone', (x, y, z0), r * 1.12, r, h * 0.12, seg)  # battered plinth
    cyl('stone', (x, y, z0 + h * 0.12), r, r * 0.98, h * 0.88, seg)
    for k in range(3):  # string courses
        cyl('stone', (x, y, z0 + h * (0.3 + 0.22 * k)), r * 1.04, r * 1.04, 0.3, seg)
    if slits:
        for lv in (0.26, 0.52, 0.76):
            for k in range(8):
                a = 2 * PI * k / 8 + lv * 3; cube_at('dstone', (x + (r + 0.02) * math.cos(a), y + (r + 0.02) * math.sin(a), z0 + h * lv + 1.3), 0.12, 0.12, 2.0, a - PI / 2)
    top = z0 + h
    if machic:
        ring = r * 1.28
        cyl('stone', (x, y, top - 0.5), ring, ring, 0.55, seg)
        for k in range(seg * 2):
            a = 2 * PI * k / (seg * 2); cube_at('stone', (x + (r * 1.08) * math.cos(a), y + (r * 1.08) * math.sin(a), top - 1.5), 0.34, 0.5, 1.0, a - PI / 2)
        for k in range(seg):
            a = 2 * PI * (k + 0.5) / seg; cube_at('dstone', (x + (ring - 0.1) * math.cos(a), y + (ring - 0.1) * math.sin(a), top - 0.6), 0.5, 0.2, 0.55, a - PI / 2)
        if cone_h <= 0:
            for k in range(seg):
                a = 2 * PI * k / seg; cube_at('stone', (x + (ring - 0.2) * math.cos(a), y + (ring - 0.2) * math.sin(a), top + 0.05), 1.0, 0.7, 1.4, a - PI / 2)
    if cone_h > 0:
        cyl(mc, (x, y, top + 0.05), r * 1.34, 0.12, cone_h, seg)
        for k in range(seg): # ridges
            a = 2 * PI * k / seg; cone_between('copper', (x + r * 1.33 * math.cos(a), y + r * 1.33 * math.sin(a), top + 0.1), (x + 0.1 * math.cos(a), y + 0.1 * math.sin(a), top + cone_h), 0.09, 0.03, 4)
        sph('gold', (x, y, top + cone_h + 0.2), 0.35, seg=8); cone_between('gold', (x, y, top + cone_h), (x, y, top + cone_h + 2.4), 0.12, 0.02, 5)
        if flag: banner(x, y, top + cone_h + 1.0, 3.5, RNG.uniform(0, 6.28), 1.0, 3.2)
    if lamps:
        for k in range(4): a = k * PI / 2 + 0.4; lamp(x + (r * 1.3) * math.cos(a), y + (r * 1.3) * math.sin(a), top - 0.4, 0.2)

def curtain_wall():
    H, Tk = 13.0, 3.0
    for (p0, p1, L, yaw) in wall_segments(WALL):
        f = F((p0[0], p0[1], 0), yaw)
        gate = abs(p0[1] + 100) < 1 and abs(p1[1] + 100) < 1
        n = max(1, int(L // 9)); ops = []
        for i in range(n):
            uc = (i + 0.5) * L / n
            if gate and abs(uc - L / 2) < 16: continue
            ops.append(op(uc, 0.42, 6.0, 8.2, 0.55, 3))
        wall_face(f, 0, L, 0, H, -Tk, 0, ops)
        lbox(f, 0, L, H - 0.2, H + 0.2, -Tk - 0.4, 0.8, 'stone')
        corbels(f, 0, L, H - 0.1, proj=0.8, sp=1.1, rows=3)
        crenel(f, 0, L, H + 0.2, Tk, 1.4, 1.3, 1.0, 0.4)
        k = max(1, int(L // 14))
        for i in range(k):
            uc = (i + 0.5) * L / k; lbox(f, uc - 0.9, uc + 0.9, 0, 9, 0, 1.2, 'stone'); lbox(f, uc - 0.8, uc + 0.8, 9, 12.4, 0, 0.8, 'stone')
        k = max(1, int(L // 12))
        for i in range(k):
            x, y, z = f.p((i + 0.5) * L / k, H + 0.4, 0.8); lamp(x, y, z + 0.9)
    for i, (x, y) in enumerate(WALL):
        big = i % 3 == 0
        cyl('stone', (x, y, -22), 8.0, 7.0, 22.5, 20)
        round_tower(x, y, -1, 6.5 if big else 5.2, 25 if big else 20, 14 if big else (10 if i % 2 else 0), flag=big)

def gatehouse():
    gy = -100
    for sx in (-1, 1):
        cyl('stone', (sx * 13, gy - 1, -24), 10.0, 8.6, 24, 24)
        round_tower(sx * 13, gy - 1, -1, 7.5, 30, 15, 24)
    f = F((0, gy - 7.5, 0), 0)
    gate = op(0, 5.4, 0, 5.4, 3.5, 10)
    lbox(f, -9, 9, -24, 0, -14, 0, 'stone')
    wall_face(f, -7, 7, 0, 22, -14, 0, [gate])
    arch_band(f, gate, 0.7, 0, 0.5); arch_band(f, gate, 1.3, 0, 0.25)
    for k in range(-5, 6): cube_at('iron', f.p(k * 0.5, 5.0, -1.0), 0.09, 0.09, 4.0)
    for k in range(8): cube_at('iron', f.p(0, 1.0 + k * 0.5, -1.0), 5.2, 0.08, 0.08)
    for k in range(-5, 6, 2): cone_between('iron', f.p(k * 0.5, 0.3, -1.0), f.p(k * 0.5, -0.4, -1.0), 0.07, 0.01, 4)
    string_course(f, -7, 7, 11, 0.4, 0.4); string_course(f, -7, 7, 16, 0.4, 0.4)
    corbels(f, -7, 7, 21.5, proj=1.1, sp=1.0, rows=4)
    crenel(f, -7, 7, 21.7, 14, 1.6, 1.4, 1.0, 0.9)
    lbox(f, -7, 7, 21.4, 21.9, -14, 1.2, 'stone')
    for sx in (-1, 1):
        lbox(f, sx * 3.5 - 0.9, sx * 3.5 + 0.9, 12.5, 14.7, 0, 0.18, 'cloth'); lbox(f, sx * 3.5 - 0.7, sx * 3.5 + 0.7, 13.0, 14.2, 0.18, 0.26, 'gold')
        lbox(f, sx * 4.8 - 1.2, sx * 4.8 + 1.2, 16.6, 17.0, 0, 1.3, 'stone')
        lstatue(f, sx * 4.8, 17.0, 0.3, 3.6, 'knight')
    for k in range(-3, 4): lamp(*f.p(k * 1.8, 7.0, 0.7), 0.2)
    x, y, z = f.p(0, 21.7, 0.5); banner(x, y, z, 7.0, PI / 2, 2.0, 6.0)

def bridge():
    y0, y1 = -108.0, -186.0; L = y0 - y1; n = 8; sp = L / n
    ops = [op((i + 0.5) * sp, sp * 0.64, -44, -6, sp * 0.32, 8) for i in range(n)]
    fe = F((4.0, y1, 0), PI / 2); wall_face(fe, 0, L, -44, 0, -8.0, 0, ops)
    fw = F((-4.0, y0, 0), -PI / 2)
    for f in (fe, fw):
        for o in ops: arch_band(f, o, 0.35, 0, 0.3)
        for i in range(1, n): lbox(f, i * sp - 0.9, i * sp + 0.9, -44, -10, 0, 1.0, 'stone')
        string_course(f, 0, L, -0.9, 0.35, 0.3)
    box('road', (0, (y0 + y1) / 2, -0.12), 7.2, L, 0.18)
    for sx in (-3.6, 3.6):
        box('stone', (sx, (y0 + y1) / 2, 0.0), 0.7, L, 1.2)
        for k in range(int(L / 1.6)): box('stone', (sx, y0 - 0.8 - k * 1.6, 1.2), 0.7, 0.8, 0.5)
    for k in range(8):
        y = y0 - 5 - k * 9.5
        for sx in (-3.6, 3.6): cone_between('iron', (sx, y, 1.2), (sx, y, 4.6), 0.06, 0.04, 5); lamp(sx, y, 4.8, 0.26)
    cyl('stone', (0, -205, -40), 8.0, 6.8, 40, 16)
    round_tower(0, -205, -1, 6.0, 16, 11, 16)
    box('road', (0, -204, -0.05), 6.0, 36.0, 0.1)

# ============================================================ the cathedral
NX, AX, BAY, Y0, ZN = 8.6, 15.2, 11.0, -41.0, 31.0
XT = 30.0

def side_frame(sign, x, ylo, yhi):
    return F((x, ylo, 0), PI / 2) if sign > 0 else F((-x, yhi, 0), -PI / 2)

def ltorus_side(f, u, v, w, R, r, m, seg=16):
    torus(m, f.M @ Matrix.Translation((u, v, w)) @ Matrix.Rotation(PI / 2, 4, 'Y'), R, r, seg, 5)

def flyer(f, u, wa, wb):
    """A flying buttress from a pier (outer face wb) to the nave wall pilaster (wa): sloped top, arched underside, tracery rings."""
    s = 1 if wb > wa else -1; span = abs(wb - wa)
    top = lambda w: 22.7 + (w - wb) * (27.0 - 22.7) / (wa - wb)
    arc = lambda t: 21.2 + (24.3 - 21.2) * t - 4 * 1.5 * t * (1 - t)  # t = 0 at the pier, 1 at the wall
    pts = [(wb, 22.7), (wa, 27.0), (wa, 24.3)] + [(wa + (wb - wa) * (1 - i / 8), arc(1 - i / 8)) for i in range(1, 9)]
    # points above run wall -> pier along the arc; they end at (wb, 21.2)
    fprism(f, pts, u - 0.55, u + 0.55, 'stone')
    for t in (0.3, 0.62):
        w = wb + (wa - wb) * t; v0 = arc(t); v1 = top(w); ltorus_side(f, u, (v0 + v1) / 2 + 0.05, w, max(0.2, (v1 - v0) * 0.28), 0.08, 'stone', 18)
    fprism(f, [(wb, 22.7), (wa + (wb - wa) * 0.05, 22.7 + (27.0 - 22.7) * 0.95), (wa + (wb - wa) * 0.05, 27.5), (wa, 27.5)], u - 0.3, u + 0.3, 'stone')
    for t in range(1, 7): crockets(f.p(u, 22.7 + (27.0 - 22.7) * t / 7, wb + (wa - wb) * t / 7), f.p(u, 22.7 + (27.0 - 22.7) * (t + 1) / 7, wb + (wa - wb) * (t + 1) / 7), 1, 0.4)

def pier(f, u, wb):
    """Buttress pier: stepped, ending in a pinnacle with a gargoyle on its face."""
    lbox(f, u - 0.95, u + 0.95, 0, 10, 0, wb, 'stone'); lbox(f, u - 0.85, u + 0.85, 10, 17, 0, wb - 0.4, 'stone')
    lbox(f, u - 0.78, u + 0.78, 17, 21.2, 0, wb - 0.8, 'stone')
    for v in (10, 17): lbox(f, u - 0.95, u + 0.95, v - 0.05, v + 0.2, 0, wb + 0.1, 'stone')
    x, y, z = f.p(u, 21.2, (wb - 0.8) / 2); pinnacle(x, y, z, 3.0, 0.55, 5.2)
    x, y, z = f.p(u, 15.8, wb - 0.4); gargoyle(x, y, z, f.yaw, 1.9)
    lbox(f, u - 0.7, u + 0.7, 10.2, 13.6, wb - 0.45, wb - 0.3, 'dstone')
    lpoly(f, [(u - 0.85, 13.6), (u + 0.85, 13.6), (u, 14.9)], wb - 0.5, wb + 0.35, 'stone')
    for sg in (-1, 1): cone_between('stone', f.p(u + sg * 0.78, 10.2, wb - 0.2), f.p(u + sg * 0.78, 13.6, wb - 0.2), 0.09, 0.08, 6)
    lstatue(f, u, 10.2, wb - 0.1, 2.5, 'saint' if int(u) % 2 else 'king', plinth=False)

def nave_run(ylo, yhi, west_closed=True):
    L = yhi - ylo; nb = int(round(L / BAY))
    for sign in (1, -1):
        f = side_frame(sign, NX, ylo, yhi)
        ops = [op(BAY * (k + 0.5), 3.4, 20.5, 26.0, 3.1, 9) for k in range(nb)]
        wall_face(f, 0, L, 0, ZN - 0.6, -1.6, 0, ops)
        for o in ops: window(f, o, depth=0.9)
        string_course(f, 0, L, 19.8, 0.4, 0.35); string_course(f, 0, L, 25.85, 0.2, 0.2)
        corbels(f, 0, L, ZN - 0.6, proj=0.85, sp=0.95, rows=3); crenel(f, 0, L, ZN - 0.4, 1.6, 1.5, 1.2, 0.9, 0.0)
        lbox(f, 0, L, ZN - 0.6, ZN - 0.4, -1.6, 0.95, 'stone')
        fa = side_frame(sign, AX, ylo, yhi)
        aops = [op(BAY * (k + 0.5), 3.2, 3.8, 9.5, 2.9, 8) for k in range(nb)]
        wall_face(fa, 0, L, 0, 14.5, -1.4, 0, aops)
        for o in aops: window(fa, o, depth=0.7)
        string_course(fa, 0, L, 3.4, 0.3, 0.25); string_course(fa, 0, L, 13.0, 0.3, 0.3)
        corbels(fa, 0, L, 14.5, proj=0.7, sp=0.95, rows=3); crenel(fa, 0, L, 14.7, 1.4, 1.3, 1.1, 0.9, 0.0)
        for k in range(nb + 1):
            u = k * BAY
            lbox(f, u - 0.8, u + 0.8, 0, ZN + 1.2, 0, 0.7, 'stone'); lbox(f, u - 0.7, u + 0.7, ZN + 1.2, ZN + 1.9, 0, 0.55, 'stone')
            x, y, z = f.p(u, ZN + 1.9, 0.3); pinnacle(x, y, z, 1.6, 0.45, 2.8, cro=False)
            pier(fa, u, 2.5); flyer(fa, u, -(AX - NX) + 0.7, 1.7)
        fprism(fa, [(0.9, 14.0), (0.9, 14.9), (-(AX - NX) + 0.2, 20.4), (-(AX - NX) + 0.2, 19.3)], 0, L, 'slate')
    r0 = NX + 0.8
    prism3d('slate', [(-r0, ylo, ZN - 0.7), (r0, ylo, ZN - 0.7), (0.5, ylo, ZN + 11.0), (-0.5, ylo, ZN + 11.0)], (0, L, 0))
    box('copper', (0, ylo + L / 2, ZN + 10.9), 0.6, L, 0.5)
    for k in range(int(L / 2.2)): cone_between('copper', (0, ylo + 1.1 + k * 2.2, ZN + 11.1), (0, ylo + 1.1 + k * 2.2, ZN + 12.4), 0.22, 0.03, 4)
    for k in range(int(L / 3.7)):
        y = ylo + 1.85 + k * 3.7
        for sg in (-1, 1): cone_between('copper', (sg * (r0 - 0.05), y, ZN - 0.4), (sg * 0.55, y, ZN + 10.7), 0.07, 0.07, 4)
        for sg in (-1, 1):  # lucarne on the slope
            if k % 2 == 0:
                x = sg * 5.0; z = ZN + 4.4; box('stone', (x, y, z), 2.2, 1.6, 2.2); prism3d('slate', [(x - 1.2, y - 0.9, z + 2.2), (x + 1.2, y - 0.9, z + 2.2), (x, y - 0.9, z + 3.6)], (0, 1.8, 0))
                lpoly(F((x, y - 0.8, z), 0), arch_pts(0, 1.0, 0.3, 1.2, 0.6, 4), -0.05, 0.1, 'glass')

def rose(f, u, v, R, m='stone'):
    lpoly(f, [(u + R * math.cos(2 * PI * i / 40), v + R * math.sin(2 * PI * i / 40)) for i in range(40)], 0.0, 0.04, 'glass')
    ltorus(f, u, v, 0.05, R + 0.3, 0.26, m, 40); ltorus(f, u, v, 0.05, R * 0.2, 0.12, m, 20)
    for k in range(12):
        a = 2 * PI * k / 12
        cone_between(m, f.p(u + R * 0.2 * math.cos(a), v + R * 0.2 * math.sin(a), 0.1), f.p(u + R * math.cos(a), v + R * math.sin(a), 0.1), 0.09, 0.09, 4)
        ltorus(f, u + R * 0.62 * math.cos(a + PI / 12), v + R * 0.62 * math.sin(a + PI / 12), 0.08, R * 0.17, 0.06, m, 14)
        ltorus(f, u + R * 0.88 * math.cos(a), v + R * 0.88 * math.sin(a), 0.08, R * 0.08, 0.05, m, 10)

def spire(cx, cy, z0, r, h, seg=8, mat='copper', crock=True, lucarne_z=(), rot=PI / 8, cap=True):
    cyl(mat, (cx, cy, z0), r, 0.05, h, seg, rot)
    for k in range(seg):
        a = rot + 2 * PI * k / seg
        cone_between('stone', (cx + r * 1.01 * math.cos(a), cy + r * 1.01 * math.sin(a), z0), (cx, cy, z0 + h), 0.15, 0.04, 4)
        if crock:
            nn = int(h / 2.6)
            for i in range(1, nn):
                t = i / nn; rr = r * (1 - t) + 0.1
                cone_between('stone', (cx + rr * math.cos(a), cy + rr * math.sin(a), z0 + h * t), (cx + (rr + 0.55) * math.cos(a), cy + (rr + 0.55) * math.sin(a), z0 + h * t + 0.7), 0.17, 0.03, 4)
    for zz in lucarne_z:
        t = (zz - z0) / h; rr = r * (1 - t) * 0.92
        for k in range(0, seg, 2):
            a = rot + 2 * PI * (k + 0.5) / seg; x, y = cx + rr * math.cos(a), cy + rr * math.sin(a)
            fl = F((x, y, zz), a + PI / 2)
            lbox(fl, -0.7, 0.7, 0, 2.2, -0.4, 0.6, 'stone'); lpoly(fl, [(-0.9, 2.2), (0.9, 2.2), (0, 3.6)], -0.3, 0.7, 'stone')
            lpoly(fl, arch_pts(0, 0.8, 0.35, 1.4, 0.6, 4), 0.55, 0.62, 'glass')
            cone_between('stone', fl.p(0, 3.6, 0.2), fl.p(0, 4.5, 0.2), 0.1, 0.02, 4)
    if cap:
        sph('gold', (cx, cy, z0 + h + 0.25), 0.7, seg=10)
        cone_between('gold', (cx, cy, z0 + h), (cx, cy, z0 + h + 4.5), 0.12, 0.03, 5); cube_at('gold', (cx, cy, z0 + h + 3.2), 1.3, 0.1, 0.1);

def tower_faces(sign):
    """One west tower: four faces, buttresses, belfry, machicolated top, corner turrets, spire."""
    xa, xb = (5.0, 16.0) if sign > 0 else (-16.0, -5.0); y0_, y1_ = -52.0, -41.0; H = 54.0; Tw = 2.5
    faces = [
        (F((0, y0_, 0), 0), xa, xb),                                  # south, u = x
        (F((16.0 if sign > 0 else -16.0, y0_, 0) if sign > 0 else (-16.0, y1_, 0), PI / 2 if sign > 0 else -PI / 2), 0, 11),  # outer side
        (F((5.0, y1_, 0), -PI / 2) if sign > 0 else F((-5.0, y0_, 0), PI / 2), 0, 11),                                          # inner side
        (F((16.0, y1_, 0), PI) if sign > 0 else F((-5.0, y1_, 0), PI), 0, 11),                                                  # north, faces the nave
    ]
    for fi, (f, u0, u1) in enumerate(faces):
        wo = 0.02 if fi in (1, 2) else 0.0
        if fi in (1, 2): u0, u1 = 0.02, 10.98
        W = u1 - u0; ops = []
        if fi == 0 and True:
            ops.append(op((xa + xb) / 2 + (0 if False else 0), 3.2, 0, 5.2, 3.0, 9))  # side portal
        for uc in ((u0 + 2.9, u0 + 8.1) if fi else (xa + 2.3, xa + 8.7)):
            ops.append(op(uc, 2.2, 39.0, 45.5, 3.4, 8))
        mid_c = (u0 + u1) / 2
        if fi:
            ops.append(op(mid_c, 1.4, 24.0, 28.0, 2.2, 6))
        else:
            ops.append(op(mid_c + (3.0 if sign > 0 else -3.0) * 0, 1.4, 28.5, 32.5, 2.2, 6)) if False else None
        wall_face(f, u0, u1, 0, H, -Tw, wo, ops)
        for o in ops:
            if o['sill'] > 30: lbox(f, o['uc'] - o['ww'] / 2, o['uc'] + o['ww'] / 2, o['sill'], arch_h(o, o['uc']), -Tw, -Tw + 0.05, 'dstone')
            if o['sill'] > 30:
                for k in range(int((arch_h(o, o['uc']) - o['sill']) / 0.55)): lbox(f, o['uc'] - o['ww'] / 2, o['uc'] + o['ww'] / 2, o['sill'] + 0.2 + k * 0.55, o['sill'] + 0.3 + k * 0.55, -Tw + 0.2, -0.3, 'wood')
            elif o['sill'] == 0:
                pass
            else: window(f, o, depth=1.0)
            if o['sill'] > 30: arch_band(f, o, 0.4, 0, 0.3)
        for v in (12.0, 23.0, 36.0, 51.6): string_course(f, u0, u1, v, 0.4, 0.4)
        for v in (0, 1):
            pass
        # blind arcade band
        for k in range(4):
            uc = u0 + (k + 0.5) * W / 4
            if fi == 0 and any(abs(uc - o['uc']) < 2.1 for o in ops if o['sill'] < 1): continue
            o = op(uc, 1.7, 28.5, 31.5, 1.6, 6)
            lpoly(f, arch_pts(uc, 1.7, 26.5, 31.5, 1.7, 6), 0.0, 0.05, 'dstone'); arch_band(f, dict(o, sill=26.5), 0.25, 0.0, 0.2)
        # slits, low
        for k in range(3): lancet_slit(f, u0 + (k + 0.5) * W / 3 + (0.9 if False else 0), 7.0, 10.5)
        corbels(f, u0, u1, H, proj=1.4, sp=1.2, rows=4)
        lbox(f, u0, u1, H - 0.02, H + 0.45, -Tw, 1.5, 'stone')
        crenel(f, u0, u1, H + 0.45, Tw, 1.5, 1.3, 1.0, 1.5)
        for k in range(int(W // 2.4)):
            x, y, z = f.p(u0 + (k + 0.5) * W / int(W // 2.4), H - 0.5, 1.2);
        if fi == 0:
            for uu in (u0, u1):  # stepped buttresses at the front corners
                s_ = 1 if uu == u0 else -1
                for v0_, v1_, pr_ in ((0, 16, 1.7), (16, 30, 1.3), (30, 42, 0.9)):
                    lbox(f, uu - 0.8 if s_ > 0 else uu - 0.8, uu + 0.8, v0_, v1_, 0, pr_, 'stone')
                    lbox(f, uu - 0.9, uu + 0.9, v1_ - 0.05, v1_ + 0.25, 0, pr_ + 0.1, 'stone')
                x, y, z = f.p(uu, 42.0, 0.45); pinnacle(x, y, z, 2.4, 0.5, 4.2)
    cxm = (xa + xb) / 2; cym = (y0_ + y1_) / 2
    for dx, dy in ((xa, y0_), (xb, y0_), (xa, y1_), (xb, y1_)):  # corner turrets
        cone_between('stone', (dx, dy, 35.5), (dx, dy, 40.5), 0.6, 1.7, 10); cyl('stone', (dx, dy, 40.0), 1.7, 1.6, 17.0, 12)
        cyl('stone', (dx, dy, 57.0), 2.1, 2.1, 0.5, 12)
        for k in range(12):
            a = 2 * PI * k / 12; cube_at('stone', (dx + 1.8 * math.cos(a), dy + 1.8 * math.sin(a), 56.5), 0.5, 0.5, 0.9, a)
        cyl('slate', (dx, dy, 57.4), 2.3, 0.1, 8.0, 12)
        for k in range(8): a = 2 * PI * k / 8; cone_between('copper', (dx + 2.25 * math.cos(a), dy + 2.25 * math.sin(a), 57.5), (dx, dy, 65.2), 0.06, 0.02, 4)
        cube_at('dstone', (dx + 0.0, dy, 48), 0.18, 0.18, 2.0); sph('gold', (dx, dy, 65.6), 0.3, seg=6)
    spire(cxm, cym, H + 0.5, 6.2, 30.0, 8, 'copper', True, (62.0, 71.0))
    banner(cxm, cym, H + 0.5 + 31.0, 4.0, PI / 3 if sign > 0 else 2 * PI / 3, 1.0, 3.6)

def west_front():
    f = F((0, -52.0, 0), 0); T = 4.0
    steps = [(8.2, 9.8), (7.0, 8.9), (5.8, 8.0), (4.7, 7.1), (3.8, 5.6)]
    d = 0.0
    for k, (ww, sp) in enumerate(steps):
        o = op(0, ww, 0, sp, ww * 0.8, 10); th = 1.0 if k < 4 else T - 4.0 + 0.0 + 0.0
        if k < 4:
            wall_face(f, -5.0, 5.0, 0, 19.0, -(d + 1.0), -d, [o]); arch_band(f, dict(o, sill=o['spring']), 0.5, -d - 0.0, -d + 0.35)
            d += 1.0
        else:
            wall_face(f, -5.0, 5.0, 0, 19.0, -T - 1.0, -d, [o]); arch_band(f, dict(o, sill=o['spring']), 0.5, -d, -d + 0.35)
    lbox(f, -5.0, 5.0, 19.0, 36.0, -T, 0, 'stone')
    # door, tympanum, trumeau
    ww, sp = steps[-1]; dd = -(d + 0.9)
    lbox(f, -ww / 2, 0, 0, 5.5, dd - 0.2, dd, 'wood'); lbox(f, 0, ww / 2, 0, 5.5, dd - 0.2, dd, 'wood')
    for k in range(4): lbox(f, -ww / 2, ww / 2, 0.8 + k * 1.3, 0.95 + k * 1.3, dd, dd + 0.06, 'iron')
    lbox(f, -ww / 2, ww / 2, 5.5, 5.8, dd - 0.4, dd + 0.2, 'stone')
    lpoly(f, arch_pts(0, ww, 5.8, 5.8, ww * 0.8, 10)[1:-1], dd - 0.3, dd, 'dstone')
    lpoly(f, [(0.9 * math.cos(2 * PI * i / 20), 7.2 + 1.2 * math.sin(2 * PI * i / 20)) for i in range(20)], dd, dd + 0.07, 'gold')
    for i in range(7):
        a = PI * (0.1 + 0.8 * i / 6); lstatue(f, -1.45 * math.cos(a) * 1.0, 5.9 + 0.4 * math.sin(a) * 0.0 + (0.0), dd + 0.1, 0.0001, 'saint', plinth=False) if False else None
    lstatue(f, -1.45, 5.9, dd + 0.1, 1.1, 'saint'); lstatue(f, 1.45, 5.9, dd + 0.1, 1.1, 'saint'); lstatue(f, 0, 6.2, dd + 0.12, 2.4, 'king', 'gold', plinth=False)
    lbox(f, -0.3, 0.3, 0, 5.5, dd - 0.1, dd + 0.4, 'stone'); lstatue(f, 0, 1.0, dd + 0.2, 2.3, 'saint', plinth=False)
    # jamb figures on the portal steps
    dd2 = 0.0
    for k in range(1, 5):
        ww_k = steps[k][0]; w_ = -k + 0.3
        for sg in (-1, 1): lstatue(f, sg * (ww_k / 2 + 0.33), 0.1, w_, 1.9, 'saint' if (k + sg) % 2 else 'king')
    for k in range(5):  # little figures along the archivolts
        o = op(0, steps[k][0] + 0.5, 0, steps[k][1], steps[k][0] * 0.8, 10); pts = arch_pts(0, steps[k][0] + 0.9, 0, steps[k][1], steps[k][0] * 0.8 + 0.3, 14)[5:-5]
        for i, (pu, pv) in enumerate(pts[::2]): lstatue(f, pu, pv, -k + 0.3 if k < 4 else -3.7, 0.55, 'saint', plinth=False)
    # gablet above the portal
    lpoly(f, [(-4.9, 15.4), (4.9, 15.4), (0, 24.6)], 0.0, 0.9, 'stone'); lpoly(f, [(-3.9, 16.0), (3.9, 16.0), (0, 22.6)], 0.9, 0.97, 'dstone')
    for sg in (-1, 1): crockets(f.p(sg * 4.9, 15.4, 0.6), f.p(0, 24.6, 0.6), 7, 0.45, 'stone', ((0, 0, 0),), 0.9) if False else None
    for i in range(8):
        t = (i + 0.5) / 8
        for sg in (-1, 1):
            c = Vector(f.p(sg * 4.9 * (1 - t), 15.4 + 9.2 * t, 0.9)); cone_between('stone', c, c + (Vector(f.p(0, 0, 1)) - Vector(f.p(0, 0, 0))) * 0.25 + Vector((0, 0, 0.6)), 0.16, 0.03, 4)
    lpoly(f, [(1.05 * math.cos(2 * PI * i / 24), 19.3 + 1.05 * math.sin(2 * PI * i / 24)) for i in range(24)], 0.97, 1.0, 'glass'); ltorus(f, 0, 19.3, 1.0, 1.2, 0.12, 'stone', 24)
    for sg in (-1, 1):
        og = op(sg * 2.2, 1.0, 16.7, 18.4, 0.9, 5); lpoly(f, arch_pts(og['uc'], og['ww'], og['sill'], og['spring'], og['rise'], 5), 0.97, 1.0, 'glass'); arch_band(f, og, 0.2, 0.9, 1.05)
    x, y, z = f.p(0, 24.6, 0.4); pinnacle(x, y, z, 0.8, 0.35, 2.4)
    lstatue(f, 0, 12.0, 0.9, 2.2, 'king')
    # gallery of kings, full width
    lbox(f, -16, 16, 19.2, 19.8, 0, 0.8, 'stone'); lbox(f, -16, 16, 24.9, 25.3, 0, 0.9, 'stone'); corbels(f, -16, 16, 24.9, proj=0.9, sp=1.0, rows=2)
    for i in range(15):
        u = -15.05 + i * 2.15
        lbox(f, u - 0.85, u + 0.85, 19.8, 24.0, 0, 0.14, 'dstone')
        for sg in (-1, 1): cone_between('stone', f.p(u + sg * 0.92, 19.8, 0.25), f.p(u + sg * 0.92, 24.0, 0.25), 0.12, 0.1, 8)
        lpoly(f, [(u - 1.05, 24.0), (u + 1.05, 24.0), (u, 25.0)], 0.0, 0.6, 'stone')
        lstatue(f, u, 19.85, 0.3, 3.3, 'king' if i % 3 else 'saint', plinth=False)
    # rose window
    rose(f, 0, 30.2, 4.2); arch_band(f, op(0, 9.4, 25.2, 31.0, 4.8, 10), 0.0, 0, 0.0) if False else None
    for sg in (-1, 1):
        lstatue(f, sg * 3.6, 25.6, 0.5, 2.0, 'angel')
    # upper gable
    lpoly(f, [(-5, 36), (5, 36), (0, 47.5)], -T, 0, 'stone'); string_course(f, -5.2, 5.2, 35.8, 0.5, 0.55)
    for o in (op(0, 1.3, 38.5, 42.0, 1.6, 6), op(-2.4, 1.0, 38.5, 41.2, 1.2, 6), op(2.4, 1.0, 38.5, 41.2, 1.2, 6)):
        lpoly(f, arch_pts(o['uc'], o['ww'], o['sill'], o['spring'], o['rise'], 6), 0.0, 0.05, 'glass'); arch_band(f, o, 0.3, 0.0, 0.25)
    for i in range(8):
        t = (i + 0.5) / 8
        for sg in (-1, 1):
            c = Vector(f.p(sg * 5.0 * (1 - t), 36 + 11.5 * t, 0.15)); cone_between('stone', c, c + (Vector(f.p(0, 0, 1)) - Vector(f.p(0, 0, 0))) * 0.3 + Vector((0, 0, 0.6)), 0.17, 0.03, 4)
    for sg in (-1, 1): x, y, z = f.p(sg * 5.0, 36.0, 0.3); pinnacle(x, y, z, 2.6, 0.5, 4.6)
    x, y, z = f.p(0, 47.5, 0.0); lstatue(f, 0, 47.5, -0.3, 3.4, 'angel', 'gold')
    # side portals in the towers and the front faces get built by tower_faces
    for sg in (-1, 1):
        o = op(sg * 10.5, 3.2, 0, 5.2, 3.0, 9); window(f, o, glass=False, mullions=0, tracery=False, hood=True, sill_ledge=False)
        lbox(f, o['uc'] - 1.5, o['uc'], 0, 4.6, -2.2, -2.0, 'wood'); lbox(f, o['uc'], o['uc'] + 1.5, 0, 4.6, -2.2, -2.0, 'wood')
        lpoly(f, arch_pts(o['uc'], 3.2, 4.6, 5.2, 3.0, 8)[1:-1], -2.2, -2.0, 'dstone')
        lpoly(f, [(o['uc'] - 2.2, 8.6), (o['uc'] + 2.2, 8.6), (o['uc'], 12.0)], 0, 0.7, 'stone')
        lstatue(f, o['uc'], 8.6, 0.2, 2.2, 'knight', 'stone')

def transept():
    for sign in (1, -1):
        # side walls (south y=1.4, north y=18.6)
        for yy, yaw in ((1.4, 0.0), (18.6, PI)):
            f = F((0, yy, 0), yaw); s_ = sign if yaw == 0 else -sign
            u0, u1 = (NX, XT) if s_ > 0 else (-XT, -NX)
            ops = [op(s_ * 19.5, 3.4, 20.5, 26.0, 3.1, 9), op(s_ * 13.0, 3.0, 4.0, 11.0, 3.0, 8)]
            wall_face(f, u0, u1, 0, ZN - 0.6, -1.6, 0, ops)
            for o in ops: window(f, o, depth=0.9)
            string_course(f, u0, u1, 19.8, 0.4, 0.35); corbels(f, u0, u1, ZN - 0.6, proj=0.85, sp=0.95, rows=3); crenel(f, u0, u1, ZN - 0.4, 1.6, 1.5, 1.2, 0.9, 0.0)
            lbox(f, u0, u1, ZN - 0.6, ZN - 0.4, -1.6, 0.95, 'stone')
            for uu in (u0 + 0.9, (u0 + u1) / 2 + s_ * 0.0, u1 - 0.9):
                lbox(f, uu - 0.8, uu + 0.8, 0, ZN + 1.2, 0, 0.8, 'stone')
        # end wall
        fe = F((XT, 1.4, 0), PI / 2) if sign > 0 else F((-XT, 18.6, 0), -PI / 2); W = 17.2
        gate = op(8.6, 3.8, 0, 5.4, 3.5, 9)
        ops = [op(3.0, 2.2, 11.0, 20.0, 2.8, 8), op(8.6, 2.6, 12.5, 21.0, 3.0, 8), op(14.2, 2.2, 11.0, 20.0, 2.8, 8)]
        wall_face(fe, 0, W, 0, 10.0, -1.8, 0, [gate]); wall_face(fe, 0, W, 10.0, ZN - 0.6, -1.8, 0, ops)
        lpoly(fe, [(0, ZN - 0.6), (W, ZN - 0.6), (W / 2, ZN + 10.5)], -1.8, 0, 'stone')
        window(fe, gate, glass=False, mullions=0, tracery=False, sill_ledge=False, hood=True)
        lbox(fe, 6.7, 8.6, 0, 4.6, -1.3, -1.1, 'wood'); lbox(fe, 8.6, 10.5, 0, 4.6, -1.3, -1.1, 'wood'); lpoly(fe, arch_pts(8.6, 3.8, 4.6, 5.4, 3.5, 8)[1:-1], -1.3, -1.1, 'dstone')
        for o in ops: window(fe, o, depth=0.9)
        rose(fe, 8.6, ZN + 4.0, 2.7); string_course(fe, 0, W, 10.3, 0.4, 0.4); string_course(fe, 0, W, ZN - 0.6, 0.45, 0.6)
        lpoly(fe, [(-0.4, ZN - 0.6), (W + 0.4, ZN - 0.6), (W / 2, ZN + 10.9)], 0, 0.0001, 'stone') if False else None
        for i in range(10):
            t = (i + 0.5) / 10
            for sg in (-1, 1):
                c = Vector(fe.p(W / 2 + sg * (W / 2) * (1 - t), ZN - 0.6 + 11.1 * t, 0.1)); cone_between('stone', c, c + Vector((0, 0, 0.6)) + (Vector(fe.p(0, 0, 1)) - Vector(fe.p(0, 0, 0))) * 0.25, 0.17, 0.03, 4)
        x, y, z = fe.p(W / 2, ZN + 10.5, 0.0); pinnacle(x, y, z, 1.2, 0.4, 3.0); lstatue(fe, W / 2, ZN + 4.0 + 3.1, 0.4, 0.001, 'saint', plinth=False) if False else None
        for uu in (0.0, W):
            lbox(fe, uu - 0.9, uu + 0.9, 0, ZN + 1.5, 0, 1.8, 'stone'); x, y, z = fe.p(uu, ZN + 1.5, 0.9); pinnacle(x, y, z, 2.0, 0.5, 3.6)
    # transept roof (ridge along x)
    prism3d('slate', [(-XT + 0.8, 1.4 - 0.9, ZN - 0.7), (-XT + 0.8, 18.6 + 0.9, ZN - 0.7), (-XT + 0.8, 10.4, ZN + 10.7), (-XT + 0.8, 9.6, ZN + 10.7)], (2 * XT - 1.6, 0, 0))
    box('copper', (0, 10.0, ZN + 10.6), 2 * XT - 1.6, 0.6, 0.5)

def crossing_tower():
    cx, cy0, cy1 = 0.0, 1.4, 18.6; Hs = 52.0
    for (f, u0, u1, wo) in ((F((0, cy0, 0), 0), -NX, NX, 0.0), (F((0, cy1, 0), PI), -NX, NX, 0.0), (F((NX, cy0, 0), PI / 2), 0.02, cy1 - cy0 - 0.02, 0.02), (F((-NX, cy1, 0), -PI / 2), 0.02, cy1 - cy0 - 0.02, 0.02)):
        W = u1 - u0; mid = (u0 + u1) / 2; ww = 2.3
        ops = [op(mid - 3.4, ww, 36.0, 44.0, 2.6, 8), op(mid + 3.4, ww, 36.0, 44.0, 2.6, 8)]
        wall_face(f, u0, u1, 27.0, Hs, -1.8, wo, ops)
        for o in ops: window(f, o, depth=1.0)
        for v in (31.5, 34.0, 50.2): string_course(f, u0, u1, v, 0.4, 0.4)
        corbels(f, u0, u1, Hs, proj=1.0, sp=1.0, rows=3); lbox(f, u0, u1, Hs - 0.02, Hs + 0.4, -1.8, 1.1, 'stone')
        crenel(f, u0, u1, Hs + 0.4, 1.8, 1.4, 1.3, 1.0, 1.1)
        for k in range(4): uu = u0 + (k + 0.5) * (u1 - u0) / 4; lancet_slit(f, uu, 38.0 if False else 33.0, 35.5) if False else None
    for sx in (-1, 1):
        for yy in (cy0 + 0.8, cy1 - 0.8): pinnacle(sx * (NX - 0.8), yy, Hs + 0.5, 4.5, 0.85, 7.0)
    cyl('stone', (0, 10.0, Hs + 0.4), 7.4, 7.2, 8.4, 8, PI / 8)
    for k in range(8):
        a = PI / 8 + 2 * PI * k / 8; fl = F((0 + 7.25 * math.cos(a), 10.0 + 7.25 * math.sin(a), Hs + 2.0), a + PI / 2)
        lpoly(fl, arch_pts(0, 1.4, 0.4, 5.0, 1.4, 6), -0.1, 0.12, 'glass'); arch_band(fl, op(0, 1.4, 0.4, 5.0, 1.4, 6), 0.3, 0.0, 0.25)
        pinnacle(0 + 7.5 * math.cos(a - PI / 8), 10.0 + 7.5 * math.sin(a - PI / 8), Hs + 8.7, 1.2, 0.35, 2.4, cro=False)
    cyl('stone', (0, 10.0, Hs + 8.8), 7.8, 7.5, 0.5, 8, PI / 8)
    spire(0, 10.0, Hs + 9.3, 7.4, 44.0, 8, 'copper', True, (66.0, 76.0, 86.0), cap=False)
    zt = Hs + 9.3 + 44.0
    sph('gold', (0, 10.0, zt + 0.4), 0.9, seg=10); cone_between('gold', (0, 10.0, zt), (0, 10.0, zt + 3.4), 0.2, 0.05, 6)
    statue(0, 10.0, zt + 1.2, 5.0, 0.0, 'angel', 'gold', plinth=False)

def choir_and_apse():
    cx, cy = 0.0, 50.0; Rn, Ra = NX, AX
    for k in range(5):
        a0 = math.radians(36 * k); a1 = math.radians(36 * (k + 1)); al = (a0 + a1) / 2; yaw = al + PI / 2
        for R, hh, wsill, wspr, wrise, wl in ((Rn, ZN - 0.6, 20.5, 25.5, 2.6, 2.2), (Ra, 14.5, 3.8, 9.5, 2.9, 3.2)):
            p0 = (cx + R * math.cos(a0), cy + R * math.sin(a0)); p1 = (cx + R * math.cos(a1), cy + R * math.sin(a1)); Lk = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
            f = F((p0[0], p0[1], 0), yaw); t_ = 1.6 if R == Rn else 1.4
            o = op(Lk / 2, wl, wsill, wspr, wrise, 8)
            wall_face(f, 0, Lk, 0, hh, -t_, 0, [o]); window(f, o, depth=0.8)
            string_course(f, 0, Lk, 19.8 if R == Rn else 13.0, 0.35, 0.3); corbels(f, 0, Lk, hh, proj=0.8, sp=0.95, rows=3)
            crenel(f, 0, Lk, hh + 0.2, t_, 1.4, 1.2, 0.9, 0.0)
    for k in range(6):  # pilasters, piers, flyers on the radial lines
        a = math.radians(36 * k)
        fn = F((cx + Rn * math.cos(a), cy + Rn * math.sin(a), 0), a + PI / 2)
        lbox(fn, -0.8, 0.8, 0, ZN + 1.2, -0.3, 0.7, 'stone'); x, y, z = fn.p(0, ZN + 1.2, 0.2); pinnacle(x, y, z, 1.6, 0.45, 2.8, cro=False)
        fa_ = F((cx + Ra * math.cos(a), cy + Ra * math.sin(a), 0), a + PI / 2)
        pier(fa_, 0, 2.5)
        flyer(fa_, 0, -(Ra - Rn) + 0.7, 1.7)
    for k in range(5):  # radiating chapels (the axial one is the lady chapel)
        if k in (0, 4): continue
        al = math.radians(36 * k + 18); Rc = Ra + 2.4 if k == 2 else Ra + 1.6; rc = 4.6 if k == 2 else 4.0
        ccx, ccy = cx + Rc * math.cos(al), cy + Rc * math.sin(al); hch = 13.0 if k == 2 else 11.0
        cyl('stone', (ccx, ccy, 0), rc * 1.04, rc, hch, 6, al)
        cyl('stone', (ccx, ccy, hch - 0.1), rc * 1.2, rc * 1.2, 0.5, 6, al)
        for j in range(6):
            b = al + PI / 6 + j * PI / 3; mid = (ccx + rc * math.cos(PI / 6) * math.cos(b - PI / 6 * 0), ccy + rc * math.cos(PI / 6) * math.sin(b - PI / 6 * 0))
        for j in range(6):
            b = al + j * PI / 3; mx = ccx + rc * math.cos(PI / 6) * math.cos(b + PI / 6); my = ccy + rc * math.cos(PI / 6) * math.sin(b + PI / 6)
            if math.hypot(mx - cx, my - cy) < Ra + 0.8: continue
            fw = F((mx, my, 0), b + PI / 6 + PI / 2)
            o = op(0, 1.8, 4.0, 7.2, 2.4, 6); window(fw, o, depth=-0.03)
        cyl('slate', (ccx, ccy, hch + 0.4), rc * 1.25, 0.1, 8.5, 6, al)
        sph('gold', (ccx, ccy, hch + 9.1), 0.35, seg=6); cone_between('gold', (ccx, ccy, hch + 8.9), (ccx, ccy, hch + 11.0), 0.1, 0.02, 4)
        if k == 2: pinnacle(ccx + 0.0, ccy + 0.0, hch + 0.5, 0.01, 0.01, 0.01) if False else None
    # apse roof (half cone) and ambulatory roof (half frustum)
    cyl('slate', (cx, cy, ZN - 0.7), 9.4 / math.cos(PI / 10), 0.5, 11.2, 10, 0.0)
    frustum('slate', Matrix.Translation((cx, cy, 14.0 + 2.9)), Ra + 0.9, Rn - 0.2, 5.8, 10, False)
    for k in range(10):
        a = 2 * PI * k / 10
        cone_between('copper', (cx + 9.2 * math.cos(a), cy + 9.2 * math.sin(a), ZN - 0.4), (cx + 0.5 * math.cos(a), cy + 0.5 * math.sin(a), ZN + 10.7), 0.1, 0.06, 5)
    sph('gold', (cx, cy, ZN + 11.4), 0.6, seg=8); cone_between('gold', (cx, cy, ZN + 11.0), (cx, cy, ZN + 15.0), 0.14, 0.03, 5)

def castle_extras():
    for k in range(10):  # houses and workshops along the inner wall
        a = 2 * PI * (k + 0.3) / 10; seg = WALL[k % len(WALL)]
    spots = [(-62, -30, 0.2), (-60, -8, 0.0), (-60, 14, 0.1), (-56, 36, 0.3), (60, -30, PI), (60, -6, PI + 0.1), (58, 20, PI), (50, 46, PI - 0.4), (-40, 62, -0.5), (40, 64, 0.5), (-30, -80, 0.0), (32, -80, 0.0), (-62, -80, 0.4), (62, -78, -0.4)]
    for (x, y, rz) in spots:
        w, d, h = RNG.uniform(8, 12), RNG.uniform(6, 8), RNG.uniform(5, 7.5)
        box('plaster', (x, y, 0), w, d, h, rz)
        c, s = math.cos(rz), math.sin(rz)
        prism3d('tile', [(x - (w / 2 + 0.7) * c, y - (w / 2 + 0.7) * s, h), (x + (w / 2 + 0.7) * c, y + (w / 2 + 0.7) * s, h), (x, y, h + w * 0.28)], (-s * (d + 1.0) / 1.0 * 0 - (-s) * 0, 0, 0)) if False else None
        fl = F((x, y, 0), rz);
        lpoly(fl, [(-w / 2 - 0.7, h), (w / 2 + 0.7, h), (0, h + w * 0.3)], -d / 2 - 0.7, d / 2 + 0.7, 'tile') if False else None
        ff = F((x - s * 0 * 0, y, 0), rz)
        pts = [(-w / 2 - 0.7, h - 0.1), (w / 2 + 0.7, h - 0.1), (0, h + w * 0.28)]
        P3 = [ff.p(u, v, -d / 2 - 0.8) for u, v in pts]; prism3d('tile', P3, tuple(Vector(ff.p(0, 0, d / 2 + 0.8)) - Vector(ff.p(0, 0, -d / 2 - 0.8))))
        for k in range(5): lbox(ff, -w / 2 + k * w / 4 - 0.12, -w / 2 + k * w / 4 + 0.12, 0, h, d / 2, d / 2 + 0.1, 'wood')
        lbox(ff, -w / 2, w / 2, h * 0.5, h * 0.5 + 0.25, d / 2, d / 2 + 0.12, 'wood'); lbox(ff, -w / 2, w / 2, h - 0.25, h, d / 2, d / 2 + 0.12, 'wood')
        for k in range(2): lbox(ff, -w / 4 + k * w / 2 - 0.5, -w / 4 + k * w / 2 + 0.5, h * 0.55, h * 0.8, d / 2 + 0.1, d / 2 + 0.16, 'dstone')
        lbox(ff, w / 4, w / 4 + 0.9, h, h + 2.2, -0.45, 0.45, 'stone')
    for sx in (-1, 1):  # knights standing guard on the processional way
        for yy in (-90, -72, -60):
            statue(sx * 7.5, yy, 0, 5.5 if yy == -90 else 3.6, PI * 0.0, 'knight', 'stone')
            box('stone', (sx * 7.5, yy, 0), 2.6, 2.6, 0.9) if False else None
    for yy in range(-92, -55, 6):
        for sx in (-1, 1): cone_between('iron', (sx * 5.5, yy, 0), (sx * 5.5, yy, 4.4), 0.07, 0.05, 5); lamp(sx * 5.5, yy, 4.6, 0.26)

def trees():
    rng = np.random.default_rng(5); n = 6000
    ang = rng.uniform(0, 2 * PI, n); rad = np.sqrt(rng.uniform(260 ** 2, 1500 ** 2, n)); X = rad * np.cos(ang); Y = rad * np.sin(ang)
    Z = terrain_h(X, Y); Z2 = terrain_h(X + 3, Y); Z3 = terrain_h(X, Y + 3); sl = np.hypot(Z2 - Z, Z3 - Z) / 3.0
    keep = (Z > WATER_Z + 1.5) & (sl < 0.55) & (Z < 190) & (fbm(X * 0.006, Y * 0.006, 77) > 0.42)
    for x, y, z in zip(X[keep][:4200], Y[keep][:4200], Z[keep][:4200]):
        s = RNG.uniform(0.8, 1.5) * (1.6 if RNG.random() < 0.3 else 1.0); h = 12 * s
        if RNG.random() < 0.7:
            cone_between('bark', (x, y, z - 0.5), (x, y, z + 3 * s), 0.35 * s, 0.25 * s, 4, caps=False)
            cone_between('conifer', (x, y, z + 2.5 * s), (x, y, z + h), 3.0 * s, 0.1, 7, caps=False); cone_between('conifer', (x, y, z + 5.5 * s), (x, y, z + h + 3 * s), 2.0 * s, 0.1, 7, caps=False)
        else:
            cone_between('bark', (x, y, z - 0.5), (x, y, z + 5 * s), 0.4 * s, 0.3 * s, 5, caps=False); sph('leaf', (x, y, z + 7.5 * s), 4.2 * s, (1, 1, 0.85), seg=7)

# ============================================================ materials
def NN(nt, t, **kw):
    n = nt.nodes.new(t)
    for k, v in kw.items(): setattr(n, k, v)
    return n
def setin(nt, sock, v):
    if isinstance(v, bpy.types.NodeSocket): nt.links.new(v, sock)
    elif v is not None: sock.default_value = v
def MATH(nt, op, a=None, b=None, clamp=False):
    n = NN(nt, 'ShaderNodeMath', operation=op, use_clamp=clamp); setin(nt, n.inputs[0], a); setin(nt, n.inputs[1], b); return n.outputs[0]
def MIX(nt, a, b, fac=0.5, bt='MIX'):
    n = NN(nt, 'ShaderNodeMix', data_type='RGBA', blend_type=bt); setin(nt, n.inputs[0], fac); setin(nt, n.inputs[6], a); setin(nt, n.inputs[7], b); return n.outputs[2]
def SEP(nt, v): s = NN(nt, 'ShaderNodeSeparateXYZ'); nt.links.new(v, s.inputs[0]); return s.outputs
def RAMP(nt, fac, stops):
    r = NN(nt, 'ShaderNodeValToRGB'); setin(nt, r.inputs[0], fac)
    cr = r.color_ramp; cr.elements[0].position = stops[0][0]; cr.elements[0].color = stops[0][1]; cr.elements[1].position = stops[-1][0]; cr.elements[1].color = stops[-1][1]
    for p, c in stops[1:-1]: e = cr.elements.new(p); e.color = c
    return r.outputs[0]
def base_mat(name):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    out = NN(nt, 'ShaderNodeOutputMaterial'); bs = NN(nt, 'ShaderNodeBsdfPrincipled'); nt.links.new(bs.outputs[0], out.inputs['Surface']); return m, nt, bs
def rgb(h): return (h[0], h[1], h[2], 1.0)

def stone_mat(name, c1, c2, mortar, bw=1.25, row=0.52, bump=0.7, rough=0.88, dirt=0.5, bevel=0.05):
    m, nt, bs = base_mat(name); g = NN(nt, 'ShaderNodeNewGeometry'); n = SEP(nt, g.outputs['Normal']); p = SEP(nt, g.outputs['Position'])
    ln = MATH(nt, 'ADD', MATH(nt, 'SQRT', MATH(nt, 'ADD', MATH(nt, 'MULTIPLY', n['X'], n['X']), MATH(nt, 'MULTIPLY', n['Y'], n['Y']))), 1e-4)  # along the wall for ANY yaw (the old |nx|py+|ny|px was constant on 45 degree walls)
    along = MATH(nt, 'DIVIDE', MATH(nt, 'ADD', MATH(nt, 'MULTIPLY', p['X'], n['Y']), MATH(nt, 'MULTIPLY', p['Y'], MATH(nt, 'MULTIPLY', n['X'], -1.0))), ln)
    vec = NN(nt, 'ShaderNodeCombineXYZ'); nt.links.new(along, vec.inputs[0]); nt.links.new(p['Z'], vec.inputs[1])
    br = NN(nt, 'ShaderNodeTexBrick', offset=0.5, offset_frequency=2, squash=1.0, squash_frequency=2)
    nt.links.new(vec.outputs[0], br.inputs['Vector']); br.inputs['Color1'].default_value = rgb(c1); br.inputs['Color2'].default_value = rgb(c2); br.inputs['Mortar'].default_value = rgb(mortar)
    br.inputs['Scale'].default_value = 1.0; br.inputs['Mortar Size'].default_value = 0.03; br.inputs['Mortar Smooth'].default_value = 0.25; br.inputs['Brick Width'].default_value = bw; br.inputs['Row Height'].default_value = row
    nz = NN(nt, 'ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 0.45; nz.inputs['Detail'].default_value = 5; nt.links.new(g.outputs['Position'], nz.inputs['Vector'])
    var = RAMP(nt, nz.outputs['Fac'], [(0.3, (0.72, 0.72, 0.72, 1)), (0.7, (1.12, 1.12, 1.12, 1))])
    col = MIX(nt, br.outputs['Color'], var, 1.0, 'MULTIPLY')
    sv = NN(nt, 'ShaderNodeCombineXYZ'); nt.links.new(MATH(nt, 'MULTIPLY', p['X'], 2.3), sv.inputs[0]); nt.links.new(MATH(nt, 'MULTIPLY', p['Y'], 2.3), sv.inputs[1]); nt.links.new(MATH(nt, 'MULTIPLY', p['Z'], 0.16), sv.inputs[2])
    sz = NN(nt, 'ShaderNodeTexNoise'); sz.inputs['Scale'].default_value = 1.0; sz.inputs['Detail'].default_value = 6; nt.links.new(sv.outputs[0], sz.inputs['Vector'])
    streak = RAMP(nt, sz.outputs['Fac'], [(0.45, (1, 1, 1, 1)), (0.75, (1 - dirt * 0.55, 1 - dirt * 0.55, 1 - dirt * 0.5, 1))])
    col = MIX(nt, col, streak, 1.0, 'MULTIPLY')
    moss = RAMP(nt, MATH(nt, 'MULTIPLY', MATH(nt, 'SUBTRACT', 1.0, MATH(nt, 'MULTIPLY', p['Z'], 0.06, True)), sz.outputs['Fac']), [(0.35, (0, 0, 0, 1)), (0.6, (1, 1, 1, 1))])
    col = MIX(nt, col, (0.12, 0.2, 0.06, 1), MATH(nt, 'MULTIPLY', moss, 0.55), 'MIX')
    ao = NN(nt, 'ShaderNodeAmbientOcclusion'); ao.inputs['Distance'].default_value = 1.4; nt.links.new(col, ao.inputs['Color'])
    nt.links.new(ao.outputs['Color'] if '--noao' not in A else col, bs.inputs['Base Color'])
    bv = NN(nt, 'ShaderNodeBevel'); bv.inputs['Radius'].default_value = bevel
    bm_ = NN(nt, 'ShaderNodeBump'); bm_.inputs['Strength'].default_value = bump; bm_.inputs['Distance'].default_value = 0.08
    nt.links.new(MATH(nt, 'SUBTRACT', 1.0, br.outputs['Factor']), bm_.inputs['Height']); nt.links.new(bv.outputs['Normal'], bm_.inputs['Normal']); nt.links.new(bm_.outputs['Normal'], bs.inputs['Normal'])
    bs.inputs['Roughness'].default_value = rough; return m

def tile_mat(name, c1, c2, scale, rough=0.7, metal=0.0, gap=0.5, bump=0.8, tint=None):
    m, nt, bs = base_mat(name); g = NN(nt, 'ShaderNodeNewGeometry'); sv = NN(nt, 'ShaderNodeVectorMath', operation='MULTIPLY'); nt.links.new(g.outputs['Position'], sv.inputs[0]); sv.inputs[1].default_value = (scale, scale, scale * 0.8)
    v1 = NN(nt, 'ShaderNodeTexVoronoi', feature='F1'); nt.links.new(sv.outputs[0], v1.inputs['Vector']); v2 = NN(nt, 'ShaderNodeTexVoronoi', feature='DISTANCE_TO_EDGE'); nt.links.new(sv.outputs[0], v2.inputs['Vector'])
    rr = SEP(nt, v1.outputs['Color'])
    col = MIX(nt, rgb(c1), rgb(c2), rr['X'])
    nz = NN(nt, 'ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 0.6; nt.links.new(g.outputs['Position'], nz.inputs['Vector'])
    if tint: col = MIX(nt, col, rgb(tint), RAMP(nt, nz.outputs['Fac'], [(0.4, (0, 0, 0, 1)), (0.7, (0.9, 0.9, 0.9, 1))]))
    edge = RAMP(nt, v2.outputs['Distance'], [(0.0, (0.15, 0.15, 0.15, 1)), (0.12, (1, 1, 1, 1))])
    col = MIX(nt, col, edge, 1.0, 'MULTIPLY'); nt.links.new(col, bs.inputs['Base Color'])
    bm_ = NN(nt, 'ShaderNodeBump'); bm_.inputs['Strength'].default_value = bump; bm_.inputs['Distance'].default_value = 0.1; nt.links.new(v2.outputs['Distance'], bm_.inputs['Height']); nt.links.new(bm_.outputs['Normal'], bs.inputs['Normal'])
    bs.inputs['Roughness'].default_value = rough; bs.inputs['Metallic'].default_value = metal; return m

def simple(name, col, rough=0.8, metal=0.0, emit=None, noise_bump=0.0, scale=6.0):
    m, nt, bs = base_mat(name); bs.inputs['Base Color'].default_value = rgb(col); bs.inputs['Roughness'].default_value = rough; bs.inputs['Metallic'].default_value = metal
    if emit: bs.inputs['Emission Color'].default_value = rgb(emit[0]); bs.inputs['Emission Strength'].default_value = emit[1]
    if noise_bump:
        g = NN(nt, 'ShaderNodeNewGeometry'); nz = NN(nt, 'ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = scale; nz.inputs['Detail'].default_value = 8; nt.links.new(g.outputs['Position'], nz.inputs['Vector'])
        bm_ = NN(nt, 'ShaderNodeBump'); bm_.inputs['Strength'].default_value = noise_bump; bm_.inputs['Distance'].default_value = 0.05; nt.links.new(nz.outputs['Fac'], bm_.inputs['Height']); nt.links.new(bm_.outputs['Normal'], bs.inputs['Normal'])
    return m

def glass_mat():
    m, nt, bs = base_mat('glass'); g = NN(nt, 'ShaderNodeNewGeometry'); sv = NN(nt, 'ShaderNodeVectorMath', operation='MULTIPLY'); nt.links.new(g.outputs['Position'], sv.inputs[0]); sv.inputs[1].default_value = (0.6, 0.6, 0.6)
    v1 = NN(nt, 'ShaderNodeTexVoronoi', feature='F1'); nt.links.new(sv.outputs[0], v1.inputs['Vector']); v2 = NN(nt, 'ShaderNodeTexVoronoi', feature='DISTANCE_TO_EDGE'); nt.links.new(sv.outputs[0], v2.inputs['Vector'])
    rr = SEP(nt, v1.outputs['Color'])
    pal = RAMP(nt, rr['X'], [(0.0, (0.05, 0.12, 0.7, 1)), (0.2, (0.7, 0.05, 0.05, 1)), (0.4, (0.95, 0.6, 0.08, 1)), (0.6, (0.05, 0.5, 0.2, 1)), (0.8, (0.4, 0.08, 0.6, 1)), (1.0, (0.1, 0.35, 0.8, 1))])
    for e in nt.nodes:
        if e.bl_idname == 'ShaderNodeValToRGB': e.color_ramp.interpolation = 'CONSTANT'
    lead = RAMP(nt, v2.outputs['Distance'], [(0.025, (0, 0, 0, 1)), (0.06, (1, 1, 1, 1))])
    col = MIX(nt, pal, lead, 1.0, 'MULTIPLY'); nt.links.new(col, bs.inputs['Base Color']); nt.links.new(col, bs.inputs['Emission Color']); bs.inputs['Emission Strength'].default_value = 2.4 if '--night' not in A else 9.0
    bs.inputs['Roughness'].default_value = 0.15; return m

def terrain_mat():
    m, nt, bs = base_mat('terrain'); g = NN(nt, 'ShaderNodeNewGeometry'); n = SEP(nt, g.outputs['Normal']); p = SEP(nt, g.outputs['Position'])
    nz = NN(nt, 'ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 0.09; nz.inputs['Detail'].default_value = 8; nt.links.new(g.outputs['Position'], nz.inputs['Vector'])
    n2 = NN(nt, 'ShaderNodeTexNoise'); n2.inputs['Scale'].default_value = 1.4; n2.inputs['Detail'].default_value = 8; nt.links.new(g.outputs['Position'], n2.inputs['Vector'])
    vor = NN(nt, 'ShaderNodeTexVoronoi', feature='DISTANCE_TO_EDGE'); vor.inputs['Scale'].default_value = 0.35; nt.links.new(g.outputs['Position'], vor.inputs['Vector'])
    st = NN(nt, 'ShaderNodeTexNoise'); st.inputs['Scale'].default_value = 0.8; st.inputs['Detail'].default_value = 4; sv_ = NN(nt, 'ShaderNodeCombineXYZ'); nt.links.new(MATH(nt, 'MULTIPLY', p['X'], 0.08), sv_.inputs[0]); nt.links.new(MATH(nt, 'MULTIPLY', p['Y'], 0.08), sv_.inputs[1]); nt.links.new(MATH(nt, 'MULTIPLY', p['Z'], 1.4), sv_.inputs[2]); nt.links.new(sv_.outputs[0], st.inputs['Vector'])
    crack = RAMP(nt, vor.outputs['Distance'], [(0.0, (0.0, 0.0, 0.0, 1)), (0.08, (1, 1, 1, 1))])
    rock = MIX(nt, (0.36, 0.32, 0.27, 1), (0.6, 0.53, 0.43, 1), st.outputs['Fac']); rock = MIX(nt, rock, crack, 1.0, 'MULTIPLY'); rock = MIX(nt, rock, (0.17, 0.15, 0.13, 1), RAMP(nt, nz.outputs['Fac'], [(0.4, (0, 0, 0, 1)), (0.65, (1, 1, 1, 1))]))
    grass = MIX(nt, (0.13, 0.2, 0.06, 1), (0.28, 0.3, 0.1, 1), n2.outputs['Fac']); grass = MIX(nt, grass, (0.33, 0.3, 0.12, 1), RAMP(nt, nz.outputs['Fac'], [(0.5, (0, 0, 0, 1)), (0.8, (1, 1, 1, 1))]))
    slope = RAMP(nt, MATH(nt, 'ADD', n['Z'], MATH(nt, 'MULTIPLY', n2.outputs['Fac'], 0.12)), [(0.68, (0, 0, 0, 1)), (0.86, (1, 1, 1, 1))])
    col = MIX(nt, rock, grass, slope)
    snow = RAMP(nt, MATH(nt, 'ADD', MATH(nt, 'MULTIPLY', MATH(nt, 'SUBTRACT', p['Z'], 250), 0.02), MATH(nt, 'MULTIPLY', n['Z'], 0.6)), [(0.55, (0, 0, 0, 1)), (0.8, (1, 1, 1, 1))])
    col = MIX(nt, col, (0.92, 0.94, 0.98, 1), snow)
    wet = RAMP(nt, MATH(nt, 'SUBTRACT', -36.0, p['Z']), [(-1.0, (0, 0, 0, 1)), (1.0, (0.9, 0.9, 0.9, 1))])
    col = MIX(nt, col, (0.05, 0.06, 0.05, 1), wet)
    nt.links.new(col, bs.inputs['Base Color']); bs.inputs['Roughness'].default_value = 0.92
    bm_ = NN(nt, 'ShaderNodeBump'); bm_.inputs['Strength'].default_value = 1.0; bm_.inputs['Distance'].default_value = 1.2; nt.links.new(MATH(nt, 'ADD', MATH(nt, 'MULTIPLY', vor.outputs['Distance'], 2.5, True), MATH(nt, 'MULTIPLY', st.outputs['Fac'], 0.8)), bm_.inputs['Height']); nt.links.new(bm_.outputs['Normal'], bs.inputs['Normal']); return m

def water_mat():
    m, nt, bs = base_mat('water'); g = NN(nt, 'ShaderNodeNewGeometry'); nz = NN(nt, 'ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 0.5; nz.inputs['Detail'].default_value = 6; nt.links.new(g.outputs['Position'], nz.inputs['Vector'])
    bm_ = NN(nt, 'ShaderNodeBump'); bm_.inputs['Strength'].default_value = 0.08; bm_.inputs['Distance'].default_value = 0.3; nt.links.new(nz.outputs['Fac'], bm_.inputs['Height']); nt.links.new(bm_.outputs['Normal'], bs.inputs['Normal'])
    bs.inputs['Base Color'].default_value = (0.02, 0.05, 0.06, 1); bs.inputs['Roughness'].default_value = 0.05; bs.inputs['IOR'].default_value = 1.33; return m

def cobble_mat():
    m, nt, bs = base_mat('cobble'); g = NN(nt, 'ShaderNodeNewGeometry'); sv = NN(nt, 'ShaderNodeVectorMath', operation='MULTIPLY'); nt.links.new(g.outputs['Position'], sv.inputs[0]); sv.inputs[1].default_value = (2.2, 2.2, 2.2)
    v1 = NN(nt, 'ShaderNodeTexVoronoi', feature='F1'); nt.links.new(sv.outputs[0], v1.inputs['Vector']); v2 = NN(nt, 'ShaderNodeTexVoronoi', feature='DISTANCE_TO_EDGE'); nt.links.new(sv.outputs[0], v2.inputs['Vector'])
    rr = SEP(nt, v1.outputs['Color']); col = MIX(nt, (0.42, 0.36, 0.28, 1), (0.62, 0.54, 0.42, 1), rr['X'])
    col = MIX(nt, col, RAMP(nt, v2.outputs['Distance'], [(0.0, (0.1, 0.09, 0.07, 1)), (0.1, (1, 1, 1, 1))]), 1.0, 'MULTIPLY'); nt.links.new(col, bs.inputs['Base Color'])
    bm_ = NN(nt, 'ShaderNodeBump'); bm_.inputs['Strength'].default_value = 0.9; bm_.inputs['Distance'].default_value = 0.06; nt.links.new(v2.outputs['Distance'], bm_.inputs['Height']); nt.links.new(bm_.outputs['Normal'], bs.inputs['Normal']); bs.inputs['Roughness'].default_value = 0.8; return m

MATS = {}
def make_materials():
    MATS['stone'] = stone_mat('stone', (0.66, 0.57, 0.43), (0.76, 0.66, 0.5), (0.4, 0.35, 0.28), dirt=0.42)
    MATS['dstone'] = stone_mat('dstone', (0.2, 0.18, 0.16), (0.26, 0.23, 0.2), (0.1, 0.09, 0.08), dirt=0.3)
    MATS['slate'] = tile_mat('slate', (0.1, 0.12, 0.16), (0.2, 0.23, 0.28), 1.3, 0.55)
    MATS['tile'] = tile_mat('tile', (0.42, 0.14, 0.08), (0.58, 0.24, 0.12), 1.4, 0.75)
    MATS['copper'] = tile_mat('copper', (0.1, 0.4, 0.32), (0.2, 0.55, 0.45), 0.9, 0.5, 0.25, tint=(0.5, 0.26, 0.13))
    MATS['gold'] = simple('gold', (1.0, 0.68, 0.2), 0.22, 1.0); MATS['iron'] = simple('iron', (0.06, 0.06, 0.065), 0.45, 0.9, noise_bump=0.2)
    MATS['wood'] = simple('wood', (0.3, 0.16, 0.07), 0.6, noise_bump=0.4, scale=14.0); MATS['cloth'] = simple('cloth', (0.45, 0.03, 0.04), 0.75)
    MATS['lamp'] = simple('lamp', (1, 0.6, 0.25), 0.5, emit=((1.0, 0.55, 0.2), 25.0 if '--night' not in A else 90.0)); MATS['glass'] = glass_mat()
    MATS['plaster'] = simple('plaster', (0.7, 0.63, 0.5), 0.9, noise_bump=0.3, scale=12.0); MATS['road'] = cobble_mat(); MATS['cobble'] = MATS['road']
    MATS['bark'] = simple('bark', (0.13, 0.08, 0.05), 0.9); MATS['conifer'] = simple('conifer', (0.04, 0.1, 0.05), 0.8, noise_bump=0.3, scale=3.0); MATS['leaf'] = simple('leaf', (0.12, 0.22, 0.05), 0.8, noise_bump=0.3, scale=3.0)

def finalize():
    for name, acc in BMS.items():
        if not acc.f: continue
        me = bpy.data.meshes.new(name); me.from_pydata(acc.v, [], acc.f); me.polygons.foreach_set('use_smooth', acc.s)
        me.materials.append(MATS[name]); me.update(); scn.collection.objects.link(bpy.data.objects.new(name, me))
    log('meshes: ' + ', '.join(f'{o.name}:{len(o.data.polygons)}' for o in bpy.data.objects if o.type == 'MESH'))

# ============================================================ scene, light, render
SHOTS = {
    'hero': ((-135, -235, 62), (0, -5, 42), 34),
    'front': ((16, -84, 3.5), (0, -52, 26), 22),
    'statues': ((9, -64, 11), (-3, -52, 22.5), 42),
    'dbg1': ((30, 34, 46), (8.6, 18.6, 42), 30),
    'dbg2': ((52, 10, 14), (30, 10, 6), 30),
    'portal': ((3.0, -69, 1.9), (0, -52, 6.2), 27),
    'gate': ((-46, -222, 16), (0, -100, 14), 30),
    'aerial_apse': ((140, 175, 95), (0, 25, 30), 30),
    'towers': ((-78, -118, 52), (-6, -52, 52), 35),
    'crossing': ((66, 52, 26), (-2, 10, 58), 27),
}
def setup_scene():
    tm = terrain_mat(); me = build_terrain(); me.materials.append(tm); scn.collection.objects.link(bpy.data.objects.new('terrain', me))
    bm = bmesh.new(); S = 6000
    for q in ((-S, -S), (S, -S), (S, S), (-S, S)): bm.verts.new((q[0], q[1], WATER_Z))
    bm.faces.new(list(bm.verts)); wm = bpy.data.meshes.new('water'); bm.to_mesh(wm); wm.materials.append(water_mat()); scn.collection.objects.link(bpy.data.objects.new('water', wm))
    # cobbled courtyard
    ppoly('road', [(x, y, 0.06) for x, y in offset_poly(WALL, -4.0)])
    # sky and haze
    world = bpy.data.worlds.new('w'); scn.world = world; world.use_nodes = True; nt = world.node_tree; nt.nodes.clear()
    NIGHT = '--night' in A
    elev = float(opt('--elev', 4.0 if not NIGHT else -3.0)); az = float(opt('--az', 250.0))
    sky = nt.nodes.new('ShaderNodeTexSky'); sky.sky_type = 'MULTIPLE_SCATTERING'; ea, aa = math.radians(elev), math.radians(az)
    sky.sun_elevation = ea if not NIGHT else math.radians(-4); sky.sun_rotation = math.radians(float(opt('--skyrot', 60))); sky.altitude = 200; sky.air_density = 1.2; sky.aerosol_density = 1.3
    sky.sun_disc = False; sky.sun_intensity = 0.0
    if NIGHT: ea, aa = math.radians(38), math.radians(130)
    sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = float(opt('--sun', 16.0 if not NIGHT else 0.7)); sun.angle = math.radians(0.8 if not NIGHT else 2.0)
    sun.color = (1.0, 0.56, 0.3) if not NIGHT else (0.62, 0.72, 1.0); so = bpy.data.objects.new('sun', sun); scn.collection.objects.link(so)
    so.rotation_euler = (-Vector((math.sin(aa) * math.cos(ea), math.cos(aa) * math.cos(ea), math.sin(ea)))).to_track_quat('-Z', 'Y').to_euler()
    bg = nt.nodes.new('ShaderNodeBackground'); wo = nt.nodes.new('ShaderNodeOutputWorld'); nt.links.new(sky.outputs[0], bg.inputs[0]); nt.links.new(bg.outputs[0], wo.inputs['Surface']); bg.inputs['Strength'].default_value = float(opt('--sky', 0.5 if not NIGHT else 0.9))
    for nm, rad, dens, z in (('haze', 4200, float(opt('--haze', 2.2e-5)), 0), ('mist', 0, 0, 0)):
        if not dens: continue
        hm = bpy.data.materials.new(nm); hm.use_nodes = True; hn = hm.node_tree; hn.nodes.clear(); vs = hn.nodes.new('ShaderNodeVolumeScatter'); ho = hn.nodes.new('ShaderNodeOutputMaterial')
        vs.inputs['Density'].default_value = dens; vs.inputs['Color'].default_value = (1.0, 0.86, 0.72, 1) if not NIGHT else (0.5, 0.6, 0.8, 1); vs.inputs['Anisotropy'].default_value = 0.55; hn.links.new(vs.outputs[0], ho.inputs['Volume'])
        bpy.ops.mesh.primitive_uv_sphere_add(radius=rad, segments=32, ring_count=16, location=(0, 0, z)); o = bpy.context.active_object; o.name = nm; o.data.materials.append(hm); o.visible_shadow = False
    if float(opt('--mist', 0.0015)) > 0:
      mm = bpy.data.materials.new('mist'); mm.use_nodes = True; mn = mm.node_tree; mn.nodes.clear(); vs = mn.nodes.new('ShaderNodeVolumeScatter'); mo = mn.nodes.new('ShaderNodeOutputMaterial')
      vs.inputs['Density'].default_value = float(opt('--mist', 0.0015)); vs.inputs['Color'].default_value = (0.85, 0.9, 1.0, 1); vs.inputs['Anisotropy'].default_value = 0.6; mn.links.new(vs.outputs[0], mo.inputs['Volume'])
      bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, -36 + 14)); o = bpy.context.active_object; o.scale = (2600, 2600, 28); o.name = 'mistbox'; o.data.materials.append(mm); o.visible_shadow = False

def render_shots():
    w, h = [int(s) for s in opt('--res', '1920x1080').split('x')]
    scn.render.engine = 'CYCLES'; scn.render.resolution_x, scn.render.resolution_y = w, h; scn.render.resolution_percentage = 100
    cy = scn.cycles; cy.samples = int(opt('--samples', 128)); cy.use_denoising = True; cy.max_bounces = 6; cy.volume_bounces = 1; cy.volume_step_rate = 2.0
    scn.view_settings.view_transform = 'AgX'; scn.view_settings.look = 'AgX - Punchy'
    if '--cpu' not in A:
        p = bpy.context.preferences.addons['cycles'].preferences
        for kind in ('OPTIX', 'CUDA'):
            try:
                p.compute_device_type = kind; p.get_devices(); [setattr(d, 'use', d.type != 'CPU') for d in p.devices]
                if any(d.use for d in p.devices): cy.device = 'GPU'; break
            except Exception: pass
    cam = bpy.data.cameras.new('cam'); cam.clip_start = 0.3; cam.clip_end = 20000; co = bpy.data.objects.new('cam', cam); scn.collection.objects.link(co); scn.camera = co
    os.makedirs(OUT, exist_ok=True)
    if opt('--save'): bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(opt('--save')))
    for name in opt('--shots', 'hero,front,statues,gate,aerial_apse,towers,crossing').split(','):
        pos, tgt, lens = SHOTS[name]; co.location = pos; cam.lens = lens
        co.rotation_euler = (Vector(tgt) - Vector(pos)).to_track_quat('-Z', 'Y').to_euler()
        scn.render.filepath = os.path.abspath(os.path.join(OUT, name + '.png')); log('render ' + name); bpy.ops.render.render(write_still=True)

make_materials(); log('materials')
setup_scene(); log('terrain + sky')
curtain_wall(); gatehouse(); bridge(); log('castle')
west_front(); log('front'); tower_faces(1); tower_faces(-1); log('towers')
nave_run(Y0, 3.0); nave_run(17.0, 50.0); log('nave'); transept(); log('transept'); crossing_tower(); log('crossing'); choir_and_apse(); log('choir')
castle_extras(); trees(); log('extras')
finalize(); render_shots(); log('done')
