# Bookwright

Personal book-writing PWA (React + Vite + TS). Book data lives in IndexedDB and syncs to a private GitHub data repo as one JSON file per item.

## Editing the Globe (worlds)

The user wants worlds built and edited mostly by Claude. A world is `seed + params + ops` (see `src/world/ops.ts` for the op language); everything else is generated deterministically.

- Get the world JSON: the user exports it from the Globe panel ("Edit with Claude" > Export JSON), or it is `worlds/<id>.json` in the data repo when sync is on.
- Understand it first: `node scripts/world.ts describe <file>`, `query <file> <lat> <lon>`, `preview <file> out.png [--region N,S,W,E]` (read the PNG).
- Edit `ops` (or `node scripts/world.ts add <file> '<op json>'`), keep ids stable, give features names.
- Always `node scripts/world.ts validate <file>` and fix errors; read warnings; preview the area you changed.
- `node scripts/world.ts brief <file>` prints the full op reference.

## Globe roadmap (approved plan; all 6 phases done)

Goal: a 3D, high-def, zoomable globe that is the book's world map, built and edited mostly by Claude (the user is not artsy, but names features), tied into wiki, timeline and scenes.

- Done, Phase 1 (`7e67600`): procedural planet (`terrain.ts`, `noise.ts`), cube-sphere LOD tiles in workers (`tile.ts`, `terrain.worker.ts`), camera/rendering (`globe.ts`), page (`WorldPage.tsx`).
- Done, Phase 2 (`9359f2f`): op language (`ops.ts`, `geo.ts`), describe/query/validate/brief (`describe.ts`), CLI `scripts/world.ts`, rivers drawn as lines, panel feature list + import/export + Copy AI brief.
- Done, Phase 3: layers (`layers.ts`: `world.layers[]` of `{id,name,kind,color?,opacity?,hidden?,items}`, items have one of `at`/`path`/`area` plus `props`, `note`, `wikiId`; validated in `validate`, listed in `describe`/`brief`, drawn by CLI `preview`). Globe draws them as draped points/lines/fills (`buildOverlays`), hover highlights the nearest feature (`pickFeature`), click opens a popup (rename, note, stats, wiki link/create). Panel has layer eye/colour/opacity. Not yet: text labels on the globe, CLI command to add layer items (edit the JSON).
- Done, Phase 4 (reworked): flat map view. `flat.ts` is pure: projections (equirect/Mercator/Robinson) with a pan/zoom `View` (`makeProj(name, w, h, view)`), `detailOf` (extra noise octaves when zoomed in), and a raster painter with six basemaps (`MAP_STYLES`: atlas parchment, terrain colours, elevation tint, grey relief, dark, political) plus contours. `FlatMap.tsx` owns the canvas: drag/wheel/dbl-click/pinch/keys move the view, a cached whole-world raster is rescaled instantly, then the visible part is resampled sharp after the view settles (`CAP` px per raster). `flatDraw.ts` draws rivers/layers in screen space and places labels greedily by priority (regions, features, big settlements first), skipping any that would overlap a label or a dot. The flat map draws the derived layers too (story pins, route, party, ruler). PNG export saves the current view. Not yet: CLI `--proj`, antimeridian-straddling polygon fills, wrap-around panning.
- Done, Phase 5: `WikiEntry.place {worldId,lat,lon}`; wiki location pages have "Place it on the globe" (opens `/globe?pick=<id>`, next click sets the place) and a "Show on globe" chip (`/globe?w=&lat=&lon=`). Placed entries appear on the globe as a derived read-only "Story places" layer (id `story`, built in `WorldPage`, never saved), whose popup lists the timeline events and scenes set there. Creating a wiki page from a feature popup sets its place.
  Also: `story.ts` (pure: `arc`, `legs` with travel time at a km/day speed, `partyAt`). Globe page "Story" section: party route (great-circle legs between party events whose location entry is placed; legs needing more travel days than the story gives are flagged) and a time slider (item `from`/`to` dates on layers, `activeAt`; the party marker moves along the route by date). Ruler button measures distance (km and days at the chosen speed). Derived layers (`story`, `route`, `party`, `measure`, set `DERIVED` in `WorldPage`) are built per render and never saved. Wiki location pages show a lazy `MiniGlobe`.
  3D camera: `Globe.orbit` (toolbar toggle: plain drag rotates around the focus point; also right-drag, Q/E/W/S), pitch is free from ~0.15 radii out, double-click flies in, popup "Zoom to" frames any feature at 55° pitch (`zoomTo` in `WorldPage`, `flyTo(lat, lon, dist, tilt)`).
  Not yet: scene locations as their own pins (they show in the Story places popup), mini-globe scroll-zoom steals page scroll, measure along terrain (it is great-circle only).
- Done, Phase 6: `mergeWorld` in `merge.ts` three-way merges `worlds/*.json` per op, layer and layer item (fields I changed win, edits beat deletes, base fetched by sha, falls back to two-way). `lightMode()` in `globe.ts` (coarse pointer or narrow screen, and the mini-globe) caps tiles at a third, 2 workers, pixel ratio 1.5, coarser LOD; the flat map renders at 900 px instead of 1400. The old image maps (`MapView.tsx`) are kept on purpose: they are for hand-drawn or pasted images with pins, which the procedural globe doesn't replace; there is no converter.
- Ideas beyond the plan: text labels on the globe, CLI command to add layer items, pan/zoom on the flat map, scene location pins, antimeridian-safe polygon fills.

Gotchas:
- The preview pane runs requestAnimationFrame only while visible; when hidden, frames advance only on screenshots, so take a few screenshots before judging tile loading.
- In dev, `window.globe` is the live `Globe` instance (set after `setWorld`). Fly with `globe.flyTo(lat, lon, dist)`, where dist is in planet radii (3 = orbit, 0.004 = near the ground).
- Keep `src/world/*.ts` pure (no DOM, `.ts` import extensions) so node tests and the CLI can run them.
- `setWorld` ignores name/note/wikiId changes, so renames don't rebuild tiles. Keep it that way for layer item labels too.

## Checks
`npx tsc -b`, `npm test`, `npm run build`.
