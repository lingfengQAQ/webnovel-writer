/** Interactive regression against the installed tarball in a real DSH Web client. */
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
const evidence=path.resolve(process.argv[2])
const {chromium}=await import(pathToFileURL(path.join(process.env.WHALE_PLAYWRIGHT,'index.mjs')).href)
const runtime=JSON.parse(fs.readFileSync(path.join(evidence,'native-runtime.json'),'utf8'))
const log=fs.readFileSync(path.join(evidence,'native.log'),'utf8')
const url=log.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/g).at(-1)
const browser=await chromium.launch({headless:true,executablePath:process.env.WHALE_CHROMIUM})
const context=await browser.newContext({viewport:{width:1440,height:1000}})
const page=await context.newPage()
page.setDefaultTimeout(15000)
const report={checks:{},errors:[],screenshots:[]}
const save=()=>fs.writeFileSync(path.join(evidence,'browser-report.json'),JSON.stringify(report,null,2))
const shot=async name=>{await page.screenshot({path:path.join(evidence,name+'.png'),fullPage:true});report.screenshots.push(name+'.png');save()}
const selected=process.argv[3]?.split(',')
const check=async(name,fn)=>{if(selected&&!selected.includes(name))return;report.current=name;save();await fn();report.checks[name]=true;save()}
page.on('pageerror',e=>{report.errors.push(e.message);save()})
const pet=page.locator('.whale-companion')
const action=async value=>page.waitForFunction(v=>document.querySelector('.whale-companion')?.getAttribute('data-action')===v,value)
const openMenu=async()=>{await pet.hover();await page.getByRole('button',{name:'打开桌宠菜单'}).click()}
const selectSession=async name=>{
 const tab=page.getByRole('tab',{name:'工作区',exact:true})
 if(await tab.isVisible())await tab.click()
 await page.getByText(name,{exact:true}).first().click()
}
try{
 if(runtime.controlToken){
   for(let attempt=0;attempt<100;attempt++){
     const response=await fetch(new URL('/__whale-fixture?disabled=false',url),{method:'POST',headers:{'x-whale-fixture':runtime.controlToken}})
     assert.equal(response.status,200)
     const body=await response.json()
     if(body.graph.entries.some(e=>e.id==='@linfengqaqtat/dsh-scriptor-companion'))break
     await new Promise(resolve=>setTimeout(resolve,30))
   }
 }
 await page.goto(url)
 const welcome=page.getByRole('button',{name:'继续',exact:true})
 if(await welcome.waitFor({state:'visible',timeout:5000}).then(()=>true,()=>false))await welcome.click()
 const workspaceTab=page.getByRole('tab',{name:'工作区',exact:true})
 if(await workspaceTab.isVisible())await workspaceTab.click()
 await page.getByText('桌宠验收 · 写作',{exact:true}).first().click()
 await check('native_single_pet_alpha',async()=>{
   await pet.waitFor();assert.equal(await pet.count(),1)
   await page.waitForFunction(()=>[...document.querySelectorAll('.whale-media video')].some(v=>v.currentTime>.2))
   const alpha=await page.evaluate(()=>{const c=document.querySelector('.whale-media canvas');const g=c.getContext('2d');return {corner:g.getImageData(0,0,1,1).data[3],center:g.getImageData(c.width/2,c.height/2,1,1).data[3]}})
   assert.equal(alpha.corner,0);assert.ok(alpha.center>240);await shot('native-light')
   assert.equal(await pet.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+2,r.y+2))}),false)
 })
 await check('controls_drag_persistence',async()=>{
   await openMenu();await page.getByLabel('桌宠大小',{exact:true}).selectOption('large')
   await page.getByRole('button',{name:'关闭桌宠菜单'}).click()
   const before=await pet.boundingBox();const x=before.x+before.width*.45,y=before.y+before.height*.52
   await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-280,y-170,{steps:15});await page.mouse.up()
   const after=await pet.boundingBox();assert.ok(after.x<before.x-250);assert.ok(after.y<before.y-150)
   assert.notEqual(await pet.getAttribute('data-action'),'interact')
   await page.reload();await pet.waitFor();const restored=await pet.boundingBox()
   assert.ok(Math.abs(after.x-restored.x)<2&&Math.abs(after.y-restored.y)<2);assert.equal(restored.height,300)
   await page.setViewportSize({width:700,height:560});const bounded=await pet.boundingBox();assert.ok(bounded.x>=0&&bounded.x+bounded.width<=701&&bounded.y+bounded.height<=561)
   await page.setViewportSize({width:1440,height:1000})
 })
 await check('hide_restore_settings',async()=>{
   await page.evaluate(()=>{window.whaleOwnedVideos=[...document.querySelectorAll('.whale-media video')]})
   await openMenu();await page.getByRole('button',{name:'隐藏桌宠',exact:true}).click();assert.equal(await pet.count(),0)
   assert.equal(await page.evaluate(()=>window.whaleOwnedVideos.every(v=>v.paused&&!v.hasAttribute('src'))),true)
   await page.getByRole('button',{name:'设置',exact:true}).click()
   const general=page.getByText('通用',{exact:true});if(await general.isVisible())await general.click()
   await page.getByLabel('显示桌宠',{exact:true}).check();await pet.waitFor()
   await page.getByRole('button',{name:'恢复默认位置'}).click();await page.keyboard.press('Escape')
   await shot('restored')
 })
 await check('motion_preference',async()=>{
   await page.emulateMedia({reducedMotion:'reduce'})
   await page.waitForFunction(()=>[...document.querySelectorAll('.whale-media video')].every(v=>v.paused))
   assert.equal(await page.locator('.whale-media img').evaluate(e=>getComputedStyle(e).opacity),'1')
   await page.emulateMedia({reducedMotion:'no-preference'})
 })
 await check('action_change_returns_before_switch',async()=>{
   const preview=async label=>{
     await openMenu();await page.getByText('预览动作',{exact:true}).click()
     await page.locator('.whale-previews').getByRole('button',{name:label,exact:true}).click()
   }
   await preview('休息一下')
   await page.waitForFunction(()=>[...document.querySelectorAll('.whale-media video')].some(v=>v.dataset.clip==='rest'&&v.dataset.presenting==='true'&&v.currentTime>1))
   await preview('正在构思')
   assert.equal(await page.locator('.whale-media').getAttribute('data-clip'),'rest')
   await page.waitForFunction(()=>[...document.querySelectorAll('.whale-media video')].some(v=>v.dataset.clip==='thinking'&&v.dataset.presenting==='true'),{},{timeout:2500})
   await shot('native-action-transition')
 })
 await check('long_native_writing_and_completion',async()=>{
   await selectSession('桌宠验收 · 写作')
   const editor=page.locator('[contenteditable="true"]').first();await editor.fill('长写作');await editor.press('Enter')
   await action('thinking');await shot('native-thinking');await action('writing')
   await page.waitForFunction(()=>document.querySelector('.whale-media')?.getAttribute('data-clip')==='writing-loop')
   await shot('native-writing')
   await page.waitForTimeout(31000)
   assert.equal(await pet.getAttribute('data-action'),'writing');assert.equal(await page.locator('.whale-media').getAttribute('data-clip'),'writing-loop')
   await action('complete');await shot('native-complete');await action('idle')
 })
 await check('switch_session_and_cancel',async()=>{
   const editor=page.locator('[contenteditable="true"]').first();await editor.fill('长写作');await editor.press('Enter');await action('thinking')
   await selectSession('桌宠验收 · 第二会话');await action('idle')
   await selectSession('桌宠验收 · 写作');await action('writing')
   const stop=page.getByRole('button',{name:/停止/}).first();await stop.click();await action('idle')
   await page.waitForTimeout(800);assert.notEqual(await pet.getAttribute('data-action'),'complete')
 })
 await check('native_question_and_approval',async()=>{
   const editor=page.locator('[contenteditable="true"]').first()
   await editor.fill('问答测试');await editor.press('Enter');await action('waiting');await shot('native-question')
   await page.getByText('海边',{exact:true}).click()
   await page.getByRole('button',{name:'提交',exact:true}).click()
   await action('complete');await action('idle')
   await editor.fill('审批测试');await editor.press('Enter');await action('waiting');await shot('native-approval')
   await page.getByRole('button',{name:/允许一次|仅允许一次/}).click()
   await action('complete');await action('idle')
   const host=JSON.parse(fs.readFileSync(path.join(evidence,'native-host.json'),'utf8'))
   assert.ok(host.interactions.some(i=>i.kind==='question'&&i.answer?.answers[0]?.selected.includes('海边')))
   assert.ok(host.interactions.some(i=>i.kind==='approval'&&i.outcome==='allowed-once'))
 })
 await check('failure_and_history_do_not_celebrate',async()=>{
   const editor=page.locator('[contenteditable="true"]').first()
   await page.evaluate(()=>{
     window.whaleObservedActions=[]
     window.whaleActionObserver=new MutationObserver(()=>window.whaleObservedActions.push(document.querySelector('.whale-companion')?.dataset.action))
     window.whaleActionObserver.observe(document.querySelector('.whale-companion'),{attributes:true,attributeFilter:['data-action']})
   })
   await editor.fill('失败测试');await editor.press('Enter')
   await page.getByText('预期的本地验收错误',{exact:false}).first().waitFor();await action('idle')
   assert.equal(await page.evaluate(()=>window.whaleObservedActions.includes('complete')),false)
   await page.evaluate(()=>window.whaleActionObserver.disconnect())
   await page.reload();await pet.waitFor();await action('idle');await page.waitForTimeout(700)
   assert.notEqual(await pet.getAttribute('data-action'),'complete')
 })
 await check('media_failure_static_recovery',async()=>{
   await page.evaluate(()=>{
     const v=[...document.querySelectorAll('.whale-media video')].find(v=>v.dataset.presenting==='true')
     v.src='data:video/webm;base64,AAAA';v.load()
   })
   await page.waitForFunction(()=>document.querySelector('.whale-media')?.dataset.static==='true')
   assert.equal(await page.locator('.whale-media img').evaluate(e=>getComputedStyle(e).opacity),'1')
   await openMenu();await page.getByText(/动画暂时无法播放/).waitFor();await shot('media-fallback')
   await page.getByRole('button',{name:'隐藏桌宠',exact:true}).click()
   await page.getByRole('button',{name:'设置',exact:true}).click()
   const general=page.getByText('通用',{exact:true});if(await general.isVisible())await general.click()
   await page.getByLabel('显示桌宠',{exact:true}).check();await page.keyboard.press('Escape')
   await page.waitForFunction(()=>[...document.querySelectorAll('.whale-media video')].some(v=>!v.paused&&v.currentTime>.2))
   assert.equal(await page.locator('.whale-media').getAttribute('data-static'),null)
 })
 await check('native_unload_and_reload',async()=>{
   await pet.waitFor();assert.equal(await pet.count(),1)
   const before=JSON.parse(fs.readFileSync(path.join(evidence,'native-host.json'),'utf8')).requests
   await page.evaluate(()=>{window.whaleOwnedVideos=[...document.querySelectorAll('.whale-media video')]})
   const toggle=async disabled=>{
     const result=await page.evaluate(async({token,disabled})=>{
       for(let attempt=0;attempt<100;attempt++){
         const response=await fetch('/__whale-fixture?disabled='+disabled,{method:'POST',headers:{'x-whale-fixture':token}})
         const body=await response.json()
         if(!response.ok)return {status:response.status,body:JSON.stringify(body)}
         if(body.graph.entries.some(e=>e.id==='@linfengqaqtat/dsh-scriptor-companion')!==disabled){
           return {status:response.status,body:JSON.stringify({ok:body.ok})}
         }
         await new Promise(resolve=>setTimeout(resolve,30))
       }
       throw Error('Host graph did not settle after the Loader change')
     },{token:runtime.controlToken,disabled})
     assert.equal(result.status,200,result.body)
   }
   await toggle(true)
   await pet.waitFor({state:'detached'})
   await page.waitForFunction(()=>!document.querySelector('style[data-whale-companion]'))
   assert.equal(await page.evaluate(()=>window.whaleOwnedVideos.every(v=>v.paused&&!v.hasAttribute('src'))),true)
   await toggle(false);await pet.waitFor();assert.equal(await pet.count(),1)
   assert.equal(await page.locator('style[data-whale-companion]').count(),1)
   assert.equal(JSON.parse(fs.readFileSync(path.join(evidence,'native-host.json'),'utf8')).requests,before)
   await shot('native-reloaded')
 })
 await check('dark_theme_and_rest_hold',async()=>{
   await page.emulateMedia({colorScheme:'dark'})
   await page.waitForFunction(()=>document.body.hasAttribute('data-ds-dark-theme'))
   await openMenu();await page.getByText('预览动作',{exact:true}).click()
   await page.locator('.whale-previews').getByRole('button',{name:'休息一下',exact:true}).click()
   await page.waitForFunction(()=>[...document.querySelectorAll('.whale-media video')].some(v=>v.dataset.clip==='rest'&&v.dataset.presenting==='true'&&v.currentTime>3))
   const duration=await page.locator('.whale-media video[data-presenting="true"]').evaluate(v=>v.duration)
   assert.ok(duration>=7.2);await shot('native-dark-rest')
   await page.waitForTimeout(1000);assert.equal(await pet.getAttribute('data-action'),'rest')
   await page.emulateMedia({colorScheme:'light'})
 })
 assert.deepEqual(report.errors,[]);report.ok=true;save();console.log(JSON.stringify({ok:true,checks:report.checks},null,2))
}catch(error){report.failure=String(error);await shot('failure');save();throw error}
finally{await context.close();await browser.close()}
