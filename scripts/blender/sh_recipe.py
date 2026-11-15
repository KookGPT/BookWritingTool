# Writes examples/stones-hold.json (the Locations recipe) from the same layout the Blender build uses (sh_world.py), so both show one place.
#   python scripts/blender/sh_recipe.py
# v3: a mountain RANGE (massif lumps taken from the Blender height field) cut by a maze of twelve valleys, eleven sites with their own shapes and levels
# (crowns, shelves, terraces, a crescent ridge, a spur, a bowl, a cascade, a mesa), districts that grow from cores along the valleys (so they follow the
# ground, not rectangles), plazas everywhere, a statue-lined bridge from the Rival Cathedral to the Great Castle, and an alpine lake behind a dam.
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
# the great upper sites: peaks, a crescent crest, the palace spur, the bowl's shoulder, the cascade's slope, the mesa
for n, p in W.PEAK.items():
    if p['role'] in ('cathedral', 'basilica', 'rival', 'twin', 'needle', 'castle'): T(id=f'peak-{n.lower()}', kind='peak', at=pt(p['c']), height=R(ALT + p['h'] + 80), radius=520, sharp=0.9)
cres = W.PLATS['A5_c']['poly']; m_ = len(cres) // 2; cmid = [((cres[i][0] + cres[len(cres) - 1 - i][0]) / 2, (cres[i][1] + cres[len(cres) - 1 - i][1]) / 2) for i in range(m_)]
T(id='crest-a5', kind='ridge', path=[pt(q) for q in cmid], height=R(ALT + 600), width=420)
T(id='spur-a8', kind='ridge', path=[[1900, -1250], [1480, -1290], [1075, -1325]], height=R(ALT + 380), width=300)
T(id='shoulder-a9', kind='peak', at=[1850, 250], height=R(ALT + 480), radius=620, sharp=0.7)
T(id='slope-a10', kind='peak', at=[-2330, -1330], height=R(ALT + 470), radius=650, sharp=0.8)
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
    s = 260.0 + 90 * (hash(v.name) % 3); k = 0
    while s < v.L - 200:
        if not lake_side(v, s):
            i = int(np.searchsorted(v.S, s)); P = v.P[i]; big = v.name in ('main', 'sw', 'e1', 'w1', 'e2', 'w2', 'e3', 'w3')
            districts.append(dict(id=f'under-{v.name}-{k}', at=pt(P), radius=R(360 if v.name == 'main' else 320 if big else 260), culture='mountain', density=0.95, wealth=0.06 if v.name == 'main' else 0.1, plan='organic' if big else 'terraced', steep=not big, farms=False))
            k += 1
        s += 650.0
# THE UPPER CITY: 1%, finer houses on each site's terraces, behind a wall
for n, p in W.PEAK.items():
    if n.startswith('K') or p['role'] == 'cascade' or p['role'] == 'mesa': continue
    key = p['tiers'].get('2') or p['tiers'].get('1'); pl = W.PLATS[key]
    districts.append(dict(id=f'upper-{n.lower()}', area=poly(pl['poly']), culture='central', density=0.7, wealth=0.9, plan='radial', farms=False, walls=True))

# ---------------------------------------------------------------- structures
def face_valley(c):
    best = None
    for v in W.VALLEYS:
        P = v.P[v.S < (W.DAM_S - 120 if v.name == 'main' else 1e9)]; d = np.hypot(P[:, 0] - c[0], P[:, 1] - c[1]); i = int(np.argmin(d))
        if best is None or d[i] < best[0]: best = (d[i], P[i])
    return bearing(best[1][0] - c[0], best[1][1] - c[1])
def toward(a, b): return bearing(W.PEAK[b]['anchor'][0] - W.PEAK[a]['anchor'][0], W.PEAK[b]['anchor'][1] - W.PEAK[a]['anchor'][1])
SB = W.STATUE_BRIDGE
for n, p in W.PEAK.items():
    c = p['c']; i = n.lower(); role = p['role']; f = face_valley(c); at = pt(c)
    if n in (SB[0], SB[2]): f = toward(n, SB[2] if n == SB[0] else SB[0])
    if role == 'cathedral': S(id=f'cathedral-{i}', kind='cathedral', at=at, facing=f, scale=1.5)
    elif role == 'basilica': S(id=f'basilica-{i}', kind='basilica', at=at, facing=f, scale=0.5)
    elif role == 'rival': S(id=f'rival-basilica-{i}', kind='basilica', at=at, facing=f, scale=0.55)
    elif role == 'twin':
        S(id=f'cathedral-{i}', kind='cathedral', at=at, facing=f, scale=1.25); S(id=f'basilica-{i}-b', kind='basilica', at=pt(p['c2']), facing=f, scale=0.42)
    elif role == 'palace': S(id=f'domed-palace-{i}', kind='dome', at=at, facing=f, scale=0.7, roof='#5f8a78')
    elif role == 'needle': S(id=f'needle-{i}', kind='tower', at=at, facing=f, width=16, height=190)
    elif role == 'mesa': S(id=f'monastery-{i}', kind='monastery', at=at, facing=f)
    elif role == 'church': S(id=f'church-{i}', kind='church', at=at, facing=f, scale=1.3, culture='mountain')
    elif role == 'fort':
        ring_ = [[R(c[0] + 34 * math.cos(2 * math.pi * k / 6)), R(c[1] + 34 * math.sin(2 * math.pi * k / 6))] for k in range(7)]
        S(id=f'fort-{i}-wall', kind='wall', path=ring_, height=12); S(id=f'fort-{i}-keep', kind='tower', at=at, facing=f, width=22, height=44)
    elif role == 'crescent':                                                         # a rampart along the crest, towers every other bay, three great ones
        S(id='rampart-wall', kind='wall', path=[pt(q) for q in cmid], height=30)
        for k, q in enumerate(cmid):
            if k in (0, len(cmid) - 1): continue
            big = k in (0, len(cmid) // 2, len(cmid) - 1); S(id=f'rampart-tower-{k}', kind='tower', at=pt(q), facing=f, width=24 if big else 14, height=106 if big else 62)
    elif role == 'bowl':                                                             # an arena: a tall ringed wall round a colonnaded oval
        a_, b_ = 150.0, 118.0; S(id='arena-wall', kind='wall', path=[[R(c[0] + a_ * math.cos(2 * math.pi * k / 40)), R(c[1] + b_ * math.sin(2 * math.pi * k / 40))] for k in range(41)], height=40, gates=[[R(c[0] + a_), R(c[1])], [R(c[0] - a_), R(c[1])]])
        S(id='arena-colonnade', kind='colonnade', at=at, facing=0, radius=60, statues=True)
    elif role == 'cascade':                                                          # five garden palaces, one per step, facing down the slope
        dn_ = np.array([62.0, -96.0]); dn_ /= np.hypot(*dn_)
        for k in ['c'] + p['extras']:
            pl = W.PLATS[p['tiers'][k]]; cx_ = sum(q[0] for q in pl['poly']) / len(pl['poly']); cy_ = sum(q[1] for q in pl['poly']) / len(pl['poly'])
            ex, ey = rim((cx_, cy_), math.atan2(dn_[1], dn_[0]), pl['poly'], 40.0); S(id=f'garden-{k}', kind='palace', at=pt((ex, ey)), facing=bearing(dn_[0], dn_[1]), width=96, depth=34, roof='#6d8a5a')
    elif role == 'castle':                                                           # THE GREAT CASTLE: two rings of towered wall, a hall, a great keep, spired towers; the gate faces the statue bridge
        o = np.array(W.PEAK[SB[0]]['anchor'], float) - np.array(c, float); d = o / np.hypot(*o)
        ux, uy = d; px, py = -uy, ux                                                  # local +y points at the bridge (gate side), local x is across
        def L(lx, ly): return [R(c[0] + px * lx + ux * ly), R(c[1] + py * lx + uy * ly)]
        n2 = 14; R2 = 138.0; ringo = [L(R2 * math.cos(2 * math.pi * k / n2 + math.pi / n2), R2 * math.sin(2 * math.pi * k / n2 + math.pi / n2)) for k in range(n2)]
        S(id='castle-outer-wall', kind='wall', path=ringo + [ringo[0]], height=18, gates=[L(0, R2 * math.cos(math.pi / n2))])
        for k, q in enumerate(ringo): S(id=f'castle-outer-tower-{k}', kind='tower', at=q, facing=f, width=14, height=36)
        for sg in (-1, 1): S(id=f'castle-gate-tower-{sg}', kind='tower', at=L(sg * 15, R2 * math.cos(math.pi / n2)), facing=f, width=20, height=50)
        n1 = 10; ringi = [L(84 * math.cos(2 * math.pi * k / n1), 84 * math.sin(2 * math.pi * k / n1)) for k in range(n1)]
        S(id='castle-inner-wall', kind='wall', path=ringi + [ringi[0]], height=30)
        for k, q in enumerate(ringi): S(id=f'castle-inner-tower-{k}', kind='tower', at=q, facing=f, width=20 if k % 2 == 0 else 15, height=62 if k % 2 == 0 else 46)
        S(id='castle-hall', kind='palace', at=L(0, -4), facing=f, width=96, depth=42, roof='#46505c')
        S(id='castle-keep', kind='tower', at=L(0, -34), facing=f, width=32, height=128)
        for k in range(6): a = 2 * math.pi * k / 6 + 0.1; S(id=f'castle-spire-{k}', kind='tower', at=L(44 * math.cos(a), 44 * math.sin(a)), facing=f, width=11, height=84 + (k % 3) * 14)
        S(id='castle-court', kind='plaza', at=L(0, R2 * 0.55 + 20), radius=40, centre='fountain', statues=True)
# colossi on the crowns' rims, looking out over the under city; gate colossi at both ends of the statue bridge (below)
for n in ('A1', 'A2', 'A3', 'A4'):
    p = W.PEAK[n]; c = p['c']; f = face_valley(c); base = math.atan2(math.cos(math.radians(f)), math.sin(math.radians(f)))
    for sg in (-1, 1):
        ang = base + sg * 0.9; x, y = rim(c, ang, p['crown'], 44.0); S(id=f'colossus-{n.lower()}-{"l" if sg < 0 else "r"}', kind='statue', at=pt((x, y)), facing=bearing(math.cos(ang), math.sin(ang)), height=56, color='#c8c2b4')

# bridges at shared deck levels; the statue bridge is a renaissance bridge with a statue on every pier, piers every 20 m
styles = ['gothic', 'renaissance', 'roman', 'gothic', 'roman', 'renaissance', 'gothic', 'roman', 'gothic', 'renaissance', 'inhabited']
for k, (a, ka, b, kb) in enumerate(W.BRIDGES):
    p0, p1, deck, u = bridge_ends(a, ka, b, kb); statue_b = (a, ka, b, kb) == tuple(SB)
    S(id=f'bridge-{a.lower()}-{b.lower()}', kind='bridge', at=pt(p0), to=pt(p1), width=24 if statue_b else 18, span=20 if statue_b else 110, deck=[R(ALT + deck + 1.7), R(ALT + deck + 1.7)], style='renaissance' if statue_b else styles[k % len(styles)])
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
    for x in np.arange(b[0], b[1], 12.0):
        for y in np.arange(b[2], b[3], 12.0):
            sd = float(W.poly_sdf(x, y, p['poly']))
            if sd > -62 or sd < -140 or any(float(W.poly_sdf(x, y, inn)) < 52 for inn in p['inner']) or dseg(x, y) < 60: continue
            cand.append((x, y))
    rg.shuffle(cand); got = []
    for x, y in cand:
        if len(got) >= 2: break
        if all(math.hypot(x - g[0], y - g[1]) > 170 for g in got): got.append((x, y)); S(id=f'plaza-up{up}', kind='plaza', at=pt((x, y)), radius=24, centre=['fountain', 'obelisk', 'statue'][up % 3], statues=True); up += 1

views = [
    dict(name='Under the umbrella', at=[60, -950, -10], heading=330, pitch=12, note='The under city: 99% of the people, houses stacked up the valleys in a maze round the cliffs and benches, the great bridges of the upper city roofing it.', hour=17, weather='cloudy', season='winter'),
    dict(name='Two cities', at=[-700, -3300, 1800], heading=15, pitch=-26, note='The whole hold: a maze of valleys full of the under city, eleven peaks of every shape carrying the upper city at different heights, bridges tying them together.', hour=17, weather='cloudy', season='winter'),
    dict(name='The statue bridge', at=[613, 939, R(ALT + 618.7 - 1.3 + 16)], heading=bearing(-0.341, 0.94), pitch=2, note='A kilometre of bridge lined with statues on both sides, from the Rival Cathedral to the Great Castle.', hour=17, weather='cloudy', season='winter'),
    dict(name='The Great Castle', at=[560, 1180, R(ALT + 640)], heading=bearing(-0.341, 0.94), pitch=-4, note='The castle at the end of the bridge: two rings of walls, a great keep, spired towers.', hour=17, weather='cloudy', season='winter'),
    dict(name='The arena', at=[1500, 80, R(ALT + 420)], heading=75, pitch=-14, note='An arena sunk into the bowl, ringed by palazzi.', hour=17, weather='cloudy', season='winter'),
    dict(name='The cathedral peak', at=[-880, -300, -150], heading=60, pitch=8, note='The first cathedral on its crown, looking over the west and main valleys.', hour=17, weather='cloudy', season='winter'),
    dict(name='The dam and the lake', at=[60, 2300, R(ALT + 420)], heading=3, pitch=-8, note='The glacial lake held above the old city by the dam.', hour=17, weather='cloudy', season='winter'),
]
doc = dict(id='stones-hold', name='Stones Hold', seed='stones-hold-3', size=9600,
    note='Stones Hold is two cities in a mountain range. The UNDER CITY (99% of the people) fills a maze of twelve valleys wall to wall, its streets running round every cliff and bench, with an alpine lake held above it by a dam. The UPPER CITY (1%) sits on eleven sites of different shapes and heights: crowns, shelves and terraces, a crescent crest, a palace spur, an arena bowl, a cascade of garden terraces, a monastery mesa; with cathedrals, basilicas, a great castle, plazas and statues everywhere, and bridges at shared levels tying them together, above all a statue-lined bridge from the Rival Cathedral to the Great Castle. Same layout as the Blender build (scripts/blender/sh_world.py); regenerate with scripts/blender/sh_recipe.py.',
    base=1000, relief=160, snowline=2300, climate='alpine', culture='central', rock='granite', wealth=[1000, 1300], farms=False, forest=0.5, hour=17, weather='cloudy', season='winter',
    terrain=terrain, districts=districts, structures=structures, views=views)
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'examples', 'stones-hold.json')
open(out, 'w').write(json.dumps(doc, indent=2) + '\n'); print('wrote', os.path.normpath(out), len(terrain), 'terrain', len(districts), 'districts', len(structures), 'structures')
