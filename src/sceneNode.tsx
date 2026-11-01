import { Node } from '@tiptap/core'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import { useBook } from './store'

// A scene written in the Scenes panel, placed inside a chapter. Its text is kept in sync with scene.body (see store.sceneBlocks/setSceneBody).
function SceneView({ node }: ReactNodeViewProps) {
  const id = node.attrs.sceneId as string
  const scene = useBook((s) => s.book.scenes.find((x) => x.id === id))
  return (
    <NodeViewWrapper className="scene-block" data-scene={id}>
      <div className="scene-label" contentEditable={false}>
        <span>Scene: <b>{scene?.title ?? '(deleted scene)'}</b></span>
        {scene && <span className={`stage ${scene.status ?? 'planned'}`}>{scene.status ?? 'planned'}</span>}
        {scene && !scene.body?.replace(/<[^>]+>/g, '').trim() && <i>no text yet: write it here, or in Scenes</i>}
        {scene && <a href={`#/scenes?s=${id}`}>Open in Scenes ›</a>}
      </div>
      <NodeViewContent />
    </NodeViewWrapper>
  )
}

export const SceneBlock = Node.create({
  name: 'scene',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return { sceneId: { default: null, parseHTML: (el) => el.getAttribute('data-scene'), renderHTML: (a) => ({ 'data-scene': a.sceneId }) } }
  },
  parseHTML() { return [{ tag: 'div[data-scene]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', { ...HTMLAttributes, class: 'scene-block' }, 0] },
  addNodeView() { return ReactNodeViewRenderer(SceneView) },
})
