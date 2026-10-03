import React, { useEffect, useState } from 'react'
import { Activity, ExternalLink, LocateFixed, X } from 'lucide-react'
import { workflowStages, runLabels, type WorkflowView as WorkflowData } from '../study/workflow-types'
import type { ChapterView } from '../study/types'
import { callStudy } from './api'
import { useStudy } from './hooks'
import type { EditorStore } from './store'
import { ArchifyWorkflow } from './workflow-artwork-view'
import { callsForNode, workflowDisplay, workflowNodes, type WorkflowNodeId } from './workflow-display'
import { novelToolTitles } from './tool-result'

function useWorkflow(sessionId: string, space: string) {
  const [value, setValue] = useState<WorkflowData>(), [error, setError] = useState('')
  useEffect(() => {
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout>
    const update = async () => {
      try {
        const next = await callStudy<WorkflowData>(sessionId, 'workflow', { space }, abort.signal)
        if (!abort.signal.aborted) { setValue(next); setError('') }
      } catch { if (!abort.signal.aborted) setError('连接已断，正在重连') }
      if (!abort.signal.aborted) timer = setTimeout(() => void update(), document.hidden ? 3000 : 750)
    }
    void update()
    return () => { abort.abort(); clearTimeout(timer) }
  }, [sessionId, space])
  return { value, error }
}
interface Props { sessionId: string; space: string; store: EditorStore; refresh: number }
export function WritingWorkflow(props: Props) {
  // Remount the entire projection on identity changes; never show another book's old selection.
  return <WorkflowContent key={props.sessionId + ':' + props.space} {...props} />
}
function WorkflowContent({ sessionId, space, store, refresh }: Props) {
  const live = useWorkflow(sessionId, space)
  // A tool result invalidates the facts; only the chapter API can confirm completion.
  const settledAt = (live.value?.calls ?? []).reduce((latest, call) => call.stage === 'confirm' ? Math.max(latest, call.ended ?? 0) : latest, 0)
  const chapters = useStudy<ChapterView>(sessionId, 'chapters', { space }, refresh + settledAt)
  const [picked, setPicked] = useState<WorkflowNodeId>(), [focus, setFocus] = useState<{ id: string }>(), [chapter, setChapter] = useState(0)
  const display = workflowDisplay(live.value, chapter, Boolean(live.error))
  const currentStage = workflowStages.find(s => s.id === display.current?.stage)
  const selected = workflowNodes.find(s => s.id === picked)
  const selectionCalls = picked ? callsForNode(display.calls, picked).slice().sort((a, b) => b.started - a.started).slice(0, 8) : []
  const chapterOptions = [...new Set([...(chapters.value?.chapters.map(c => c.chapter) ?? []), ...(live.value?.calls ?? []).flatMap(c => c.chapter ? [c.chapter] : [])])].filter(n => n > 0).sort((a, b) => a - b)
  const isFinalized = (c: ChapterView['chapters'][number]) => c.finalized ?? c.status === '完成'
  const finalized = Boolean(chapter && chapters.value?.chapters.some(c => c.chapter === chapter && isFinalized(c)))
  const title = live.error ? '连接已断' : !live.value ? '正在连接' : !live.value.available ? '运行记录暂不可用' : live.value.syncing ? '正在读取记录'
    : display.current ? (currentStage?.label ?? '处理中') + ' · ' + runLabels[display.current.state]
    : chapter ? '本章暂无执行中的操作' : live.value.waiting ? '本会话 · 待确认' : live.value.active ? '本会话处理中' : '当前没有执行中的操作'
  return <>
    <div className="nw-flow-summary" role="status"><Activity size={20} /><div><strong>{title}</strong><span>{chapter ? '第 ' + chapter + ' 章' : display.current?.chapter ? '第 ' + display.current.chapter + ' 章' : '跟随本会话的工具调用'}</span></div>
      {display.currentNode ? <button type="button" onClick={() => { setPicked(display.currentNode); setFocus({ id: display.currentNode! }) }}><LocateFixed size={15} />回到当前</button> : null}</div>
    <div className="nw-flow-toolbar">
      <select aria-label="选择流程章节" value={chapter} onChange={e => setChapter(Number(e.target.value))}><option value={0}>全部章节</option>{chapterOptions.map(n => <option key={n} value={n}>第 {n} 章</option>)}</select>
      <span className="nw-viz-note">{chapters.value?.chapters.filter(isFinalized).length ?? 0} 章已定稿</span>
    </div>
    <div className={'nw-explorer nw-flow-explorer ' + (selected ? 'has-detail' : '')}>
      <ArchifyWorkflow activities={display.nodes} selected={picked} focus={focus} onSelect={setPicked} finalized={finalized} />
      {selected ? <aside className="nw-inspector"><button type="button" className="nw-icon" aria-label="关闭详情" onClick={() => setPicked(undefined)}><X size={16} /></button>
        <small>{chapter ? '第 ' + chapter + ' 章' : '全部章节'}</small><h3>{selected.label}</h3><p>{selected.note}</p>
        {picked === 'wait' && chapter ? <p>{finalized ? '本章已有定稿记录。' : '本章尚无已定稿事实。'}</p> : null}
        <h4>最近操作</h4>
        {!selectionCalls.length ? <p>本会话暂无对应记录。</p> : <ol className="nw-run-list">{selectionCalls.map(call => <li key={call.id}>
          <strong>{runLabels[call.state]}{call.chapter ? ' · 第 ' + call.chapter + ' 章' : ''}</strong>
          <p>{workflowStages.find(s => s.id === call.stage)?.label ?? '其他'} · {novelToolTitles[call.name] ?? call.name}</p>
          <p>{call.summary}</p><small>{new Date(call.started).toLocaleTimeString('zh-CN')}{call.ended !== undefined ? ' · ' + Math.max(0, Math.round((call.ended - call.started) / 1000)) + ' 秒' : ''}</small>
        </li>)}</ol>}
        {chapters.value?.chapters.filter(c => c.source && c.chapter > 0 && (!chapter || c.chapter === chapter)).slice(-3).map(c => <button type="button" className="nw-source-button" key={c.volume + '-' + c.chapter} onClick={() => { if (c.source) void store.open(sessionId, c.source) }}><ExternalLink size={14} />第 {c.chapter} 章 · 打开原文</button>)}
      </aside> : null}
    </div>
    <p className="nw-viz-note">节点标记表示操作状态，不代表整个环节已完成。</p>
    {live.error ? <p className="nw-viz-note" role="alert">{live.error}。</p> : null}
    {display.calls.some(c => !c.stage) || (!chapter && live.value?.otherActive) ? <p className="nw-viz-note">部分操作无法确定工序，可在对话中查看详情。</p> : null}
    {chapters.error ? <p className="nw-error">章节资料读取失败：{chapters.error}</p> : null}
  </>
}
