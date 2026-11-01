import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { type Scene, setSceneBody, useBook } from './store'

// The scene's prose. If the scene is placed in a chapter, edits here update that chapter too.
export default function SceneText({ scene }: { scene: Scene }) {
  const update = useBook((s) => s.update)
  const editor = useEditor({
    extensions: [StarterKit],
    content: scene.body ?? '',
    onUpdate: ({ editor }) => update((b) => setSceneBody(b, scene.id, editor.getHTML())),
  })
  return <EditorContent editor={editor} className="editor scene-text" />
}
