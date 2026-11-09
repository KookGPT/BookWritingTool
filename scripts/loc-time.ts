// Times a location build stage by stage: node scripts/loc-time.ts <location.json>
import { readFileSync } from 'node:fs'
import { buildCity, type LocationDoc } from '../src/locations/city.ts'

const doc: LocationDoc = JSON.parse(readFileSync(process.argv[2], 'utf8')), t0 = Date.now()
const b = buildCity(doc, (s) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)} s  ${s}`))
console.log(`total ${(b.ms / 1000).toFixed(1)} s`, b.stages, b.counts)
