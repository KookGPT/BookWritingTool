# Locations plan

The plan, status and session log for the **Locations** tab (`/locations`, `src/locations/`).
CLAUDE.md explains how the code works. This file covers what the tool is for, where it stands, and what comes next.

Last updated: 2026-11-09, FIX-6 (rivers never vanish).

---

## 0. How to use this file (read first, every session)

**Start of a session:**
1. Read this file and the Locations section of CLAUDE.md.
2. Work on **one item**: either the ID the user names, or the top unblocked item in "Next up" (section 5). Before writing code, say which one it is, what its "Done when" check is, and which of the three pillars it advances (realism, graphical quality, detail where needed; see section 1).
3. Keep the end goal in mind: the tool should be able to recreate **any** environment with a lot of detail, realism and graphical quality. Prefer general solutions (a better material system, a better erosion model) over fixes that only work for one demo.
   - **Every fix must fix the situation wherever it comes up.** No coordinates, ids or per-demo tuning. Thresholds scale with what they measure (river width, scene size, relief), not absolute numbers picked to make one demo pass. Each fix gets a synthetic test (a made-up case built in the test, like the staircase river in `test/locations.test.ts`), not only a demo audit. Ask: would it hold for a 2 km scene and a 30 km one, a creek and a great river?
4. If the item turns out bigger than one session, split it here first. Then do the first part.

**During the session:**
- Stay on the item. If you notice a different problem, add it to "Known problems" (section 4) instead of fixing it now, unless it blocks the item.
- If a judgement call belongs to the user (looks, scale, story), ask. Don't guess.

**End of a session (before committing):**
1. Run `npx tsc -b`, `npm test`, `npm run build`.
2. Run `node scripts/loc.ts check` on every demo and update the numbers in section 3.
3. Take the standard shots and compare them with the last set (the newest tag in the session log; the first is `base-`, 2026-11-09):
   - In the browser pane, open each demo (`#/locations?l=<id>`) and run `locScene.standard('<tag>-')`, where `<tag>` is new for this session (e.g. `s1110-`). It saves 1280 x 720 JPEGs as `test/out/shots/<tag>-<demo>-<shot>.jpg`. In a hidden pane it takes about 1 min (cliff-test), 4 min (active-lands) and 8 min (showcase); `javascript_tool` gives up after 45 s, so start it with `.then(n => window.__std = n)` and poll.
   - `node scripts/loc-sheet.ts <old>-<demo>- <tag>-<demo>- test/out/sheet-<demo>.html`, then open `http://localhost:5173/BookWritingTool/test/out/sheet-<demo>.html` (or Read the single JPEGs).
   - Nothing may look worse in realism, graphical quality or detail. If something does, fix it or write it down as a problem. `test/out/` is not in git, so the sets only live on this machine.
4. Update this file:
   - add at least one new idea for something the tool can't make yet (to section 5 or "Later / ideas"), so the catalogue keeps growing;
   - mark the item done in section 5 (move it to the log);
   - add or close problems in section 4;
   - add a decision to section 7 if one was made;
   - add a short entry to the Session log (section 8): date, commit, what changed, what you learned, what's next.
5. If the code changed how something works, update CLAUDE.md too. Keep the two from repeating each other: CLAUDE.md says how things work, this file says what to do.

**How the user can start a session** (paste one):
- `Locations: do FIX-2 from plan.md.`
- `Locations: next item from plan.md.`
- `Locations: here are reference images for <thing>; update plan.md and do the first step.`
- `Locations: planning only. Revise plan.md with: <notes>.` (no code)

---

## 1. What the tool is for

### The end goal

**The tool should be able to recreate any environment with a lot of detail, real-world realism and high graphical quality.** Claude writes a recipe; the tool builds the place and you fly over it on a desktop.

"Any environment" covers:
- any landform and climate;
- any water;
- any kind of settlement, from a single ruin, a farm or a mountain pass up to a whole mountain-range city.

Every place should look like it could exist and should hold up when you fly close.

Every session pushes on three pillars and never makes any of them worse:

1. **Realism.** Things look and behave like the real world.
   - Landforms come from natural processes.
   - Water runs downhill and stays in its banks.
   - Towns follow town logic, buildings follow real construction, plants follow climate.
   - Nothing is random or round.
   - It's checked by `audit` and compared with real reference photos, not just eyeballed.
2. **Graphical quality.** The look of a good modern game or a matte painting: rich materials (stone, plaster, tile, wood, metal, ice, water), convincing light, shadow, haze and sky, clean edges, no seams, popping or flicker.
   - The style is **grounded realism**: detailed and varied, not photoreal and not cartoon. It was chosen from mock-ups on 2026-11-08.
3. **Detail where it's needed.**

**And always grow what can be made.** The range of things the tool can create should keep getting bigger: new kinds of environments, landforms, climates, water, plants, structures, building cultures, props and details. Fixing and polishing what exists is necessary, but the catalogue must never stand still. Whenever a session has room, or finds a gap, it adds something new, and every few sessions at least one item should be a brand-new kind of thing (ENV, KIT or DET items, or a new idea added to the roadmap). This follows the detail hierarchy below.

### The detail hierarchy

Detail is a budget. It goes where the eye goes, and it depends on the size of the scene and the distance to the camera.

- **Small scenes** (roughly under 2 km across: a village, a castle, a cliff, a ruin, a single cathedral square) get **high detail everywhere**:
  - houses with doors, window frames, shutters, chimneys, roof tiles and trim;
  - ground at metre scale or finer;
  - single rocks, ground cover and close-up trees;
  - props such as fences, carts, barrels, market stalls and steps.
- **Big scenes** (a city or a range) put the detail on the **focal points**:
  - the megastructures (cathedrals, bridges, aqueducts, palaces, squares, statues);
  - landmarks;
  - whatever the saved views look at.

  Ordinary houses stay cheap massing with good silhouettes and colour variety, because thousands of them read as texture.
- **Always by distance.** Every kind of thing has levels of detail (massing, then ornament, then carving), so close-ups are rich and far views stay fast. Detail that can't be seen from where the camera can be is wasted.
- **Scale decides the tier, not the kind.** A house in a small scene gets the detail a cathedral gets in a big one. Today houses are fixed at tier 0 in every scene; DET-1 fixes that.

### Stones Hold: the flagship

Stones Hold is the hardest test of the end goal and the first big place to build. It is not the only purpose of the tool.

**Stones Hold**, the main city of Eyaris, is in the Dematrus Mountains:
- A whole mountain range turned into a city, spread across valleys and peaks.
- The higher you go, the wealthier it gets: palaces and cathedrals on the peaks, slums in the valley floors.
- Glacial lakes, and aqueducts everywhere.
- Enormous bridges from peak to peak.
- Rival families compete to build the biggest cathedral (references: Cologne, Sagrada Família).
- A St Peter's-style colonnade square, and statues and plazas everywhere.

### How it works with the user
- **The user describes, Claude builds.** The user isn't artsy; they name things and give references. Claude writes and fixes the recipe, checks it, and shows pictures.
- **Variety:** building cultures (four now; more as needed), climates, and seeded variation in every great structure. Two of anything should never look copied.
- **The quality bar is the real world.** For any visual item, compare the shots side by side with reference photos of the real thing (an alpine valley, a fjord, Cologne Cathedral, the Pont du Gard). Write down what still differs.

**Not goals (unless the user changes this):** interiors, walking or first-person view, phones and tablets, AI inside the app, uniform detail on every house in a big scene, putting places on the Map or Globe (later, maybe).

---

## 2. What exists now (capability inventory)

| Area | What works | Main files |
|---|---|---|
| Recipe | `LocationDoc` JSON, `brief` prints the format, `validate`, `describe` | `city.ts`, `scripts/loc.ts` |
| Landforms | peak, island, ridge, valley, coast, fjord, cliff, gorge, canyon, mesa, plateau, glacier, volcano, crater, dunes, geyser, rock forms; glacial cirques; winding valleys | `terrain.ts` |
| Ground surface | Volume ground (SDF + surface nets, quadtree LOD in workers, real overhangs and undercuts), the default. Old height grid plus rock sheets still available | `volume.ts`, `volumeLod.ts`, `rock.ts`, `geometry.ts` |
| Water | stream-power erosion, droplet erosion, lakes at contour level, routed and meandering rivers, falls, deltas, sea, canals | `hydro.ts`, `erode.ts`, `water.ts` |
| Living ground | lava flows and fields, spring terraces, geysers, marshes, steam | `city.ts`, `fx.ts` |
| Towns | grow over cost (valleys, shores, contours), tensor-field streets, stairs, walls, squares, parish churches, harbours, farmland patchwork | `town.ts`, `roads.ts`, `city.ts` |
| Houses | 4 cultures, instanced parts, wealth by zone | `buildings.ts` |
| Great structures | cathedral (high variety), basilica, church, market, colonnade, dome, palace, monastery, tower, plaza, statue, bridge (roman/gothic/renaissance/inhabited), aqueduct (roman/segovia/moorish), wall, harbour | `kit.ts` |
| Detail tiers | 0 massing / 1 ornament (≤2.6 km) / 2 carving (≤800 m), chunked LOD; small places get finer grids | `kit.ts`, `scene.ts` |
| Look | moods (morning..night), weather, seasons, clouds, mist, steam, lava glow, baked AO | `scene.ts`, `shaders.ts`, `fx.ts` |
| Flying | fly controls; views saved in the recipe | `fly.ts` |
| Checking | `audit`: needles, uncovered steps, flat area, stranded sea, river banks, lake shape, glacier, town shape, streets, houses off street, road grades | `check.ts` |
| Pictures | `locScene.shots(...)` and the standard set `locScene.standard(tag)` (saved views, overview, low pass, every structure, every town at street height; 1280 x 720) save JPEGs to `test/out/shots/`; `scripts/loc-sheet.ts` makes a before/after contact sheet | `shots.ts`, `scene.ts`, `vite.config.ts` |
| Demos | `showcase` (glacier to sea, 5 towns, bridge, aqueduct), `active-lands` (volcanic tropical coast), `cliff-test` (2 km cliffs, stack, arch, gorge) | `examples/` |

---

## 3. Baseline numbers (update every session)

Audit on 2026-11-09 after FIX-1 (`node scripts/loc.ts check examples/<demo>.json`):

| Demo | Warnings | Notable |
|---|---|---|
| showcase | 2 | **glacier 18% above banks (bad)**; eastern-hill 18% houses off street; river 1% bank below water, 5 falls |
| active-lands | 0 | 8 inland sea cells; jade-river 0% bank below water, 4 falls |
| cliff-test | 0 | gorge-river 0% |

Before FIX-1: showcase 4 (river 12% / 18 falls, port-town 16% houses off street), active-lands 2 (30 inland sea cells, river 20% / 23 falls), cliff-test 1 (river 45%). Part of that was the audit itself: see the FIX-1 log entry.

Performance (showcase, preview pane, volume ground):
- Build: about 25 s in node, about 50 s in the pane. It is cached in IndexedDB.
- About 15M triangles including shadows; about 30 fps.
- Detail takes a few seconds to arrive after flying somewhere new.

Targets: 0 bad, ≤1 warning per demo, ≥50 fps while flying the showcase, detail within 1 s.

---

## 4. Known problems

Each problem has an ID. Fix items refer to these IDs.

| ID | Problem | Likely cause / where | Severity |
|---|---|---|---|
| P3 | Glacier tongue stands above its banks (18%) | glacier bed vs valley floor, `terrain.ts` glacier | high |
| P4 | Inland cells below sea level (active-lands 8 after FIX-1, was 30: most were the delta trench) | `drySeaPuddles` misses some; volcano/crater basins | low |
| P5 | 18% of houses not on a street in eastern-hill (port-town is under 10% since FIX-1) | `placeAll` vs `townStreets` density on slopes | medium |
| P6 | Heavy ground mesh: about 15M triangles, about 30 fps | volume squares are 64 cubes even on flat ground; shadow casters | high |
| P7 | Detail arrives late when flying | 2 workers, nearest-first queue, no prefetch along the flight direction | medium |
| P8 | The seam between the volume map edge and the backdrop skirt is unchecked | `volumeLod.ts` vs `skirtMesh` | low |
| P9 | Build time 25-50 s; a mountain-range city will be much bigger | single-threaded build, `city.ts` stages | high for Stones Hold |
| P10 | Karst village has 63% dead ends | streets on tower karst; maybe fine | low |
| P11 | No cold/arid demo: fjords, mesas, canyons and dunes have never been looked at | no demo | medium |
| P12 | No quays along town shores | missing feature | low |
| P13 | Editing a location on two devices keeps an "(other device)" copy instead of merging | `merge.ts` | low |
| P15 | Houses are tier 0 in every scene, so small scenes are as plain as big ones | `buildings.ts` has no detail tiers (DET-1) | high |
| P16 | Up close, kit wood, metal, glass and cloth are still flat colours (stone and weathering done in GFX-1a) | materials in `kit.ts`, `shaders.ts` (GFX-1b) | high |
| P17 | Trees, ground cover and props are simple up close; no undergrowth, grass or scattered stones | `city.ts` trees, no ground-cover pass (GFX-4) | medium |
| P18 | Light and render pipeline are basic: no bloom, no screen-space AO, limited shadow range, plain sky | `scene.ts` (GFX-5, ATM-4) | medium |
| P19 | Port Town's square (showcase, shot `town-port-town`): bare levelled sand under a big dark slab overhead, rock wall behind, no market in view | the core sits on a slope (ground 10..63 m round it); the square's levelling vs the volume ground, maybe an overhang | medium |
| P20 | Triangular rock facets on smooth grass slopes (showcase, below the aqueduct) | volume rock where the grid is steep, `volume.ts` | medium |
| P21 | The build cache misses for showcase and active-lands: they rebuild on every visit in the pane (cliff-test hits) | `idbSet` in `LocationsPage.tsx` failing on big builds? Old builds are never deleted (IndexedDB held `loc-build:25..30:cliff-test` at once and no showcase entry), so storage likely fills up: delete other versions' keys when saving | medium |
| P22 | A thin straight horizontal line across the far cliffs (cliff-test `view-sea-cliffs`, both grounds) | maybe the backdrop skirt or the sea plane edge (see P8) | low |
| P23 | Floating grey quads near the river cathedral's base (showcase `structure-river-cathedral`) | a kit part or detail-tier chunk placed off the ground | low |
| P25 | Deltas are a simple fan: channels from one apex, no real branching, no levees or bars (active-lands) | `carveDelta` in `hydro.ts`; see ENV-5 | medium |
| P26 | Jade River reaches the sea over a cliff fall, so its delta starts under a plunge pool | the coast cliff is cut after the river's valley; the river does not cut its own way through the cliff | low |
| P27 | A short flat ribbon ledge sticks out past the rock at the top of a fall | the last ribbon segment above the lip is drawn at full width | low |

---

## 5. Roadmap

Milestones are in order. Each milestone lists its items in order. An item is sized for **one session**. "Done when" is the check that closes it.

### Next up (the short queue)

1. **GFX-1b** Surface detail up close (P16)
2. **DET-1** Detail tiers by scene size (P15)
3. **FIX-2** Glacier sits in its valley (P3)
4. **PERF-1** Lighter volume ground (P6)
5. **SH-0** Stones Hold reference pack (needs the user)

The rule for picking order: keep alternating between fixing what's wrong (realism), raising the look (quality and detail) and **adding new kinds of things** (environments, structures, details), so none of them falls behind. If no "new kind of thing" item was done in the last three sessions, the next one should be.

### M1 Measure first (tooling)
Makes every later session targeted: change, re-shoot, compare.

- ~~TOOL-1 Standard shots and contact sheet~~ (done 2026-11-09, see the log).
- **TOOL-2 Audit score and history.** `loc.ts check --json`, plus a `test/out/audit-history.json` that sessions append to, so numbers are compared and not remembered.
  - Done when: the end-of-session step writes it and prints the change since last time.
- **TOOL-3 Perf readout.** A dev overlay or `locScene.stats()`: fps, triangles, draw calls, pending squares, build stage times.
  - Done when: the numbers in section 3 come from it.

### M2 Fix what's wrong
- ~~FIX-1 Rivers stay in their banks~~ (done 2026-11-09, see the log).
- **FIX-2 Glacier sits in its valley** (P3).
  - Done when: the glacier audit is ≤3%, and shots show ice between moraines.
- **FIX-3 No inland sea** (P4).
  - Done when: stranded sea is ≤2 cells on every demo.
- **FIX-4 Houses face streets** (P5). Adds lanes or courtyards where blocks are deep, and drops houses with no access.
  - Done when: houses off street are ≤10% everywhere.
- **FIX-5 Edge seam** (P8).
  - Done when: low shots along all four map edges show no crack or step.
- **DEMO-1 Cold/arid demo** (P11). Fjord, mesas, canyon and dunes, with one town each. Fix what it reveals as new FIX items.
  - Done when: it builds, the audit is clean, and the shots have been looked at.
- ~~FIX-6 Rivers never vanish~~ (done 2026-11-09, see the log).

### M3 Graphical quality
Raises the look of every scene at once. Each item is done when the standard shots are clearly better side by side, with no fps loss over 15%.

- **GFX-1 Real materials.** A material system shared by kits, houses and ground. Split into three sessions (2026-11-09):
  - ~~GFX-1a Weathering and cut stone~~ (done 2026-11-09, see the log).
  - **GFX-1b Surface detail up close.** Every kit material, not only stone: wood (grain, planks, end grain), metal (hammered sheet, rust and patina by climate), glass (reflections of the sky, leaded panes on great windows, dirt at the edges), cloth, ice. Detail normals and roughness that fade in under ~60 m and out with distance, the same way stone does. Kits need to say which material a surface is beyond colour: add a material id per vertex where `kit.ts` mixes several under one `Mat` (e.g. `dark` doors vs openings).
    - Done when: close shots of a door, a copper roof, a cathedral window and a market stall look like their materials, fps within 15%.
  - **GFX-1c Built ground.** Paving, steps, cobbles and kerbs in the same system (road and plaza surfaces), worn where feet go (centres of streets, thresholds), weeds in the joints by climate.
    - Done when: street-height shots in every town show paving with wear, fps within 15%.
- **GFX-2 Stone that reads as built.** Masonry courses and blocks on great structures (on the carving tier); ashlar vs rubble by wealth and culture; mortar lines; worn edges.
- **GFX-3 Ground close up.** Terrain texture at metre scale: soil, grass, scree, gravel, mud, snow, rock strata, blended by slope, wetness and wear (paths worn where streets and roads run).
- **GFX-4 Vegetation.** Better trees by species and climate, with real crowns and up-close leaves; grass, shrubs, undergrowth and scattered stones as ground cover near the camera; forest edges and clearings that follow terrain and settlement.
- **GFX-5 Render pipeline.** Tone mapping and colour grading per mood, screen-space ambient occlusion, cascaded shadows over the whole view, anti-aliasing without shimmer, bloom (shared with ATM-4).
- **GFX-6 Water quality.** Reflections, refraction and depth colour, foam at rocks and falls, wet shore bands, ripples by wind, ice on cold lakes.

### M4 Detail hierarchy
Makes detail follow scene size and focus, as section 1 says.

- **DET-1 Detail tiers by scene size.** Houses get tiers too: doors, window frames, shutters, sills, chimneys, eaves, balconies and signs on tier 1, and fine trim on tier 2. Small scenes switch them on everywhere; big scenes only near focal points and the camera.
  - Done when: a village close-up in a small demo looks hand-built, and the showcase fps doesn't drop.
- **DET-2 Focal points.** The recipe can mark things as focal (and the saved views mark what they look at automatically); focal things get more detail budget and stay detailed further out.
- **DET-3 Street props for small scenes.** Fences, walls, carts, barrels, stalls, wells, steps, lamps, washing lines, placed by town logic (market, harbour, farmyard).
- **DET-4 A small showcase.** A demo under 2 km (a castle village on a crag, or a harbour town) that shows the top of the hierarchy.
  - Done when: the close-up shots hold up next to reference photos.

### M5 Any environment (realism breadth)
The end goal is any environment, so every kind has to be built, looked at and compared with reference photos.

- **ENV-1 Environment matrix.** A table in this file: every landform, climate, water kind and settlement kind, with columns for "built", "in a demo", "checked against references" and "looks real". It lists what's missing.
- **ENV-2 onward: one demo per missing row.** Examples: cold or arid (DEMO-1), desert oasis town, arctic coast, rainforest river, steppe, wetlands and marsh, high pass with a fortress, mining valley, coastal ruins. Each finds its own FIX and KIT items.
- **ENV-3 Ruins and age.** Any structure can be ruined or aged: collapsed roofs, broken arches, overgrowth, rubble. Old places need this to look real.
- **ENV-4 More building cultures** as the user asks (for example Nordic timber, desert mud brick, East Asian), each with houses, a church or temple, and a market.
- **ENV-5 Real deltas and river mouths** (P25, P26). Distributaries that split again and again and wander, natural levees, mouth bars, a lobate front that differs by kind (arcuate like the Nile, bird's foot like the Mississippi, cuspate); a river cuts its own way through a coastal cliff instead of falling over it.
  - Done when: the active-lands delta holds up next to reference photos from the air, and the audit checks that every distributary reaches the sea.

### M6 Performance for a mountain-range city
Stones Hold is maybe 15-30 km across, with tens of thousands of buildings and dozens of megastructures. The current numbers won't carry that.

- **PERF-1 Lighter volume ground** (P6). Fewer cubes on flat or low-relief squares (adaptive C), cheaper shadow casters, merge distant squares.
  - Done when: showcase fly-through is ≥50 fps with the same look in the standard shots.
- **PERF-2 Faster detail arrival** (P7). Prefetch along the flight direction, more workers on big machines, and prioritise what's on screen.
  - Done when: detail appears within 1 s.
- **PERF-3 Faster builds** (P9). Run stages in parallel workers (ground, towns, kits), cache stages separately so a recipe edit only rebuilds what changed.
  - Done when: a structure edit rebuilds in ≤3 s and a full showcase build in ≤15 s in the pane.
- **PERF-4 Scale test.** A synthetic 25 km place with 50k houses and 30 great structures.
  - Done when: it builds and flies at an acceptable rate, or the limits are written down here.

### M7 Megastructures for Stones Hold
Each kit gets variety from a seed and a few named `style`s, uses the detail tiers, and is checked against the ground (footings, spans, grades).

- **KIT-1 Peak-to-peak bridges.** Very long spans across deep valleys: multi-tier stone viaducts, chained arches between rock pylons, and possibly bridges carrying streets and houses. Needs the decision in Q3.
- **KIT-2 Valley aqueducts.** Multi-tier aqueducts that follow a real gradient from glacial lakes, with siphon towers, distribution castles (castellum) and fountains. They should be routed, not just placed: water must flow downhill along the whole line.
- **KIT-3 Organic cathedral** (Sagrada Família family): clustered spindle towers, tree-like columns, sculpted façades. A second family next to the Gothic `cathedral`.
- **KIT-4 Colossal cathedral scale.** Let `cathedral` grow to 2-3x Cologne: more bays, double aisles, tower clusters, flying buttress tiers.
- **KIT-5 St Peter's square.** Elliptical colonnade with statues on the attic, an obelisk, fountains and a dome church behind (extends `colonnade` + `dome`).
- **KIT-6 Colossal statues and monuments.** Statues of 30-100 m on peaks and at bridge heads, triumphal arches, columns.
- **KIT-7 Dams and glacial lake works.** Masonry dams, spillways, cisterns, lake-edge terraces.
- **KIT-8 Vertical city pieces.** Grand staircases, ramps, lifts or funiculars, cliff-hung houses, terraces cut into rock, tunnels and gates through ridges.
- **KIT-9 Peak palaces and family compounds.** Palace complexes on summits with walls, gardens, towers and a family church.

Each kit is done when: three seeds look different, they sit correctly on uneven ground in the shots, and they are in a demo.

### M8 The mountain city itself (town logic at range scale)
- **CITY-1 Wealth by altitude.** Districts take their wealth from height and view, not just distance from the core. Slums go in the valley floors and along rivers; palaces go on the peaks. Houses, streets and density follow.
- **CITY-2 Many districts, one city.** Several cores on different peaks and valleys, joined by main roads, bridges and stairs into one network. Shared walls where it makes sense.
- **CITY-3 Building on steep ground.** Houses stepping down slopes, built onto cliffs, terraces with retaining walls (today steep ground is mostly avoided).
- **CITY-4 Civic network.** Plazas at junctions, statues in plazas, fountains fed by the aqueducts, market streets.
- **CITY-5 Districts by character.** Cathedral quarter, guild quarter, harbour or lake quarter, slum. Each has its own house mix and street pattern.

### M9 Atmosphere
- **ATM-1 Valley fog and cloud seas.** Clouds below the peaks, fog pooled in valleys at dawn.
- **ATM-2 City at night.** Lit windows by wealth, lanterns on bridges, fires in the slums, glowing cathedral windows.
- **ATM-3 Smoke and life.** Chimney smoke by district, birds around peaks, banners.
- **ATM-4 Light quality.** Bloom, better sky and haze with distance, sun shafts through valleys, water reflections.
- **ATM-5 Weather on stone.** Wet stone in rain, snow on roofs and ledges in winter.

### M10 Flying and presentation
- **FLY-1 Better flight.** Smooth speed by altitude, collision with the volume ground, orbit-a-structure mode.
- **FLY-2 Tours.** Camera paths through saved views, exported as a sequence of stills or a video.
- **FLY-3 Photo mode.** Hide UI, set mood/time/weather, export a high-res still.
- **FLY-4 Views in the page.** Save the current camera as a named view in the recipe, from the page.

### M11 Authoring loop
- **AUTH-1 Description to recipe checklist.** A written procedure in `brief`: reference images → landforms → water → districts → megastructures → views → audit → shots.
- **AUTH-2 Structure audit.** Add checks for great structures: footings in the ground, bridge ends on land, aqueduct gradient, nothing in water that shouldn't be, overlaps between structures.
- **AUTH-3 Book links.** Link a location to wiki pages and scenes (later, like the Globe's places).

### M12 Stones Hold
- **SH-0 Reference pack** (user). Images and notes for: the range's shape, the cathedrals, bridges, aqueducts, the square, the slums, the mood. Put them in `refs/stones-hold/`, and answer the questions in section 6.
- **SH-1 Blockout.** A first recipe from existing parts only: the range, lakes, districts and placeholder megastructures. Its main output is a **gap list** added to this plan.
- **SH-2 onward.** Fill the gaps in the order the user cares about most. Each session adds one megastructure or one district and re-shoots.

### Later / ideas (not planned)
Quays along town shores (P12); a field-wise merge for locations (P13); showing locations on the Map or Globe; scene and wiki pins.
- Braided rivers: wide gravel beds with shifting channels and bars below glaciers (the showcase's upper valley would have one).
- Shot sheets that score each pair by pixel difference, so the sheet opens on what changed most.
- Rivers by season: high water and brown floods in spring melt, low water with gravel bars showing in late summer (the season switch exists; the channel would need a bankfull and a low-water level).
- Age as a recipe knob: a place (or one structure) says how old and how kept it is, and weathering, moss, missing render and broken tiles follow (feeds ENV-3 ruins).
- Rivers in winter: ice along the banks, frozen falls as hanging icicle curtains, snow on the gravel bars (the season switch already exists).

---

## 6. Open questions for the user

These block or shape items. Answer any time; write the answer into section 7.

- **Q1 Size of Stones Hold.** How big is the range, roughly (10 km? 30 km?), and how many people live there? This drives PERF-4 and CITY-*.
- **Q2 Engineering realism.** Eyaris has no fantasy features. Should megastructures stay within what pre-modern masonry could build (spans up to about 100 m per arch, viaducts many arches long), or are they allowed to be "heroic" beyond real engineering?
- **Q3 Peak-to-peak bridges.** Should they be stone arches (many tiers deep, valley gets filled with piers), chain or suspension bridges, or both?
- **Q4 Era and technology.** Medieval, Renaissance, or early modern? This affects glass, iron, lifts and lighting.
- **Q5 Cultures in the city.** Which of the four building cultures, or a new Stones Hold style of its own?
- **Q6 Families.** How many rival families or cathedrals are there, and does each have a different style?
- **Q7 Performance floor.** What fps is acceptable while flying on your machine (30? 60?)?
- **Q8 Priority after the fixes.** Megastructure kits first, or atmosphere first?

---

## 7. Decisions (keep; add with date)

- 2026-11-08: The goal is massive cityscapes; Stones Hold comes first, but is not built until reference images arrive.
- 2026-11-08: Style is **Grounded realism**. The PBR street style of Phase 0 was rejected.
- 2026-11-08: Desktop only, no interiors, no walking view; flying matters.
- 2026-11-08: Everything placed needs a natural or town-logic cause, checked by `audit`.
- 2026-11-09: Detail hierarchy: great structures get ornament and carving tiers; small places get finer grids.
- 2026-11-09 (later): **End goal stated: recreate any environment with a lot of detail, realism and graphical quality.** Every session pushes realism, graphical quality and detail where needed. Detail follows scene size and focus: small scenes get high detail everywhere (houses included), big scenes put it on focal points and megastructures. This replaces "houses always stay at tier 0".
- 2026-11-09: **Always grow the catalogue.** Sessions keep adding new kinds of environments, structures and details, alongside fixes and polish.
- 2026-11-09: The map is only a small margin wider than the place (`margin` 0.35 x size).
- 2026-11-09: **Volume ground is the default** (one SDF surface for ground and rock). Reason: the height grid can't do overhangs, and the cliff sheets left seams. The grid stays available with `volume: false`.
- 2026-11-09: Sessions are driven by this plan, one item each, with measurable "done when" checks.

---

## 8. Session log (newest first)

**2026-11-09: `c594e35` FIX-6 rivers never vanish.**
- Measured in the browser, not guessed: rays cast down onto every river point as it is drawn, from each saved view. The height grid was fine (new audit line "hidden or thinned by the ground": 0% everywhere); the volume ground was not. Its coarse levels sample the grid only at cube corners, so any channel narrower than a cube (about distance/150) closed over: from "The whole valley" 79 of 246 river points were under the ground, 21 by over 2 m, all 5-10 km away. (First count said 224: the raycaster also hits hidden LOD meshes; count visible ones only.)
- Fix for any water (`volume.ts` `Hv`): the build marks every grid vertex under water (`volume.wet`: river channels, lakes, plunge pools); a coarse column whose footprint holds water takes the lowest underwater ground in it, so water keeps an opening at least one cube wide at every level of detail. Now 0-1 of 241 points covered from every saved view. Test: a 10 m channel on an 8 m grid meshed with 32 m cubes closes without the mask and stays open with it.
- Rivers keep at least ~1.5 px on screen (`water.ts`: ribbon vertices carry their offset from the centre line, `across`; far away they move out to 0.75 px * distance, inside that opening), so a distant river is a line, not dashes. Up close nothing changes.
- P24 fixed: a river gives way to a lake only where the lake surface is drawn (cells in `lakeDrawn`), not wherever a lake vertex is near; the ribbon out of Glacier Lake is whole.
- FIX-1 thresholds scale with the river: a fall is a step over 2.5 channel depths (min 6 m), falls closer than 7 widths are one, the grade is read over 8 widths (demos unchanged: 10 m / ~250 m / ~290 m for them).
- Not done: wider and deeper channels in general. The measurements showed the width was not the cause, so true widths stay; the minimum on screen covers the far view. If rivers still look too thin up close, that is a recipe width (or a new default) to decide with the user.
- Shots: `fix6-` sets vs `gfx1-`: the whole-valley view now shows the river as one line from the town up to the lake.
- Next: GFX-1b.

**2026-11-09: `c768189` GFX-1a weathering and cut stone.**
- GFX-1 split into 1a (this), 1b surface detail up close, 1c built ground.
- `shaders.ts`: shared `WEATHER` for everything built (great-structure stone, roof, dark and metal; house walls, roofs and parts), switched on by `atmo(..., { weather: true })`. It only reads where a surface is: height above the real ground (the height texture, now shared as `tGround`), its facing (the smooth geometric normal), and the climate's dampness (`DAMP` by climate, `uDamp`). Rising damp and splash at the foot, rain streaks, moss on faces turned from the sun and on ledges in damp climates, bleaching in dry ones, varied roughness. The house walls' own foot grime and streaks went into it.
- `STONE` (great structures): courses laid in each face's own frame (level along any wall, paving on tops), blocks of varied length and tint, recessed mortar, worn arrises, drums only on curved surfaces (columns, statues), all fading out once a joint is under a pixel.
- Learned: masks built from the bumped normal speckle (a tiny normal wobble times world coordinates of ~1 km jumps the noise); use the geometric normal and frame-free noise. Cost was +16% on the cathedral view at first; cut to +9% (street +2%, overview none) by sharing noise lookups (four in weathering, three in stone). Timing method: render 20 frames with a 1-pixel `readPixels` after each (gl.finish does not wait in the pane).
- Shots: `gfx1-` sets for all three demos vs `fix1-`; close shots `gfx1-close-*` (cathedral base, bridge pier, a street).
- The user saw rivers get very thin and drop out in places: P28, new item FIX-6 at the top of the queue.
- Next: FIX-6, then GFX-1b.

**2026-11-09: `adc4a36` FIX-1 rivers stay in their banks.**
- Measured first. Most of the "bank below the water" was the audit: it read the nearest grid vertex (13.7 m cells; on a steep reach that is a step down the slope, metres lower), counted samples off the map edge (cliff-test's river starts off the map) and counted lakebed inside lakes and plunge pools as bank. The audit now samples the drawn (bilinear) ground and skips those; a cascade of steps counts as one fall.
- Real faults fixed in `hydro.ts`: the delta apex sat a fixed 3.6 km back from the mouth, so its channels cut a sea-level trench beside a river still 70 m up (active-lands: also most of its 30 inland sea cells); now the apex is where the river reaches the sea, and the fan grows out from there with a rounded lobed front and wandering channels. The water profile reads banks in 18 directions (turned up and down stream) instead of 2. The running-minimum staircase is smoothed: steps over 10 m are falls (the biggest one per 250 m), the rest wear back into a steady incline no steeper than 1.3x the reach's own grade (falls left out of that grade). Water still only goes down and only cuts deeper.
- Drawing (`city.ts`, `water.ts`): plunge pools are filled with water (they were dry pits); a fall run is one curtain along a throw curve (out with time, down with time squared), a little narrower than the river, with streaks sliding down it, see-through between streaks and at the edges; the ribbon gives way to the pool at its foot. Flow texture coordinates are metres along the water, down the falls too.
- Numbers: showcase river 12% -> 1%, 18 -> 5 falls; jade-river 20% -> 0%, 23 -> 4 falls; gorge-river 45% -> 0%. Showcase warnings 4 -> 2, active-lands 2 -> 0, cliff-test 1 -> 0.
- Shots: `fix1-` sets for all three demos; sheets `test/out/sheet-<demo>.html` (`base-` vs `fix1-`). The gorge fall is a curtain into a pool; the active-lands delta is a small arcuate fan instead of a large plain that land mostly hid.
- Not done from the old FIX-1 text: routing on a finer grid in steep ground was not needed once the measurements were right.
- Learned: measure before fixing; two of the three "worst" numbers were the ruler. New problems P24-P27, new item ENV-5.
- Next: GFX-1, compare with `fix1-`.

**2026-11-09: `1109287` TOOL-1 standard shots and contact sheet.**
- `shots.ts` (pure): `standardShots(doc, groundAt)` = every saved view (with its hour, weather, season), overview, low pass, each recipe structure (lines from the side, others three-quarters from the front, raised until the sight line clears hills, from the other side if that is much lower), each town at street height from the end of its square (or, when the recipe gave the town its own plaza, from that plaza towards the nearest great building). Tested in `locations.test.ts`.
- `locScene.standard(tag)` shoots it; `shots` now draws at a fixed 1280 x 720, so sets from any window size line up.
- `scripts/loc-sheet.ts` pairs two sets into one HTML page (images embedded).
- Shot sets: `base-` for all three demos (the baseline); `grid-cliff-test-` (the old height-grid ground) as the first before/after sheet.
- Audit numbers unchanged (no build change).
- Learned: the shots found five new problems at once (P19-P23). Shooting is slow in a hidden pane (about 15 s a shot on the showcase).
- Next: FIX-1, then compare its shots with `base-`.

**2026-11-09: planning** (no code).
- Wrote this plan and recorded the baseline audit.
- The user set the end goal: any environment, with a lot of detail, realism and graphical quality, and the detail hierarchy by scene size.
- Added milestones M3 Graphical quality, M4 Detail hierarchy and M5 Any environment.
- Added the "always grow what can be made" rule: new environments, structures and details are added steadily, not only fixes.
- Next: TOOL-1.

**2026-11-09: `69b21b6` volume ground by default.**
- Ground and rock became one SDF surface, meshed by surface nets in a quadtree LOD in 2 workers.
- Added the Ground switch on the page, the `cliff-test` demo and the volume tests.
- Learned: it fixed the coast cones and cliff seams and gave real undercuts. The cost is about 15M triangles and late detail (P6, P7).

**2026-11-09: `9b303a1` detail tiers, cathedral and bridge variety, terrain pass.**
- Builder tiers 0/1/2 with chunked LOD.
- The cathedral is now varied (spires, transepts, chevet, west front).
- Bridge styles: roman, gothic, renaissance, inhabited. Aqueduct styles: roman, segovia, moorish.
- Terrain: cirques and winding valleys. Rivers: banks widen with the cut. The backdrop is a small margin.
- Learned: the height grid with rock sheets kept producing seams, which led to the volume prototype.

**2026-11-08: `29b0c74` natural terrain, water, towns, audit.** The realism pass: landforms with causes, stream-power erosion, routed rivers and glaciers, towns with streets, squares, walls and farmland, and `audit`. Added the `active-lands` demo.

**2026-11-08: `1bbcb35` cultures, terrain, water, showcase.** Four building cultures, the glacier-to-sea showcase.

**2026-11-08: `191a31f` Locations tab.** City-scale 3D places built from recipes.
