# Writes examples/stones-hold.json (the Locations recipe) from the same layout the Blender build uses (sh_world.py), so both show one place.
#   python scripts/blender/sh_recipe.py
# v4: a mountain RANGE (massif lumps taken from the Blender height field) cut by a maze of twelve valleys; the upper city is seventeen big nodes on the ridge
# blocks between the valleys (crown, shelf and terrace each at its own level, terraces of one block overlapping at one shared level so a block is one
# continuous mass), each dense with houses, palaces, towers and plazas round a great building; tall pointed-arch bridges (one row of arches, as in the Blender
# renders) tie the blocks together, above all a statue-lined bridge from the Rival Cathedral to the Great Castle. Districts of the under city grow from cores
# along the valleys (so they follow the ground, not rectangles); an alpine lake sits behind a dam.
import json, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import sh_world as W

R = lambda v: int(round(v))
ALT = 1000.0                                   # blender z 0 = this altitude
def pt(p): return [R(p[0]), R(p[1])]
def poly(p, step=1): return [pt(q) for q in p[::step]]
def sample(P, n):                              # n evenly spaced points along a polyline (always the two ends)
    idx = np.linspace(0, len(P) - 1, n).round().astype(int); return [pt(P[i]) for i in idx]
def bearing(dx, dy): return R((math.degrees(math.atan2(dx, dy)) + 360) % 360)      # compass: 0 = north, 90 = east
def rim(c, ang, polyg, margin):                # walk from c along ang until the polygon's rim is `margin` m away
    last = (c[0], c[1])
    for r in np.arange(4.0, 600.0, 2.0):
        x, y = c[0] + math.cos(ang) * r, c[1] + math.sin(ang) * r
        if float(W.poly_sdf(x, y, polyg)) > -margin: break
        last = (x, y)
    return last
def lake_side(v, s): return v.name == 'main' and s > W.DAM_S - 120

V = {v.name: v for v in W.VALLEYS}; MAIN = V['main']
terrain = []; districts = []; structures = []
def T(**k): terrain.append(k)
def S(**k): structures.append(k)

# ---------------------------------------------------------------- the range: a ring of crests, then massif lumps copied from the Blender height field
ring = [[(-3500, -2800), (-3700, 0), (-3500, 2700), (-2300, 4300)], [(-2300, 4300), (-300, 4700), (1800, 4500), (3300, 3700)], [(3300, 3700), (3600, 2200), (3700, -200), (3500, -2800)], [(3500, -2800), (1200, -3500), (-1600, -3400), (-3500, -2800)]]
for i, path in enumerate(ring): T(id=f'range-{i + 1}', kind='ridge', path=[[R(q[0]), R(q[1])] for q in path], height=2300, width=1000)
for i, (x, y, h) in enumerate([(-3300, 2400, 2900), (3200, 2200, 2800), (3300, -2300, 2650), (-3200, -2400, 2750), (-1900, 3900, 2950), (1700, 4000, 2850)]):
    T(id=f'horn-{i + 1}', kind='peak', at=[x, y], height=h, radius=1300, sharp=1.5)
gx = np.arange(-3900.0, 3901.0, 300.0); GX, GY = np.meshgrid(gx, gx); Z = W.natural(GX, GY); em, fl, hwn, dm = W.near(GX, GY)
ok = (dm > hwn * 1.25 + 90) & (GY < 4300) & (Z > 120)
cand = sorted(zip(Z[ok].tolist(), GX[ok].tolist(), GY[ok].tolist()), reverse=True); lumps = []
for z, x, y in cand:
    if all(math.hypot(x - a, y - b) > 600 for _, a, b in lumps): lumps.append((z, x, y))
for i, (z, x, y) in enumerate(lumps): T(id=f'massif-{i + 1}', kind='peak', at=[R(x), R(y)], height=R(ALT + z + 40), radius=480, sharp=1.0)
# the upper city's sites: a rock mass under every node (the terraces are cut into it below)
for n, p in W.PEAK.items():
    if not n.startswith('K'): T(id=f'peak-{n.lower()}', kind='peak', at=pt(p['c']), height=R(ALT + p['h'] + 80), radius=620, sharp=0.9)
# the valleys of the under city: one main valley and a maze of side and sub valleys, all draining to the south
for v in W.VALLEYS:
    if v.name == 'main':
        P = v.P[v.S < W.DAM_S - 20]; n = max(5, int(v.S[v.S < W.DAM_S - 20][-1] / 420)); T(id='main-valley', kind='valley', path=sample(P, n), height=R(ALT + float(v.F[0])), end=R(ALT + float(v.F[len(P) - 1])), width=R(np.mean(v.hw) * 2.4), edge=R(np.mean(v.hw) * 0.5), meander=0.3)
    else:
        n = max(4, int(v.L / 420)); T(id=f'{v.name}-valley', kind='valley', path=sample(v.P, n), height=R(ALT + v.F[0]), end=R(ALT + v.F[-1]), width=R(np.mean(v.hw) * 2.4), edge=R(np.mean(v.hw) * 0.5), meander=0.3)
# the alpine lake: a deep finger lake in a U-shaped trough behind the dam, a glacier feeding its head
LP = MAIN.P[MAIN.S > W.DAM_S - 10]
T(id='lake-trough', kind='valley', path=sample(LP, 6), height=R(ALT + W.LAKE_FLOOR), end=R(ALT + W.LAKE_FLOOR), width=420, edge=110, meander=0.15)
def bridge_ends(a, ka, b, kb):
    pa = W.PLATS[W.PEAK[a]['tiers'][ka]]; pb = W.PLATS[W.PEAK[b]['tiers'][kb]]; A = np.array(W.PEAK[a]['anchor'], float); B = np.array(W.PEAK[b]['anchor'], float)
    d = B - A; L = float(np.hypot(*d)); u = d / L; ts = np.arange(0, L, 2.0); X = A[0] + u[0] * ts; Y = A[1] + u[1] * ts
    ia = np.where(W.poly_sdf(X, Y, pa['poly']) > -6)[0]; ib = np.where(W.poly_sdf(X, Y, pb['poly']) > -6)[0]
    i0 = max((int(ia[0]) - 1) if len(ia) else 0, 0); i1 = min((int(ib[-1]) + 1) if len(ib) else len(ts) - 1, len(ts) - 1)
    return (X[i0], Y[i0]), (X[i1], Y[i1]), min(pa['h'], pb['h']) - 1.3, u
# a notch for every bridge where the ground rises above its deck (the bridges are level spans between the platforms)
for a_, ka_, b_, kb_ in W.BRIDGES:
    q0, q1, dk, _u = bridge_ends(a_, ka_, b_, kb_); T(id=f'cut-{a_.lower()}-{b_.lower()}', kind='valley', path=[pt(q0), pt(q1)], height=R(ALT + dk - 30), end=R(ALT + dk - 30), width=150, edge=30, meander=0)
# the terraces: every platform at its own level (lowest first, so the crowns finish last)
for key, p in sorted(W.PLATS.items(), key=lambda kv: (kv[1]['order'], kv[1]['h'])):
    k = key.split('_')[1]; T(id=f'plat-{key.lower()}', kind='plateau', area=poly(p['poly']), height=R(ALT + p['h']), edge=R({'2': 50, '1': 40, 'c': 28}.get(k, 25)))
T(id='lake', kind='lake', path=sample(LP, 4), radius=230, level=R(ALT + W.LAKE_Z), depth=44)
T(id='glacier-head', kind='glacier', path=[[250, 4800], [320, 4650], [380, 4470]], width=300, height=R(ALT + W.LAKE_Z + 40), depth=60)
dn = MAIN.P[MAIN.S < W.DAM_S - 50]
T(id='the-river', kind='river', path=sample(dn, 9)[::-1] + [[-80, -4790]], width=24, depth=4, meander=0.3, mouth='none')

# ---------------------------------------------------------------- districts
# THE UNDER CITY: 99% of the people. Cores every ~650 m along every valley floor; each town grows over the cheapest ground so it follows the benches and cliffs
for v in W.VALLEYS:
    s = 260.0 + 90 * (sum(map(ord, v.name)) % 3); k = 0
    while s < v.L - 200:
        if not lake_side(v, s):
            i = int(np.searchsorted(v.S, s)); P = v.P[i]; big = v.name in ('main', 'sw', 'e1', 'w1', 'e2', 'w2', 'e3', 'w3')
            districts.append(dict(id=f'under-{v.name}-{k}', at=pt(P), radius=R(360 if v.name == 'main' else 320 if big else 260), culture='mountain', density=0.95, wealth=0.06 if v.name == 'main' else 0.1, plan='organic' if big else 'terraced', steep=not big, farms=False))
            k += 1
        s += 650.0
# THE UPPER CITY: 1%, a concrete jungle: big masonry blocks over every terrace of every node (terraces of a block join, so there are no walls between nodes)
for n, p in W.PEAK.items():
    if n.startswith('K'): continue
    key = p['tiers'].get('2') or p['tiers'].get('1'); pl = W.PLATS[key]
    districts.append(dict(id=f'upper-{n.lower()}', area=poly(pl['poly']), culture='central', density=1.0, wealth=0.9, plan='radial', farms=False, walls=False))

# ---------------------------------------------------------------- structures
def face_valley(c):
    best = None
    for v in W.VALLEYS:
        P = v.P[v.S < (W.DAM_S - 120 if v.name == 'main' else 1e9)]; d = np.hypot(P[:, 0] - c[0], P[:, 1] - c[1]); i = int(np.argmin(d))
        if best is None or d[i] < best[0]: best = (d[i], P[i])
    return bearing(best[1][0] - c[0], best[1][1] - c[1])
def toward(a, b): return bearing(W.PEAK[b]['anchor'][0] - W.PEAK[a]['anchor'][0], W.PEAK[b]['anchor'][1] - W.PEAK[a]['anchor'][1])
SB = W.STATUE_BRIDGE
USED = []                                      # (x, y, radius) of everything placed so far on the upper city, so the plazas keep clear
def ring_pts(p, n, margin=58.0, shift=0.5):
    """n points round a node's terrace rim, each with the direction pointing out; starts towards the nearest valley."""
    pl = W.PLATS[p['tiers'].get('2') or p['tiers'].get('1')]; f = face_valley(p['c']); base = math.atan2(math.cos(math.radians(f)), math.sin(math.radians(f))); out = []
    for k in range(n):
        ang = base + 2 * math.pi * (k + shift) / n
        for m_ in (margin, margin + 40.0):
            q = rim(p['c'], ang, pl['poly'], m_)
            if all(float(W.poly_sdf(q[0], q[1], o['poly'])) > 75.0 for o in W.PLATS.values() if o['h'] > pl['h'] + 5 and o['bb'][0] - 90 < q[0] < o['bb'][1] + 90 and o['bb'][2] - 90 < q[1] < o['bb'][3] + 90): out.append((q, ang)); break
    return out
def castle(tag, c, f, d, R2, scale=1.0):
    """A castle: two rings of towered wall, a hall, a great keep, spired towers; local +y (d) is the gate side."""
    ux, uy = d; px, py = -uy, ux
    def L(lx, ly): return [R(c[0] + px * lx + ux * ly), R(c[1] + py * lx + uy * ly)]
    n2 = 14; ringo = [L(R2 * math.cos(2 * math.pi * k / n2 + math.pi / n2), R2 * math.sin(2 * math.pi * k / n2 + math.pi / n2)) for k in range(n2)]
    S(id=f'{tag}-outer-wall', kind='wall', path=ringo + [ringo[0]], height=18, gates=[L(0, R2 * math.cos(math.pi / n2))])
    for k, q in enumerate(ringo): S(id=f'{tag}-outer-tower-{k}', kind='tower', at=q, facing=f, width=14, height=36)
    for sg in (-1, 1): S(id=f'{tag}-gate-tower-{sg}', kind='tower', at=L(sg * 15, R2 * math.cos(math.pi / n2)), facing=f, width=20, height=50)
    r1 = R2 * 0.61; n1 = 10; ringi = [L(r1 * math.cos(2 * math.pi * k / n1), r1 * math.sin(2 * math.pi * k / n1)) for k in range(n1)]
    S(id=f'{tag}-inner-wall', kind='wall', path=ringi + [ringi[0]], height=30)
    for k, q in enumerate(ringi): S(id=f'{tag}-inner-tower-{k}', kind='tower', at=q, facing=f, width=20 if k % 2 == 0 else 15, height=62 if k % 2 == 0 else 46)
    S(id=f'{tag}-hall', kind='palace', at=L(0, -4), facing=f, width=96, depth=42, roof='#46505c')
    S(id=f'{tag}-keep', kind='tower', at=L(0, -34), facing=f, width=32, height=128 * scale)
    for k in range(6): a = 2 * math.pi * k / 6 + 0.1; S(id=f'{tag}-spire-{k}', kind='tower', at=L(R2 * 0.32 * math.cos(a), R2 * 0.32 * math.sin(a)), facing=f, width=11, height=84 + (k % 3) * 14)
    S(id=f'{tag}-court', kind='plaza', at=L(0, R2 * 0.55 + 20), radius=40, centre='fountain', statues=True)
ROOFS = ['#5f8a78', '#6d7a8a', '#8a6a58', '#6d8a5a', '#7a6a8a']
for n, p in W.PEAK.items():
    c = p['c']; i = n.lower(); role = p['role']; f = face_valley(c); at = pt(c)
    if n in (SB[0], SB[2]): f = toward(n, SB[2] if n == SB[0] else SB[0])
    if role == 'cathedral': S(id=f'cathedral-{i}', kind='cathedral', at=at, facing=f, scale=1.75)
    elif role == 'basilica': S(id=f'basilica-{i}', kind='basilica', at=at, facing=f, scale=0.62)
    elif role == 'rival': S(id=f'rival-basilica-{i}', kind='basilica', at=at, facing=f, scale=0.68)
    elif role == 'twin':
        S(id=f'cathedral-{i}', kind='cathedral', at=at, facing=f, scale=1.5); S(id=f'basilica-{i}-b', kind='basilica', at=pt(p['c2']), facing=f, scale=0.5)
    elif role == 'palace': S(id=f'domed-palace-{i}', kind='dome', at=at, facing=f, scale=0.85, roof='#5f8a78')
    elif role == 'needle': S(id=f'needle-{i}', kind='tower', at=at, facing=f, width=18, height=240)
    elif role == 'mesa': S(id=f'monastery-{i}', kind='monastery', at=at, facing=f)
    elif role == 'church': S(id=f'church-{i}', kind='church', at=at, facing=f, scale=1.3, culture='mountain')
    elif role == 'fort':
        ring_ = [[R(c[0] + 34 * math.cos(2 * math.pi * k / 6)), R(c[1] + 34 * math.sin(2 * math.pi * k / 6))] for k in range(7)]
        S(id=f'fort-{i}-wall', kind='wall', path=ring_, height=12); S(id=f'fort-{i}-keep', kind='tower', at=at, facing=f, width=22, height=44)
    elif role == 'bowl':                                                             # an arena: a tall ringed wall round a colonnaded oval
        a_, b_ = 130.0, 102.0; S(id='arena-wall', kind='wall', path=[[R(c[0] + a_ * math.cos(2 * math.pi * k / 40)), R(c[1] + b_ * math.sin(2 * math.pi * k / 40))] for k in range(41)], height=40, gates=[[R(c[0] + a_), R(c[1])], [R(c[0] - a_), R(c[1])]])
        S(id='arena-colonnade', kind='colonnade', at=at, facing=0, radius=52, statues=True)
    elif role == 'gardens':                                                          # terraced palaces round a colonnaded garden court
        S(id=f'garden-court-{i}', kind='colonnade', at=at, facing=f, radius=64, statues=True); S(id=f'garden-fountain-{i}', kind='plaza', at=at, radius=30, centre='fountain', statues=True)
    elif role == 'citadel':                                                          # a second castle, facing the valley
        a = math.atan2(math.cos(math.radians(f)), math.sin(math.radians(f))); castle(f'citadel-{i}', c, f, (math.cos(a), math.sin(a)), 112.0, 0.9)
    elif role == 'agora':                                                            # an open forum: a colonnade round an obelisk, two great towers
        S(id=f'agora-colonnade-{i}', kind='colonnade', at=at, facing=f, radius=58, statues=True); S(id=f'agora-obelisk-{i}', kind='plaza', at=at, radius=32, centre='obelisk', statues=True)
    elif role == 'castle':                                                           # THE GREAT CASTLE: the gate faces the statue bridge
        o = np.array(W.PEAK[SB[0]]['anchor'], float) - np.array(c, float); d = o / np.hypot(*o); castle('castle', c, f, (d[0], d[1]), 138.0, 1.0)
    if n.startswith('K'): continue
    # the node's own palaces and towers round the terrace rim, looking out over the under city
    ring_n = 4 if role == 'agora' else 7
    for k, (q, ang) in enumerate(ring_pts(p, ring_n)):
        if k % 2 == 0: S(id=f'rim-palace-{i}-{k}', kind='palace', at=pt(q), facing=bearing(math.cos(ang), math.sin(ang)), width=84 + 10 * (k % 3), depth=46, roof=ROOFS[(k + len(structures)) % len(ROOFS)]); USED.append((q[0], q[1], 60.0))
        else: S(id=f'rim-tower-{i}-{k}', kind='tower', at=pt(q), facing=bearing(math.cos(ang), math.sin(ang)), width=14 + 2 * (k % 3), height=84 + 18 * (k % 4)); USED.append((q[0], q[1], 24.0))
    USED.append((c[0], c[1], 190.0))
# colossi on the crowns' rims, looking out over the under city; gate colossi at both ends of the statue bridge (below)
for n in ('A1', 'A2', 'A3', 'A4'):
    p = W.PEAK[n]; c = p['c']; f = face_valley(c); base = math.atan2(math.cos(math.radians(f)), math.sin(math.radians(f)))
    for sg in (-1, 1):
        ang = base + sg * 0.9; x, y = rim(c, ang, p['crown'], 44.0); S(id=f'colossus-{n.lower()}-{"l" if sg < 0 else "r"}', kind='statue', at=pt((x, y)), facing=bearing(math.cos(ang), math.sin(ang)), height=56, color='#c8c2b4')

# bridges at shared deck levels, in the style of the renders: one row of tall pointed arches on slender piers (gothic), gate towers at both ends.
# The statue bridge has a figure on each parapet every 8.5 m
for k, (a, ka, b, kb) in enumerate(W.BRIDGES):
    p0, p1, deck, u = bridge_ends(a, ka, b, kb); statue_b = (a, ka, b, kb) == tuple(SB)
    S(id=f'bridge-{a.lower()}-{b.lower()}', kind='bridge', at=pt(p0), to=pt(p1), width=24 if statue_b else 18, span=90 if statue_b else 85, tiers=1, deck=[R(ALT + deck + 1.7), R(ALT + deck + 1.7)], style='gothic', **(dict(statueEvery=8.5) if statue_b else dict(statues=False)))
    if statue_b:
        for sg, e in ((-1, p0), (1, p1)):
            for sd in (-1, 1):
                nx, ny = u[1], -u[0]; S(id=f'gate-colossus-{"a" if sg < 0 else "b"}{"l" if sd < 0 else "r"}', kind='statue', at=pt((e[0] - sg * u[0] * 16 + sd * nx * 11, e[1] - sg * u[1] * 16 + sd * ny * 11)), facing=bearing(-sg * u[0], -sg * u[1]), height=30, color='#c8c2b4')
# the dam holding the lake above the old city (the trough's floor steps up behind it)
S(id='the-dam', kind='wall', path=[[R(W.DAM_X - 150), R(W.DAM_Y)], [R(W.DAM_X + 150), R(W.DAM_Y)]], height=125)

# ---------------------------------------------------------------- plazas: along every valley floor, and on the upper platforms
kinds = ['fountain', 'obelisk', 'statue', 'fountain']; pk = 0
for v in W.VALLEYS:
    s = 330.0
    while s < v.L - 150:
        if not lake_side(v, s + 200):
            i = int(np.searchsorted(v.S, s)); P = v.P[i]; N = v.N[i]; off = (1 if pk % 2 else -1) * min(max(float(v.hw[i]) * 0.5, 52.0), float(v.hw[i]) * 0.85)
            qx, qy = P[0] + N[0] * off, P[1] + N[1] * off
            if any((p['bb'][0] - 120 < qx < p['bb'][1] + 120 and p['bb'][2] - 120 < qy < p['bb'][3] + 120 and float(W.poly_sdf(qx, qy, p['poly'])) < 110) for p in W.PLATS.values()): s += 560.0; continue      # not on a platform's flank
            S(id=f'plaza-u{pk}', kind='plaza', at=pt((qx, qy)), radius=26 + 3 * (pk % 3), centre=kinds[pk % 4], statues=pk % 3 == 0); pk += 1
        s += 560.0
rg = np.random.default_rng(3); BL = [(np.array(W.PEAK[a]['anchor'], float), np.array(W.PEAK[b]['anchor'], float)) for a, ka, b, kb in W.BRIDGES]
def dseg(x, y):
    d = 1e9
    for a_, b_ in BL: t = float(np.clip(((x - a_[0]) * (b_[0] - a_[0]) + (y - a_[1]) * (b_[1] - a_[1])) / (np.hypot(*(b_ - a_)) ** 2), 0, 1)); d = min(d, math.hypot(x - (a_[0] + t * (b_[0] - a_[0])), y - (a_[1] + t * (b_[1] - a_[1]))))
    return d
up = 0
for key, p in W.PLATS.items():
    if not p['fab'] or p['peak'].startswith('K'): continue
    b = p['bb']; cand = []
    for x in np.arange(b[0], b[1], 14.0):
        for y in np.arange(b[2], b[3], 14.0):
            sd = float(W.poly_sdf(x, y, p['poly']))
            if sd > -110 or sd < -240 or any(float(W.poly_sdf(x, y, inn)) < 60 for inn in p['inner']) or dseg(x, y) < 60 or any(math.hypot(x - ux_, y - uy_) < ur_ + 50 for ux_, uy_, ur_ in USED): continue
            cand.append((x, y))
    rg.shuffle(cand); got = []; want = 3 if p['tier'] == 2 else 2
    for x, y in cand:
        if len(got) >= want: break
        if all(math.hypot(x - g[0], y - g[1]) > 190 for g in got): got.append((x, y)); USED.append((x, y, 34.0)); S(id=f'plaza-up{up}', kind='plaza', at=pt((x, y)), radius=26 + 4 * (up % 3), centre=['fountain', 'garden', 'obelisk', 'garden', 'statue'][up % 5], statues=up % 5 != 1 and up % 5 != 3); up += 1

_A3 = np.array(W.PEAK['A3']['anchor'], float); _A7 = np.array(W.PEAK['A7']['anchor'], float); _sd = (_A7 - _A3) / np.hypot(*(_A7 - _A3)); _sh = bearing(_sd[0], _sd[1])
_sb0, _sb1, _sbdeck, _ = bridge_ends(*SB); _cam = np.array(_sb0) + _sd * 90
H17 = dict(hour=17, weather='cloudy', season='winter')
views = [
    dict(name='Under the umbrella', at=[60, -950, -10], heading=330, pitch=12, note='The under city: 99% of the people, houses stacked up the valleys in a maze round the cliffs and benches, the great bridges of the upper city roofing it.', **H17),
    dict(name='Two cities', at=[-700, -3300, 1800], heading=15, pitch=-26, note='The whole hold: a maze of valleys full of the under city, and on the ridge blocks between them the upper city, seventeen dense nodes tied together by bridges.', **H17),
    dict(name='The upper city', at=[3000, -2000, R(ALT + 1100)], heading=bearing(-1700, 2300), pitch=-18, note='A concrete jungle on the heights: the eastern blocks seen from the south-east, palaces, towers, plazas and bridges all joined.', **H17),
    dict(name='Over the great block', at=[250, -450, R(ALT + 980)], heading=bearing(530, 900), pitch=-26, note='The Rival Cathedral on its block, the bridges to the Great Castle and the basilica.', **H17),
    dict(name='The statue bridge', at=[R(_cam[0]), R(_cam[1]), R(ALT + _sbdeck + 18)], heading=_sh, pitch=2, note='A kilometre and a half of bridge lined with statues on both sides, from the Rival Cathedral to the Great Castle.', **H17),
    dict(name='The Great Castle', at=[R(_A7[0] - _sd[0] * 190), R(_A7[1] - _sd[1] * 190), R(ALT + 640)], heading=_sh, pitch=-4, note='The castle at the end of the bridge: two rings of walls, a great keep, spired towers.', **H17),
    dict(name='The arena', at=[1380, -330, R(ALT + 760)], heading=36, pitch=-10, note='The arena block from the south-west: an arena, a citadel and a forum, terraces of houses between them.', **H17),
    dict(name='The bridges', at=[-250, -900, R(ALT + 560)], heading=25, pitch=-14, note='Tall pointed arches in one row, bridges at shared levels tying the blocks of the upper city together over the roofs of the under city.', **H17),
    dict(name='The cathedral peak', at=[-880, -300, -150], heading=60, pitch=8, note='The first cathedral on its crown, looking over the west and main valleys.', **H17),
    dict(name='The dam and the lake', at=[60, 2300, R(ALT + 420)], heading=3, pitch=-8, note='The glacial lake held above the old city by the dam.', **H17),
]
doc = dict(id='stones-hold', name='Stones Hold', seed='stones-hold-4', size=9600,
    note='Stones Hold is two cities in a mountain range. The UNDER CITY (99% of the people) fills a maze of twelve valleys wall to wall, its streets running round every cliff and bench, with an alpine lake held above it by a dam. The UPPER CITY (1%) is a concrete jungle on seventeen big nodes along the ridge blocks between the valleys: each a crown with a great building, a shelf and a terrace at different heights, packed with palaces, towers, houses and plazas, terraces of one block running together, and tall pointed-arch bridges at shared levels tying the blocks together, above all a statue-lined bridge from the Rival Cathedral to the Great Castle. Same layout as the Blender build (scripts/blender/sh_world.py); regenerate with scripts/blender/sh_recipe.py.',
    base=1000, relief=160, snowline=2300, climate='alpine', culture='central', rock='granite', wealth=[1000, 1300], farms=False, forest=0.5, hour=17, weather='cloudy', season='winter',
    terrain=terrain, districts=districts, structures=structures, views=views)
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'examples', 'stones-hold.json')
open(out, 'w').write(json.dumps(doc, indent=2) + '\n'); print('wrote', os.path.normpath(out), len(terrain), 'terrain', len(districts), 'districts', len(structures), 'structures')
