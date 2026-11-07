import { useState } from 'react'
import { Link } from 'react-router-dom'
import { nextStep } from './next'
import { bookWords, streakOf, today, uid, useBook, words } from './store'
import { PageHead, readLocal } from './ui'

export default function Today() {
  const { book, dirty, update } = useBook()
  const [idea, setIdea] = useState('')
  const { goal, days } = book.stats
  const done = days[today()] ?? 0
  const total = bookWords(book)
  // Back to whatever was open last, scene or chapter; with no history, the first thing being drafted.
  const last = readLocal<{ kind: string; id: string } | null>('room-last', null)
  const openScene = (last?.kind === 'scene' ? book.scenes.find((s) => s.id === last.id) : undefined) ?? (last ? undefined : book.scenes.find((s) => s.status === 'drafting'))
  const chapter = book.chapters.find((c) => c.id === last?.id) ?? book.chapters.find((c) => c.status !== 'done') ?? book.chapters[0]
  const scene = openScene ?? (chapter ? undefined : book.scenes[0])
  const next = nextStep(book)
  const hour = new Date().getHours()
  const hello = hour < 5 ? 'Still up' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const steps: [string, boolean, string][] = [
    ['Plan a scene', book.scenes.length > 0, '/scenes'],
    ['Add a character to the wiki', book.wiki.some((w) => w.type === 'character'), '/wiki'],
    ['Put an event on the timeline', book.events.length > 0 || book.plan.length > 0, '/timeline'],
  ]
  const started = steps.filter((s) => s[1]).length
  const capture = () => {
    if (!idea.trim()) return
    update((b) => ({ ...b, ideas: [{ id: uid(), text: idea.trim(), tags: [...idea.matchAll(/#(\w+)/g)].map((m) => m[1].toLowerCase()), pinned: false }, ...b.ideas] }))
    setIdea('')
  }

  return (
    <div className="page wide">
      <PageHead title="Today" hint={`${hello}. ${book.title}`} />
      <div className="cards">
        <div className="card">
          <small className="muted">CONTINUE WRITING</small>
          {scene ? (
            <>
              <b className="card-title">{scene.title}</b>
              <small className="muted">{scene.status ?? 'planned'} · {words(scene.body ?? '')} words</small>
              <Link className="btn" to={`/scenes?s=${scene.id}`}>Continue</Link>
            </>
          ) : chapter ? (
            <>
              <b className="card-title">{chapter.title}</b>
              <small className="muted">{chapter.status} · {words(chapter.body)} words</small>
              <Link className="btn" to={`/write?c=${chapter.id}`}>Continue</Link>
            </>
          ) : (
            <><b className="card-title">Nothing written yet</b><Link className="btn" to="/scenes">Start the first scene</Link></>
          )}
        </div>
        <div className="card">
          <small className="muted">TODAY</small>
          <span className="stat">{done}<small className="muted"> / {goal} words</small></span>
          <div className="bar"><div style={{ width: `${Math.min(100, (done / Math.max(goal, 1)) * 100)}%` }} /></div>
          <small className="muted">{streakOf(book.stats)}-day streak</small>
        </div>
        <div className="card">
          <small className="muted">THE BOOK</small>
          <span className="stat">{total.toLocaleString()}<small className="muted"> words</small></span>
          <small className="muted">{book.scenes.filter((s) => s.status === 'done').length} of {book.scenes.length} scenes done · {dirty ? 'unsynced changes' : 'everything saved'}</small>
        </div>
      </div>
      <div className="card">
        <small className="muted">NEXT UP</small>
        <Link to={next.to} className="next-link">{next.text} ›</Link>
      </div>
      <div className="card">
        <small className="muted">JOT AN IDEA</small>
        <div className="row">
          <input className="grow" value={idea} placeholder="An idea, a line, a twist... use #tags" onChange={(e) => setIdea(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && capture()} />
          <button onClick={capture}>Save</button>
        </div>
      </div>
      {started < steps.length && (
        <div className="card">
          <small className="muted">GETTING STARTED · {started} OF {steps.length}</small>
          {steps.map(([t, ok, to]) => (
            <Link key={t} to={to} className={`step ${ok ? 'ok' : ''}`}><span className="tick">{ok ? '✓' : ''}</span>{t}</Link>
          ))}
        </div>
      )}
    </div>
  )
}
