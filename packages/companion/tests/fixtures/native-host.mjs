/** Deterministic local model for real DSH acceptance, not part of the shipped package. */
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
const { LlmAdapter, createUserMessage } = await import(pathToFileURL(process.env.WHALE_TEST_LLM).href)
export const name = 'whale-companion-acceptance'
export const inject = ['agents', 'agentLoop', 'llm', 'sessionPersistence', 'workspaceRegistry', 'sessionController', 'userQuestions', 'approval', 'webServer', 'loader', 'clientModules', 'pluginManager']
export async function apply(ctx) {
  const report = { requests: 0, sessions: [], interactions: [] }
  const persist = () => writeFileSync(process.env.WHALE_TEST_REPORT, JSON.stringify(report,null,2))
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/__whale-fixture', handler: async (req, res) => {
    if (req.method !== 'POST' || req.headers['x-whale-fixture'] !== process.env.WHALE_TEST_CONTROL_TOKEN) {
      res.writeHead(403); res.end(); return
    }
    try {
      const url = new URL(req.url, 'http://localhost')
      const change = await ctx.pluginManager.setBundleEnabled('@linfengqaqtat/dsh-scriptor-companion', url.searchParams.get('disabled') !== 'true')
      if (change.application !== 'applied') throw Error(JSON.stringify(change))
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, graph: ctx.clientModules.graph() }))
    } catch (error) { res.writeHead(500); res.end(String(error)) }
  } }), 'whale acceptance lifecycle control')
  class LocalAdapter extends LlmAdapter {
    providerInfo(id) { return {id,name:'桌宠本地验收'} }
    async listModels() { return [{id:'fixture',name:'桌宠验收模型'}] }
    async *stream(options) {
      report.requests++; persist()
      const last = options.messages.filter(m=>m.role==='user').at(-1)
      const input = JSON.stringify(last)
      const long = input.includes('长写作')
      if (input.includes('失败测试')) throw Error('预期的本地验收错误')
      yield {type:'block-start',index:0,blockType:'reasoning'}
      yield {type:'reasoning-delta',index:0,text:'正在整理这个故事的思路。'}
      await new Promise(r=>setTimeout(r,long?5000:400))
      yield {type:'block-end',index:0,block:{type:'reasoning',text:'思路已整理。'}}
      const agent = ctx.agents.roots().find(item => item.session.id === options.sessionId)
      if (input.includes('问答测试')) {
        if (!agent) throw Error('Question fixture requires the live calling Agent')
        report.interactions.push({ kind: 'question', status: 'waiting' }); persist()
        const answer = await ctx.userQuestions.ask({ agent, signal: options.signal, questions: [
          { id: 'whale-answer', question: '桌宠验收：选择接下来的场景', options: [{ label: '海边' }, { label: '书房' }] },
        ] })
        report.interactions.push({ kind: 'question', status: 'answered', answer }); persist()
      }
      if (input.includes('审批测试')) {
        if (!agent) throw Error('Approval fixture requires the live calling Agent')
        report.interactions.push({ kind: 'approval', status: 'waiting' }); persist()
        const outcome = await ctx.approval.request({ agent, signal: options.signal, toolName: 'whale_acceptance' })
        report.interactions.push({ kind: 'approval', status: 'answered', outcome }); persist()
      }
      yield {type:'block-start',index:1,blockType:'text'}
      let text=''
      for(let i=0;i<(long?40:2);i++) {
        if(options.signal?.aborted) throw new DOMException('Aborted','AbortError')
        const part='潮水漫过石阶，她合上书，抬头望向远方。\n'
        text+=part;yield {type:'text-delta',index:1,text:part}
        await new Promise(r=>setTimeout(r,long?900:150))
      }
      yield {type:'block-end',index:1,block:{type:'text',text}}
      yield {type:'finish',reason:{kind:'stop'}}
    }
  }
  ctx.llm.registerAdapter(['whale-acceptance'],new LocalAdapter())
  const workspace=await ctx.workspaceRegistry.create(process.env.WHALE_TEST_WORKSPACE,'桌宠验收')
  for(const id of ['whale-first','whale-second']) {
    let handle
    try {
      handle=await ctx.agents.create({sessionId:id,meta:{cwd:process.env.WHALE_TEST_WORKSPACE,title:id},agentOptions:{provider:'whale-acceptance',model:'fixture'}})
    } catch(error) {
      if(error?.name!=='SessionAlreadyExistsError')throw error
      // A preview upgrade reuses its isolated profile and existing conversations.
      await workspace.attachSession(id)
      report.sessions.push(id);persist();continue
    }
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{off();reject(Error('Fixture setup timed out'))},15000)
      const off=ctx.on('agent/status',({agent,status})=>{if(agent===handle.agent&&status==='idle'){clearTimeout(timer);off();resolve()}})
      handle.agent.followup(createUserMessage({content:[{type:'text',text:'准备桌宠验收会话'}],source:{kind:'user'}}))
    })
    await workspace.attachSession(id)
    await ctx.sessionController.rename({sessionId:id,title:id==='whale-first'?'桌宠验收 · 写作':'桌宠验收 · 第二会话'})
    report.sessions.push(id);persist()
    ctx.on('dispose',()=>handle.dispose())
  }
  await ctx.sessionPersistence.flush();report.ready=true;persist()
}
