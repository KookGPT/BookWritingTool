# Upper city v4 (exec'd inside sh_city.py after the under city's streets). The upper city is a "concrete jungle": every platform top of every node is built
# up with big masonry blocks along contour streets, cut by radial avenues, plazas and parks. Everything here uses its own rng (rngU) so the under city is unaffected.
#   masks on the height grid: OWNU (height of the platform that owns a cell), DOWN (distance to the open edge of the merged platforms), CRU (signed distance to a crown)
#   HABU: flat platform top (crowns too), 38+ m from the open rim (the palazzo ring and the parapet walk), clear of each hero's footprint (HERO_R), away from higher walls, bridge heads, avenues
rngU = np.random.default_rng(77)
UPS = [(k, p) for k, p in W.PLATS.items() if not p['peak'].startswith('K')]
def sub_box(b, m=70.0):
    return max(0, int((b[2] - m - GY0) / GC)), min(len(_gys), int((b[3] + m - GY0) / GC) + 2), max(0, int((b[0] - m - GX0) / GC)), min(len(_gxs), int((b[1] + m - GX0) / GC) + 2)
OWNU = np.zeros(HGg.shape, np.float32); DOWN = np.zeros(HGg.shape, np.float32); CRU = np.full(HGg.shape, 1e4, np.float32)
for key, p in sorted(UPS, key=lambda kv: (kv[1]['order'], kv[1]['h'])):
    j0, j1, i0, i1 = sub_box(p['bb']); sd = W.poly_sdf(GXg[j0:j1, i0:i1], GYg[j0:j1, i0:i1], p['poly']).astype(np.float32); cov = sd < 0
    ow = OWNU[j0:j1, i0:i1]; dw = DOWN[j0:j1, i0:i1]; same = cov & (ow == p['h']); new = cov & ~same
    DOWN[j0:j1, i0:i1] = np.where(same, np.maximum(dw, -sd), np.where(new, -sd, dw)); OWNU[j0:j1, i0:i1] = np.where(cov, p['h'], ow)
    if p['tier'] == 0: CRU[j0:j1, i0:i1] = np.minimum(CRU[j0:j1, i0:i1], sd)
TOPF = (OWNU > 0) & (np.abs(HGg - OWNU) < 0.9)
_mx = OWNU.copy()
for _ in range(4): _mx = np.maximum.reduce([_mx, np.roll(_mx, 1, 0), np.roll(_mx, -1, 0), np.roll(_mx, 1, 1), np.roll(_mx, -1, 1)])
HABU = TOPF & (DOWN > 38) & ~(_mx > OWNU + 4); del _mx
def mark_seg(M, x0, y0, x1, y1, half, val=False):
    """Set M to `val` within `half` metres of the segment."""
    j0, j1, i0, i1 = sub_box((min(x0, x1), max(x0, x1), min(y0, y1), max(y0, y1)), half + 8)
    X = GXg[j0:j1, i0:i1]; Y = GYg[j0:j1, i0:i1]; dx, dy = x1 - x0, y1 - y0; L2 = dx * dx + dy * dy + 1e-9; t = np.clip(((X - x0) * dx + (Y - y0) * dy) / L2, 0, 1)
    M[j0:j1, i0:i1] &= ~(np.hypot(X - (x0 + t * dx), Y - (y0 + t * dy)) < half) if val is False else True
def mark_disc(M, x, y, r):
    j0, j1, i0, i1 = sub_box((x - r, x + r, y - r, y + r), 8.0); M[j0:j1, i0:i1] &= ~(np.hypot(GXg[j0:j1, i0:i1] - x, GYg[j0:j1, i0:i1] - y) < r)
for a_, ka_, b_, kb_ in W.BRIDGES:                          # the bridge heads keep a clear strip along the line
    A_ = W.PEAK[a_]['anchor']; B_ = W.PEAK[b_]['anchor']; mark_seg(HABU, A_[0], A_[1], B_[0], B_[1], 28.0)
def _facing(name, pk):
    """The direction (unit x, y) a node's great building looks along: towards the other end of the statue bridge, else towards the nearest valley (as sh_heroes2 places it)."""
    c = np.asarray(pk['c'], float)
    if name in (W.STATUE_BRIDGE[0], W.STATUE_BRIDGE[2]):
        d = np.array(W.PEAK[W.STATUE_BRIDGE[2] if name == W.STATUE_BRIDGE[0] else W.STATUE_BRIDGE[0]]['anchor'], float) - c
    else:
        best = None
        for v in W.VALLEYS:
            P = v.P[v.S < (W.DAM_S - 100 if v.name == 'main' else 1e9)]; dd = P - c; L = np.hypot(dd[:, 0], dd[:, 1]); i = int(L.argmin())
            if best is None or L[i] < best[0]: best = (L[i], dd[i])
        d = best[1]
    return d / np.hypot(*d)
# each great building's footprint along its facing direction f (metres from the node's centre; + = towards f) and half its width, measured from the built meshes
HERO_FP = {'cathedral': (-18, 154, 46), 'basilica': (-101, 198, 108), 'rival': (-107, 92, 64), 'twin': (-85, 74, 52), 'palace': (-18, 170, 136), 'gardens': (-145, 1, 83)}
HERO_DISC = {'needle': 52, 'castle': 168, 'bowl': 130, 'mesa': 150, 'citadel': 105, 'agora': 78}
HEROES_C = []                                                # (x0, y0, x1, y1, half): capsules round every great building; nothing else is built inside, the fabric steps down towards it
HERO_FRONT = []                                              # (x, y, f): the forecourt side of the buildings that have one
for _n, _pk in W.PEAK.items():
    if _n.startswith('K'): continue
    _c = np.asarray(_pk['c'], float); _f = _facing(_n, _pk); _role = _pk['role']
    if _role in HERO_FP:
        _lo, _hi, _hw = HERO_FP[_role]; _p0 = _c + _f * (_lo - 6); _p1 = _c + _f * (_hi + 6); HEROES_C.append((_p0[0], _p0[1], _p1[0], _p1[1], _hw + 12.0)); HERO_FRONT.append((_c + _f * _hi, _f, _n))
    else: HEROES_C.append((_c[0], _c[1], _c[0], _c[1], HERO_DISC.get(_role, 100.0) + 6.0))
    if 'c2' in _pk: HEROES_C.append((_pk['c2'][0], _pk['c2'][1], _pk['c2'][0], _pk['c2'][1], 100.0))
for _x0, _y0, _x1, _y1, _hw in HEROES_C: mark_seg(HABU, _x0, _y0, _x1, _y1, _hw)
def inb(M, x, y):
    j, k = gidx(x, y); return 0 <= j < M.shape[0] and 0 <= k < M.shape[1] and bool(M[j, k])
def disc_ok(M, x, y, r):
    if not inb(M, x, y): return False
    return all(inb(M, x + (r + 6) * math.cos(t), y + (r + 6) * math.sin(t)) for t in np.linspace(0, 2 * math.pi, 14, endpoint=False))

# ---- avenues: from each node's centre outward on every tier's floor (a run of HABU cells along a ray), lamps, trees and figures drawn by the heroes
AVENUES = []
for name, pk in W.PEAK.items():
    if name.startswith('K'): continue
    cx0, cy0 = pk['c']; a0 = rngU.uniform(0, 6.28); rs = np.arange(10.0, 950.0, 6.0)
    for kk in range(4):
        a = a0 + 2 * math.pi * kk / 4; xs = cx0 + rs * math.cos(a); ys = cy0 + rs * math.sin(a); jj = ((ys - GY0) / GC + 0.5).astype(int); kk_ = ((xs - GX0) / GC + 0.5).astype(int)
        ok = (jj >= 0) & (jj < HABU.shape[0]) & (kk_ >= 0) & (kk_ < HABU.shape[1]); ok[ok] = HABU[jj[ok], kk_[ok]]; hh = np.where(ok, OWNU[np.clip(jj, 0, HABU.shape[0] - 1), np.clip(kk_, 0, HABU.shape[1] - 1)], 0)
        i = 0
        while i < len(rs):
            if not ok[i]: i += 1; continue
            j_ = i
            while j_ + 1 < len(rs) and ok[j_ + 1] and hh[j_ + 1] == hh[i]: j_ += 1
            if rs[j_] - rs[i] >= 80.0: AVENUES.append(dict(x0=float(xs[i]), y0=float(ys[i]), x1=float(xs[j_]), y1=float(ys[j_]), h=float(hh[i]), node=name))
            i = j_ + 1
for av in AVENUES: mark_seg(HABU, av['x0'], av['y0'], av['x1'], av['y1'], 13.0)

# ---- plazas and parks: blue noise on the free top, by node
def pick_sites(node, cell_mask, n, r_lo, r_hi, mind, taken, tries=900):
    pk = W.PEAK[node]; cx0, cy0 = pk['c']; j0, j1, i0, i1 = sub_box((cx0 - 520, cx0 + 520, cy0 - 520, cy0 + 520), 0.0)
    ys_, xs_ = np.nonzero(cell_mask[j0:j1, i0:i1]); out = []
    if len(xs_) == 0: return out
    for _ in range(tries):
        if len(out) >= n: break
        q = int(rngU.integers(0, len(xs_))); x = GX0 + (xs_[q] + i0) * GC; y = GY0 + (ys_[q] + j0) * GC; r = float(rngU.uniform(r_lo, r_hi))
        if math.hypot(x - cx0, y - cy0) > 500 or not disc_ok(cell_mask, x, y, r): continue
        if all(math.hypot(x - t[0], y - t[1]) > t[2] + r + mind for t in taken + out): out.append((x, y, r))
    return out
UPL = []; PARKS = []; _taken = []
_kinds = ['fountain', 'obelisk', 'statue', 'fountain', 'church', 'tower', 'statue']
for name, pk in W.PEAK.items():
    if name.startswith('K'): continue
    for j, (x, y, r) in enumerate(pick_sites(name, HABU, 5, 24.0, 40.0, 150.0, _taken)):
        big = j == 0; r = max(r, 40.0) if big else r; q = dict(x=x, y=y, r=r, kind='grand' if big else _kinds[(len(UPL) + j) % len(_kinds)], upper=True); UPL.append(q); _taken.append((x, y, r)); mark_disc(HABU, x, y, r + 4)
for _q, _f, _n in HERO_FRONT:                                # a formal garden in front of every great building that has a forecourt
    for _t in (48.0, 60.0, 74.0, 90.0):
        for _r in (38.0, 30.0):
            _x, _y = _q[0] + _f[0] * (_t + _r * 0.4), _q[1] + _f[1] * (_t + _r * 0.4)
            if disc_ok(HABU, _x, _y, _r) and all(math.hypot(_x - t[0], _y - t[1]) > t[2] + _r + 20 for t in _taken):
                PARKS.append(dict(x=_x, y=_y, r=_r, kind='formal')); _taken.append((_x, _y, _r)); mark_disc(HABU, _x, _y, _r + 4); break
        else: continue
        break
for name, pk in W.PEAK.items():
    if name.startswith('K'): continue
    for j, (x, y, r) in enumerate(pick_sites(name, HABU, 3, 36.0, 56.0, 80.0, _taken, 1600)):
        PARKS.append(dict(x=x, y=y, r=r, kind='formal' if (len(PARKS) % 2 == 0) else 'wood')); _taken.append((x, y, r)); mark_disc(HABU, x, y, r + 4)
PLAZAS += UPL
log(f'upper: top {TOPF.sum() * GC * GC / 1e6:.2f} km2, buildable {HABU.sum() * GC * GC / 1e6:.2f} km2, avenues {len(AVENUES)}, plazas {len(UPL)}, parks {len(PARKS)}')

# ---- streets: streamlines of the merged platforms' contour direction (rings round every rim), 46 m apart
DOWNb = blur(DOWN.astype(np.float32), 10); _gy, _gx = np.gradient(DOWNb, GC); _mu = np.hypot(_gx, _gy) + 1e-6
_cx = -_gy / _mu; _cy = _gx / _mu; _an = 1.1 * W.gn(GXg * 0.004, GYg * 0.004, 8); _bx = np.cos(_an); _by = np.sin(_an); _fl = (_bx * _cx + _by * _cy) < 0; _bx = np.where(_fl, -_bx, _bx); _by = np.where(_fl, -_by, _by)
_wq = sst(0.25, 0.75, _mu); DXu = _wq * _cx + (1 - _wq) * _bx; DYu = _wq * _cy + (1 - _wq) * _by; _L = np.hypot(DXu, DYu) + 1e-9; DXu = (DXu / _L).astype(np.float32); DYu = (DYu / _L).astype(np.float32)
DSEP_U = 46.0
_jj, _kk = np.nonzero(HABU[::7, ::7]); _seeds = [(GX0 + k * 7 * GC + rngU.uniform(-8, 8), GY0 + j * 7 * GC + rngU.uniform(-8, 8)) for j, k in zip(_jj, _kk)]
ULINES, USGRID = trace_streets(HABU, DXu, DYu, DSEP_U, _seeds, rngU, 220)
log(f'upper streets {len(ULINES)} ({sum(len(l) for l in ULINES) * STEP / 1000:.0f} km)')

# ---- lots: big blocks both sides of every street, 4-12 storeys (rising away from the rim), gaps for alleys
def along_up(P):
    seg = np.hypot(*np.diff(P, axis=0).T); S_ = np.concatenate([[0], np.cumsum(seg)]); Lt = S_[-1]; out = []
    if Lt < 24: return out
    T = np.gradient(P, axis=0); T = T / (np.hypot(T[:, 0], T[:, 1])[:, None] + 1e-9)
    for side in (-1, 1):
        s = rngU.uniform(0, 6.0)
        while s < Lt - 6:
            big = rngU.random() < 0.12; w = rngU.uniform(24, 40) if big else rngU.uniform(13, 27); d = rngU.uniform(14.5, 17.5)
            if rngU.random() < 0.04: s += rngU.uniform(4.0, 9.0); continue
            sc_ = s + w / 2; i = min(int(np.searchsorted(S_, sc_)), len(P) - 1); t = T[i]; nx, ny = -t[1], t[0]; off = side * (4.8 + d / 2)
            out.append((P[i][0] + nx * off, P[i][1] + ny * off, w, d, math.atan2(t[1], t[0]))); s += w + 0.6
    return out
UPC = []
for L_ in ULINES: UPC += along_up(L_)
rngU.shuffle(UPC); log(f'upper candidate lots {len(UPC)}')
def accept_up(cands):
    keep = []
    for (x, y, w, d, yaw) in cands:
        c_, s_ = math.cos(yaw), math.sin(yaw)
        if not (inb(HABU, x, y) and inb(HABU, x + c_ * w * 0.5, y + s_ * w * 0.5) and inb(HABU, x - c_ * w * 0.5, y - s_ * w * 0.5)): continue
        r = 0.47 * math.sqrt(w * d)
        if occupied(x, y, r): continue
        keep.append((x, y, w, d, yaw)); OCC.setdefault((int(x // 7), int(y // 7)), []).append((x, y, r))
    return keep
