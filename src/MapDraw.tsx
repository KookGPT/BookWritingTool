import { useEffect, useRef, useState } from 'react'
import type { MapDoc } from './store'

export const SEA = '#2d6a9f'
const TERRAIN = [
  { name: 'Sea', color: SEA }, { name: 'Land', color: '#7bb661' }, { name: 'Forest', color: '#3f7d3a' },
  { name: 'Hills', color: '#a89968' }, { name: 'Mountain', color: '#7d7d7d' }, { name: 'Snow', color: '#f2f2f2' },
  { name: 'Desert', color: '#e0c67a' }, { name: 'River', color: '#4aa3df' }, { name: 'Road', color: '#6b4f2a' },
]
const UNDO_LIMIT = 8 // full-canvas snapshots are big; keep few

export default function MapDraw({ map, onSave, onCancel }: { map: MapDoc; onSave: (image: string) => void; onCancel: () => void }) {
  const cv = useRef<HTMLCanvasElement>(null)
  const undo = useRef<ImageData[]>([])
  const last = useRef<{ x: number; y: number } | null>(null)
  const [color, setColor] = useState(TERRAIN[1].color)
  const [size, setSize] = useState(28)

  useEffect(() => {
    const img = new Image()
    img.onload = () => cv.current?.getContext('2d')!.drawImage(img, 0, 0, map.w, map.h)
    img.src = map.image
  }, [map.id, map.image, map.w, map.h])

  const at = (e: React.PointerEvent) => {
    const r = cv.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) * map.w) / r.width, y: ((e.clientY - r.top) * map.h) / r.height }
  }
  const line = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const g = cv.current!.getContext('2d')!
    g.strokeStyle = color
    g.lineWidth = color === TERRAIN[7].color || color === TERRAIN[8].color ? Math.max(3, size / 4) : size // rivers and roads are thin
    g.lineCap = g.lineJoin = 'round'
    g.beginPath()
    g.moveTo(a.x, a.y)
    g.lineTo(b.x, b.y)
    g.stroke()
  }

  return (
    <>
      <div className="row" style={{ alignItems: 'center' }}>
        {TERRAIN.map((t) => (
          <button key={t.name} className="swatch" title={t.name} aria-label={t.name} aria-pressed={color === t.color}
            style={{ background: t.color, outline: color === t.color ? '3px solid var(--fg)' : 'none' }} onClick={() => setColor(t.color)} />
        ))}
        <label className="check">Size <input type="range" min={4} max={120} value={size} onChange={(e) => setSize(+e.target.value)} /></label>
        <button className="alt" onClick={() => { const s = undo.current.pop(); if (s) cv.current!.getContext('2d')!.putImageData(s, 0, 0) }}>Undo</button>
        <button onClick={() => onSave(cv.current!.toDataURL('image/jpeg', 0.85))}>Save drawing</button>
        <button className="alt" onClick={onCancel}>Cancel</button>
      </div>
      <canvas
        ref={cv} width={map.w} height={map.h} className="drawcv"
        onPointerDown={(e) => {
          try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic events have no active pointer */ }
          const g = cv.current!.getContext('2d')!
          undo.current = [...undo.current.slice(-(UNDO_LIMIT - 1)), g.getImageData(0, 0, map.w, map.h)]
          last.current = at(e)
          line(last.current, last.current)
        }}
        onPointerMove={(e) => { if (last.current) { const p = at(e); line(last.current, p); last.current = p } }}
        onPointerUp={() => { last.current = null }}
        onPointerCancel={() => { last.current = null }}
      />
    </>
  )
}
