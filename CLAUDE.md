# Bookwright

Personal book-writing PWA (React + Vite + TS). Book data lives in IndexedDB and syncs to a private GitHub data repo as one JSON file per item.

## Editing the Globe (worlds)

The user wants worlds built and edited mostly by Claude. A world is `seed + params + ops` (see `src/world/ops.ts` for the op language); everything else is generated deterministically.

- Get the world JSON: the user exports it from the Globe panel ("Edit with Claude" > Export JSON), or it is `worlds/<id>.json` in the data repo when sync is on.
- Understand it first: `node scripts/world.ts describe <file>`, `query <file> <lat> <lon>`, `preview <file> out.png [--region N,S,W,E]` (read the PNG).
- Edit `ops` (or `node scripts/world.ts add <file> '<op json>'`), keep ids stable, give features names.
- Always `node scripts/world.ts validate <file>` and fix errors; read warnings; preview the area you changed.
- `node scripts/world.ts brief <file>` prints the full op reference.

## Globe roadmap (approved plan; phases 1-2 done)

Goal: a 3D, high-def, zoomable globe that is the book's world map, built and edited mostly by Claude (the user is not artsy, but names features), tied into wiki, timeline and scenes.

- Done, Phase 1 (`7e67600`): procedural planet (`terrain.ts`, `noise.ts`), cube-sphere LOD tiles in workers (`tile.ts`, `terrain.worker.ts`), camera/rendering (`globe.ts`), page (`WorldPage.tsx`).
- Done, Phase 2 (`9359f2f`): op language (`ops.ts`, `geo.ts`), describe/query/validate/brief (`describe.ts`), CLI `scripts/world.ts`, rivers drawn as lines, panel feature list + import/export + Copy AI brief.
- Phase 3, next: hover highlights a feature (river, range, lake, region...) under the cursor; click opens a popup (name, type, stats, note, wiki link or "create wiki page", rename). Layers with toggles (eye, colour, opacity): cities/towns (points), regions/nations (polygons), borders (lines), religions, roads/trade routes, custom. Layer items are plain JSON on the world (`layers: Layer[]` with items `{id, name, geometry point|line|polygon in [lat,lon], props, wikiId, note}`), editable by Claude via the same CLI/validate/brief loop. Picking idea: analytic ray-sphere hit (already in `Globe.pick`) + distance tests against ops/items (`opDistKm` in `describe.ts`).
- Phase 4: flat projections (equirect/Mercator/Robinson), Atlas/parchment style, contour lines, PNG export.
- Phase 5: wiki/scenes/timeline wiring: `place {worldId, lat, lon}` on wiki location entries, pins for timeline events and scene locations, mini-globe inset on wiki pages, time scrubber (reuse `timelineScale.ts`/`calendar.ts`), party route as a great-circle path with travel time, time-aware region layers, measure tool.
- Phase 6: polish: keep or convert old image maps (`MapView.tsx`), per-op/per-item merge in `merge.ts` (worlds currently merge whole-file), mobile performance caps.

Gotchas:
- The preview pane runs requestAnimationFrame only while visible; when hidden, frames advance only on screenshots, so take a few screenshots before judging tile loading.
- In dev, `window.globe` is the live `Globe` instance (set after `setWorld`). Fly with `globe.flyTo(lat, lon, dist)`, where dist is in planet radii (3 = orbit, 0.004 = near the ground).
- Keep `src/world/*.ts` pure (no DOM, `.ts` import extensions) so node tests and the CLI can run them.
- `setWorld` ignores name/note/wikiId changes, so renames don't rebuild tiles. Keep it that way for layer item labels too.

## Checks
`npx tsc -b`, `npm test`, `npm run build`.
