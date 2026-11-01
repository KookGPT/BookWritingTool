import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { trashIt } from './history'
import { shrink } from './image'
import { type MapDoc, type Pin, uid, useBook } from './store'


function Canvas({ map, adding, sel, onAdd, onSel }: {
  map: MapDoc; adding: boolean; sel: string | null; onAdd: (y: number, x: number) => void; onSel: (id: string) => void
}) {
  const update = useBook((s) => s.update)
  const el = useRef<HTMLDivElement>(null)
  const lmap = useRef<L.Map | null>(null)
  const pins = useRef<L.LayerGroup | null>(null)
  const addRef = useRef(onAdd)
  addRef.current = adding ? onAdd : () => {}

  useEffect(() => {
    const m = L.map(el.current!, { crs: L.CRS.Simple, minZoom: -3, zoomSnap: 0.25, attributionControl: false })
    const bounds: L.LatLngBoundsLiteral = [[0, 0], [map.h, map.w]]
    L.imageOverlay(map.image, bounds).addTo(m)
    m.fitBounds(bounds)
    m.on('click', (e) => addRef.current(e.latlng.lat, e.latlng.lng))
    pins.current = L.layerGroup().addTo(m)
    lmap.current = m
    return () => { m.remove() }
  }, [map.id, map.image, map.w, map.h])

  useEffect(() => {
    pins.current?.clearLayers()
    for (const p of map.pins) {
      L.marker([p.y, p.x], {
        draggable: true,
        icon: L.divIcon({ className: `pin ${p.id === sel ? 'sel' : ''}`, iconSize: [16, 16] }),
      })
        .bindTooltip(p.label, { permanent: true, direction: 'right', className: 'pin-label' })
        .on('click', () => onSel(p.id))
        .on('dragend', (e) => {
          const { lat, lng } = (e.target as L.Marker).getLatLng()
          update((b) => ({ ...b, maps: b.maps.map((mm) => mm.id === map.id ? { ...mm, pins: mm.pins.map((q) => q.id === p.id ? { ...q, y: lat, x: lng } : q) } : mm) }))
        })
        .addTo(pins.current!)
    }
  }, [map.pins, map.id, sel, onSel, update])

  return <div ref={el} className={`leaflet-host ${adding ? 'adding' : ''}`} />
}

export default function MapView() {
  const { book, update } = useBook()
  const [id, setId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [pinId, setPinId] = useState<string | null>(null)
  const map = book.maps.find((m) => m.id === id)
  const pin = map?.pins.find((p) => p.id === pinId)
  const places = book.wiki.filter((w) => w.type === 'location')

  const patchMap = (p: Partial<MapDoc>) =>
    update((b) => ({ ...b, maps: b.maps.map((m) => (m.id === id ? { ...m, ...p } : m)) }))
  const patchPin = (p: Partial<Pin>) =>
    patchMap({ pins: map!.pins.map((q) => (q.id === pinId ? { ...q, ...p } : q)) })

  const upload = async (f?: File) => {
    if (!f) return
    const m: MapDoc = { id: uid(), name: f.name.replace(/\.\w+$/, ''), pins: [], ...(await shrink(f, 2400)) }
    update((b) => ({ ...b, maps: [...b.maps, m] }))
    setId(m.id)
  }
  const addPin = (y: number, x: number) => {
    const p: Pin = { id: uid(), y, x, label: 'New pin' }
    patchMap({ pins: [...map!.pins, p] })
    setPinId(p.id)
    setAdding(false)
  }

  return (
    <div className="write">
      <aside>
        <label className="upload">+ Upload map image
          <input type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} />
        </label>
        {book.maps.map((m) => (
          <div key={m.id} className={`item ${m.id === id ? 'sel' : ''}`} onClick={() => { setId(m.id); setPinId(null) }}>{m.name}</div>
        ))}
        {map && (
          <button className="danger" onClick={() => {
            if (!confirm(`Delete map ${map.name}? (It goes to Trash.)`)) return
            trashIt('maps', map.name, map)
            update((b) => ({ ...b, maps: b.maps.filter((m) => m.id !== map.id) }))
            setId(null)
          }}>Delete map</button>
        )}
      </aside>
      <section className="mapsec">
        {map ? (
          <>
            <div className="row" style={{ alignItems: 'center' }}>
              <input className="grow title" value={map.name} onChange={(e) => patchMap({ name: e.target.value })} />
              <button className={adding ? '' : 'alt'} onClick={() => setAdding(!adding)}>{adding ? 'Click the map...' : '+ Pin'}</button>
            </div>
            <Canvas map={map} adding={adding} sel={pinId} onAdd={addPin} onSel={setPinId} />
            {pin ? (
              <div className="row" style={{ alignItems: 'end' }}>
                <label className="grow">Label<input value={pin.label} onChange={(e) => patchPin({ label: e.target.value })} /></label>
                <label>Wiki location
                  <select value={pin.wikiId ?? ''} onChange={(e) => {
                    const w = places.find((p) => p.id === e.target.value)
                    patchPin({ wikiId: w?.id, ...(w && { label: w.name }) })
                  }}>
                    <option value="">none</option>
                    {places.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </label>
                {pin.wikiId && <Link to={`/wiki/${pin.wikiId}`} className="chip">Open entry</Link>}
                <button className="danger" onClick={() => { patchMap({ pins: map.pins.filter((q) => q.id !== pin.id) }); setPinId(null) }}>Delete pin</button>
              </div>
            ) : <p className="muted">Click + Pin, then the map, to drop a pin. Drag pins to move them; click one to edit.</p>}
          </>
        ) : <p className="muted">Upload a map image to start. Images are shrunk to 2400px so they sync quickly.</p>}
      </section>
    </div>
  )
}
