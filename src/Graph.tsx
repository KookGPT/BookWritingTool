import { Background, Controls, Panel, ReactFlow, useNodesState, type Edge, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { allTypes, useBook } from './store'

const COLORS = ['#8ab4ff', '#f2994a', '#6fcf97', '#bb6bd9', '#eb5757', '#f2c94c', '#56ccf2', '#9b9b9b', '#27ae60']

// Entries start on a circle grouped by type. Drag a node to move it; its spot is saved on the entry (and syncs).
export default function Graph() {
  const { book, update } = useBook()
  const nav = useNavigate()
  const typeNames = Object.keys(allTypes(book))
  const built = useMemo(() => {
    const entries = [...book.wiki].sort((a, b) => typeNames.indexOf(a.type) - typeNames.indexOf(b.type))
    const r = Math.max(200, entries.length * 28)
    const nodes: Node[] = entries.map((w, i) => {
      const a = (i / entries.length) * Math.PI * 2
      const color = COLORS[Math.max(0, typeNames.indexOf(w.type)) % COLORS.length]
      return {
        id: w.id, position: w.pos ?? { x: r + Math.cos(a) * r, y: r + Math.sin(a) * r }, data: { label: w.name },
        style: { background: color, color: '#111', border: 0, borderRadius: 8, padding: 8 },
      }
    })
    const edges: Edge[] = entries.flatMap((w) =>
      (w.links ?? []).filter((l) => book.wiki.some((x) => x.id === l.to)).map((l, i) => ({
        id: `${w.id}-${l.to}-${i}`, source: w.id, target: l.to, label: l.label, animated: false,
      })),
    )
    return { nodes, edges }
  }, [book.wiki, typeNames.join()]) // eslint-disable-line react-hooks/exhaustive-deps
  // React Flow needs its own node state to be draggable; rebuild it when the wiki changes.
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(built.nodes)
  useEffect(() => setNodes(built.nodes), [built.nodes, setNodes])

  const savePos = (_: unknown, n: Node) =>
    update((b) => ({ ...b, wiki: b.wiki.map((w) => (w.id === n.id ? { ...w, pos: { x: Math.round(n.position.x), y: Math.round(n.position.y) } } : w)) }))
  const reset = () => update((b) => ({ ...b, wiki: b.wiki.map(({ pos: _pos, ...w }) => w) }))

  return (
    <div style={{ height: '100vh', width: '100%' }}>
      {book.wiki.length ? (
        <ReactFlow
          nodes={nodes} edges={built.edges} onNodesChange={onNodesChange} onNodeDragStop={savePos}
          colorMode={document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'} fitView
          onNodeDoubleClick={(_, n) => nav(`/wiki/${n.id}`)}
        >
          <Background />
          <Controls showInteractive={false} />
          <Panel position="top-left" className="graph-tip">
            <small className="muted">Drag to move. Double-click to open.</small>
            <button className="alt" onClick={reset}>Reset layout</button>
          </Panel>
        </ReactFlow>
      ) : <p className="muted page">Add wiki entries and relationships between them to see the graph.</p>}
    </div>
  )
}
