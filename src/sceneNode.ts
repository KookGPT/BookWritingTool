import { Node } from '@tiptap/core'

// A scene written in the Scenes panel, placed inside a chapter. Its text is kept in sync with scene.body (see store.sceneBlocks/setSceneBody).
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
})
