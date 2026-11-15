# City fabric of Stones Hold v3 (exec'd inside stones_hold.py).
# UNDER CITY: streets are streamlines of the ground's contour direction (benches, cliffs, knolls), spaced evenly (Jobard-Lefer), so they wrap
#   round every knoll and run along every bench like a maze; flat floors fall back to the valley's own direction. Double rows of attached houses
#   stand on both sides of every street; stairs climb the risers; plazas sit on the flattest ground. 99% of the people live here.
# UPPER CITY: rows of finer houses run along inward offsets of each terrace's rim, round the hero's footprint.
import time
rng = np.random.default_rng(7)
MATS['street'] = simple('street', (0.045, 0.042, 0.04), 0.85, noise_bump=0.5, scale=2.0)
STOREY = 3.1
DSEP = float(opt('--dsep', 22.0)); STEP = 4.0
PLAZAS = []          # dict(x, y, r, kind, upper): built by sh_heroes
def sst(a, b, x): t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
def blur(a, it):
    for _ in range(it): a = (a * 2 + np.roll(a, 1, 0) + np.roll(a, -1, 0) + np.roll(a, 1, 1) + np.roll(a, -1, 1)) / 6.0
    return a

# ---- fields on the height grid: contour direction, habitability, density
_t0 = time.time()
GXg, GYg = np.meshgrid(_gxs, _gys); HGg = hgrid()
HGs = blur(HGg.astype(np.float32), 7); gyg, gxg = np.gradient(HGs, GC); GMAG = np.hypot(gxg, gyg).astype(np.float32)
SLP = np.hypot(*np.gradient(blur(HGg.astype(np.float32), 1), GC)).astype(np.float32)
EM, FNG, HWG, DMG = [a.astype(np.float32) for a in W.near(GXg, GYg)]
TXg, TYg = W.tangent(GXg, GYg); ang = 0.9 * W.gn(GXg * 0.005, GYg * 0.005, 5); ca, sa = np.cos(ang), np.sin(ang); bx = TXg * ca - TYg * sa; by = TXg * sa + TYg * ca
cx_ = -gyg / (GMAG + 1e-6); cy_ = gxg / (GMAG + 1e-6); flip = (bx * cx_ + by * cy_) < 0; bx = np.where(flip, -bx, bx); by = np.where(flip, -by, by)
wq = sst(0.07, 0.30, GMAG); DXg = wq * cx_ + (1 - wq) * bx; DYg = wq * cy_ + (1 - wq) * by; Ln = np.hypot(DXg, DYg) + 1e-9; DXg = (DXg / Ln).astype(np.float32); DYg = (DYg / Ln).astype(np.float32)
EMAXg = np.maximum(float(opt('--emax', 125.0)) + 60 * W.gn(GXg * 0.004, GYg * 0.004, 81), 55.0); HMAXg = np.maximum(float(opt('--hmax', 90.0)) + 35 * W.gn(GXg * 0.003 + 3, GYg * 0.003, 82), 40.0)
RISE = HGg - FNG
HAB = (EM < EMAXg) & (RISE < HMAXg) & (SLP < 1.0) & (DMG > 13) & (GYg < W.DAM_Y - 70) & (np.abs(GXg) < 3700) & (np.abs(GYg) < 3700)
DENS = (sst(EMAXg, EMAXg * 0.5, EM) * sst(HMAXg, HMAXg * 0.55, RISE)).astype(np.float32)
for key, p in W.PLATS.items():                                   # keep the city off the upper sites' footprints and their fills
    if p['tier'] > 2 and not p['peak'].startswith('K'): continue
    b = p['bb']; i0 = max(0, int((b[0] - 40 - GX0) / GC)); i1 = min(len(_gxs), int((b[1] + 40 - GX0) / GC) + 2); j0 = max(0, int((b[2] - 40 - GY0) / GC)); j1 = min(len(_gys), int((b[3] + 40 - GY0) / GC) + 2)
    sub = W.poly_sdf(GXg[j0:j1, i0:i1], GYg[j0:j1, i0:i1], p['poly']); HAB[j0:j1, i0:i1] &= sub > (22 if p['peak'].startswith('K') else 30)
log(f'city fields {time.time() - _t0:.1f}s, habitable {HAB.mean() * 100:.1f}%')
def gidx(x, y): return int((y - GY0) / GC + 0.5), int((x - GX0) / GC + 0.5)

# ---- plazas on the flattest ground near the valley axes (before the streets, so the streets stop at their edges)
def place_plazas():
    zones = [v for v in W.VALLEYS]
    for v in zones:
        s = 90.0 + rng.uniform(0, 100)
        while s < v.L - 100:
            if v.name == 'main' and s > W.DAM_S - 220: break
            i = int(np.searchsorted(v.S, s)); P = v.P[i]; N = v.N[i]; best = None
            for off in (-1, 1):
                for dd in (v.hw[i] * 0.6 + 40, v.hw[i] + 25, v.hw[i] + 60, v.hw[i] + 100):
                    x, y = P[0] + off * N[0] * dd, P[1] + off * N[1] * dd; j, k = gidx(x, y)
                    if not (0 <= j < HAB.shape[0] and 0 <= k < HAB.shape[1]) or not HAB[j, k]: continue
                    r = 34.0
                    while r > 17.5:
                        a = np.linspace(0, 2 * math.pi, 12, endpoint=False); hz = H(x + r * np.cos(a), y + r * np.sin(a)); hc = float(H(x, y))
                        if float(np.abs(hz - hc).max()) < 2.6 and all(HAB[gidx(x + r * math.cos(t), y + r * math.sin(t))] for t in a[::3]): break
                        r -= 3.0
                    else: continue
                    sc_ = r - 0.02 * float(slope(x, y))
                    if all(math.hypot(x - q['x'], y - q['y']) > q['r'] + r + 28 for q in PLAZAS) and (best is None or sc_ > best[0]): best = (sc_, x, y, r)
            if best: PLAZAS.append(dict(x=best[1], y=best[2], r=best[3], kind=['fountain', 'obelisk', 'statue', 'church', 'fountain', 'tower'][len(PLAZAS) % 6], upper=False))
            s += rng.uniform(170, 260)
place_plazas(); log(f'plazas {len(PLAZAS)}')
for q in PLAZAS:                                                  # plazas are not city ground for streets and houses
    b = q['r'] + 3.0; j0, k0 = gidx(q['x'] - b, q['y'] - b); j1, k1 = gidx(q['x'] + b, q['y'] + b); sub = np.hypot(GXg[j0:j1 + 1, k0:k1 + 1] - q['x'], GYg[j0:j1 + 1, k0:k1 + 1] - q['y']) < b; HAB[j0:j1 + 1, k0:k1 + 1] &= ~sub

# ---- streamlines (Jobard-Lefer): evenly spaced contour streets
def trace_streets(HABm=None, DX=None, DY=None, dsep=None, seeds=None, rg=None, maxst=170):
    HABm = HAB if HABm is None else HABm; DX = DXg if DX is None else DX; DY = DYg if DY is None else DY; dsep = DSEP if dsep is None else dsep; rg = rng if rg is None else rg
    cell = dsep * 0.9; dtest = dsep * 0.7; dseed = dsep * 0.88; grid = {}; lines = []; shp = HABm.shape
    def near_any(x, y, lid=-1, idx=0, own=None):
        cx0, cy0 = int(x // cell), int(y // cell); d2m = dtest * dtest
        for gx_ in (cx0 - 1, cx0, cx0 + 1):
            for gy_ in (cy0 - 1, cy0, cy0 + 1):
                for (px, py, l, i) in grid.get((gx_, gy_), ()):
                    if (px - x) ** 2 + (py - y) ** 2 < d2m: return True
        if own is not None:
            for gx_ in (cx0 - 1, cx0, cx0 + 1):
                for gy_ in (cy0 - 1, cy0, cy0 + 1):
                    for (px, py, i) in own.get((gx_, gy_), ()):
                        if abs(i - idx) > 28 and (px - x) ** 2 + (py - y) ** 2 < d2m: return True
        return False
    def free(x, y, r2):
        cx0, cy0 = int(x // cell), int(y // cell)
        for gx_ in (cx0 - 1, cx0, cx0 + 1):
            for gy_ in (cy0 - 1, cy0, cy0 + 1):
                for (px, py, l, i) in grid.get((gx_, gy_), ()):
                    if (px - x) ** 2 + (py - y) ** 2 < r2: return False
        return True
    def okp(x, y):
        j = int((y - GY0) / GC + 0.5); k = int((x - GX0) / GC + 0.5)
        return 0 <= j < shp[0] and 0 <= k < shp[1] and HABm[j, k]
    def trace(x0, y0):
        own = {}; segs = []
        for direction in (1, -1):
            x, y = x0, y0; j = int((y - GY0) / GC + 0.5); k = int((x - GX0) / GC + 0.5); dx, dy = direction * float(DX[j, k]), direction * float(DY[j, k]); seg = []
            for st in range(1, maxst):
                j = int((y + dy * 2 - GY0) / GC + 0.5); k = int((x + dx * 2 - GX0) / GC + 0.5)
                if not (0 <= j < shp[0] and 0 <= k < shp[1]): break
                fx, fy = float(DX[j, k]), float(DY[j, k])
                if fx * dx + fy * dy < 0: fx, fy = -fx, -fy
                nx, ny = 0.45 * dx + 0.55 * fx, 0.45 * dy + 0.55 * fy; L = math.hypot(nx, ny) or 1.0; dx, dy = nx / L, ny / L
                x += dx * STEP; y += dy * STEP
                if not okp(x, y) or near_any(x, y, -1, direction * st, own): break
                seg.append((x, y)); c = (int(x // cell), int(y // cell)); own.setdefault(c, []).append((x, y, direction * st))
            segs.append(seg)
        return segs[1][::-1] + [(x0, y0)] + segs[0]
    if seeds is None:
      seeds = []
      for v in W.VALLEYS:
        for s in np.arange(30.0, v.L - 30.0, 110.0):
            if v.name == 'main' and s > W.DAM_S - 200: break
            i = int(np.searchsorted(v.S, s)); P = v.P[i]; N = v.N[i]
            for off in (-1, 1): seeds.append((P[0] + off * N[0] * (v.hw[i] * 0.45 + 20.0), P[1] + off * N[1] * (v.hw[i] * 0.45 + 20.0)))
    rg.shuffle(seeds); lid = 0; tried = 0
    while seeds:
        j_ = int(rg.integers(0, len(seeds))); seeds[j_], seeds[-1] = seeds[-1], seeds[j_]; x, y = seeds.pop(); tried += 1
        if not okp(x, y) or not free(x, y, dseed * dseed): continue
        pts = trace(x, y)
        if len(pts) < 6: continue
        for i, (px, py) in enumerate(pts): grid.setdefault((int(px // cell), int(py // cell)), []).append((px, py, lid, i))
        lines.append(np.array(pts)); lid += 1
        for i in range(2, len(pts) - 2, 4):
            tx, ty = pts[i + 1][0] - pts[i - 1][0], pts[i + 1][1] - pts[i - 1][1]; L = math.hypot(tx, ty) or 1.0; nx, ny = -ty / L, tx / L
            for sg in (-1, 1): seeds.append((pts[i][0] + sg * nx * dsep, pts[i][1] + sg * ny * dsep))
    if HABm is HAB: log(f'streamlines {len(lines)} ({sum(len(l) for l in lines) * STEP / 1000:.0f} km), seeds tried {tried}')
    return lines, grid
LINES, SGRID = trace_streets()

# ---- stairs: short climbs up the risers from one street to the next (along the gradient)
STAIRS = []; STAIRCELL = {}
def stairs():
    for lid, L in enumerate(LINES):
        for i in range(6, len(L) - 6, int(rng.integers(18, 28))):
            x, y = L[i]; j, k = gidx(x, y)
            if GMAG[j, k] < 0.3 or not HAB[j, k]: continue
            gx_, gy_ = float(gxg[j, k]), float(gyg[j, k]); m = math.hypot(gx_, gy_); dx, dy = gx_ / m, gy_ / m
            if rng.random() < 0.5: dx, dy = -dx, -dy
            pts = [(x, y)]; ok = False
            for st in range(1, 14):
                x += dx * 3.0; y += dy * 3.0; j, k = gidx(x, y)
                if not (0 <= j < HAB.shape[0] and 0 <= k < HAB.shape[1]) or not HAB[j, k]: break
                pts.append((x, y)); c = (int(x // (DSEP * 0.9)), int(y // (DSEP * 0.9)))
                hit = False
                for gx2 in (c[0] - 1, c[0], c[0] + 1):
                    for gy2 in (c[1] - 1, c[1], c[1] + 1):
                        for (px, py, l2, i2) in SGRID.get((gx2, gy2), ()):
                            if l2 != lid and (px - x) ** 2 + (py - y) ** 2 < 4.8 ** 2: hit = True
                if hit: ok = True; break
            if ok and len(pts) >= 3:
                STAIRS.append(np.array(pts))
                for (px, py) in pts: STAIRCELL.setdefault((int(px // 5), int(py // 5)), []).append((px, py))
stairs(); log(f'stairs {len(STAIRS)}')

# ---- houses along a street (both sides); occupancy keeps them from overlapping
OCC = {}
def occupied(x, y, r):
    cx0, cy0 = int(x // 7), int(y // 7)
    for gx_ in (cx0 - 1, cx0, cx0 + 1):
        for gy_ in (cy0 - 1, cy0, cy0 + 1):
            for (px, py, pr) in OCC.get((gx_, gy_), ()):
                if (px - x) ** 2 + (py - y) ** 2 < (r + pr) ** 2: return True
    return False
def near_stairs(x, y):
    cx0, cy0 = int(x // 5), int(y // 5)
    for gx_ in (cx0 - 1, cx0, cx0 + 1):
        for gy_ in (cy0 - 1, cy0, cy0 + 1):
            for (px, py) in STAIRCELL.get((gx_, gy_), ()):
                if (px - x) ** 2 + (py - y) ** 2 < 3.8 ** 2: return True
    return False
def along(P, upper):
    """Candidate houses along polyline P (n,2): rows of attached houses with a street between."""
    seg = np.hypot(*np.diff(P, axis=0).T); S_ = np.concatenate([[0], np.cumsum(seg)]); Lt = S_[-1]; out = []
    if Lt < 14: return out
    T = np.gradient(P, axis=0); T = T / (np.hypot(T[:, 0], T[:, 1])[:, None] + 1e-9)
    for side in (-1, 1):
        s = rng.uniform(0, 5.0)
        while s < Lt - 5:
            big = rng.random() < (0.10 if upper else 0.08); w = rng.uniform(11, 18) if big else (rng.uniform(7.5, 13.0) if upper else rng.uniform(5.0, 10.0)); d = rng.uniform(7.5, 9.2)
            if rng.random() < 0.06: s += rng.uniform(2.5, 5.0); continue
            sc_ = s + w / 2; i = min(int(np.searchsorted(S_, sc_)), len(P) - 1); t = T[i]; nx, ny = -t[1], t[0]; off = side * ((2.6 if upper else 2.3) + d / 2)
            out.append((P[i][0] + nx * off, P[i][1] + ny * off, w, d, math.atan2(t[1], t[0]))); s += w * 0.97
    return out
def accept(cands, upper, bridges=None):
    keep = []
    for (x, y, w, d, yaw) in cands:
        j, k = gidx(x, y)
        if not (0 <= j < HAB.shape[0] and 0 <= k < HAB.shape[1]): continue
        if not upper:
            if not HAB[j, k] or rng.random() > DENS[j, k]: continue
        else:
            if SLP[j, k] > 0.12: continue
        r = 0.47 * math.sqrt(w * d)
        if occupied(x, y, r) or near_stairs(x, y): continue
        keep.append((x, y, w, d, yaw)); OCC.setdefault((int(x // 7), int(y // 7)), []).append((x, y, r))
    return keep

load('sh_upper.py')

def bridge_lines():
    out = []
    for a, ka, b, kb in W.BRIDGES: out.append((np.array(W.PEAK[a]['anchor']), np.array(W.PEAK[b]['anchor'])))
    return out
BL = bridge_lines()
def fabric():
    cand = []
    for L_ in LINES: cand += along(L_, False)
    log(f'under candidate houses {len(cand)}'); rng.shuffle(cand)
    under = accept(cand, False)
    A = np.array(under); upf = np.zeros(len(under))
    cx, cy, w, d, yaw = A.T; gz = H(cx, cy); fl = W.near(cx, cy)[1]
    log(f'houses: under {len(under)}')
    streets = [np.column_stack([L_[::2, 0], L_[::2, 1], np.full(len(L_[::2]), 4.4)]) for L_ in LINES] + [np.column_stack([L_[:, 0], L_[:, 1], np.full(len(L_), 2.8)]) for L_ in STAIRS] + [np.column_stack([L_[::2, 0], L_[::2, 1], np.full(len(L_[::2]), 8.0)]) for L_ in ULINES]
    return (cx, cy, w, d, yaw, gz, fl, upf), streets

def build_houses():
    (cx, cy, w, d, yaw, gz, fl, upf), streets = fabric(); n = len(cx); upf = upf > 0.5; log(f'houses {n}')
    kind = rng.random(n) < 0.35                                  # gable to the street (tall and narrow) or ridge along it
    a = np.where(kind, d, w); b = np.where(kind, w, d); yw = np.where(kind, yaw + PI / 2, yaw)
    ca, sa = np.cos(yw), np.sin(yw)
    zs = np.stack([H(cx + ca * u - sa * v, cy + sa * u + ca * v) for u, v in ((0, 0), (a / 2, b / 2), (-a / 2, b / 2), (a / 2, -b / 2), (-a / 2, -b / 2))])
    zmin = zs.min(0); low = gz - fl
    z0 = np.floor(zs.mean(0) / STOREY + 0.5) * STOREY
    floors = np.where(low < 50, rng.integers(3, 7, n), rng.integers(2, 5, n)) + (a * b > 110) * rng.integers(0, 2, n)
    floors = np.where(upf, rng.integers(3, 6, n), floors)
    zt = z0 + floors * STOREY + rng.uniform(-0.2, 0.2, n); zb = zmin - 1.4
    rh = np.clip(b * rng.uniform(0.32, 0.5, n), 2.2, 6.0); zr = zt + rh
    zone = ((low > 52) | (rng.random(n) < 0.12)) & ~upf
    tone = np.where(zone | upf, rng.uniform(0.2, 1.0, n), rng.uniform(0.0, 0.7, n)); lit = rng.uniform(0.35, 1.0, n)
    cvec = np.stack([tone, lit, np.zeros(n), np.ones(n)], 1)
    def R(lx, ly): x, y = rotz(lx, ly, yw); return cx + x, cy + y
    corners = [(-a / 2, -b / 2), (a / 2, -b / 2), (a / 2, b / 2), (-a / 2, b / 2)]
    W4 = []; U4 = []
    for k in range(4):
        (x0, y0), (x1, y1) = corners[k], corners[(k + 1) % 4]; L = np.hypot(x1 - x0, y1 - y0); X0, Y0_ = R(x0, y0); X1, Y1_ = R(x1, y1)
        W4.append(np.stack([np.stack([X0, Y0_, zb], 1), np.stack([X1, Y1_, zb], 1), np.stack([X1, Y1_, zt], 1), np.stack([X0, Y0_, zt], 1)], 1))
        U4.append(np.stack([np.stack([np.zeros(n), zb - z0], 1), np.stack([L, zb - z0], 1), np.stack([L, zt - z0], 1), np.stack([np.zeros(n), zt - z0], 1)], 1))
    walls = np.concatenate(W4); uvs = np.concatenate(U4); cw = np.concatenate([cvec] * 4)
    gabs = []
    for sx in (-1, 1):
        X0, Y0_ = R(sx * a / 2, -b / 2); X1, Y1_ = R(sx * a / 2, b / 2); Xm, Ym = R(sx * a / 2, 0 * a)
        gabs.append(np.stack([np.stack([X0, Y0_, zt], 1), np.stack([X1, Y1_, zt], 1), np.stack([Xm, Ym, zr], 1)], 1))
    gab = np.concatenate(gabs); gu = np.concatenate([np.stack([np.stack([np.zeros(n), zt - z0], 1), np.stack([b, zt - z0], 1), np.stack([b / 2, zr - z0], 1)], 1)] * 2); gc = np.concatenate([cvec] * 2)
    roofs = []; ov = 0.45
    for sy in (-1, 1):
        xa, ya = R(-a / 2 - ov, sy * (b / 2 + ov)); xb, yb = R(a / 2 + ov, sy * (b / 2 + ov)); xc_, yc_ = R(a / 2 + ov, 0 * a); xd, yd = R(-a / 2 - ov, 0 * a)
        roofs.append(np.stack([np.stack([xa, ya, zt - 0.5 * ov], 1), np.stack([xb, yb, zt - 0.5 * ov], 1), np.stack([xc_, yc_, zr + 0.1], 1), np.stack([xd, yd, zr + 0.1], 1)], 1))
    roof = np.concatenate(roofs); rc = np.concatenate([cvec] * 2)
    ch = rng.random(n) < 0.33; xs, ys = R(a * 0.28, b * 0.12); xs = xs[ch]; ys = ys[ch]; zc0 = (zt - 1.0)[ch]; zc1 = (zr + 1.9)[ch]; yc_ = yw[ch]; s = 0.45
    def box_faces(x, y, za, zb_, sx, yaw_):
        c, sn = np.cos(yaw_), np.sin(yaw_); q = [(-sx, -sx), (sx, -sx), (sx, sx), (-sx, sx)]; Q = [(x + px * c - py * sn, y + px * sn + py * c) for px, py in q]
        faces = [np.stack([np.stack([Q[i][0], Q[i][1], za], 1), np.stack([Q[(i + 1) % 4][0], Q[(i + 1) % 4][1], za], 1), np.stack([Q[(i + 1) % 4][0], Q[(i + 1) % 4][1], zb_], 1), np.stack([Q[i][0], Q[i][1], zb_], 1)], 1) for i in range(4)]
        faces.append(np.stack([np.stack([Q[i][0], Q[i][1], zb_], 1) for i in range(4)], 1)); return np.concatenate(faces)
    chim = box_faces(xs, ys, zc0, zc1, s, yc_)
    for nm, sel_house, wm, rm in (('slum', ~zone & ~upf, 'slumwall', 'slumroof'), ('mid', zone, 'midwall', 'midroof'), ('up', upf, 'upperwall', 'uproof')):
        sw = np.tile(sel_house, 4); sg = np.tile(sel_house, 2)
        mk_obj(nm + '_walls', walls[sw], wm, uvs[sw], cw[sw]); mk_obj(nm + '_gables', gab[sg], wm, gu[sg], gc[sg]); mk_obj(nm + '_roofs', roof[sg], rm, None, rc[sg])
    mk_obj('chimneys', chim, 'dstone')
    # street surfaces follow the ground (vectorised: one quad per segment)
    X0, Y0, W0, X1, Y1, W1 = [], [], [], [], [], []
    for st in streets: X0.append(st[:-1, 0]); Y0.append(st[:-1, 1]); W0.append(st[:-1, 2]); X1.append(st[1:, 0]); Y1.append(st[1:, 1])
    x0, y0, w0, x1, y1 = [np.concatenate(v) for v in (X0, Y0, W0, X1, Y1)]; dx, dy = x1 - x0, y1 - y0; Lq = np.hypot(dx, dy) + 1e-9; px, py = -dy / Lq * w0 / 2, dx / Lq * w0 / 2; z0_, z1_ = H(x0, y0) + 0.35, H(x1, y1) + 0.35
    mk_obj('streets', np.stack([np.stack([x0 - px, y0 - py, z0_], 1), np.stack([x0 + px, y0 + py, z0_], 1), np.stack([x1 + px, y1 + py, z1_], 1), np.stack([x1 - px, y1 - py, z1_], 1)], 1), 'street')
    return cx, cy, zt, zr, ch, zs, yw, a, b

# ---- smoke from some chimneys, in leaning columns
def smoke(cx, cy, zr, ch, a, b, yw):
    idx = np.where(ch)[0]; idx = idx[rng.random(len(idx)) < 0.05]; log(f'smoke columns {len(idx)}')
    ico = np.array([[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 5], [0, 5, 1], [6, 2, 1], [6, 3, 2], [6, 4, 3], [6, 5, 4], [6, 1, 5]])
    ang = np.linspace(0, 2 * PI, 5, endpoint=False); vt = np.array([[0, 0, 1]] + [[math.cos(t), math.sin(t), 0.2 * (-1) ** i] for i, t in enumerate(ang)] + [[0, 0, -1]], float)
    tri = [];
    for i in idx:
        x, y = cx[i], cy[i]; z = zr[i] + 2.0; r = 0.9
        for k in range(8):
            r *= 1.19; z += r * 1.3; x += 1.6 + rng.normal(0, 0.4); y += 0.6 + rng.normal(0, 0.4)
            c = np.array([x, y, z]); s = vt * [r, r, r * 0.9] + c; tri.append(s[ico])
    if tri: mk_obj('smoke', np.concatenate(tri), 'smoke', smooth=False)

cx, cy, zt, zr, ch, zs, yw, a, b = build_houses(); smoke(cx, cy, zr, ch, a, b, yw)

# ---- the upper city's blocks: big masonry, flat roofs (some green), spires on the tall ones; floors rise away from the rim
def cone_tris(x, y, z0, rad, hgt, seg=8):
    n = len(x); ang = np.arange(seg) * 2 * math.pi / seg; ang2 = ang + 2 * math.pi / seg
    A = np.stack([x[:, None] + rad[:, None] * np.cos(ang), y[:, None] + rad[:, None] * np.sin(ang), np.broadcast_to(z0[:, None], (n, seg))], -1); B = np.stack([x[:, None] + rad[:, None] * np.cos(ang2), y[:, None] + rad[:, None] * np.sin(ang2), np.broadcast_to(z0[:, None], (n, seg))], -1)
    T = np.stack([np.broadcast_to(x[:, None], (n, seg)), np.broadcast_to(y[:, None], (n, seg)), np.broadcast_to((z0 + hgt)[:, None], (n, seg))], -1)
    return np.stack([A, B, T], 2).reshape(-1, 3, 3)
def build_upper_houses(cands):
    r = np.random.default_rng(78); n = len(cands)
    if n == 0: return
    Ar = np.array(cands); cx, cy, w, d, yaw = Ar.T
    j = np.clip(((cy - GY0) / GC + 0.5).astype(int), 0, HAB.shape[0] - 1); k = np.clip(((cx - GX0) / GC + 0.5).astype(int), 0, HAB.shape[1] - 1); dop = DOWN[j, k]; z0 = OWNU[j, k] + 0.2; crd = CRU[j, k]
    fl = np.clip(np.round(5 + (dop - 38) / 17.0 + r.normal(0, 2.0, n)), 3, 18)
    def sdist(x0, y0, x1, y1):
        dx, dy = x1 - x0, y1 - y0; t = np.clip(((cx - x0) * dx + (cy - y0) * dy) / (dx * dx + dy * dy + 1e-9), 0, 1); return np.hypot(cx - (x0 + t * dx), cy - (y0 + t * dy))
    dh = np.min([sdist(x0, y0, x1, y1) - hw for x0, y0, x1, y1, hw in HEROES_C], axis=0); fl = np.where(dh < 70, np.minimum(fl, 8), fl)     # the great buildings stand over a lower fabric
    tall = r.random(n) < 0.07; fl = np.where(tall & (dh > 70), fl + r.integers(4, 9, n), fl)
    flat = r.random(n) < 0.74; green = flat & (r.random(n) < 0.2); a = w; b = d
    zb = z0 - 0.8; zt = z0 + fl * STOREY; rh = np.where(flat, 0.45, np.clip(np.minimum(w, d) * r.uniform(0.26, 0.36, n), 3.0, 6.5)); zr = zt + rh
    tone = r.uniform(0.15, 1.0, n); lit = r.uniform(0.45, 1.0, n); cvec = np.stack([tone, lit, np.zeros(n), np.ones(n)], 1); ca, sa = np.cos(yaw), np.sin(yaw)
    def R(lx, ly): return cx + lx * ca - ly * sa, cy + lx * sa + ly * ca
    corners = [(-a / 2, -b / 2), (a / 2, -b / 2), (a / 2, b / 2), (-a / 2, b / 2)]; W4 = []; U4 = []
    for q in range(4):
        (x0, y0), (x1, y1) = corners[q], corners[(q + 1) % 4]; L = np.hypot(x1 - x0, y1 - y0); X0, Y0_ = R(x0, y0); X1, Y1_ = R(x1, y1)
        W4.append(np.stack([np.stack([X0, Y0_, zb], 1), np.stack([X1, Y1_, zb], 1), np.stack([X1, Y1_, zt], 1), np.stack([X0, Y0_, zt], 1)], 1)); U4.append(np.stack([np.stack([np.zeros(n), zb - z0], 1), np.stack([L, zb - z0], 1), np.stack([L, zt - z0], 1), np.stack([np.zeros(n), zt - z0], 1)], 1))
    walls = np.concatenate(W4); uvs = np.concatenate(U4); cw = np.concatenate([cvec] * 4); gabs = []
    for sx in (-1, 1):
        X0, Y0_ = R(sx * a / 2, -b / 2); X1, Y1_ = R(sx * a / 2, b / 2); Xm, Ym = R(sx * a / 2, 0 * a); gabs.append(np.stack([np.stack([X0, Y0_, zt], 1), np.stack([X1, Y1_, zt], 1), np.stack([Xm, Ym, zr], 1)], 1))
    gab = np.concatenate(gabs); gu = np.concatenate([np.stack([np.stack([np.zeros(n), zt - z0], 1), np.stack([b, zt - z0], 1), np.stack([b / 2, zr - z0], 1)], 1)] * 2); gc = np.concatenate([cvec] * 2); roofs = []; ov = 0.9
    for sy in (-1, 1):
        xa, ya = R(-a / 2 - ov, sy * (b / 2 + ov)); xb, yb = R(a / 2 + ov, sy * (b / 2 + ov)); xc_, yc_ = R(a / 2 + ov, 0 * a); xd, yd = R(-a / 2 - ov, 0 * a)
        roofs.append(np.stack([np.stack([xa, ya, zt - 0.5 * ov], 1), np.stack([xb, yb, zt - 0.5 * ov], 1), np.stack([xc_, yc_, zr + 0.1], 1), np.stack([xd, yd, zr + 0.1], 1)], 1))
    roof = np.concatenate(roofs); rc = np.concatenate([cvec] * 2)
    mk_obj('up_walls', walls, 'upperwall', uvs, cw); mk_obj('up_gables', gab, 'upperwall', gu, gc)
    for nm, sel, mat in (('up_roof', ~flat, 'uproof'), ('up_flat', flat & ~green, 'upflat'), ('up_green', green, 'greenroof')):
        sg = np.tile(sel, 2); mk_obj(nm, roof[sg], mat, None, rc[sg])
    sp = (fl >= 9) & (r.random(n) < 0.55) | (r.random(n) < 0.03)
    if sp.any(): mk_obj('up_spires', cone_tris(cx[sp], cy[sp], zr[sp], np.minimum(w, d)[sp] * 0.28, r.uniform(11, 26, int(sp.sum())), 8), 'copper', smooth=False)
    log(f'upper houses {n}: floors mean {fl.mean():.1f}, flat {flat.mean() * 100:.0f}% (green {green.mean() * 100:.0f}%), spires {int(sp.sum())}')

UPK = accept_up(UPC); build_upper_houses(UPK)
if opt('--dbg'): np.savez(os.path.join(OUT, 'dbg_upper.npz'), habu=HABU, own=OWNU, down=DOWN, lots=np.array(UPK), x0=GX0, y0=GY0, gc=GC, streets=np.array([np.array(l) for l in ULINES], dtype=object), plz=np.array([[q['x'], q['y'], q['r']] for q in UPL]), parks=np.array([[q['x'], q['y'], q['r']] for q in PARKS]))

# ---- forest: conifers on the slopes round the city (not on the city's ground, not on the platforms), thinning to the tree line; the lake's shore gets them too
def build_forest():
    rg = np.random.default_rng(11); N = int(opt('--tcand', 520000)); X = rg.uniform(-3800, 3800, N); Y = rg.uniform(-3800, 3800, N); Z = H(X, Y); sl = slope(X, Y)
    near_ = W.near(X, Y); fl_ = near_[1]; dens = np.clip(0.55 + 0.9 * W.gn(X * 0.0045, Y * 0.0045, 91), 0, 1); line = 1 - sst(470, 640, Z + 40 * W.gn(X * 0.01, Y * 0.01, 92))
    lake = (Y > W.DAM_Y + 6) & (Z < W.LAKE_Z + 1.5)
    ok = (sl < 0.62) & (rg.random(N) < dens * line * 0.75) & ~lake & (Z > fl_ + 4)
    jj = np.clip(((Y - GY0) / GC + 0.5).astype(int), 0, HAB.shape[0] - 1); kk = np.clip(((X - GX0) / GC + 0.5).astype(int), 0, HAB.shape[1] - 1); ok &= ~HAB[jj, kk]
    for p in W.PLATS.values():
        b = p['bb']; m = ok & (X > b[0] - 60) & (X < b[1] + 60) & (Y > b[2] - 60) & (Y < b[3] + 60)
        if m.any(): ok[m] &= W.poly_sdf(X[m], Y[m], p['poly']) > (60 if p['tier'] > 0 and not p['peak'].startswith('K') else 30)
    for q in PLAZAS:
        m = ok & (np.abs(X - q['x']) < q['r'] + 20) & (np.abs(Y - q['y']) < q['r'] + 20)
        if m.any(): ok[m] &= np.hypot(X[m] - q['x'], Y[m] - q['y']) > q['r'] + 14
    x, y, z = X[ok], Y[ok], Z[ok]; n = len(x); hgt = rg.uniform(8, 17, n) * (1 - 0.35 * sst(300, 640, z)); rad = hgt * rg.uniform(0.22, 0.3, n); yaw0 = rg.uniform(0, 6.28, n)
    ang = yaw0[:, None] + np.arange(6)[None, :] * (2 * math.pi / 6); ang2 = ang + 2 * math.pi / 6
    def cone(zb, r, ztop):
        a = np.stack([x[:, None] + r[:, None] * np.cos(ang), y[:, None] + r[:, None] * np.sin(ang), np.broadcast_to(zb[:, None], ang.shape)], -1); b = np.stack([x[:, None] + r[:, None] * np.cos(ang2), y[:, None] + r[:, None] * np.sin(ang2), np.broadcast_to(zb[:, None], ang.shape)], -1)
        t = np.stack([np.broadcast_to(x[:, None], ang.shape), np.broadcast_to(y[:, None], ang.shape), np.broadcast_to(ztop[:, None], ang.shape)], -1)
        return np.stack([a, b, t], 2).reshape(-1, 3, 3)
    P = np.concatenate([cone(z - 0.6, rad, z + hgt * 0.62), cone(z + hgt * 0.35, rad * 0.72, z + hgt)])
    mk_obj('forest', P, 'conifer'); log(f'forest {n} trees')
build_forest()
