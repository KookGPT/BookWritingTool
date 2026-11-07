import { useSearchParams } from 'react-router-dom'
import { FindPanel } from './Find'
import { PageHead } from './ui'

export default function Search() {
  const [params] = useSearchParams()
  return (
    <div className="page wide">
      <PageHead title="Search" hint="Finds text in scenes, chapters, the wiki, the timeline, ideas and map names. Tick Replace to change it; every match is shown first." />
      <FindPanel key={params.get('replace') ?? ''} inputId="search-input" replacing={params.has('replace')} />
    </div>
  )
}
