import React, { useEffect, useId, useRef, useState } from 'react'
import { Button, SegmentedTabs, StateDot, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { ClientHost } from './host'
import { mainSessionOf } from './host'
import { editorLiveOverlay, subscribeEditorOverlay } from './editor/requests'
import { IconChevronDown, IconChevronRight } from './icons'
import { editorRequestId, editorSuggestionModel, novelResultModel, novelToolTitles } from './tool-result'
import { openPluginSettings } from './plugin-nav'
import { retrievalSettingsLink } from './retrieval-settings-link'
import { resultFiles, type ResultFile } from './result-files'
import { callStudy } from './api'
import type { StudyDocument } from '../study/types'
import type { NovelResultModel } from './tool-result'

const dots: Record<NovelResultModel['state'], StateDotState> = {
  preparing: 'idle', running: 'ongoing', success: 'done', attention: 'warning', error: 'error', stopped: 'idle', unknown: 'warning',
}

export function NovelToolCard(props: ToolCallViewProps & { host?: ClientHost }) {
  const panelId = useId()
  const [view, setView] = useState<'result' | 'raw'>('result')
  const [fileError, setFileError] = useState('')
  const fileRequest = useRef<AbortController>()
  useEffect(() => () => fileRequest.current?.abort(), [props.sessionId])
  const requestId = props.toolName === 'novel_editor_suggest' ? editorRequestId(props) : undefined
  const [revision, setRevision] = useState(0)
  useEffect(() => props.toolName === 'novel_editor_suggest' ? subscribeEditorOverlay(() => setRevision(value => value + 1)) : undefined, [props.toolName])
  const overlay = requestId && revision >= 0 ? editorLiveOverlay(requestId) : undefined
  const model = props.toolName === 'novel_editor_suggest' ? editorSuggestionModel(props, overlay) : novelResultModel(props)
  const disclosure = props.useDisclosure()
  const available = props.phase !== 'preparing'
  const retrieval = retrievalSettingsLink(props.toolName, model.raw)
  const files = resultFiles(props)
  const open = async (file: ResultFile) => {
    fileRequest.current?.abort()
    const request = new AbortController()
    fileRequest.current = request
    const current = () => !request.signal.aborted && (!props.host || (mainSessionOf(props.host) === props.sessionId
      && props.host.sidebarRight.mounted.getSnapshot() === props.sessionId))
    if (!current()) return
    setFileError('')
    try {
      if (file.bookId || file.shared) {
        const document = file.shared
          ? await callStudy<StudyDocument>(props.sessionId, 'read', { ref: { space: 'shared', path: file.path.replace(/^书房\//, '') } }, request.signal)
          : await callStudy<StudyDocument | null>(props.sessionId, 'resolve', { path: file.bookId + ':' + file.path }, request.signal)
        if (!current()) return
        if (!document) throw new Error('文件已移动或不在当前工作范围，请核对原文路径')
        props.openFile(document.absolutePath)
      } else props.openFile(file.path)
    } catch (error) { if (current()) setFileError(error instanceof Error ? error.message : '文件无法打开，请核对原文路径') }
  }
  return <section className="nw-result" data-state={model.state} aria-label={novelToolTitles[props.toolName]}>
    <button type="button" className="nw-result-heading" disabled={!available} aria-expanded={available ? disclosure.expanded : undefined} onClick={disclosure.toggle}>
      <StateDot state={dots[model.state]} />
      <strong className="nw-result-title">{novelToolTitles[props.toolName]}</strong>
      <span className="nw-result-state">{model.label}</span>
      {available && (disclosure.expanded ? <IconChevronDown size={14} className="nw-result-chevron" /> : <IconChevronRight size={14} className="nw-result-chevron" />)}
    </button>
    <p className="nw-result-summary">{model.summary.split('\n')[0]}</p>
    {props.host && retrieval && props.phase === 'result' && (retrieval.needsAttention || model.state !== 'success' || disclosure.expanded) ? <Button variant="outline" size="sm" onClick={() => openPluginSettings(props.host!, retrieval.target)}>打开检索设置</Button> : null}
    {available && disclosure.expanded && <div className="nw-result-body">
      <SegmentedTabs label="结果显示方式" className="nw-result-views" items={[
        { value: 'result', label: '结果', id: panelId + '-result-tab', panelId: panelId + '-result' },
        { value: 'raw', label: '原文', id: panelId + '-raw-tab', panelId: panelId + '-raw' },
      ]} value={view} onChange={setView} />
      {view === 'result' ? <div role="tabpanel" id={panelId + '-result'} aria-labelledby={panelId + '-result-tab'}>
        {model.facts.length > 0 && <dl className="nw-result-facts">{model.facts.map(fact => <div key={fact.label} className="nw-result-fact"><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>}
        <p className="nw-result-detail">{model.summary}</p>
        {files.length > 0 && <div className="nw-result-files" aria-label="结果文件">{files.map(file => <Button key={file.path} variant="ghost" size="sm" title={file.path} onClick={() => { void open(file) }}>{file.label}</Button>)}</div>}
        {fileError && <p className="nw-result-detail" role="alert">{fileError}</p>}
        {model.report && <pre className="nw-result-report">{model.report}</pre>}
      </div> : <div role="tabpanel" id={panelId + '-raw'} aria-labelledby={panelId + '-raw-tab'} className="nw-result-raw-body" aria-label="原始参数与结果">
        <h4>参数</h4><pre>{model.args || '无参数记录'}</pre><h4>结果</h4><pre>{model.raw || '尚无结果'}</pre>
      </div>}
      {props.inspect && <Button variant="ghost" size="sm" className="nw-result-inspect" onClick={props.inspect}>查看调用轨迹</Button>}
    </div>}
  </section>
}

export function installNovelToolCards(host: ClientHost): void {
  host.slots.inject('tool.call.toolview', () => {
    const offs = Object.keys(novelToolTitles).map(key => host.slots.register({ name: 'tool.call.toolview', key }, (props: ToolCallViewProps) => <NovelToolCard {...props} host={host} />))
    return () => { for (const off of offs.reverse()) off() }
  })
}
