import React, { useEffect, useState } from 'react'
import { BookOpen, ChevronDown, ChevronRight } from 'lucide-react'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { ClientHost } from './host'
import { editorLiveOverlay, subscribeEditorOverlay } from './editor/requests'
import { editorRequestId, editorSuggestionModel, novelResultModel, novelToolTitles } from './tool-result'

export function NovelToolCard(props: ToolCallViewProps) {
  const requestId = props.toolName === 'novel_editor_suggest' ? editorRequestId(props) : undefined
  const [revision, setRevision] = useState(0)
  useEffect(() => props.toolName === 'novel_editor_suggest' ? subscribeEditorOverlay(() => setRevision(value => value + 1)) : undefined, [props.toolName])
  const overlay = requestId && revision >= 0 ? editorLiveOverlay(requestId) : undefined
  const model = props.toolName === 'novel_editor_suggest' ? editorSuggestionModel(props, overlay) : novelResultModel(props)
  const disclosure = props.useDisclosure()
  const available = props.phase !== 'preparing'
  return <section className="nw-result" data-state={model.state} aria-label={novelToolTitles[props.toolName]}>
    <button type="button" className="nw-result-heading" disabled={!available} aria-expanded={available ? disclosure.expanded : undefined} onClick={disclosure.toggle}>
      <BookOpen size={16} aria-hidden="true" />
      <strong>{novelToolTitles[props.toolName]}</strong>
      <span className="nw-result-state">{model.label}</span>
      {available && (disclosure.expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />)}
    </button>
    <p className="nw-result-summary">{model.summary}</p>
    {available && disclosure.expanded && <div className="nw-result-body">
      {model.facts.length > 0 && <dl>{model.facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>}
      {model.report && <pre className="nw-result-report">{model.report}</pre>}
      <details><summary>原始参数与结果</summary><h4>参数</h4><pre>{model.args || '无参数记录'}</pre><h4>结果</h4><pre>{model.raw || '尚无结果'}</pre></details>
      {props.inspect && <button type="button" className="nw-result-inspect" onClick={props.inspect}>查看调用轨迹</button>}
    </div>}
  </section>
}

export function installNovelToolCards(host: ClientHost): void {
  host.slots.inject('tool.call.toolview', () => {
    const offs = Object.keys(novelToolTitles).map(key => host.slots.register({ name: 'tool.call.toolview', key }, NovelToolCard))
    return () => { for (const off of offs.reverse()) off() }
  })
}
