# Hero structures of Stones Hold (exec'd inside stones_hold.py). Each is built at the origin facing south (-y) and moved with placed(origin, yaw, scale).
# Every one is a different design: Gothic cathedral (BLN-2 reuse), St Peter's style basilica + colonnade, Sagrada-style rival cathedral, arch dam with spillways,
# great viaducts, colossal statues, a domed palace, hanging-garden terraces, a spired citadel, a needle temple.
MATS['pale'] = MATS['pale']; MATS['fruit'] = simple('fruit', (0.9, 0.35, 0.1), 0.35, 0.6)
MATS['teal'] = simple('teal', (0.1, 0.45, 0.42), 0.35, 0.6)
HEROTEST = opt('--hero')

# ---------------------------------------------------------------- generic parts
def loft(m, rings, seg, smooth=True, cap_top=True):
    """rings: list of (z, radius_fn(angle) or radius, cx, cy). Quads between consecutive rings."""
    pts = []
    for (z, r, cx, cy) in rings:
        row = []
        for i in range(seg):
            a = 2 * PI * i / seg; rr = r(a) if callable(r) else r; row.append((cx + rr * math.cos(a), cy + rr * math.sin(a), z))
        pts.append(row)
    P = [p for row in pts for p in row]; fs = []
    for j in range(len(pts) - 1):
        for i in range(seg): a0 = j * seg + i; a1 = j * seg + (i + 1) % seg; fs.append((a0, a1, a1 + seg, a0 + seg))
    if cap_top: fs.append(tuple(range((len(pts) - 1) * seg, len(pts) * seg)))
    B(m).add(P, fs, smooth)

def bar(m, p0, p1, z0, z1, wid):
    """A rectangular beam from p0 to p1 (x, y), between heights z0 and z1, width wid (across)."""
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]; L = math.hypot(dx, dy)
    if L < 1e-6: return
    nx, ny = -dy / L * wid / 2, dx / L * wid / 2
    prism3d(m, [(p0[0] - nx, p0[1] - ny, z0), (p1[0] - nx, p1[1] - ny, z0), (p1[0] + nx, p1[1] + ny, z0), (p0[0] + nx, p0[1] + ny, z0)], (0, 0, z1 - z0))

def column(x, y, z, h, r, m='pale', tuscan=True):
    cyl(m, (x, y, z), r * 1.35, r * 1.2, 0.9, 10, 0.3); cyl(m, (x, y, z + 0.9), r * 1.05, r * 0.88, h - 2.2, 10, 0.3)
    cyl(m, (x, y, z + h - 1.3), r * 1.1, r * 1.35, 0.5, 10, 0.3); box(m, (x, y, z + h - 0.8), r * 3.0, r * 3.0, 0.8)

def dome(c, r, hh, mat='copper', ribs=16, ring_mat='pale', lantern=True, rings=9, pts_style=0):
    """A ribbed dome: the profile is a pointed ellipse so it reads at a distance; lantern with a ball and cross."""
    cx, cy, z0 = c; prof = []
    for k in range(rings + 1):
        t = k / rings; a = t * PI / 2; prof.append((r * math.cos(a) * (1 - 0.0 * t), z0 + hh * math.sin(a) ** (1.0 if pts_style == 0 else 0.8)))
    for k in range(rings):
        (r0, za), (r1, zb) = prof[k], prof[k + 1]; frustum(mat, Matrix.Translation((cx, cy, (za + zb) / 2)), r0, max(r1, 0.0), zb - za, ribs * 2, k == 0, 0.0)
    for i in range(ribs):
        a = 2 * PI * i / ribs
        for k in range(rings):
            (r0, za), (r1, zb) = prof[k], prof[k + 1]; cone_between(ring_mat, (cx + (r0 + 0.12) * math.cos(a), cy + (r0 + 0.12) * math.sin(a), za), (cx + (r1 + 0.12) * math.cos(a), cy + (r1 + 0.12) * math.sin(a), zb), r * 0.012 + 0.12, r * 0.012 + 0.12, 4, False)
    for k in (2, 5): cyl(ring_mat, (cx, cy, z0 + hh * math.sin(k / rings * PI / 2) - 0.2), prof[k][0] + 0.25, prof[k][0] + 0.25, 0.5, ribs * 2)
    if lantern:
        zt = z0 + hh; lr = r * 0.12; cyl(ring_mat, (cx, cy, zt - 0.5), lr * 1.5, lr * 1.3, 1.0, 16)
        for i in range(8):
            a = 2 * PI * i / 8; column(cx + lr * math.cos(a), cy + lr * math.sin(a), zt + 0.4, lr * 2.4, lr * 0.14, ring_mat);
        cyl('winlit', (cx, cy, zt + 0.6), lr * 0.95, lr * 0.95, lr * 1.7, 16)
        dome((cx, cy, zt + lr * 2.4), lr * 1.3, lr * 2.2, mat, 8, ring_mat, False, 5)
        zz = zt + lr * 2.4 + lr * 2.2; sph('gold', (cx, cy, zz + 0.5), lr * 0.38, seg=8); cone_between('gold', (cx, cy, zz), (cx, cy, zz + lr * 2.6), lr * 0.05, lr * 0.02, 5); cube_at('gold', (cx, cy, zz + lr * 1.9), lr * 0.8, lr * 0.05, lr * 0.05)

def cypress(x, y, z, h): cone_between('conifer', (x, y, z + h * 0.1), (x, y, z + h), h * 0.14, 0.2, 7, False)

def colossus(x, y, z, H, yaw=0.0, kind='saint', cloak='stone', base=True):
    """A robed giant with a raised staff, a book and a hooded or crowned head: lofted robe with folds, cloak, arms, hands. Feet at z."""
    c, s = math.cos(yaw), math.sin(yaw)
    def P(dx, dy, dz): return (x + dx * c - dy * s, y + dx * s + dy * c, z + dz)
    prof = [(0.0, 0.20), (0.03, 0.185), (0.12, 0.15), (0.30, 0.125), (0.46, 0.105), (0.55, 0.1), (0.62, 0.115), (0.68, 0.125), (0.72, 0.1), (0.755, 0.055), (0.78, 0.05)]
    rings = []
    for t, r in prof:
        rings.append((z + t * H, (lambda a, r=r, t=t: H * r * (1 + 0.11 * math.sin(9 * a + t * 7) + 0.05 * math.sin(17 * a - t * 11) + (0.12 * max(0, math.sin(a - yaw)) if t < 0.5 else 0))), x, y))
    loft('stone', rings, 28, True)
    # cloak falling down the back, wider than the robe
    for k in range(10):
        t0 = 0.72 - k * 0.07; t1 = t0 - 0.07
        cone_between(cloak, P(-0.02 * H, 0.1 * H, t0 * H), P(-0.01 * H, 0.15 * H, t1 * H), (0.12 + 0.012 * k) * H, (0.125 + 0.012 * k) * H, 12, False)
    for sg in (-1, 1): cone_between('stone', P(sg * 0.1 * H, 0, 0.7 * H), P(sg * 0.14 * H, -0.01 * H, 0.46 * H), 0.045 * H, 0.04 * H, 8)                 # sleeves
    cone_between('stone', P(0.105 * H, 0, 0.7 * H), P(0.17 * H, -0.09 * H, 0.9 * H), 0.045 * H, 0.032 * H, 8); sph('stone', P(0.175 * H, -0.095 * H, 0.915 * H), 0.032 * H, seg=8)   # raised arm
    cone_between('iron', P(0.175 * H, -0.095 * H, 0.35 * H), P(0.175 * H, -0.095 * H, 1.08 * H), 0.013 * H, 0.011 * H, 6)                                              # staff
    sph('gold', P(0.175 * H, -0.095 * H, 1.1 * H), 0.028 * H, seg=8); cone_between('gold', P(0.175 * H, -0.095 * H, 1.1 * H), P(0.175 * H, -0.095 * H, 1.2 * H), 0.012 * H, 0.002 * H, 5)
    cube_at('stone', P(-0.13 * H, -0.09 * H, 0.52 * H), 0.012 * H, 0.1 * H, 0.14 * H, yaw)                                                                                # book
    sph('stone', P(0, 0, 0.84 * H), 0.052 * H, (1, 1.05, 1.18), yaw, seg=10); cone_between('stone', P(0, -0.04 * H, 0.82 * H), P(0, -0.07 * H, 0.74 * H), 0.03 * H, 0.012 * H, 6)  # head, beard
    if kind == 'saint': cone_between('gold', P(0, 0.05 * H, 0.86 * H), P(0, 0.07 * H, 0.86 * H), 0.1 * H, 0.1 * H, 20, True)                                                     # halo
    else:
        for k in range(9): a = 2 * PI * k / 9; cone_between('gold', P(0.045 * H * math.cos(a), 0.045 * H * math.sin(a), 0.89 * H), P(0.055 * H * math.cos(a), 0.055 * H * math.sin(a), 0.95 * H), 0.012 * H, 0.002 * H, 4)
    # pedestal: stepped base, tall plinth with panels, cornice
    pw = 0.4 * H
    for k, (sz, hz) in enumerate(((1.0, 0.03), (0.85, 0.03), (0.72, 0.03)) if base else ()): box('pale', (x, y, z - 0.45 * H + k * 0.03 * H), pw * sz * 1.5, pw * sz * 1.5, hz * H, yaw)

def colossus_on_plinth(x, y, z, H, yaw, kind='saint'):
    ph = 0.45 * H; pw = 0.33 * H
    box('wallstone', (x, y, z), pw * 1.6, pw * 1.6, 0.04 * H, yaw); box('wallstone', (x, y, z + 0.04 * H), pw * 1.35, pw * 1.35, 0.05 * H, yaw); box('wallstone', (x, y, z + 0.09 * H), pw * 1.1, pw * 1.1, ph - 0.09 * H, yaw)
    box('pale', (x, y, z + ph - 0.03 * H), pw * 1.25, pw * 1.25, 0.03 * H, yaw)
    for k in range(4):
        a = yaw + k * PI / 2; fx, fy = x + math.cos(a) * pw * 0.56, y + math.sin(a) * pw * 0.56
        cube_at('dstone', (fx, fy, z + ph * 0.5), 0.02 * H, pw * 0.7, ph * 0.5, a + PI / 2)
    colossus(x, y, z + ph, H, yaw, kind)

# ---------------------------------------------------------------- the dam with spillways
def dam(L=430.0, crest=156.0, base=42.0, sag=40.0):
    N = 48; R = (L * L / 4 + sag * sag) / (2 * sag)
    def arcP(s): x = (s - 0.5) * L; return x, -(R - math.sqrt(max(R * R - x * x, 0))) + sag * 0.0 * 1
    for i in range(N):
        x0, y0 = arcP(i / N); x1, y1 = arcP((i + 1) / N); dx, dy = x1 - x0, y1 - y0; Ls = math.hypot(dx, dy); ux, uy = dx / Ls, dy / Ls; nx, ny = uy, -ux
        f = F((x0, y0, 0.0), math.atan2(nx, -ny))
        fprism(f, [(-6.5, crest), (6.5, crest), (6.5, crest - 4), (38.0, base + 24), (40.0, base), (-6.5, base)], 0, Ls, 'wallstone')
        for zz in (crest - 26, crest - 52): fprism(f, [(6.5 + (crest - 4 - zz) / ((crest - 4) - (base + 24)) * 31.5 + 0.0, zz), (8.6 + (crest - 4 - zz) / ((crest - 4) - (base + 24)) * 31.5, zz), (8.6 + (crest - 4 - zz) / ((crest - 4) - (base + 24)) * 31.5, zz - 1.2), (6.5 + (crest - 4 - zz) / ((crest - 4) - (base + 24)) * 31.5, zz - 1.2)], 0, Ls, 'pale')
        spill = abs(i / N - 0.5) < 0.17
        if not spill:
            lbox(f, 0, Ls, crest, crest + 1.4, -6.5, 6.5, 'pale'); crenel(f, 0, Ls, crest + 1.4, 1.0, 1.2, 1.2, 1.2, 6.2)
            if i % 2 == 0:
                x, y, z = f.p(Ls / 2, crest + 1.4, -5.5); lamp(x, y, z + 1.2, 0.3)
            if i % 4 == 0: fprism(f, [(6.5, crest - 8), (13, crest - 30), (13, base), (6.5, base)], Ls * 0.3, Ls * 0.7, 'wallstone')   # buttress
        else:
            lbox(f, 0, Ls, crest - 6, crest + 1.0, 4.0, 6.5, 'pale')
            if i % 2 == 0: lbox(f, Ls * 0.25, Ls * 0.55, crest - 2, crest + 18, -6.5, 6.5, 'pale'); lpoly(f, arch_pts(Ls * 0.4, Ls * 0.2, crest + 2, crest + 11, 3.0, 5), -6.7, 6.7, 'dstone')   # gate piers
    # spillway sheets: five falls down the downstream face with foam at the foot
    for k in range(5):
        xm = (-0.14 + 0.07 * k + 0.035) * L / 0.5 * 0.5 * 1; xm = (k - 2) * L * 0.13 * 0.5 * 1.0; xm = (k - 2) * 24.0
        x0, y0 = arcP(0.5 + xm / L); w = 8.5; P = []; segs = 10
        for j in range(segs):
            t0, t1 = j / segs, (j + 1) / segs; z0_ = crest - 3 - t0 * (crest - base - 12); z1_ = crest - 3 - t1 * (crest - base - 12)
            wf = lambda zz: 6.5 + min(max((crest - 4 - zz) / ((crest - 4) - (base + 24)), 0), 1) * 31.5 + 1.4
            yy0 = y0 - wf(z0_); yy1 = y0 - wf(z1_)
            P.append([(x0 - w, yy0, z0_), (x0 + w, yy0, z0_), (x0 + w * 1.15, yy1, z1_), (x0 - w * 1.15, yy1, z1_)])
        B('falls').add([p for q in P for p in q], [tuple(range(4 * j, 4 * j + 4)) + () for j in range(segs)] + [tuple(range(4 * j, 4 * j + 4))[::-1] for j in range(segs)])
        sph('snow', (x0, y0 - 46, base + 6), 13, (1.5, 1.5, 0.35), seg=10)
    # shoulder towers
    for sg in (-1, 1):
        x, y = arcP(0.5 + sg * 0.5)[0] - sg * 12, arcP(0.5 + sg * 0.5)[1]
        round_tower(x, y - 3, crest - 12, 11, 52, 26, 20)
    # lake side parapet walk
    return

# ---------------------------------------------------------------- great bridge between two peaks (arches stand on the real ground; deck at the tier-1 level)
def great_bridge(p0, p1, deck, thick=24.0, tag=0, gates=False):
    d = np.array(p1) - np.array(p0); L = float(np.hypot(*d)); ux, uy = d / L; yaw = math.atan2(uy, ux); sx, sy = uy, -ux       # w = right of u
    nbay = max(3, int(round(L / 78.0))); sp = L / nbay; f = F((p0[0] + sx * thick / 2, p0[1] + sy * thick / 2, 0.0), yaw)
    def G(u): return float(H(p0[0] + ux * u, p0[1] + uy * u))
    ops = []; zlo = min(G(u) for u in np.linspace(0, L, 80)) - 12
    for k in range(nbay):
        uc = (k + 0.5) * sp; g = max(G(uc - sp * 0.3), G(uc), G(uc + sp * 0.3)); rise = sp * 0.5; spring = deck - 14 - rise - 4
        if spring - 8 > g - 3.0 and spring > g + 6: ops.append(op(uc, sp * 0.7, g - 3.0, spring, rise, 12))
    wall_face(f, 0, L, zlo, deck, -thick, 0, ops, 'wallstone')
    for o in ops: arch_band(f, o, 0.9, -0.4, 0.5, 'pale', 0.0); arch_band(f, o, 1.9, -0.2, 0.2, 'pale', 0.0)
    for k in range(1, nbay):
        u = k * sp; fprism(f, [(0.0, deck - 3), (3.0, deck - 3), (7.0, zlo), (0.0, zlo)], u - 4.5, u + 4.5, 'wallstone'); fprism(f, [(-thick, deck - 3), (-thick - 3.0, deck - 3), (-thick - 7.0, zlo), (-thick, zlo)], u - 4.5, u + 4.5, 'wallstone')
    lbox(f, -1, L + 1, deck, deck + 1.3, -thick - 1.6, 1.6, 'pale'); string_course(f, -1, L + 1, deck - 3.0, 1.4, 1.2, 'pale')
    ppoly('pave', [f.p(0, deck + 1.35, -thick + 1.0), f.p(L, deck + 1.35, -thick + 1.0), f.p(L, deck + 1.35, -1.0), f.p(0, deck + 1.35, -1.0)])
    n = int(L // 7)
    for w_ in (-1.2, -thick + 1.2):
        for j in range(n + 1): x, y_, z = f.p(j * L / n, deck + 1.3, w_); cyl('pale', (x, y_, z), 0.5, 0.4, 3.2, 8)
        lbox(f, 0, L, deck + 4.5, deck + 5.3, w_ - 0.6, w_ + 0.6, 'pale')
        for j in range(0, n + 1, 2): x, y_, z = f.p(j * L / n, deck + 5.3, w_); lamp(x, y_, z + 1.2, 0.35)
    for j in range(1, nbay):
        u = j * sp; tx, ty, tz = f.p(u, deck + 1.3, -thick / 2)
        if gates:                                                       # the statue bridge's towers are gates: two piers and a lintel, the road runs through
            for w0, w1 in ((-thick + 0.6, -thick / 2 - 5.5), (-thick / 2 + 5.5, -0.6)): lbox(f, u - 4.5, u + 4.5, deck + 1.3, deck + 26, w0, w1, 'wallstone'); px_, py_, pz_ = f.p(u, deck + 26, (w0 + w1) / 2); pinnacle(px_, py_, pz_, 4.5, 2.2, 11)
            lbox(f, u - 4.5, u + 4.5, deck + 15.5, deck + 26, -thick + 0.6, -0.6, 'wallstone'); lbox(f, u - 5.0, u + 5.0, deck + 14.6, deck + 15.5, -thick + 0.2, -0.2, 'pale')
            for sg_, du, dyaw in ((-1, -4.5, -PI / 2), (1, 4.5, PI / 2)):          # both faces of the lintel: two lit lancets, a gold crest, battlements
                fa = F(f.p(u + du, 0.0, -thick + 0.6 if sg_ < 0 else -0.6), f.yaw + dyaw); span_ = thick - 1.2
                for q in range(2):
                    uc = span_ * (0.17 + 0.66 * q); lpoly(fa, arch_pts(uc, 2.6, deck + 17.0, deck + 21.2, 1.7, 6), -0.15, 0.06, 'winlit'); lbox(fa, uc - 1.8, uc + 1.8, deck + 16.4, deck + 16.9, -0.1, 0.5, 'pale')
                lpoly(fa, [(span_ / 2 + 2.0 * math.cos(2 * PI * k / 16), deck + 22.8 + 2.0 * math.sin(2 * PI * k / 16)) for k in range(16)], -0.1, 0.35, 'gold')
                for k in range(8): lbox(fa, 0.6 + k * (span_ - 1.2) / 7.0 - 0.8, 0.6 + k * (span_ - 1.2) / 7.0 + 0.8, deck + 26, deck + 27.5, -8.5, 0.3, 'wallstone')
        else: lbox(f, u - 4.5, u + 4.5, deck + 1.3, deck + 26, -thick + 3, -3, 'wallstone'); pinnacle(tx, ty, deck + 26, 4.5, 3.0, 12)
        if j % 2: banner(*f.p(u, deck + 26, -thick - 0.2)[:2], deck + 16, f.yaw + PI, 5.0, 22.0)
    for ex in (0, L):
        if gates:
            for w_ in (-3.5, -thick + 3.5): round_tower(*f.p(ex, 0, w_)[:2], deck, 6.5, 44, 22, 14)
        else: round_tower(*f.p(ex, 0, -thick / 2)[:2], deck, 11, 40, 24, 24)

# (bridge_between: see the placing section at the end)

# ---------------------------------------------------------------- St Peter's: basilica with a great dome and an oval colonnade
def basilica_square(S=1.0):
    W_ = 130; Hh = 46; yb = 0.0
    lbox(F((0, yb, 0), 0), -W_ / 2, W_ / 2, 0, Hh, -150, 0, 'pale')          # nave block behind the facade
    f = F((0, yb, 0), 0); string_course(f, -W_ / 2 - 1, W_ / 2 + 1, Hh - 1, 3.0, 2.5, 'pale'); lbox(f, -W_ / 2, W_ / 2, Hh + 2, Hh + 11, -2.0, 0.8, 'pale')
    for j in range(8):                                                         # giant order
        u = -W_ / 2 + 8 + j * (W_ - 16) / 7; cyl('pale', (u, yb + 1.5, 0), 2.6, 2.2, Hh - 4, 14); lbox(f, u - 3.6, u + 3.6, 0, 1.8, -1.6, 1.6, 'pale') if False else None
        box('pale', (u, yb + 1.5, 0), 7.4, 7.4, 2.2); box('pale', (u, yb + 1.5, Hh - 4), 7.4, 7.4, 2.6)
    for r, v0 in enumerate((2.5, 22)):
        for j in range(7):
            uc = -W_ / 2 + 8 + (j + 0.5) * (W_ - 16) / 7; o = op(uc, 6.0, v0, v0 + 7.0, 4.5, 6); pwin(F((0, yb + 0.5, 0), 0), o, RNG.random() < 0.55, 0.0)
    for j in range(13):                                                        # attic statues
        u = -W_ / 2 + 5 + j * (W_ - 10) / 12; box('pale', (u, yb, Hh + 11), 4.0, 3.0, 1.5); statue(u, yb - 0.3, Hh + 12.5, 8.5 if j == 6 else 7.0, 0.0, 'saint' if j != 6 else 'king', 'pale', False)
    # drum and the great dome
    cz = Hh + 2; cyl('pale', (0, yb + 70, cz), 25, 24, 8, 32)
    cyl('pale', (0, yb + 70, cz + 8), 22.5, 22.5, 24, 32)
    for k in range(16):
        a = 2 * PI * k / 16 + PI / 16; x, y = 22.6 * math.cos(a), yb + 70 + 22.6 * math.sin(a)
        column(x, y, cz + 8, 20, 1.0, 'pale'); fx = F((x, y, cz + 8), a - PI / 2 + PI); lpoly(F((x + 0.7 * math.cos(a), y + 0.7 * math.sin(a), cz + 8), a - PI / 2 + PI), arch_pts(0, 3.0, 4.0, 11.0, 3.2, 6), 0, 0.06, 'winlit')
    cyl('pale', (0, yb + 70, cz + 32), 25.5, 24, 2.0, 32)
    dome((0, yb + 70, cz + 34), 24.0, 36.0, 'copper', 16, 'pale', True, 10, 1)
    for sx, sy in ((-42, 40), (42, 40)):
        cyl('pale', (sx, yb + sy, Hh), 9.5, 9.0, 6, 20); dome((sx, yb + sy, Hh + 6), 9.0, 10.0, 'copper', 8, 'pale', True, 6, 1)
    prism3d('slate', [(-W_ / 2 + 2, yb - 4, Hh), (W_ / 2 - 2, yb - 4, Hh), (W_ / 2 - 2, yb - 150, Hh), (-W_ / 2 + 2, yb - 150, Hh)], (0, 0, 0.1)) if False else None
    # oval colonnade: two arms of four rows, entablature, balustrade and saints
    a_, b_ = 112.0, 88.0; cyo = yb - 90.0
    for sg in (-1, 1):
        for row in range(4):
            d = row * 7.4; A_, B_ = a_ - d, b_ - d; prev = None
            n = int((PI * 0.78 * (A_ + B_) / 2) / 7.0)
            for i in range(n + 1):
                ph = math.radians(18 + (162 - 18) * i / n); x = sg * A_ * math.sin(ph); y = cyo + B_ * math.cos(ph) * 1.0
                column(x, y, 0, 16, 1.15, 'pale');
                if prev: bar('pale', prev, (x, y), 16, 18.4, 3.4 if row in (0, 3) else 2.2) if row in (0, 3) else bar('pale', prev, (x, y), 16, 17.6, 2.2)
                prev = (x, y)
                if row == 0 and i % 2 == 0: statue(x, y, 19.9, 6.2, math.atan2(-(x), 0.001) if False else (PI if y < cyo else 0), 'saint', 'pale', True)
    cube_at('wallstone', (0, cyo - 4, 0), 4, 4, 0, 0)
    ob = [(0, cyo - 10)]; cone_between('pale', (0, cyo, 0.0), (0, cyo, 30), 3.2, 1.6, 4); cone_between('gold', (0, cyo, 30), (0, cyo, 34), 1.6, 0.05, 4)
    for sg in (-1, 1):
        cyl('stone', (sg * 34, cyo, 0), 11, 10, 1.4, 24); cyl('water', (sg * 34, cyo, 1.0), 10, 10, 0.3, 24); cone_between('snow', (sg * 34, cyo, 1.0), (sg * 34, cyo, 9), 2.5, 0.2, 8)
    # connecting galleries from the arms to the facade
    for sg in (-1, 1):
        for row in (0, 3):
            for k in range(8):
                x = sg * (W_ / 2 + 14 + row * 0.0 + (k * 0.0));

# ---------------------------------------------------------------- rival cathedral: tapering tower-forest, melting facade, fruit finials
def sagrada_tower(x, y, z0, r0, hgt, seg=16, rot=0.0):
    N = 26; rings = [];
    for k in range(N + 1):
        t = k / N; rr = r0 * (1 - 0.82 * t ** 1.25) * (1 + 0.05 * math.sin(14 * t) + 0.0); rings.append((z0 + hgt * t, rr, x, y))
    loft('pale', rings, seg, True, False)
    for k in range(2, N - 2):
        t = k / N; rr = r0 * (1 - 0.82 * t ** 1.25)
        for q in range(4):
            a = rot + q * PI / 2 + (k % 2) * PI / 4; ox = x + (rr + 0.05) * math.cos(a); oy = y + (rr + 0.05) * math.sin(a)
            cube_at('dstone' if k % 3 else 'winlit', (ox, oy, z0 + hgt * t), 0.5 + rr * 0.07, 0.15, hgt / N * 0.62, a + PI / 2)
        if k % 6 == 0: cyl('pale', (x, y, z0 + hgt * t), rr * 1.12, rr * 1.12, hgt * 0.012 + 0.6, seg)
    zt = z0 + hgt; rr = r0 * 0.18 + 0.4
    for q in range(8):
        a = q * PI / 4; sph(['fruit', 'teal', 'gold', 'fruit'][q % 4], (x + rr * math.cos(a), y + rr * math.sin(a), zt - rr * 0.2), rr * 0.55, seg=8)
    sph('gold', (x, y, zt + rr * 0.2), rr * 0.9, seg=10); cone_between('gold', (x, y, zt), (x, y, zt + rr * 5), rr * 0.2, 0.05, 6)
    for q in range(4): cone_between('gold', (x, y, zt + rr * 3), (x + rr * 1.6 * math.cos(q * PI / 2), y + rr * 1.6 * math.sin(q * PI / 2), zt + rr * 3), rr * 0.12, 0.03, 4)

def rival_cathedral():
    Wd, Ln, Hn = 78, 150, 62
    lbox(F((0, 0, 0), 0), -Wd / 2, Wd / 2, 0, Hn, -Ln, 0, 'pale')
    f = F((0, 0, 0), 0)
    # melting nativity front: three deep portals under a mass of stalactite cones, flanked by two towers each
    for sx in (-1, 1):
        for q, rr in enumerate((26, 22)):
            pass
    for pu in (-22, 0, 22):
        o = op(pu, 13 if pu == 0 else 11, 0, 12 if pu else 14, 12 if pu else 14, 8); lpoly(f, arch_pts(o['uc'], o['ww'], 0, o['spring'], o['rise'], 8), -0.3, 0.4, 'dstone')
        for r_ in (1.0, 2.2, 3.4): arch_band(f, o, r_ * 1.1, 0.0, 1.1 + r_, 'pale')
    for k in range(420):
        u = RNG.uniform(-Wd / 2, Wd / 2); v = RNG.uniform(6, Hn); w = RNG.uniform(0.5, 3.5) * (1 - 0.6 * v / Hn); ln = RNG.uniform(2.5, 8.0)
        x, y, z = f.p(u, v, w); cone_between('pale', (x, y, z), (x, y, z - ln), RNG.uniform(0.6, 1.6), 0.08, 5)
    for u in (-26, -8, 8, 26):
        for v0 in (22, 36, 50):
            lpoly(f, arch_pts(u, 3.0, v0, v0 + 5, 4.2, 5), -0.2, 0.3, 'winlit' if RNG.random() < 0.6 else 'dstone')
    for k in range(40): u = -Wd / 2 + (k + 0.5) * Wd / 40; x, y, z = f.p(u, Hn, 1.0); sph(['fruit', 'teal', 'gold'][k % 3], (x, y, z + 1.8), 1.3, seg=6)
    for (x, y, r, hh) in ((-31, 6, 7.5, 160), (-13, 6, 7.0, 175), (13, 6, 7.0, 175), (31, 6, 7.5, 160)): sagrada_tower(x, y, Hn - 6, r, hh)
    sagrada_tower(0, 86, Hn - 6, 15, 245, 24); sagrada_tower(-26, 86, Hn - 6, 9, 140); sagrada_tower(26, 86, Hn - 6, 9, 140)
    for (x, y) in ((-22, 128), (22, 128), (0, 146)): sagrada_tower(x, y, Hn - 6, 8.5, 130)
    # nave side: branching buttress forest and tall windows
    for sg in (-1, 1):
        fs = F((Wd / 2, 0, 0), PI / 2) if sg > 0 else F((-Wd / 2, Ln, 0), -PI / 2)
        for k in range(14):
            u = 6 + k * 10.0
            for q in range(3): cone_between('pale', fs.p(u + q * 1.2 - 1.2, 2.0 + q * 1.0, 6), fs.p(u + q * 1.2 - 1.2 + (q - 1) * 3.0, 40 + q * 5, 3 + q * 4), 1.1, 0.3, 6)  # leaning branches
            lpoly(fs, arch_pts(u + 5, 4.0, 14, 36, 10.0, 7), -0.2, 0.3, 'glass')
    prism3d('slate', [(-Wd / 2 - 1, 4, Hn), (Wd / 2 + 1, 4, Hn), (Wd / 2 + 1, Ln, Hn), (-Wd / 2 - 1, Ln, Hn)], (0, 0, 0.5))

# ---------------------------------------------------------------- the domed palace on its terrace
def domed_palace():
    Wd = 120; Hh = 30
    f = F((0, 0, 0), 0); palazzo(f, Wd, Hh, 30, 'slate', None, 0.55)
    for sg in (-1, 1):
        fw = F(((Wd / 2) if sg > 0 else (-Wd / 2 - 80), 0, 0), 0); palazzo(fw, 80, Hh - 6, 30, 'tile', None, 0.5)
        pw = F((sg * (Wd / 2 + 18), -18, 0), PI / 2 * (1 if sg > 0 else -1));
    # central block with pediment, columned portico and a dome
    cz = Hh
    cyl('pale', (0, 15, cz), 24, 23, 6, 32); cyl('pale', (0, 15, cz + 6), 21, 21, 16, 32)
    for k in range(12): a = 2 * PI * k / 12; column(21.3 * math.cos(a), 15 + 21.3 * math.sin(a), cz + 6, 14, 0.9, 'pale')
    dome((0, 15, cz + 22), 21, 28, 'copper', 12, 'pale', True, 9, 0)
    for k in range(8): column(-24 + k * 6.85, -6.0, 0, Hh - 2, 1.5, 'pale')
    prism3d('pale', [(-27, -6, Hh - 2), (27, -6, Hh - 2), (0, -6, Hh + 8)], (0, -3.0, 0))
    for sg in (-1, 1):
        for (ox, oy) in ((sg * 52, 14), (sg * 92, 14)):
            cyl('pale', (ox, oy, Hh - 6), 6.0, 5.5, 14, 12); dome((ox, oy, Hh + 8), 5.5, 8, 'copper', 8, 'pale', True, 5, 1)
    # garden axis: parterres, cypress avenues, a long pool with fountains
    for sg in (-1, 1):
        for k in range(14): cypress(sg * 20, -14 - k * 11, 0, 17 + (k % 3)); cypress(sg * 36, -14 - k * 11, 0, 15 + (k % 2) * 2)
    box('water', (0, 100, 0.2), 14, 120, 0.2) if False else ppoly('water', [(-7, -20, 0.4), (7, -20, 0.4), (7, -150, 0.4), (-7, -150, 0.4)])
    for k in range(5): cone_between('snow', (0, -40 - k * 22, 0.4), (0, -40 - k * 22, 7.5), 0.7, 0.05, 6)
    for sg in (-1, 1): bar('leaf', (sg * 60, -18), (sg * 60, -150), 0, 1.4, 3.0)

# ---------------------------------------------------------------- hanging gardens: arcaded terraces with cascades
def hanging_gardens():
    tiers = 6; Lw = 160; dep = 34
    for k in range(tiers):
        z = k * 11.0; f = F((0, k * 22.0, z), 0); Lk = Lw - k * 12
        ops = [op(-Lk / 2 + (j + 0.5) * Lk / int(Lk // 8), 4.2, 0.0, 5.0, 3.5, 8) for j in range(int(Lk // 8))]
        wall_face(f, -Lk / 2, Lk / 2, 0, 10.8, -dep, 0, [dict(o, uc=o['uc']) for o in ops], 'pale')
        lbox(f, -Lk / 2 - 1, Lk / 2 + 1, 10.8, 11.8, -dep - 1, 1.2, 'pale'); lbox(f, -Lk / 2, Lk / 2, 11.8, 12.6, 0.6, 1.0, 'pale')
        for o in ops: lpoly(f, arch_pts(o['uc'], 4.2, 0.0, 5.0, 3.5, 8), -3.0, -2.9, 'winlit' if RNG.random() < 0.5 else 'dstone')
        for j in range(int(Lk // 6)):
            u = -Lk / 2 + 3 + j * 6.0; x, y, zz = f.p(u, 11.8, -dep + 6)
            if k < tiers - 1: cypress(x, y, zz, 10 + RNG.random() * 6)
            lamp(*f.p(u, 12.6, 0.8), 0.25)
        ppoly('leaf', [f.p(-Lk / 2, 10.8, -dep), f.p(Lk / 2, 10.8, -dep), f.p(Lk / 2, 10.8, -2), f.p(-Lk / 2, 10.8, -2)]) if False else None
        lbox(f, -Lk / 2 + 2, Lk / 2 - 2, 10.8, 11.5, -dep + 3, -dep + 18, 'leaf')
    # cascade from the top terrace
    zt = tiers * 11.0
    for k in range(tiers):
        x0 = 0; yb = k * 22.0 - 0.8; z1 = (k + 1) * 11.0 + 1.2 - 1.2; z0 = k * 11.0 + 11.8 if k < tiers else 0
        B('falls').add([(-4, yb, z0 + 0.1), (4, yb, z0 + 0.1), (4.6, yb + 1.2 - 22 * 0.02, z0 - 10.4), (-4.6, yb + 1.2 - 22 * 0.02, z0 - 10.4)], [(0, 1, 2, 3), (3, 2, 1, 0)])
    for sg in (-1, 1):
        for q in range(3): round_tower(sg * (Lw / 2 - 8 - q * 18), q * 22 + 40, 10, 5.5, 26 + q * 6, 12, 16, flag=False, lamps=False)

# ---------------------------------------------------------------- spired citadel
def citadel():
    Rk = 60.0; z0 = 0.0
    round_tower(0, 0, 0, 22, 130, 70, 28)                         # the great keep
    for k in range(10):
        a = 2 * PI * k / 10; x, y = Rk * math.cos(a), Rk * math.sin(a); big = k % 2 == 0
        round_tower(x, y, 0, 8.5 if big else 6.5, (58 if big else 40), (46 if big else 26), 18)
        if big: cyl('pale', (x, y, 0), 8.5, 8.5, 2.0, 18)
    for k in range(10):
        a0, a1 = 2 * PI * k / 10, 2 * PI * (k + 1) / 10; p0 = (Rk * math.cos(a0), Rk * math.sin(a0)); p1 = (Rk * math.cos(a1), Rk * math.sin(a1))
        bar('wallstone', p0, p1, 0, 17, 5.0); bar('stone', p0, p1, 17, 18.4, 6.8)
    for k in range(6):                                              # tall slender spired palace towers inside the ring
        a = 2 * PI * k / 6 + 0.3; x, y = 34 * math.cos(a), 34 * math.sin(a); cyl('pale', (x, y, 0), 5.5, 4.8, 74 + (k % 3) * 12, 12); spire(x, y, 74 + (k % 3) * 12, 5.4, 52, 12, 'copper', True)
    for k in range(8):
        a = 2 * PI * k / 8 + 0.2; x, y = 11 * math.cos(a), 11 * math.sin(a); pinnacle(x, y, 118, 4.0, 1.8, 10)

# ---------------------------------------------------------------- needle temple (a slender gilt tower of stacked drums)
def needle():
    z = 0.0; r = 22.0
    for k in range(9):
        hgt = 20 - k * 1.4; cyl('pale' if k % 2 else 'stone', (0, 0, z), r, r * 0.9, hgt, 16 if k < 5 else 12)
        for q in range(16):
            a = 2 * PI * q / 16; column(r * math.cos(a), r * math.sin(a), z, hgt - 0.6, 0.7 * r / 22 + 0.3, 'pale') if k % 2 == 0 else None
            if k % 2 == 1: cube_at('winlit' if (q + k) % 3 else 'dstone', ((r + 0.05) * math.cos(a), (r + 0.05) * math.sin(a), z + hgt * 0.5), 1.4, 0.2, hgt * 0.5, a + PI / 2)
        for q in range(8): a = 2 * PI * q / 8; statue((r * 1.02) * math.cos(a), (r * 1.02) * math.sin(a), z + hgt, 4.5, a, 'angel', 'pale', True)
        z += hgt; r *= 0.84
    spire(0, 0, z, r * 1.1, 70, 12, 'gold', True);

