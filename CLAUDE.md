# Bookwright

Personal book-writing PWA (React + Vite + TS). Book data lives in IndexedDB and syncs to a private GitHub data repo as one JSON file per item.

## Editing the Globe (worlds)

The user wants worlds built and edited mostly by Claude. A world is `seed + params + ops` (see `src/world/ops.ts` for the op language); everything else is generated deterministically.

- Get the world JSON: the user exports it from the Globe panel ("Edit with Claude" > Export JSON), or it is `worlds/<id>.json` in the data repo when sync is on.
- Understand it first: `node scripts/world.ts describe <file>`, `query <file> <lat> <lon>`, `preview <file> out.png [--region N,S,W,E]` (read the PNG).
- Edit `ops` (or `node scripts/world.ts add <file> '<op json>'`), keep ids stable, give features names.
- Always `node scripts/world.ts validate <file>` and fix errors; read warnings; preview the area you changed.
- `node scripts/world.ts brief <file>` prints the full op reference.

## Globe roadmap (approved plan; phases 1-4 done)

Goal: a 3D, high-def, zoomable globe that is the book's world map, built and edited mostly by Claude (the user is not artsy, but names features), tied into wiki, timeline and scenes.

- Done, Phase 1 (`7e67600`): procedural planet (`terrain.ts`, `noise.ts`), cube-sphere LOD tiles in workers (`tile.ts`, `terrain.worker.ts`), camera/rendering (`globe.ts`), page (`WorldPage.tsx`).
- Done, Phase 2 (`9359f2f`): op language (`ops.ts`, `geo.ts`), describe/query/validate/brief (`describe.ts`), CLI `scripts/world.ts`, rivers drawn as lines, panel feature list + import/export + Copy AI brief.
- Done, Phase 3: layers (`layers.ts`: `world.layers[]` of `{id,name,kind,color?,opacity?,hidden?,items}`, items have one of `at`/`path`/`area` plus `props`, `note`, `wikiId`; validated in `validate`, listed in `describe`/`brief`, drawn by CLI `preview`). Globe draws them as draped points/lines/fills (`buildOverlays`), hover highlights the nearest feature (`pickFeature`), click opens a popup (rename, note, stats, wiki link/create). Panel has layer eye/colour/opacity. Not yet: text labels on the globe, CLI command to add layer items (edit the JSON).
- Done, Phase 4: flat map view (`flat.ts` pure projections equirect/Mercator/Robinson + atlas/terrain raster painter + contours, `flatDraw.ts` canvas overlays for rivers/layers/labels, Globe page "Flat map" toggle with PNG export). Sampling is cached per terrain+projection (`groundSpec`), so style/contour/label changes repaint fast. Not yet: pan/zoom on the flat map, CLI `--proj`, antimeridian-straddling polygon fills.
- Phase 5, next: wiki/scenes/timeline wiring: `place {worldId, lat, lon}` on wiki location entries, pins for timeline events and scene locations, mini-globe inset on wiki pages, time scrubber (reuse `timelineScale.ts`/`calendar.ts`), party route as a great-circle path with travel time, time-aware region layers, measure tool.
- Phase 6: polish: keep or convert old image maps (`MapView.tsx`), per-op/per-item merge in `merge.ts` (worlds currently merge whole-file), mobile performance caps.

Gotchas:
- The preview pane runs requestAnimationFrame only while visible; when hidden, frames advance only on screenshots, so take a few screenshots before judging tile loading.
- In dev, `window.globe` is the live `Globe` instance (set after `setWorld`). Fly with `globe.flyTo(lat, lon, dist)`, where dist is in planet radii (3 = orbit, 0.004 = near the ground).
- Keep `src/world/*.ts` pure (no DOM, `.ts` import extensions) so node tests and the CLI can run them.
- `setWorld` ignores name/note/wikiId changes, so renames don't rebuild tiles. Keep it that way for layer item labels too.

## Checks
`npx tsc -b`, `npm test`, `npm run build`.
