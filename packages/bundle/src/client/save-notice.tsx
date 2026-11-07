import React, { useCallback, useState, type ComponentType } from 'react'
import { Button, DisclosureRow, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { AUTHOR_SAVE_SOURCE } from '../message-sources'
import { mainSessionOf, type ClientHost } from './host'

type TriggerProps = ChatNodeViewProps<'turn-trigger'>
export function saveNotice(source: unknown): { summary: string; documentPath?: string } | undefined {
  if (!source || typeof source !== 'object' || !('kind' in source) || source.kind !== AUTHOR_SAVE_SOURCE
    || !('form' in source) || source.form !== 'notice' || !('summary' in source) || typeof source.summary !== 'string' || !source.summary.trim()) return undefined
  const documentPath = 'documentPath' in source && typeof source.documentPath === 'string' ? source.documentPath : undefined
  return { summary: source.summary, ...(documentPath ? { documentPath } : {}) }
}

/** DSH's turn-trigger renderer ignores notice.summary; adapt only our declared save notice. */
export function SaveNotice({ props, Native, host }: { props: TriggerProps; Native: ComponentType<TriggerProps>; host: ClientHost }) {
  const [open, setOpen] = useState(false)
  const toggle = useCallback(() => setOpen(value => !value), [])
  const notice = saveNotice(props.node.data.source)
  if (!notice) return <Native {...props} />
  const content = props.node.data.content
  return <section data-turn-trigger data-webnovel-save-notice>
    <DisclosureRow className="nw-save-notice" title={notice.summary} icon={<StateDot state="done" />} open={open} expandable expandOnRowClick onToggle={toggle}>
      <div className="nw-save-notice-body">
        {notice.documentPath && <Button variant="ghost" size="sm" onClick={() => {
          if (mainSessionOf(host) === props.sessionId && host.sidebarRight.mounted.getSnapshot() === props.sessionId) props.openFile(notice.documentPath!)
        }}>打开已保存文件</Button>}
        {content.map((block, index) => <pre className="nw-save-notice-raw" key={index}>{block.type === 'text' ? block.text : JSON.stringify(block, null, 2)}</pre>)}
      </div>
    </DisclosureRow>
  </section>
}

export function installSaveNotices(host: ClientHost): void {
  const name = 'conversation.chat.node', key = 'turn-trigger'
  host.slots.inject(name, () => {
    const original = host.slots.entries(name).find(entry => entry.options?.key === key)
    if (!original) return
    const Native = original.component as unknown as ComponentType<TriggerProps>
    return host.slots.register({ name, key, priority: -40,
      ...(original.locale ? { locale: original.locale } : {}),
      ...(original.inject ? { inject: original.inject } : {}),
      ...(original.store ? { store: original.store } : {}),
    }, (props: TriggerProps) => <SaveNotice {...{ props, Native, host }} />)
  })
}
