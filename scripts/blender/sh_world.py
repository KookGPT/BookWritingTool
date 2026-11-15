# Stones Hold world v3 (pure numpy, no Blender):  python scripts/blender/sh_world.py <out.png> [lo]
# A mountain RANGE. UNDER CITY: a maze of branching valleys cut into stepped benches and cliffs (99% of the people). UPPER CITY: fourteen very
# different sites on the heights (crowns, a crescent ridge, a spur, a bowl, a cascade, a mesa, twin peaks, a needle, a great castle crag,
# low knolls) at different levels, tied by great bridges. Metres, x east, y north, z up.
import numpy as np, math, zlib, struct, sys, os
TERRAIN_VERSION = 'v4b'      # bump when height() changes: the Blender build caches the height grids under this name

def sstep(a, b, x): t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
def hsh(x, y, s):
    n = (np.asarray(x).astype(np.int64) * 374761393 + np.asarray(y).astype(np.int64) * 668265263 + int(s * 1013904223 % 4294967296)) & 0xffffffff
    n = ((n ^ (n >> 13)) * 1274126177) & 0xffffffff; n = n ^ (n >> 16); return (n & 0xffffff) / 16777216.0
def gnoise(x, y, s=0):
    """Gradient (Perlin) noise with analytic derivatives: (value, d/dx, d/dy)."""
    xi = np.floor(x); yi = np.floor(y); xf = x - xi; yf = y - yi
    u = xf * xf * xf * (xf * (xf * 6 - 15) + 10); du = 30 * xf * xf * (xf - 1) ** 2; v = yf * yf * yf * (yf * (yf * 6 - 15) + 10); dv = 30 * yf * yf * (yf - 1) ** 2
    def g(ix, iy): a = hsh(ix, iy, s) * 6.283185307; return np.cos(a), np.sin(a)
    (g00x, g00y), (g10x, g10y), (g01x, g01y), (g11x, g11y) = g(xi, yi), g(xi + 1, yi), g(xi, yi + 1), g(xi + 1, yi + 1)
    n00 = g00x * xf + g00y * yf; n10 = g10x * (xf - 1) + g10y * yf; n01 = g01x * xf + g01y * (yf - 1); n11 = g11x * (xf - 1) + g11y * (yf - 1)
    k = n00 - n10 - n01 + n11; n = n00 + u * (n10 - n00) + v * (n01 - n00) + u * v * k
    dx = g00x + u * (g10x - g00x) + v * (g01x - g00x) + u * v * (g00x - g10x - g01x + g11x) + du * ((n10 - n00) + v * k)
    dy = g00y + u * (g10y - g00y) + v * (g01y - g00y) + u * v * (g00y - g10y - g01y + g11y) + dv * ((n01 - n00) + u * k)
    return n, dx, dy
def gn(x, y, s=0): return gnoise(x, y, s)[0]
def mtn(x, y, s=0, o=7, ridge=1.0, damp=1.0):
    """Eroded-looking mountains: ridged noise whose detail is damped where the slope is already steep (so gullies run downhill), 0..~1."""
    t = 0.0; a = 0.5; f = 1.0; dxs = 0.0; dys = 0.0; wsum = 0.0
    for i in range(o):
        n, nx, ny = gnoise(x * f, y * f, s + i); r = 1 - np.abs(n * 1.5); sg = -np.sign(n) * 1.5
        dxs = dxs + nx * sg * ridge * 0.5; dys = dys + ny * sg * ridge * 0.5
        t = t + a * r * r / (1 + damp * (dxs * dxs + dys * dys)); wsum += a; a *= 0.5; f *= 2.03
    return t / wsum
def smin(a, b, k): h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1); return b + (a - b) * h - k * h * (1 - h)
def smax(a, b, k): return -smin(-a, -b, k)
def poly_sdf(X, Y, pts):
    X = np.asarray(X, float); Y = np.asarray(Y, float); d = np.full(X.shape, 1e9); inside = np.zeros(X.shape, bool)
    for i in range(len(pts)):
        x0, y0 = pts[i]; x1, y1 = pts[(i + 1) % len(pts)]; ex, ey = x1 - x0, y1 - y0
        t = np.clip(((X - x0) * ex + (Y - y0) * ey) / (ex * ex + ey * ey + 1e-12), 0, 1)
        d = np.minimum(d, np.hypot(X - (x0 + t * ex), Y - (y0 + t * ey)))
        inside ^= ((y0 > Y) != (y1 > Y)) & (X < (x1 - x0) * (Y - y0) / (y1 - y0 + 1e-12) + x0)
    return np.where(inside, -d, d)

# ---------------------------------------------------------------- valleys
def catmull(pts, step):
    P = [np.array(p, float) for p in pts]; P = [2 * P[0] - P[1]] + P + [2 * P[-1] - P[-2]]; out = []
    for i in range(1, len(P) - 2):
        n = max(2, int(np.hypot(*(P[i + 1] - P[i])) / step))
        for k in range(n):
            t = k / n; out.append(0.5 * ((2 * P[i]) + (-P[i - 1] + P[i + 1]) * t + (2 * P[i - 1] - 5 * P[i] + 4 * P[i + 1] - P[i + 2]) * t * t + (-P[i - 1] + 3 * P[i] - 3 * P[i + 1] + P[i + 2]) * t ** 3))
    out.append(P[-2]); return np.array(out)
class Valley:
    """Axis P, floor F (rising up-valley), half-width hw (varies along it), wall profile: slope `sin` for the first `e1` metres past the edge, then `sout`."""
    def __init__(s, name, pts, hw, f0, slope, seed=0, prof=(0.62, 230.0, 2.3)):
        s.name = name; d = catmull(pts, 14.0); s.P = d
        seg = np.hypot(*np.diff(d, axis=0).T); s.S = np.concatenate([[0], np.cumsum(seg)]); s.L = float(s.S[-1])
        ctl = hw if isinstance(hw, list) else [(0, hw), (1, hw)]; s.hw = np.interp(s.S / s.L, [c[0] for c in ctl], [c[1] for c in ctl]) * (1 + 0.28 * gn(s.S / 330.0 + seed * 7.3, np.full(len(s.S), seed * 1.7), 50 + seed))
        s.F = f0 + slope * s.S + 7 * gn(s.S / 260.0, np.full(len(s.S), 3.3 + seed), 70 + seed)
        s.sin = np.full(len(s.S), prof[0]); s.e1 = np.full(len(s.S), prof[1]); s.sout = np.full(len(s.S), prof[2])
        t = np.gradient(d, axis=0); s.T = t / np.hypot(t[:, 0], t[:, 1])[:, None]; s.N = np.stack([s.T[:, 1], -s.T[:, 0]], 1)
    def near(s, X, Y):
        X = np.asarray(X, float); Y = np.asarray(Y, float); sh = X.shape; x = X.ravel(); y = Y.ravel(); best = np.full(len(x), 1e12); idx = np.zeros(len(x), int)
        for c in range(0, len(x), 12000):
            xs = x[c:c + 12000, None]; ys = y[c:c + 12000, None]; d2 = (xs - s.P[None, :, 0]) ** 2 + (ys - s.P[None, :, 1]) ** 2; i = d2.argmin(1); idx[c:c + 12000] = i; best[c:c + 12000] = d2[np.arange(len(i)), i]
        return np.sqrt(best).reshape(sh), idx.reshape(sh)
    def at(s, y):  # nearest axis sample to a y (for joining branches)
        i = int(np.argmin(np.abs(s.P[:, 1] - y))); return s.P[i], float(s.F[i])

# the trunk runs south to north into the lake basin behind the dam; side valleys leave it east and west, with pockets branching off those
MAIN = Valley('main', [(-80, -3750), (40, -3050), (-110, -2250), (60, -1350), (170, -550), (-40, 250), (-130, 1100), (0, 1900), (60, 2450), (95, 2750), (150, 3250), (250, 3850), (390, 4450)],
              [(0, 130), (0.3, 190), (0.6, 140), (0.8, 170), (0.905, 78), (0.935, 120), (0.96, 230), (1, 200)], -35.0, 0.0245, 1)
_di = int(np.argmin(np.abs(MAIN.P[:, 1] - 2520))); DAM_S = float(MAIN.S[_di]); DAM_Y = float(MAIN.P[_di][1]); DAM_X = float(MAIN.P[_di][0]); F_DAM = float(MAIN.F[_di])
LAKE_Z = F_DAM + 118.0; LAKE_FLOOR = LAKE_Z - 44.0
_t = sstep(DAM_S - 10, DAM_S + 70, MAIN.S)
MAIN.F = np.where(MAIN.S > DAM_S - 10, F_DAM * (1 - _t) + (LAKE_FLOOR + 0.011 * (MAIN.S - DAM_S - 70).clip(0)) * _t, MAIN.F)      # a step at the dam, then the lake floor rising gently to the head
MAIN.sin = np.where(MAIN.S > DAM_S + 20, 0.13, MAIN.sin); MAIN.e1 = np.where(MAIN.S > DAM_S + 20, 150.0, MAIN.e1); MAIN.sout = np.where(MAIN.S > DAM_S + 20, 0.85, MAIN.sout)
def trib(name, join_y, pts, hw=95, slope=0.05, seed=2, prof=(0.62, 230.0, 2.3), side=1):
    p, f = MAIN.at(join_y); hwl = hw if isinstance(hw, list) else [(0, hw * 1.5), (0.2, hw), (0.7, hw * 1.15), (1, hw * 0.7)]
    return Valley(name, [(float(p[0]), float(p[1]))] + pts, hwl, f + 2.0, slope, seed, prof)
VALLEYS = [MAIN,
    trib('sw', -3050, [(-700, -3200), (-1500, -3000), (-2300, -3350), (-3150, -3050)], 105, seed=11),
    trib('e1', -2250, [(750, -2330), (1500, -2000), (2350, -2300), (3150, -2000)], 100, seed=12),
    trib('w1', -1350, [(-800, -1450), (-1600, -1250), (-2400, -1500), (-3250, -1250)], 110, seed=13),
    trib('e2', -550, [(800, -330), (1600, -520), (2400, -120), (3250, -420)], 105, seed=14),
    trib('w2', 250, [(-800, 420), (-1500, 300), (-2300, 640), (-3100, 520)], 100, seed=15),
    trib('e3', 1100, [(850, 1000), (1700, 1300), (2500, 1100), (3250, 1700)], 105, seed=16),
    trib('w3', 1900, [(-800, 2080), (-1600, 1900), (-2350, 2400)], 95, seed=17)]
def sub(name, parent, frac, pts, hw=75, slope=0.055, seed=3):
    v = [u for u in VALLEYS if u.name == parent][0]; i = int(len(v.P) * frac); p = v.P[i]
    return Valley(name, [(float(p[0]), float(p[1]))] + pts, [(0, hw * 1.4), (0.3, hw), (1, hw * 0.65)], float(v.F[i]) + 2.0, slope, seed)
VALLEYS += [sub('w1b', 'w1', 0.5, [(-1880, -750), (-1950, -150)], 80, seed=21), sub('e2b', 'e2', 0.45, [(1900, -1050), (2250, -1500)], 75, seed=22), sub('e3b', 'e3', 0.4, [(1920, 2000), (2300, 2600)], 75, seed=23),
            sub('w2b', 'w2', 0.55, [(-2000, 1100), (-1700, 1650)], 70, seed=24)]

# coarse fields: surface of the valleys, distance to the nearest valley's edge, its floor and width (bilinear-sampled; the fine detail is added in base())
FX0, FC, FN = -4800.0, 24.0, 401
_CG = None
def _coarse():
    global _CG
    if _CG is not None: return _CG
    cache = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'test', 'out', 'sh', 'coarse_v3.npz')
    key = np.array([sum(float(v.P.sum()) + float(v.hw.sum()) + float(v.F.sum()) for v in VALLEYS), FC, FN, LAKE_Z, 2.0])
    try:
        z = np.load(cache)
        if np.allclose(z['key'], key): _CG = (z['zv'], z['em'], z['fn'], z['hwn'], z['dm'], z['tx'], z['ty']); return _CG
    except Exception: pass
    xs = FX0 + FC * np.arange(FN); X, Y = np.meshgrid(xs, xs); zv = np.full(X.shape, 1e9, np.float32); em = np.full(X.shape, 1e9, np.float32); fn = np.zeros(X.shape, np.float32); hwn = np.zeros(X.shape, np.float32); dm = np.full(X.shape, 1e9, np.float32); tx = np.zeros(X.shape, np.float32); ty = np.zeros(X.shape, np.float32)
    for v in VALLEYS:
        d, i = v.near(X, Y); hw = v.hw[i]; e = d - hw; ee = np.maximum(e, 0.0); f = v.F[i]
        z = f + np.where(ee < v.e1[i], v.sin[i] * ee, v.sin[i] * v.e1[i] + v.sout[i] * (ee - v.e1[i])); z = np.where(e < 0, f + (-e / hw) ** 2 * 0.0, z)
        nearer = e < em; tx = np.where(nearer, v.T[i, 0], tx); ty = np.where(nearer, v.T[i, 1], ty); fn = np.where(nearer, f, fn); hwn = np.where(nearer, hw, hwn); em = np.where(nearer, e, em); dm = np.minimum(dm, d)
        zv = np.where(zv > 1e8, z, smin(zv, z, 28.0)).astype(np.float32)
    _CG = (zv, em.astype(np.float32), fn, hwn, dm.astype(np.float32), tx.astype(np.float32), ty.astype(np.float32))
    try: os.makedirs(os.path.dirname(cache), exist_ok=True); np.savez(cache, key=key, zv=_CG[0], em=_CG[1], fn=_CG[2], hwn=_CG[3], dm=_CG[4], tx=_CG[5], ty=_CG[6])
    except Exception: pass
    return _CG
def cs(g, X, Y):
    fx = np.clip((X - FX0) / FC, 0, FN - 1.001); fy = np.clip((Y - FX0) / FC, 0, FN - 1.001); ix = fx.astype(int); iy = fy.astype(int); tx = fx - ix; ty = fy - iy
    return g[iy, ix] * (1 - tx) * (1 - ty) + g[iy, ix + 1] * tx * (1 - ty) + g[iy + 1, ix] * (1 - tx) * ty + g[iy + 1, ix + 1] * tx * ty
def near(X, Y):
    """(distance to the nearest valley edge (negative on a floor), that valley's floor altitude, its half-width, distance to its axis) at X, Y."""
    X = np.asarray(X, float); Y = np.asarray(Y, float); zv, em, fn, hwn, dm, tx, ty = _coarse(); return cs(em, X, Y), cs(fn, X, Y), cs(hwn, X, Y), cs(dm, X, Y)
def tangent(X, Y):
    """Unit direction of the nearest valley's axis at X, Y (a direction, not a heading: sign is arbitrary)."""
    X = np.asarray(X, float); Y = np.asarray(Y, float); c = _coarse(); a = cs(c[5], X, Y); b = cs(c[6], X, Y); L = np.hypot(a, b) + 1e-9; return a / L, b / L
def xc(y): i = int(np.argmin(np.abs(MAIN.P[:, 1] - y))); return float(MAIN.P[i][0])
def floor_h(y): return float(np.interp(y, MAIN.P[:, 1], MAIN.F))

# ---------------------------------------------------------------- the upper city's sites: big fat nodes on the ridge blocks between the valleys
# v4: the upper city is a "concrete jungle". Every ridge block between two valleys carries a chain of nodes whose lowest terraces share one level and
# overlap, so each block is one continuous masonry mass; crowns (heroes), shelves and terraces sit at different levels; bridges tie the blocks together.
def blob(cx, cy, r, seed, n=12, stretch=1.0, ang=0.0, wob=0.16):
    """A lobed outline: a few low harmonics (big lobes and bays, never a circle or an oval) plus a little jitter, stretched along ang."""
    rg = np.random.default_rng(seed); ph = rg.uniform(0, 2 * math.pi, 3); am = rg.uniform(0.6, 1.0, 3); pts = []
    for i in range(n):
        a = 2 * math.pi * i / n; k = 1 + wob * (0.55 * am[0] * math.sin(2 * a + ph[0]) + 0.4 * am[1] * math.sin(3 * a + ph[1]) + 0.3 * am[2] * math.sin(5 * a + ph[2])) + 0.03 * (rg.random() - 0.5)
        rr = r * k; x, y = rr * math.cos(a) * stretch, rr * math.sin(a); c, s_ = math.cos(ang), math.sin(ang); pts.append((cx + x * c - y * s_, cy + x * s_ + y * c))
    return pts
def circle(cx, cy, r, n=30, seed=0, wob=0.04):
    rg = np.random.default_rng(seed); return [(cx + r * (1 + wob * (rg.random() - 0.5)) * math.cos(2 * math.pi * i / n), cy + r * (1 + wob * (rg.random() - 0.5)) * math.sin(2 * math.pi * i / n)) for i in range(n)]

PEAK = {}          # name -> site: c (the hero's centre), h (crown), role, anchor (a point inside every tier), tiers {'c','1','2',...: key into PLATS}
PLATS = {}         # key -> platform: h, K (fill slope), poly, peak, tier (0 crown, 1 shelf, 2 terrace, 3+ extras), inner (polygons the houses keep out of), fab (the upper city's houses go here)
def fit_ridge(poly, margin=22.0):
    """Pull every vertex that falls into (or too near) a valley back toward the outline's middle, then smooth: a terrace ends where the ridge does."""
    P = np.array(poly, float); c0 = P.mean(0); n = len(P); sc = np.ones(n)
    for i in range(n):
        for f in np.arange(1.0, 0.25, -0.03):
            q = c0 + (P[i] - c0) * f
            if float(near(np.array([q[0]]), np.array([q[1]]))[0][0]) >= margin: sc[i] = f; break
        else: sc[i] = 0.25
    sc = np.minimum(sc, np.minimum(np.roll(sc, 1), np.roll(sc, -1))); sc = (np.roll(sc, 1) + 2 * sc + np.roll(sc, -1)) / 4
    return [tuple(c0 + (P[i] - c0) * sc[i]) for i in range(n)]
def add_site(name, role, c, crown_h, crown_poly, t1=None, t2=None, anchor=None, extra=(), K=22, seed=0):
    p = dict(name=name, role=role, c=tuple(c), h=crown_h, anchor=tuple(anchor or c), seed=seed, tiers={}, extras=[]); PEAK[name] = p
    if not name.startswith('K'): crown_poly = fit_ridge(crown_poly); t1 = (fit_ridge(t1[0]), t1[1]) if t1 else None; t2 = (fit_ridge(t2[0]), t2[1]) if t2 else None
    def put(k, poly, h, tier, inner, fab):
        PLATS[f'{name}_{k}'] = dict(h=h, K=K, poly=poly, peak=name, tier=tier, inner=inner, fab=fab, order={'2': 1, '1': 2, 'c': 3}.get(k, 0)); p['tiers'][k] = f'{name}_{k}'
    if t2: put('2', t2[0], t2[1], 2, [crown_poly] + ([t1[0]] if t1 else []), True)
    if t1: put('1', t1[0], t1[1], 1, [crown_poly], True)
    for i, (poly, h, fab) in enumerate(extra): put(f'x{i}', poly, h, 3 + i, [], fab); p['extras'].append(f'x{i}')
    put('c', crown_poly, crown_h, 0, [], False); p['crown'] = crown_poly; p['t1'] = t1[0] if t1 else None; p['t2'] = t2[0] if t2 else None; p['h1'] = t1[1] if t1 else crown_h; p['h2'] = t2[1] if t2 else crown_h
    return p
def node(name, role, c, hc, h1, h2, rc, r1, r2, ang=0.0, st=1.2, seed=1, o1=(0.0, 0.0), o2=(0.0, 0.0), crown=None, anchor=None, **kw):
    """A site: a crown (the hero), a shelf and a terrace, each its own polygon (not concentric: the shelf and terrace lean along `ang` by o1 / o2)."""
    cx, cy = c
    return add_site(name, role, c, hc, crown or blob(cx, cy, rc * 1.28, seed, 20, 1.0, ang, 0.13), (blob(cx + o1[0], cy + o1[1], r1 * 1.06, seed + 1, 28, st, ang, 0.2), h1), (blob(cx + o2[0], cy + o2[1], r2 * 1.03, seed + 2, 32, st * 1.04, ang, 0.24), h2), anchor=anchor or c, seed=seed, **kw)

# West block F3 (between w2 and w3), west block F2 (w1..w2), west block F1 (sw..w1); east blocks F1 (e1..e2), F2 (e2..e3), F3 (north of e3)
node('A4', 'twin', (-1250, 1050), 600, 480, 330, 175, 330, 410, 0.5, 1.27, 131, o1=(60, 20), o2=(-30, 20))
PEAK['A4']['c2'] = (-1410, 890); PEAK['A4']['h_c2'] = 540
PLATS['A4_c2'] = dict(h=540, K=22, poly=blob(-1410, 890, 100, 139, 11), peak='A4', tier=0, inner=[], fab=False, order=3); PEAK['A4']['tiers']['c2'] = 'A4_c2'
node('A6', 'needle', (-760, 1520), 700, 480, 330, 90, 240, 320, 0.3, 1.12, 151, o1=(-20, 0), o2=(-20, 0))
node('B3', 'agora', (-2700, 1250), 500, 480, 330, 100, 250, 360, 0.0, 1.32, 311)
node('A1', 'cathedral', (-600, -300), 560, 480, 400, 190, 340, 430, 0.4, 1.32, 101, o1=(-50, -30), o2=(-60, -40))
node('A5', 'citadel', (-1280, -700), 580, 480, 400, 160, 300, 390, 0.1, 1.22, 161, o1=(-30, -30), o2=(-20, -20))
node('B2', 'agora', (-2650, -520), 540, 480, 400, 100, 250, 360, 0.0, 1.27, 211)
node('A11', 'mesa', (-1000, -2250), 480, 400, 330, 150, 300, 400, 0.2, 1.32, 411, o1=(40, 10), o2=(30, 30))
node('B1', 'agora', (-1650, -2250), 480, 400, 330, 100, 250, 360, 0.0, 1.32, 111)
node('A10', 'gardens', (-2300, -2250), 460, 400, 330, 130, 280, 380, 0.0, 1.32, 311, o1=(0, 40), o2=(-20, 30))
node('A2', 'basilica', (750, -1100), 520, 400, 330, 175, 320, 410, 0.3, 1.32, 111, o1=(30, 30), o2=(50, 30))
node('A8', 'palace', (1300, -1450), 480, 400, 330, 130, 280, 380, 0.4, 1.27, 171, o1=(40, 0), o2=(60, 0))
node('A3', 'rival', (780, 450), 620, 480, 400, 190, 330, 400, 0.2, 1.27, 121, o1=(-40, 20), o2=(-30, 10), anchor=(780, 450))
node('B6', 'agora', (1350, 380), 540, 480, 400, 100, 260, 380, 0.0, 1.27, 611)
node('A9', 'bowl', (1950, 330), 560, 480, 400, 150, 300, 380, 0.0, 1.27, 211, o1=(30, 0), o2=(20, 0))
node('B5', 'agora', (2700, 330), 540, 480, 400, 100, 250, 360, 0.0, 1.32, 511)
node('A7', 'castle', (650, 1950), 620, 480, 330, 175, 340, 430, -0.1, 1.32, 141, o1=(60, -30), o2=(80, -40), anchor=(650, 1950))
node('B7', 'agora', (1250, 1900), 520, 480, 330, 100, 240, 320, 0.0, 1.12, 711)
KNOLLS = [('K1', 'fort', 330, -1800, 58), ('K2', 'church', -520, -2650, 50), ('K3', 'fort', 1850, -2050, 54), ('K4', 'church', 40, 700, 46), ('K5', 'fort', -1700, 120, 52), ('K6', 'church', 1500, 1150, 48)]
for nm, role, kx, ky, kr in KNOLLS:
    fl = float(near(np.array([kx]), np.array([ky]))[1][0])
    add_site(nm, role, (kx, ky), fl + 78, circle(kx, ky, kr * 0.66, 18, int(abs(kx)) + 3), (circle(kx, ky, kr, 20, int(abs(ky)) + 5), fl + 62), None, K=30, seed=int(abs(kx)))
# bridges: (site, platform key, site, platform key). Each pair shares a deck level, so a bridge is a plain level span (the user's favourite).
BRIDGES = [('A1', '1', 'A3', '1'), ('A1', '2', 'A2', '1'), ('A2', '1', 'A3', '2'), ('A1', '1', 'A4', '1'), ('A5', '1', 'A4', '1'), ('A5', '2', 'A11', '1'), ('A6', '1', 'A7', '1'), ('A3', 'c', 'A7', 'c'),
           ('A9', '1', 'B7', '1'), ('B6', '1', 'B7', '1'), ('A5', '1', 'B2', '1'), ('A4', '1', 'B3', '1')]
STATUE_BRIDGE = ('A3', 'c', 'A7', 'c')     # crown to crown at 620 m: the Rival Cathedral to the Great Castle, a kilometre of statues
for p in PLATS.values():
    xs = [q[0] for q in p['poly']]; ys = [q[1] for q in p['poly']]; p['bb'] = (min(xs), max(xs), min(ys), max(ys))

# ---------------------------------------------------------------- the rock
def massif(X, Y):
    r = np.hypot(X, Y * 0.9); wx = X + 380 * gn(X * 0.00055, Y * 0.00055, 21); wy = Y + 380 * gn(X * 0.00055 + 5, Y * 0.00055 + 9, 22)
    rg = mtn(wx * 0.00085, wy * 0.00085, 31, 5); ring = sstep(2600, 5200, r)
    return 365 + 70 * gn(X * 0.0006, Y * 0.0006, 5) + (300 + 340 * ring) * rg + 560 * ring ** 1.35 + 34 * (mtn(X * 0.005, Y * 0.005, 41, 3) - 0.3) * sstep(300, 1400, r)

def base(X, Y):
    X = np.asarray(X, float); Y = np.asarray(Y, float)
    wx = 40 * gn(X * 0.004, Y * 0.004, 3); wy = 40 * gn(X * 0.004 + 17, Y * 0.004, 4); zv, em, fn, hwn, dm, tx, ty = _coarse(); Xs = X + wx; Ys = Y + wy
    ZV = cs(zv, Xs, Ys); EM = cs(em, Xs, Ys); FNr = cs(fn, Xs, Ys); HW = cs(hwn, Xs, Ys)
    z = smin(ZV, massif(X, Y), 55.0)
    # cliffs and crags on the valley walls
    wall = sstep(0, 160, EM) * sstep(900, 450, EM); z = z + wall * ((mtn(X * 0.011, Y * 0.011, 61, 3) - 0.38) * 70)
    # benches and cliffs: the walls are cut into steps whose contours wander and close round knolls, so streets have to follow them
    u = z - FNr; stp = np.maximum(15 + 10 * gn(X * 0.0028, Y * 0.0028, 63), 11.0); w = u / stp + 1.35 * gn(X * 0.0046, Y * 0.0046, 61) + 0.55 * gn(X * 0.014, Y * 0.014, 62)
    fl = np.floor(w); out = stp * (fl + sstep(0.50, 0.90, w - fl)) - stp * 0.38
    tm = sstep(8, 34, u) * sstep(620, 360, EM) * sstep(380, 240, u); z = z + (FNr + out + 0 - z) * tm
    # knolls on the floors of the wide basins (the city wraps round them)
    kn = np.maximum(gn(X * 0.0034 + 9, Y * 0.0034, 71) - 0.03, 0.0) ** 1.1 * 190 * sstep(HW * 0.5, HW * 0.95 + 25, np.maximum(EM + HW, 0)) * sstep(HW + 420, HW + 120, np.maximum(EM + HW, 0)); z = z + kn
    return z

def natural(X, Y):
    """The rock before any masonry platform: valleys, massif and the towers every platform stands on."""
    X = np.asarray(X, float); Y = np.asarray(Y, float); z = base(X, Y)
    for p in PLATS.values():
        b = p['bb']; m = (X > b[0] - 480) & (X < b[1] + 480) & (Y > b[2] - 480) & (Y < b[3] + 480)
        if m.any():
            d = poly_sdf(X[m], Y[m], p['poly']); pk = p['h'] - 50 - 1.5 * np.maximum(d, 0) + (gn(X[m] * 0.03, Y[m] * 0.03, 2)) * 26; z[m] = smax(z[m], pk, 22)
    return z
def height(X, Y):
    X = np.asarray(X, float); Y = np.asarray(Y, float); z = natural(X, Y)
    for key in sorted(PLATS, key=lambda k: (PLATS[k]['order'], PLATS[k]['h'])):      # extras, terraces, shelves, crown; the higher one wins an overlap
        p = PLATS[key]; b = p['bb']; m = (X > b[0] - 420) & (X < b[1] + 420) & (Y > b[2] - 420) & (Y < b[3] + 420)
        if not m.any(): continue
        d = poly_sdf(X[m], Y[m], p['poly']); h = p['h']; zz = z[m]
        out = np.where(zz > h, np.minimum(zz, h + 1.8 * d), np.maximum(zz, h - p['K'] * d)); z[m] = np.where(d < 0, h, out)
    return z

def write_png(path, rgb):
    h, w, _ = rgb.shape; raw = b''.join(b'\x00' + rgb[i].tobytes() for i in range(h)); comp = zlib.compress(raw, 6)
    def ch(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + ch(b'IDAT', comp) + ch(b'IEND', b''))

if __name__ == '__main__':
    out = sys.argv[1]; N = 1000; E = float(sys.argv[2]) if len(sys.argv) > 2 else 4300; ext = (-E, E, -E, E)
    xs = np.linspace(ext[0], ext[1], N); ys = np.linspace(ext[3], ext[2], N); Xg, Yg = np.meshgrid(xs, ys); Z = height(Xg, Yg)
    cell = (ext[1] - ext[0]) / N; gy, gx = np.gradient(Z, cell); shade = np.clip(0.55 + 0.95 * (gx * 0.7 - gy * 0.7) / (1 + np.hypot(gx, gy)), 0, 1)
    t = np.clip(Z / 700, 0, 1); img = np.stack([40 + 215 * t, 60 + 190 * t, 50 + 200 * t], 2) * (0.3 + 0.7 * shade[..., None])
    img[(Z < LAKE_Z + 0.5) & (Yg > DAM_Y + 10) & (np.abs(Xg) < 1600)] = (40, 90, 150)
    def mark(pts, col):
        for i in range(len(pts)):
            a = pts[i]; b = pts[(i + 1) % len(pts)]
            for k in range(30):
                x = a[0] + (b[0] - a[0]) * k / 30; y = a[1] + (b[1] - a[1]) * k / 30; ix = int((x - ext[0]) / cell); iy = int((ext[3] - y) / cell)
                if 0 <= ix < N and 0 <= iy < N: img[iy, ix] = col
    for k, p in PLATS.items(): mark(p['poly'], (255, 40, 40) if p['tier'] == 0 else ((255, 200, 60) if p['tier'] == 1 else (255, 140, 200)))
    for a, ka, b, kb in BRIDGES: mark([PEAK[a]['anchor'], PEAK[b]['anchor']], (255, 255, 0))
    for v in VALLEYS: mark(v.P[::5], (60, 200, 255))
    write_png(out, np.clip(img, 0, 255).astype(np.uint8)); print('zmin', Z.min(), 'zmax', Z.max(), 'dam', DAM_Y, 'lake', LAKE_Z, 'F_dam', F_DAM)
