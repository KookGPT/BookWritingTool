# Bookwright

Personal book-writing PWA (React + Vite + TS). Book data lives in IndexedDB and syncs to a private GitHub data repo as one JSON file per item.

## Editing the Globe (worlds)

The user wants worlds built and edited mostly by Claude. A world is `seed + params + ops` (see `src/world/ops.ts` for the op language); everything else is generated deterministically.

- Get the world JSON: the user exports it from the Globe panel ("Edit with Claude" > Export JSON), or it is `worlds/<id>.json` in the data repo when sync is on.
- Understand it first: `node scripts/world.ts describe <file>`, `query <file> <lat> <lon>`, `preview <file> out.png [--region N,S,W,E]` (read the PNG).
- Edit `ops` (or `node scripts/world.ts add <file> '<op json>'`), keep ids stable, give features names.
- Always `node scripts/world.ts validate <file>` and fix errors; read warnings; preview the area you changed.
- `node scripts/world.ts brief <file>` prints the full op reference.

## Checks
`npx tsc -b`, `npm test`, `npm run build`.
