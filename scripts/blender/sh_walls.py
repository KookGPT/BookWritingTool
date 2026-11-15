# Platform walls, paving and palazzo rings of Stones Hold (exec'd inside stones_hold.py).
# A platform is a flat-topped shoulder (polygon, height h) whose fill falls away at slope K to the natural rock. The masonry skin lies exactly on that fill:
# its face at height z stands (h - z) / K outside the rim line, so it is a battered retaining wall from the true ground up to the top, never a floating panel.
MATS['winlit'] = simple('winlit', (1, 0.6, 0.25), 0.4, emit=((1.0, 0.5, 0.16), 14.0)); MATS['windark'] = simple('windark', (0.012, 0.014, 0.02), 0.2)
MATS['pave'] = simple('pave', (0.09, 0.085, 0.08), 0.8, noise_bump=0.35, scale=1.6)
def pwin(f, o, lit, depth=0.5):
    lpoly(f, arch_pts(o['uc'], o['ww'], o['sill'], o['spring'], o['rise'], 6), -depth, -depth + 0.06, 'winlit' if lit else 'windark')
    arch_band(f, o, 0.35, 0.0, 0.3, 'pale')

def poly_area(p): return 0.5 * sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1] for i in range(len(p)))
def inset(poly, d):
    """Shrink a polygon by d along its vertex normals (miter)."""
    P = np.array(poly, float)
    if poly_area(poly) < 0: P = P[::-1]
    n = len(P); out = []
    for i in range(n):
        a = P[i - 1]; b = P[i]; c = P[(i + 1) % n]; t1 = (b - a) / (np.hypot(*(b - a)) + 1e-9); t2 = (c - b) / (np.hypot(*(c - b)) + 1e-9); n1 = np.array([-t1[1], t1[0]]); n2 = np.array([-t2[1], t2[0]]); m = n1 + n2; k = np.hypot(*m)
        m = m / (k + 1e-9); cs = max(0.35, float(m @ n1)); q = b + m * d / cs; out.append((float(q[0]), float(q[1])))
    return out
NG = None
def M_only(x, y):
    global NG
    if NG is None:
        f = os.path.join(CACHE, f'ng_{_WKEY}_{GC}.npy')
        if os.path.exists(f): NG = np.load(f)
        else: X, Y = np.meshgrid(_gxs, _gys); sh = X.shape; x_ = X.ravel(); y_ = Y.ravel(); out = np.empty(len(x_), np.float32); [out.__setitem__(slice(c, c + 400000), W.natural(x_[c:c + 400000], y_[c:c + 400000])) for c in range(0, len(x_), 400000)]; NG = out.reshape(sh); np.save(f, NG)
    x = np.asarray(x, float); y = np.asarray(y, float); fx = np.clip((x - GX0) / GC, 0, NG.shape[1] - 1.001); fy = np.clip((y - GY0) / GC, 0, NG.shape[0] - 1.001); ix = fx.astype(int); iy = fy.astype(int); tx = fx - ix; ty = fy - iy
    return NG[iy, ix] * (1 - tx) * (1 - ty) + NG[iy, ix + 1] * tx * (1 - ty) + NG[iy + 1, ix] * (1 - tx) * ty + NG[iy + 1, ix + 1] * tx * ty

PLAT_INFO = {}      # name -> dict(rim=[(x, y, nx, ny, foot)] , edges=[...]) for the heroes to use
def platform_wall(name, p):
    pts = p['poly']; h = p['h']; K = p['K']; sgn = 1; info = dict(h=h, edges=[]); worst = (0, None)
    if poly_area(pts) < 0: pts = pts[::-1]
    for i in range(len(pts)):
        p0 = pts[i]; p1 = pts[(i + 1) % len(pts)]; dx, dy = p1[0] - p0[0], p1[1] - p0[1]; L = math.hypot(dx, dy); ux, uy = dx / L, dy / L; nx, ny = uy * sgn, -ux * sgn   # outward normal
        n = max(1, int(round(L / 22.0))); step = L / n
        for k in range(n):
            ua, ub = k * step, (k + 1) * step; ts = np.linspace(0, (h + 30) / K, 70)
            feet = []
            for uu in (ua, (ua + ub) / 2, ub):
                X = p0[0] + ux * uu + nx * ts; Y = p0[1] + uy * uu + ny * ts; Mg = M_only(X, Y); hit = np.where(h - K * ts <= Mg + 0.3)[0]
                feet.append(h - K * ts[hit[0]] if len(hit) else h - K * ts[-1])
            zf = min(feet); mx_, my_ = p0[0] + ux * (ua + ub) / 2 + nx * 4.0, p0[1] + uy * (ua + ub) / 2 + ny * 4.0
            for q in W.PLATS.values():                         # a lower tier right outside: the wall stops on its terrace
                if q is not p and q['h'] < h and q['bb'][0] - 10 < mx_ < q['bb'][1] + 10 and q['bb'][2] - 10 < my_ < q['bb'][3] + 10 and float(W.poly_sdf(mx_, my_, q['poly'])) < 0: zf = max(zf, q['h'])
            if any(q is not p and q['h'] >= h - 0.5 and q['bb'][0] - 10 < mx_ < q['bb'][1] + 10 and q['bb'][2] - 10 < my_ < q['bb'][3] + 10 and float(W.poly_sdf(mx_, my_, q['poly'])) < 0 for q in W.PLATS.values()): continue   # inside a neighbouring platform at this level or higher: no wall (the terraces of a block merge)
            if h - zf < 8: continue
            f = F((p0[0] + ux * ua, p0[1] + uy * ua, 0.0), math.atan2(-nx, ny) if False else math.atan2(nx, -ny)); wl = step
            # F frame: u along the edge, v up, w outward (yaw so that local w points along (nx, ny)); check orientation once
            dl = lambda v: (h - v) / K + 0.35
            top = h
            fprism(f, [(dl(top), top), (dl(zf), zf - 3), (-3.0, zf - 3), (-3.0, top)], 0, wl, 'wallstone')
            info['edges'].append(dict(p0=(p0[0] + ux * ua, p0[1] + uy * ua), u=(ux, uy), n=(nx, ny), L=wl, zf=zf, f=f))
            if h - zf > worst[0]: worst = (h - zf, info['edges'][-1])
    # detailing along each skin panel
    for e in info['edges']:
        f = e['f']; L = e['L']; zf = e['zf']; hh = h - zf; dl = lambda v: (h - v) / K + 0.35
        # pilaster at the start of every panel and string courses every ~26 m
        for u in (0.0, L):
            fprism(f, [(dl(h) , h), (dl(h) + 2.3, h - 0.6), (dl(zf) + 2.3, zf - 3), (dl(zf), zf - 3)], u - 1.7 if u > 0 else u - 1.7, u + 1.7, 'wallstone')
        nb = int(hh // 26)
        for kb in range(1, nb + 1):
            v = h - kb * 26.0 + 0.0
            if v > zf + 2: fprism(f, [(dl(v), v), (dl(v) + 0.9, v), (dl(v) + 0.9, v - 0.5), (dl(v - 0.5), v - 0.5)], 0, L, 'wallstone')
        # tall lit pointed windows in a band under the parapet and further bands down, alternating with the pilasters
        for kb in range(0, min(6, int(hh // 26))):
            vtop = h - 7.0 - kb * 26.0; wv = 8.0 if kb == 0 else 6.5
            if vtop - wv < zf + 3: break
            nw = max(1, int(L // 9.0))
            for j in range(nw):
                uc = (j + 0.5) * L / nw
                if uc < 2.6 or uc > L - 2.6 or RNG.random() < 0.4: continue
                o = op(uc, 3.2, vtop - wv, vtop - wv * 0.4, 2.6, 6); fx = F(f.p(0, 0, 0), f.yaw)
                lpoly(f, arch_pts(uc, 3.2, vtop - wv, vtop - wv * 0.4, 2.6, 6), dl(vtop - wv * 0.6) - 0.15, dl(vtop - wv * 0.6) + 0.05, 'winlit' if RNG.random() < 0.38 else 'windark')
                arch_band(f, o, 0.32, dl(vtop - wv * 0.6) + 0.0, dl(vtop - wv * 0.6) + 0.28, 'wallstone')
        # parapet: corbels, crenellation, lamps
        fp = F(f.p(0, 0, 0), f.yaw); wt = dl(h)
        lbox(f, 0, L, h - 0.2, h + 0.5, 0.0, wt + 1.6, 'wallstone'); corbels(f, 0, L, h - 0.4, proj=wt + 1.4, sp=1.3, rows=3)
        crenel(f, 0, L, h + 0.5, 2.0, 1.5, 1.4, 1.1, wt + 1.0)
        for j in range(max(1, int(L // 11))):
            x, y, z = f.p((j + 0.5) * L / max(1, int(L // 11)), h + 0.6, wt + 0.4)
            if j % 2 == 0 and p['tier'] in (1, 2): lstatue(f, (j + 0.5) * L / max(1, int(L // 11)), h + 2.0, wt + 0.4, 6.0, ('saint', 'king', 'angel', 'knight')[(j // 2 + int(L)) % 4], 'pale')   # the rim's row of figures
            else: lamp(x, y, z + 1.0, 0.24)
    if p['tier'] in (1, 2):
        for k, e in enumerate(info['edges']):                  # the upper city's palazzo ring along the rim, facing out over the under city
            if k % 4 == 3 or e['L'] < 14: continue
            fo = F((e['f'].p(0, 0, -6.0)[0], e['f'].p(0, 0, -6.0)[1], h), e['f'].yaw); palazzo(fo, e['L'], RNG.choice([18, 23, 29, 36]), RNG.choice([24.0, 28.0, 32.0]), RNG.choice(['slate', 'copper', 'tile']), None, 0.55)
    PLAT_INFO[name] = info; return worst

def platform_top(name, p):
    pts = p['poly']; h = p['h']; ins = inset(pts, 4.0); cx = sum(q[0] for q in ins) / len(ins); cy = sum(q[1] for q in ins) / len(ins)
    holes = [q for q in W.PLATS.values() if q is not p and q['peak'] == p['peak'] and q['h'] < h - 1 and float(W.poly_sdf(sum(v[0] for v in q['poly']) / len(q['poly']), sum(v[1] for v in q['poly']) / len(q['poly']), pts)) < -10]
    if not holes: ppoly('pave', [(x, y, h + 0.12) for x, y in ins])
    else:                                                       # a rim around a lower floor (the arena's bowl): pave only the ring, cell by cell
        b = p['bb']; xs = np.arange(b[0], b[1], 6.0); ys = np.arange(b[2], b[3], 6.0); X, Y = np.meshgrid(xs + 3.0, ys + 3.0); ok = W.poly_sdf(X, Y, ins) < 0
        for q in holes: ok &= W.poly_sdf(X, Y, q['poly']) > 3.0
        for j, i in zip(*np.where(ok)): x0, y0 = xs[i], ys[j]; ppoly('pave', [(x0, y0, h + 0.12), (x0 + 6.0, y0, h + 0.12), (x0 + 6.0, y0 + 6.0, h + 0.12), (x0, y0 + 6.0, h + 0.12)])
    return (cx, cy)

# palazzo: a long pale-stone block with two bands of arched windows, string courses, a mansard-ish roof and a cornice, facing outward (w = out of the facade)
def palazzo(f, L, Hh, depth=22.0, roof='slate', tiers=None, lit=0.5, pilast=True):
    ops = []; nb = max(1, int(L // 7.0)); fl = max(2, int(Hh // 7.5)); tier_h = Hh / fl
    for r in range(fl):
        v0 = r * tier_h
        for j in range(nb):
            uc = (j + 0.5) * L / nb; ops.append(((r, j), op(uc, 2.3 if r else 2.5, v0 + 1.2, v0 + tier_h * 0.62, 1.4 if r else 1.2, 5), v0))
    lbox(f, 0, L, 0, Hh, -depth, 0, 'pale')
    for (r, j), o, v0 in ops: pwin(f, o, RNG.random() < lit, 0.0)
    for r in range(1, fl): string_course(f, -0.3, L + 0.3, r * tier_h - 0.3, 0.55, 0.45, 'pale')
    string_course(f, -0.4, L + 0.4, Hh - 0.8, 1.2, 1.0, 'pale'); corbels(f, 0, L, Hh - 0.8, proj=0.9, sp=1.2, rows=2)
    if pilast:
        for j in range(nb + 1): lbox(f, j * L / nb - 0.5, j * L / nb + 0.5, 0, Hh - 0.8, 0, 0.5, 'pale')
    lpoly(f, [(0.0, Hh), (L, Hh)] + [(L, Hh), (L, Hh)], 0, 0, roof) if False else None
    prism3d(roof, [f.p(-0.6, Hh, 0.9), f.p(L + 0.6, Hh, 0.9), f.p(L + 0.6, Hh, -depth - 0.6), f.p(-0.6, Hh, -depth - 0.6)], (0, 0, 3.6))
    for j in range(max(1, int(L // 16))):
        uc = (j + 0.5) * L / max(1, int(L // 16)); lbox(f, uc - 1.0, uc + 1.0, Hh + 0.5, Hh + 4.4, -4.0, -2.6, 'pale')
        x, y, z = f.p(uc, Hh + 4.4, -3.3); cyl('stone', (x, y, z), 0.5, 0.5, 4.0, 6)
def build_platforms():
    for name, p in W.PLATS.items():
        worst = platform_wall(name, p); c = platform_top(name, p); log(f'wall {name}: tallest skin {worst[0]:.0f} m')
    return

if not opt('--hero'): build_platforms()
