import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionHost } from '../src/session'
import { watchSession } from '../src/session'
import { CompanionStore } from '../src/state'

function source<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return { getSnapshot: () => value, subscribe: (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb) } },
    set(next: T) { value = next; for (const cb of [...listeners]) cb() }, listeners }
}
function fixture() {
  const store = new CompanionStore()
  const state = source({running:false, removed:false, openState:'open', lastAgentError:null})
  type Entry = {type:'event'|'transient';event:{type:string;data:Record<string,unknown>}}
  const events = source({entries: [] as Entry[], revision:0, change:{kind:'replace',entries:[] as Entry[]}})
  const binding = {sessionId:'a',session:state,eventSource:events}
  const list = source({byId:{a:{id:'a',retainedBy:{mainView:1}}}})
  const status = source(new Map<string, {running:boolean;pendingInteraction?:object}>([['a',{running:false}]]))
  const generation = source<object|undefined>({id:1})
  const host = {sessions:{list,binding:()=>binding},uiSession:{sessionStatus:status},connection:{generation}} as unknown as SessionHost
  const stop = watchSession(host,store)
  const append = (type:string,data:Record<string,unknown>,kind='append') => {
    const entry:Entry={type:type==='assistant/live-chunk'?'transient':'event',event:{type,data}}
    events.set({entries:[...events.getSnapshot().entries,entry],revision:events.getSnapshot().revision+1,change:{kind,entries:[entry]}})
  }
  const running=(value:boolean)=> {state.set({...state.getSnapshot(),running:value});status.set(new Map([['a',{running:value}]]))}
  const dispose=()=>{stop();store.dispose();expect(list.listeners.size+state.listeners.size+events.listeners.size+status.listeners.size+generation.listeners.size).toBe(0)}
  return {store,state,events,list,status,generation,append,running,dispose}
}
afterEach(()=>vi.useRealTimers())
describe('native session adapter',()=>{
  it('follows reasoning, long text, approval and only successful terminal events',()=>{
    vi.useFakeTimers();const f=fixture()
    f.running(true);f.append('turn/start',{turn:1});expect(f.store.getSnapshot().action).toBe('thinking')
    f.append('assistant/live-chunk',{turn:1,chunk:{type:'text-delta',text:'正文'}})
    vi.advanceTimersByTime(35000);expect(f.store.getSnapshot().action).toBe('writing')
    f.status.set(new Map([['a',{running:true,pendingInteraction:{kind:'approval'}}]]));expect(f.store.getSnapshot().action).toBe('waiting')
    f.status.set(new Map([['a',{running:true}]]));expect(f.store.getSnapshot().action).toBe('writing')
    f.append('turn/end',{turn:1,reason:{kind:'completed'}});f.running(false)
    expect(f.store.getSnapshot().action).toBe('complete');vi.advanceTimersByTime(5100);expect(f.store.getSnapshot().action).toBe('idle');f.dispose()
  })
  it.each(['cancelled','error','interrupted'])('does not celebrate %s or a bare running=false',kind=>{
    const f=fixture();f.running(true);f.append('turn/start',{turn:1});f.running(false)
    expect(f.store.getSnapshot().action).toBe('idle')
    f.append('turn/end',{turn:1,reason:{kind}});expect(f.store.getSnapshot().action).toBe('idle');f.dispose()
  })
  it('does not replay completion after baseline replacement, prepend or reconnect',()=>{
    const f=fixture();f.append('turn/start',{turn:1},'replace');f.append('turn/end',{turn:1,reason:{kind:'completed'}},'replace')
    expect(f.store.getSnapshot().action).toBe('idle')
    f.append('turn/end',{turn:0,reason:{kind:'completed'}},'prepend');expect(f.store.getSnapshot().action).toBe('idle')
    f.generation.set(undefined);expect(f.store.getSnapshot().label).toContain('连接')
    f.generation.set({id:2});expect(f.store.getSnapshot().action).toBe('idle');f.dispose()
  })
  it('detaches the old session before switching away',()=>{
    const f=fixture();f.running(true);f.append('turn/start',{turn:1});f.list.set({byId:{a:{id:'a',retainedBy:{mainView:0}}}})
    expect(f.events.listeners.size).toBe(0)
    f.append('turn/end',{turn:1,reason:{kind:'completed'}});expect(f.store.getSnapshot().action).toBe('idle');f.dispose()
  })
})
