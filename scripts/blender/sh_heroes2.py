# Stones Hold v3, part 2 of the hero structures (exec'd after sh_heroes.py inside stones_hold.py): statues, plazas, the great castle, the arena,
# the rampart, the monastery, garden terraces, forts and churches, and the placing of everything (sites, bridges, dam, plazas).

def yaw_of(dx, dy): return math.atan2(dx, -dy)           # the yaw whose front (local -y) looks along (dx, dy)

# ---------------------------------------------------------------- figures: saint, king, angel, knight on a plinth
def plinth(x, y, z, w, h, yaw):
    box('wallstone', (x, y, z), w * 1.5, w * 1.5, h * 0.14, yaw); box('wallstone', (x, y, z + h * 0.14), w * 1.15, w * 1.15, h * 0.74, yaw); box('pale', (x, y, z + h * 0.88), w * 1.4, w * 1.4, h * 0.12, yaw)
    for k in range(4): a = yaw + k * PI / 2; cube_at('dstone', (x + math.cos(a) * w * 0.58, y + math.sin(a) * w * 0.58, z + h * 0.5), 0.02 * h, w * 0.6, h * 0.4, a + PI / 2)
def angel(x, y, z, H, yaw):
    c, s = math.cos(yaw), math.sin(yaw)
    def P(dx, dy, dz): return (x + dx * c - dy * s, y + dx * s + dy * c, z + dz)
    prof = [(0.0, 0.17), (0.15, 0.14), (0.4, 0.1), (0.62, 0.085), (0.7, 0.09), (0.76, 0.06), (0.8, 0.05)]
    loft('stone', [(z + t * H, (lambda a, r=r, t=t: H * r * (1 + 0.12 * math.sin(8 * a + t * 6))), x, y) for t, r in prof], 20, True)
    for sg in (-1, 1):                                                                  # two wings of overlapping feathers
        for j in range(4): sph('stone', P(sg * (0.12 + 0.05 * j) * H, 0.09 * H, (0.8 - 0.11 * j) * H), 0.3 * H * (1 - 0.1 * j), (0.06, 0.28, 1.0), yaw + sg * (0.3 + 0.12 * j), 0.1 * j, 6)
    cone_between('stone', P(0.09 * H, 0, 0.74 * H), P(0.17 * H, -0.1 * H, 0.98 * H), 0.04 * H, 0.03 * H, 6); sph('stone', P(0.18 * H, -0.11 * H, 1.0 * H), 0.032 * H, seg=6)
    cone_between('gold', P(0.18 * H, -0.11 * H, 0.98 * H), P(0.2 * H, -0.12 * H, 1.32 * H), 0.012 * H, 0.03 * H, 6)   # trumpet raised
    sph('stone', P(0, 0, 0.87 * H), 0.055 * H, (1, 1, 1.15), yaw); cone_between('gold', P(0, 0.05 * H, 0.9 * H), P(0, 0.065 * H, 0.9 * H), 0.1 * H, 0.1 * H, 14)
def knight(x, y, z, H, yaw):
    c, s = math.cos(yaw), math.sin(yaw)
    def P(dx, dy, dz): return (x + dx * c - dy * s, y + dx * s + dy * c, z + dz)
    for sx in (-1, 1): cone_between('stone', P(sx * 0.05 * H, 0, 0), P(sx * 0.055 * H, 0, 0.44 * H), 0.05 * H, 0.04 * H, 8)
    cone_between('stone', P(0, 0, 0.3 * H), P(0, 0, 0.52 * H), 0.11 * H, 0.09 * H, 12); cube_at('stone', P(0, 0, 0.64 * H), 0.2 * H, 0.12 * H, 0.2 * H, yaw)
    for sx in (-1, 1): sph('stone', P(sx * 0.11 * H, 0, 0.72 * H), 0.045 * H, seg=6)
    sph('stone', P(0, 0, 0.82 * H), 0.06 * H, (1, 1, 1.15), yaw); cube_at('dstone', P(0, -0.055 * H, 0.82 * H), 0.09 * H, 0.03 * H, 0.014 * H, yaw)   # helm and visor
    cone_between('stone', P(0, 0.05 * H, 0.88 * H), P(0, 0.13 * H, 0.97 * H), 0.02 * H, 0.006 * H, 5)                                               # plume
    cone_between('stone', P(-0.07 * H, 0.03 * H, 0.74 * H), P(-0.08 * H, 0.13 * H, 0.1 * H), 0.07 * H, 0.12 * H, 10)                                  # cloak
    cone_between('iron', P(0.12 * H, -0.1 * H, 0.05 * H), P(0.12 * H, -0.1 * H, 0.98 * H), 0.012 * H, 0.008 * H, 4); cube_at('iron', P(0.12 * H, -0.1 * H, 0.36 * H), 0.12 * H, 0.02 * H, 0.02 * H, yaw)  # sword
    cube_at('gold', P(-0.13 * H, -0.08 * H, 0.5 * H), 0.02 * H, 0.12 * H, 0.2 * H, yaw)                                                               # shield
def figure(x, y, z, H, yaw, i):
    k = i % 4
    if k == 0: colossus(x, y, z, H, yaw, 'saint', base=False)
    elif k == 1: angel(x, y, z, H, yaw)
    elif k == 2: knight(x, y, z, H, yaw)
    else: colossus(x, y, z, H, yaw, 'king', base=False)
def on_plinth(x, y, z, H, yaw, i): plinth(x, y, z, H * 0.3, H * 0.42, yaw); figure(x, y, z + H * 0.42, H, yaw, i)

# ---------------------------------------------------------------- small buildings for plazas and knolls
def small_church(wd=12.0, ln=26.0, ht=11.0):
    f = F((0, 0, 0), 0); lbox(f, -wd / 2, wd / 2, -9, ht, -ln, 0, 'pale'); lpoly(f, [(-wd / 2 - 0.6, ht), (wd / 2 + 0.6, ht), (0, ht + wd * 0.55)], -ln - 0.6, 0.6, 'slate')
    lbox(f, -3.8, 3.8, -9, ht + 13, 0, 7.6, 'pale'); x, y, z = f.p(0, ht + 13, 3.8); spire(x, y, z, 4.9, 19, 8, 'copper', True)
    lpoly(f, arch_pts(0, 2.6, 0, 3.0, 1.4, 6), 7.6, 7.8, 'dstone'); lpoly(f, arch_pts(0, 1.4, ht + 3, ht + 7, 1.1, 6), 7.7, 7.9, 'winlit')
    for sg in (-1, 1):
        for k in range(4): cube_at('winlit' if (k + sg) % 2 else 'windark', (sg * (wd / 2 + 0.05), 3.5 + 6.0 * k, 7.0), 0.12, 1.5, 4.2)
    cyl('pale', (0, ln, -9), wd / 2, wd / 2, ht + 9, 12); cone_between('slate', (0, ln, ht), (0, ln, ht + wd * 0.6), wd / 2 + 0.5, 0.2, 12)
def campanile(h=40.0):
    cyl('pale', (0, 0, -8), 3.6, 3.3, h + 8, 12); cyl('stone', (0, 0, h * 0.6), 3.7, 3.7, 0.6, 12)
    for q in range(4): a = q * PI / 2 + PI / 4; cube_at('winlit', (3.35 * math.cos(a), 3.35 * math.sin(a), h * 0.8), 1.0, 0.2, 3.4, a + PI / 2)
    spire(0, 0, h, 3.9, 17, 8, 'copper', True)
def fort():
    round_tower(0, 0, 0, 11, 40, 26, 18)
    P = [(30 * math.cos(2 * PI * k / 6), 30 * math.sin(2 * PI * k / 6)) for k in range(6)]
    for k in range(6): round_tower(P[k][0], P[k][1], 0, 5.2, 22, 14, 12, flag=False, lamps=False); bar('wallstone', P[k], P[(k + 1) % 6], -6, 11, 3.8); bar('stone', P[k], P[(k + 1) % 6], 11, 12.3, 5.2)

# ---------------------------------------------------------------- plazas: a raised round pavement with a landmark, lamps and trees (upper ones ring a landmark with statues)
def disc_pts(x, y, z, r, n=28): return [(x + r * math.cos(2 * PI * i / n), y + r * math.sin(2 * PI * i / n), z) for i in range(n)]
def annulus(m, x, y, z, r0, r1, n=28):
    for i in range(n):
        a0, a1 = 2 * PI * i / n, 2 * PI * (i + 1) / n
        ppoly(m, [(x + r0 * math.cos(a0), y + r0 * math.sin(a0), z), (x + r1 * math.cos(a0), y + r1 * math.sin(a0), z), (x + r1 * math.cos(a1), y + r1 * math.sin(a1), z), (x + r0 * math.cos(a1), y + r0 * math.sin(a1), z)])
def plaza(q):
    x, y, r = q['x'], q['y'], q['r']; ang = np.linspace(0, 2 * PI, 12, endpoint=False); z0 = float(np.max(H(x + r * np.cos(ang), y + r * np.sin(ang)))) + 0.35
    cyl('wallstone', (x, y, z0 - 5.0), r, r * 0.985, 5.0, 32); ppoly('cobble', disc_pts(x, y, z0, r, 32)); annulus('pale', x, y, z0 + 0.04, r * 0.62, r * 0.7, 32); annulus('pale', x, y, z0 + 0.04, r * 0.94, r, 32)
    for k in range(8): a = k * PI / 4; bar('pale', (x + r * 0.7 * math.cos(a), y + r * 0.7 * math.sin(a)), (x + r * 0.94 * math.cos(a), y + r * 0.94 * math.sin(a)), z0 + 0.02, z0 + 0.07, 1.4)
    for k in range(10):
        a = 2 * PI * (k + 0.5) / 10; px, py = x + r * 0.97 * math.cos(a), y + r * 0.97 * math.sin(a); cyl('iron', (px, py, z0), 0.13, 0.1, 3.8, 6); lamp(px, py, z0 + 4.1, 0.3)
    kind = q['kind']
    if kind in ('fountain', 'grand'):
        cyl('pale', (x, y, z0), r * 0.22, r * 0.22, 1.0, 24); ppoly('water', disc_pts(x, y, z0 + 0.85, r * 0.2, 24)); cyl('pale', (x, y, z0 + 1.0), 0.55, 0.42, r * 0.22, 10)
        cyl('pale', (x, y, z0 + 1.0 + r * 0.2), r * 0.1, r * 0.1, 0.5, 16); ppoly('water', disc_pts(x, y, z0 + 1.45 + r * 0.2, r * 0.085, 16)); sph('pale', (x, y, z0 + 1.0 + r * 0.26), 0.6, seg=8)
    elif kind == 'obelisk':
        box('wallstone', (x, y, z0), 5.0, 5.0, 1.6, 0.3); cone_between('pale', (x, y, z0 + 1.6), (x, y, z0 + r * 0.7 + 1.6), 1.35, 0.6, 4, True); cone_between('gold', (x, y, z0 + r * 0.7 + 1.6), (x, y, z0 + r * 0.7 + 4.4), 0.6, 0.0, 4)
    elif kind == 'statue': on_plinth(x, y, z0, r * 0.5, RNG.uniform(0, 6.28), int(abs(x)))
    elif kind in ('church', 'tower'):
        a = (abs(int(x * 7 + y * 3)) % 628) / 100.0; px, py = x + r * 0.55 * math.cos(a), y + r * 0.55 * math.sin(a)
        if kind == 'church':
            with placed((px, py, z0), yaw_of(x - px, y - py), 0.8): small_church()
        else:
            with placed((px, py, z0), 0, 1.0): campanile(RNG.uniform(34, 46))
        on_plinth(x - 0.2 * r * math.cos(a), y - 0.2 * r * math.sin(a), z0, r * 0.4, a + PI, int(abs(y)))
    if q['upper']:
        for k in range(8): a = 2 * PI * (k + 0.5) / 8; on_plinth(x + r * 0.8 * math.cos(a), y + r * 0.8 * math.sin(a), z0, 7.0, a, k)
    else:
        for k in range(5): a = 2 * PI * k / 5 + 0.4; cypress(x + r * 0.84 * math.cos(a), y + r * 0.84 * math.sin(a), z0, 9.0 + (k % 3))

# ---------------------------------------------------------------- the arena (a Colosseum for the Bowl)
def arena(a=96.0, b=72.0):
    n = 48; rho = lambda s: (lambda t: a * b * s / math.sqrt((b * math.cos(t)) ** 2 + (a * math.sin(t)) ** 2))
    for i in range(n):
        t0, t1 = 2 * PI * i / n, 2 * PI * (i + 1) / n; x0, y0 = a * math.cos(t0), b * math.sin(t0); x1, y1 = a * math.cos(t1), b * math.sin(t1); dx, dy = x1 - x0, y1 - y0; L = math.hypot(dx, dy); nx, ny = dy / L, -dx / L
        f = F((x0, y0, 0.0), yaw_of(nx, ny)); ops = [op(L / 2, 3.4, r * 13 + 0.6, r * 13 + 7.0, 3.0, 8) for r in range(3)]
        wall_face(f, 0, L, 0, 46, -14, 0, ops, 'pale')
        for r in range(1, 4): string_course(f, -0.2, L + 0.2, r * 13 - 0.3, 0.6, 0.5, 'pale')
        lbox(f, -0.5, L + 0.5, 45, 47.2, -15, 1.0, 'pale')
        for r in range(3):
            lbox(f, -0.4, 0.4, r * 13, r * 13 + 12.5, 0, 0.7, 'pale'); lpoly(f, arch_pts(L / 2, 3.4, r * 13 + 0.6, r * 13 + 7.0, 3.0, 8), -3.0, -2.9, 'winlit' if RNG.random() < 0.55 else 'windark')
        x, y, z = f.p(L / 2, 47.2, -4.0)
        if i % 2 == 0: statue(x, y, z, 4.6, f.yaw, ['saint', 'king', 'angel', 'knight'][(i // 2) % 4], 'pale', True)
        if i % 4 == 0: banner(x, y, 47.2 + 1.0, 14.0, f.yaw + PI, 2.4, 6.0)
    lv = [(44.0, 0.86), (41.0, 0.80), (38.0, 0.74), (35.0, 0.68), (31.0, 0.62), (27.0, 0.56), (23.0, 0.5), (19.0, 0.45), (15.0, 0.41)]
    for k in range(len(lv) - 1):
        z0, s0 = lv[k]; z1, s1 = lv[k + 1]; loft('pale', [(z0, rho(s0), 0, 0), (z0, rho(s1), 0, 0), (z1, rho(s1), 0, 0)], 48, True, False)
    ppoly('cobble', [(a * 0.4 * math.cos(2 * PI * i / 48), b * 0.4 * math.sin(2 * PI * i / 48), 14.0) for i in range(48)])
    for sg in (-1, 1): cyl('pale', (sg * a * 0.4, 0, 14), 1.2, 1.0, 5, 8); lamp(sg * a * 0.4, 0, 19.5, 0.5)

# ---------------------------------------------------------------- the great castle (the statue bridge ends at its gate): gate faces local -y
def great_castle():
    n2 = 14; R2 = 138.0; Rg = R2 * math.cos(PI / n2); P2 = [(R2 * math.cos(-PI / 2 - PI / n2 + 2 * PI * k / n2), R2 * math.sin(-PI / 2 - PI / n2 + 2 * PI * k / n2)) for k in range(n2)]
    for k in range(n2):
        p0, p1 = P2[k], P2[(k + 1) % n2]; bar('wallstone', p0, p1, -8, 17, 5.5); bar('stone', p0, p1, 17, 18.6, 7.4)
        L = math.hypot(p1[0] - p0[0], p1[1] - p0[1]); ang = math.atan2(p1[1] - p0[1], p1[0] - p0[0])
        for t in np.arange(2.0, L - 1.5, 3.6): cube_at('stone', (p0[0] + (p1[0] - p0[0]) * t / L, p0[1] + (p1[1] - p0[1]) * t / L, 19.4), 1.7, 1.6, 1.7, ang)
        round_tower(p0[0], p0[1], -4, 7.2, 36, 22, 12, flag=False)
    for sg in (-1, 1): round_tower(sg * 15, -Rg, -4, 10.5, 50, 32, 16, flag=True)
    f = F((0, -Rg, 0), 0); wall_face(f, -15, 15, -4, 38, -7, 7, [op(0, 7.0, 0.0, 12.0, 4.6, 10)], 'wallstone'); lbox(f, -16, 16, 36, 38.6, -8, 8, 'pale')
    for k in range(7): x, y, z = f.p(-12 + 4 * k, 38.6, 7.6); statue(x, y, z, 4.4, 0.0, ['saint', 'king', 'angel', 'knight'][k % 4], 'pale', True)
    R1, n1 = 84.0, 10; P1 = [(R1 * math.cos(2 * PI * k / n1 + 0.3), R1 * math.sin(2 * PI * k / n1 + 0.3)) for k in range(n1)]
    for k in range(n1):
        p0, p1 = P1[k], P1[(k + 1) % n1]; bar('wallstone', p0, p1, -4, 30, 6.5); bar('stone', p0, p1, 30, 31.6, 8.4)
        big = k % 2 == 0; round_tower(p0[0], p0[1], -4, 10.5 if big else 8, 62 if big else 46, 40 if big else 28, 18)
    for k in range(6):
        a = 2 * PI * k / 6 + 0.1; x, y = 44 * math.cos(a), 44 * math.sin(a); cyl('pale', (x, y, 0), 6.2, 5.4, 76 + (k % 3) * 14, 12); spire(x, y, 76 + (k % 3) * 14, 6.0, 56, 12, 'copper', True)
    palazzo(F((-48, -16, 0), 0), 96, 36, 42, 'slate', None, 0.6)
    for sx in (-1, 1): round_tower(sx * 54, -16, 0, 13, 92, 58, 20)
    round_tower(0, 30, 0, 16, 128, 74, 22)
    for k in range(8): a = 2 * PI * k / 8 + 0.2; round_tower(19 * math.cos(a), 30 + 19 * math.sin(a), 127.8, 2.8, 16, 16, 10, slits=False, machic=False, lamps=False, flag=False)
    cyl('pale', (0, -2, 36), 24, 23, 6, 28); dome((0, -2, 42), 21, 24, 'copper', 14, 'pale', True, 8, 0)
    for k in range(12): ang = 2 * PI * k / 12; column(21.5 * math.cos(ang), -2 + 21.5 * math.sin(ang), 42, 8, 0.9, 'pale')
    cyl('cobble', (0, -50, 0), 40, 40, 0.5, 24); cyl('pale', (0, -60, 0), 3.6, 3.0, 1.4, 14); sph('pale', (0, -60, 2.2), 1.4, seg=8)
    for k in range(6): a = 2 * PI * k / 6; on_plinth(0 + 26 * math.cos(a), -60 + 26 * math.sin(a), 0, 8.0, a, k)

# ---------------------------------------------------------------- rampart (crescent ridge), monastery (mesa), garden terraces (cascade)
def rampart(pk):
    poly = W.PLATS[pk['tiers']['c']]['poly']; m = len(poly) // 2; z = pk['h']
    mid = [((poly[i][0] + poly[len(poly) - 1 - i][0]) / 2, (poly[i][1] + poly[len(poly) - 1 - i][1]) / 2) for i in range(m)]
    for i in range(m - 1):
        bar('wallstone', mid[i], mid[i + 1], z - 6, z + 28, 9.0); bar('stone', mid[i], mid[i + 1], z + 28, z + 29.5, 11.2)
        L = math.hypot(mid[i + 1][0] - mid[i][0], mid[i + 1][1] - mid[i][1]); ang = math.atan2(mid[i + 1][1] - mid[i][1], mid[i + 1][0] - mid[i][0])
        for t in np.arange(2.0, L - 1.5, 3.8):
            for sg in (-1, 1): cube_at('stone', (mid[i][0] + (mid[i + 1][0] - mid[i][0]) * t / L - sg * math.sin(ang) * 5.4, mid[i][1] + (mid[i + 1][1] - mid[i][1]) * t / L + sg * math.cos(ang) * 5.4, z + 30.4), 1.8, 1.8, 1.8, ang)
    for i, p in enumerate(mid):
        great = i in (0, m // 2, m - 1); round_tower(p[0], p[1], z - 6, 15 if great else 9, 108 if great else 62, 66 if great else 40, 20 if great else 16)
    px, py = mid[m // 2]; q0, q1 = mid[m // 2 - 1], mid[m // 2 + 1]; ang = math.atan2(q1[1] - q0[1], q1[0] - q0[0])
    for sg in (-1, 1): round_tower(px + math.cos(ang) * sg * 34, py + math.sin(ang) * sg * 34, z - 6, 12, 80, 50, 18)
    for k in range(1, m - 1, 2):                                          # a figure on the wall walk every other bay, facing the under city
        p = mid[k]; q = mid[k + 1]; an = math.atan2(q[1] - p[1], q[0] - p[0]); sx_, sy_ = p[0] + math.sin(an) * 7.5, p[1] - math.cos(an) * 7.5
        plinth(sx_, sy_, z + 29.5, 4.0, 4.0, an); figure(sx_, sy_, z + 33.5, 9.0, yaw_of(math.sin(an), -math.cos(an)), k)
def monastery():
    for side in range(4): o = [(-45, -45), (45, -45), (45, 45), (-45, 45)][side]; palazzo(F((o[0], o[1], 0), side * PI / 2), 90, 22, 18, 'tile', None, 0.5)
    for j in range(14):
        t = -30 + j * 60 / 13
        for (x, y) in ((t, -26), (t, 26), (-26, t), (26, t)): column(x, y, 0, 6.0, 0.5, 'pale')
    for p0, p1 in (((-26, -26), (26, -26)), ((26, -26), (26, 26)), ((26, 26), (-26, 26)), ((-26, 26), (-26, -26))): bar('pale', p0, p1, 6.0, 6.8, 1.2)
    cyl('pale', (0, 0, 0), 3.6, 3.6, 1.2, 20); ppoly('water', disc_pts(0, 0, 1.15, 3.3, 20)); cyl('pale', (0, 0, 1.2), 0.5, 0.4, 3.0, 8)
    with placed((0, 66, 0), 0, 1.9): small_church(12.0, 24.0, 11.0)
    with placed((52, 70, 0), 0, 1.0): campanile(62.0)
    R3, n3 = 150.0, 16; P3 = [(R3 * math.cos(2 * PI * k / n3), R3 * math.sin(2 * PI * k / n3)) for k in range(n3)]
    for k in range(n3): bar('wallstone', P3[k], P3[(k + 1) % n3], -8, 15, 4.2); bar('stone', P3[k], P3[(k + 1) % n3], 15, 16.2, 6.0); round_tower(P3[k][0], P3[k][1], -4, 6.2, 30, 20, 12, flag=False)
def garden_terrace(Lk=96.0, dep=34.0):
    f = F((0, 0, 0), 0); n = int(Lk // 8); ops = [op(-Lk / 2 + (j + 0.5) * Lk / n, 4.2, 0.0, 5.0, 3.5, 8) for j in range(n)]
    wall_face(f, -Lk / 2, Lk / 2, 0, 10.8, -dep, 0, ops, 'pale'); lbox(f, -Lk / 2 - 1, Lk / 2 + 1, 10.8, 11.8, -dep - 1, 1.2, 'pale'); lbox(f, -Lk / 2, Lk / 2, 11.8, 12.6, 0.6, 1.0, 'pale')
    for o in ops: lpoly(f, arch_pts(o['uc'], 4.2, 0.0, 5.0, 3.5, 8), -3.0, -2.9, 'winlit' if RNG.random() < 0.5 else 'dstone')
    for j in range(int(Lk // 6)):
        u = -Lk / 2 + 3 + j * 6.0; x, y, zz = f.p(u, 11.8, -dep + 6); cypress(x, y, zz, 10 + RNG.random() * 6); lamp(*f.p(u, 12.6, 0.8), 0.25)
    lbox(f, -Lk / 2 + 2, Lk / 2 - 2, 10.8, 11.5, -dep + 3, -dep + 18, 'leaf')
    B('falls').add([(-4, -0.6, 12.0), (4, -0.6, 12.0), (4.6, -0.3, 1.0), (-4.6, -0.3, 1.0)], [(0, 1, 2, 3), (3, 2, 1, 0)])

# ================================================================ placing everything
def face_dir(c):
    c = np.asarray(c, float); best = None
    for v in W.VALLEYS:
        P = v.P[v.S < (W.DAM_S - 100 if v.name == 'main' else 1e9)]; dd = P - c; L = np.hypot(dd[:, 0], dd[:, 1]); i = int(L.argmin())
        if best is None or L[i] < best[0]: best = (L[i], dd[i])
    return best[1]
def face_yaw_pt(c): d = face_dir(c); return yaw_of(d[0], d[1])
def gothic(): west_front(); tower_faces(1); tower_faces(-1); nave_run(Y0, 3.0); nave_run(17.0, 50.0); transept(); crossing_tower(); choir_and_apse()
HEROES = {'cathedral': (gothic, 1.1, 60.0), 'basilica': (basilica_square, 0.72, 40.0), 'rival': (rival_cathedral, 1.0, 70.0), 'needle': (needle, 1.5, 0.0), 'palace': (domed_palace, 0.6, 20.0),
          'castle': (great_castle, 1.0, 0.0), 'bowl': (arena, 0.95, 0.0), 'mesa': (monastery, 1.0, 0.0), 'fort': (fort, 1.0, 0.0), 'church': (small_church, 1.7, -8.0)}
def rim_pt(c, ang, poly, margin=8.0):
    last = (c[0], c[1])
    for r in np.arange(4.0, 500.0, 2.0):
        x, y = c[0] + math.cos(ang) * r, c[1] + math.sin(ang) * r
        if float(W.poly_sdf(x, y, poly)) > -margin: break
        last = (x, y)
    return last
def hero_at(c, h, role, yaw=None, scale=None):
    fn, sc_, off = HEROES[role]; sc_ = scale or sc_; yaw = face_yaw_pt(c) if yaw is None else yaw; fx, fy = math.sin(yaw), -math.cos(yaw)
    with placed((c[0] + fx * off * sc_, c[1] + fy * off * sc_, h), yaw, sc_): fn()
def bridge_ends(a, ka, b, kb):
    pa = W.PLATS[W.PEAK[a]['tiers'][ka]]; pb = W.PLATS[W.PEAK[b]['tiers'][kb]]; A_ = np.array(W.PEAK[a]['anchor'], float); B_ = np.array(W.PEAK[b]['anchor'], float)
    d = B_ - A_; L = float(np.hypot(*d)); u = d / L; ts = np.arange(0, L, 2.0); X = A_[0] + u[0] * ts; Y = A_[1] + u[1] * ts
    ia = np.where(W.poly_sdf(X, Y, pa['poly']) > -6)[0]; ib = np.where(W.poly_sdf(X, Y, pb['poly']) > -6)[0]
    i0 = max((int(ia[0]) - 1) if len(ia) else 0, 0); i1 = min((int(ib[-1]) + 1) if len(ib) else len(ts) - 1, len(ts) - 1)
    if abs(pa['h'] - pb['h']) > 1.0: log(f'WARNING bridge {a}{ka}-{b}{kb}: decks differ ({pa["h"]} vs {pb["h"]})')
    return (float(X[i0]), float(Y[i0])), (float(X[i1]), float(Y[i1])), min(pa['h'], pb['h']) - 1.3
def statue_bridge(p0, p1, deck, thick=24.0):
    """A bridge lined on both sides with statues every 8.5 m, two gate colossi at each end."""
    great_bridge(p0, p1, deck, thick, gates=True); d = np.array(p1) - np.array(p0); L = float(np.hypot(*d)); ux, uy = d / L; sx, sy = uy, -ux
    f = F((p0[0] + sx * thick / 2, p0[1] + sy * thick / 2, 0.0), math.atan2(uy, ux)); n = int(L // 8.5); out = yaw_of(sx, sy)
    sp_ = L / max(3, int(round(L / 78.0)))
    for j in range(2, n - 1):
        u = j * L / n
        if abs(u / sp_ - round(u / sp_)) * sp_ < 7.5: continue                              # not inside a gate tower
        for side, w_, yw in ((0, -2.9, out), (1, -(thick - 2.9), out + PI)):
            x, y, z = f.p(u, deck + 1.3, w_); on_plinth(x, y, z, 7.2, yw, j * 2 + side)
    for ex, sg in ((14.0, -1), (L - 14.0, 1)):
        for sd in (-1, 1): x, y, z = f.p(ex, deck + 1.3, -thick / 2 + sd * 7.5); colossus_on_plinth(x, y, z, 26.0, yaw_of(sg * ux, sg * uy), 'king' if sd > 0 else 'saint')
MATS['flag'] = simple('flag', (0.4, 0.37, 0.3), 0.8, noise_bump=0.3, scale=1.2)
def crown_dress(key, gap=30.0):
    """A pale flagstone floor on a crown, with a ring of statues on plinths and lamps along its rim, looking out over the city."""
    p = W.PLATS[key]; h = p['h']; ins = inset(p['poly'], 5.0); ppoly('flag', [(x, y, h + 0.16) for x, y in ins])
    ring = np.array(inset(p['poly'], 13.0)); ar = 0.5 * sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1] for i in range(len(ring)))
    if ar < 0: ring = ring[::-1]
    acc = gap * 0.5; k = 0
    for i in range(len(ring)):
        a_ = ring[i]; b_ = ring[(i + 1) % len(ring)]; L = float(np.hypot(*(b_ - a_)))
        if L < 1e-6: continue
        u = (b_ - a_) / L; nrm = np.array([u[1], -u[0]]); t = acc
        while t < L:
            q = a_ + u * t
            if k % 2 == 0: on_plinth(q[0], q[1], h + 0.16, 6.6, yaw_of(nrm[0], nrm[1]), k // 2)
            else: cyl('iron', (q[0], q[1], h + 0.16), 0.15, 0.11, 4.2, 6); lamp(q[0], q[1], h + 4.6, 0.34)
            k += 1; t += gap * 0.5
        acc = t - L
def build_sites():
    for name, pk in W.PEAK.items():
        c = pk['c']; role = pk['role']; z = pk['h']; yaw = None
        if (name == W.STATUE_BRIDGE[0]) or (name == W.STATUE_BRIDGE[2]):                 # the two ends of the statue bridge look at each other
            o = W.STATUE_BRIDGE[2] if name == W.STATUE_BRIDGE[0] else W.STATUE_BRIDGE[0]; d = np.array(W.PEAK[o]['anchor'], float) - np.array(c, float); yaw = yaw_of(d[0], d[1])
        if role in ('cathedral', 'basilica', 'rival', 'castle', 'palace', 'twin'): crown_dress(pk['tiers']['c']); (crown_dress(pk['tiers']['c2'], 36.0) if role == 'twin' else None)
        if role in HEROES: hero_at(c, z, role, yaw)
        elif role == 'twin': hero_at(c, z, 'rival', scale=0.85); hero_at(pk['c2'], pk['h_c2'], 'cathedral', scale=0.8)
        elif role == 'crescent': rampart(pk)
        elif role == 'cascade':
            dirn = np.array([62.0, -96.0]); dirn /= np.hypot(*dirn)
            for k in ['c'] + pk['extras']:
                p = W.PLATS[pk['tiers'][k]]; cx_ = sum(q[0] for q in p['poly']) / len(p['poly']); cy_ = sum(q[1] for q in p['poly']) / len(p['poly'])
                ex, ey = rim_pt((cx_, cy_), math.atan2(dirn[1], dirn[0]), p['poly'], 7.0)
                with placed((ex, ey, p['h']), yaw_of(dirn[0], dirn[1]), 0.8): garden_terrace()
        if role == 'palace':                                              # the spur's promenade: cypress avenue and lamps along its spine
            a0 = np.array([1880.0, -1255.0]); a1 = np.array([1110.0, -1320.0])
            for i, t in enumerate(np.linspace(0, 1, 52)): q = a0 + (a1 - a0) * t; cypress(q[0], q[1] + 9, pk['h1'], 12 + (i % 3)); cypress(q[0], q[1] - 9, pk['h1'], 12 + ((i + 1) % 3)); lamp(q[0], q[1] + 4.5, pk['h1'] + 3.4, 0.28)
        if role in ('cathedral', 'basilica', 'rival', 'twin'):               # colossi on the crown's rim, looking out over the city
            fy = face_yaw_pt(c); base = math.atan2(-math.cos(fy), math.sin(fy))
            for sg in (-1, 1):
                ang = base + sg * 0.9; px, py = rim_pt(c, ang, pk['crown'], 22.0); colossus_on_plinth(px, py, z, 56.0, yaw_of(math.cos(ang), math.sin(ang)), 'saint' if sg > 0 else 'king')
def build_bridges():
    for a, ka, b, kb in W.BRIDGES:
        p0, p1, deck = bridge_ends(a, ka, b, kb)
        if (a, ka, b, kb) == tuple(W.STATUE_BRIDGE): statue_bridge(p0, p1, deck)
        else: great_bridge(p0, p1, deck)
def build_dam():
    xs = np.arange(-420.0, 420.0, 4.0); zz = H(W.DAM_X + xs, np.full_like(xs, W.DAM_Y)); crest = W.LAKE_Z + 2.0
    lo = xs[(xs < 0) & (zz >= crest)]; hi = xs[(xs > 0) & (zz >= crest)]; l0 = float(lo.max()) if len(lo) else -215.0; r0 = float(hi.min()) if len(hi) else 215.0
    with placed((W.DAM_X + (l0 + r0) / 2, W.DAM_Y, 0), 0, 1.0): dam(r0 - l0 + 30.0, crest, float(W.F_DAM) - 10.0, 30.0)

if HEROTEST:
    tests = {'dam': dam, 'basilica': basilica_square, 'rival': rival_cathedral, 'palace': domed_palace, 'gardens': hanging_gardens, 'citadel': citadel, 'needle': needle, 'colossus': lambda: colossus_on_plinth(0, 0, 0, 110, 0),
             'castle': great_castle, 'arena': arena, 'monastery': monastery, 'terrace': garden_terrace, 'church': small_church, 'fort': fort, 'angel': lambda: angel(0, 0, 0, 12, 0), 'knight': lambda: knight(0, 0, 0, 12, 0),
             'figures': lambda: [on_plinth(k * 9, 0, 0, 7.2, 0, k) for k in range(8)], 'plaza': lambda: plaza(dict(x=0, y=0, r=30, kind='fountain', upper=True))}
    tests[HEROTEST]()
else:
    build_sites(); build_bridges(); build_dam()
    for q in PLAZAS: plaza(q)
