import type { InputTriggerServiceContract, InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { InputActions, ReferenceInsert, SessionInput } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import type { StudyDocument } from '../study/types'
import { studyFileLink } from '../study/links'
import { documentQuote } from './quote'
import type { ClientHost } from './host'

export const QUOTE_SOURCE = 'webnovel-quote'
interface QuoteSnapshot { version: 1; sessionId: string; path: string; text: string }

function snapshot(ref: string): QuoteSnapshot {
  const value: unknown = JSON.parse(ref)
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1
    || !('sessionId' in value) || typeof value.sessionId !== 'string'
    || !('path' in value) || typeof value.path !== 'string'
    || !('text' in value) || typeof value.text !== 'string') throw new Error('原文引用无法读取，请重新引用')
  return value as QuoteSnapshot
}

/** Persist the exact selection in the host draft; never resolve it to newer disk text at send time. */
export function quoteReference(sessionId: string, document: StudyDocument, buffer: string, selection: string, line?: number): ReferenceInsert {
  const text = documentQuote(document, buffer, selection, line)
  return {
    source: QUOTE_SOURCE,
    ref: JSON.stringify({ version: 1, sessionId, path: document.absolutePath, text } satisfies QuoteSnapshot),
    label: `${document.owner} / ${document.name} · ${Array.from(selection).length}字${buffer !== document.body ? ' · 未保存' : ''}`,
    appearance: 'file', clipboardText: text,
  }
}

export function insertQuoteReference(input: Pick<SessionInput, 'state' | 'insertReference'>, actions: Pick<InputActions, 'captureInsertion'>, reference: ReferenceInsert): boolean {
  const state = input.state.getSnapshot()
  if (state.phase !== 'plain' && state.phase !== 'claimed') return false
  // Host capture accounts for native quote blocks as well as references and commands.
  // Append at the previous composer selection's end; never replace selected author text.
  const span = actions.captureInsertion()
  if (state.phase === 'claimed' && span.end === 0) return false
  return input.insertReference(reference, { start: span.end, end: span.end, draftRev: span.draftRev })
}

export function createQuoteInputs() {
  const inputs = new Map<string, Pick<InputActions, 'captureInsertion'>>()
  return {
    bind(sessionId: string, actions: Pick<InputActions, 'captureInsertion'>) {
      inputs.set(sessionId, actions)
      return () => { if (inputs.get(sessionId) === actions) inputs.delete(sessionId) }
    },
    insert(sessionId: string, input: Pick<SessionInput, 'state' | 'insertReference'>, reference: ReferenceInsert) {
      const actions = inputs.get(sessionId)
      return actions ? insertQuoteReference(input, actions, reference) : false
    },
  }
}

export function quoteSource(open: (sessionId: string, path: string) => void): InputTriggerSource {
  return {
    trigger: '@', name: QUOTE_SOURCE,
    candidates: async () => [], onPick: () => undefined,
    openReference: (session, reference) => {
      try {
        const quote = snapshot(reference.ref)
        if (quote.sessionId !== session.sessionId) return false
        open(session.sessionId, quote.path)
        return true
      } catch { return false }
    },
    codec: {
      clipboardText: ref => snapshot(ref).text,
      serialize: async (ref, signal) => {
        signal.throwIfAborted()
        const quote = snapshot(ref)
        return quote.text + '\n[在书房打开原文](<' + studyFileLink(quote.path) + '>)\n'
      },
    },
  }
}

export function installQuoteReferences(host: ClientHost): void {
  host.inject(['inputTriggers'], scope => {
    const triggers = scope.get('inputTriggers') as InputTriggerServiceContract
    scope.effect(() => triggers.registerSource(quoteSource((id, path) => host.sidebarRight.openResource(sessionFileAddress(id, path)))), 'webnovel: original text references')
  })
}
