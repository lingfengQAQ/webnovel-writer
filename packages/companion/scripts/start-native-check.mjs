import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { baseline } from '../../bundle/scripts/dsh-source.mjs'

const packageRoot=fileURLToPath(new URL('..',import.meta.url))
const [cliArg,tarArg,evidenceArg,portArg]=process.argv.slice(2)
if(!cliArg||!tarArg||!evidenceArg) throw Error('Usage: start-native-check <dsh-bin.js> <companion.tgz> <evidence-dir>')
const cli=path.resolve(cliArg),evidence=path.resolve(evidenceArg)
const root=fs.mkdtempSync(path.join(os.tmpdir(),'whale-native-'))
const home=path.join(root,'home'),workspace=path.join(root,'workspace')
fs.mkdirSync(workspace,{recursive:true});fs.mkdirSync(evidence,{recursive:true})
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=> !/^(npm_|pnpm_)|TOKEN|API_KEY|SECRET|DSH_|AGENTS_HOME|NODE_PATH/i.test(key)))
Object.assign(env,{DSH_HOME:home,DSH_AGENTS_HOME:path.join(root,'agents'),DSH_TELEMETRY_DISABLED:'1'})
const run=(args,label)=>{const result=execFileSync(process.execPath,[cli,...args],{cwd:workspace,env,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:16*1024*1024});fs.writeFileSync(path.join(evidence,label+'.log'),result);return result}
assert.equal(run(['--version'],'version').trim(),baseline.registry.version)
run(['--profile','whale-test','--from-default-profile','web','--dump-config'],'initial')
const tarball=path.join(root,'companion.tgz');fs.copyFileSync(path.resolve(tarArg),tarball)
run(['plugin','--profile','whale-test','add',tarball],'install')
assert.ok(run(['--profile','whale-test','--dump-config'],'installed').includes('@linfengqaqtat/dsh-scriptor-companion'))
run(['plugin','--profile','whale-test','remove','@linfengqaqtat/dsh-scriptor-companion'],'uninstall')
assert.ok(!run(['--profile','whale-test','--dump-config'],'removed').includes('@linfengqaqtat/dsh-scriptor-companion'))
run(['plugin','--profile','whale-test','add',tarball],'reinstall')
if (process.env.WHALE_SCRIPTOR_TGZ) {
  const scriptor = path.join(root, 'scriptor.tgz')
  fs.copyFileSync(path.resolve(process.env.WHALE_SCRIPTOR_TGZ), scriptor)
  run(['plugin','--profile','whale-test','add',scriptor],'coexist-install')
}
const profile=path.join(home,'profiles','whale-test')
const installed=JSON.parse(fs.readFileSync(path.join(profile,'package.json'),'utf8'))
assert.ok(installed.dependencies?.['@linfengqaqtat/dsh-scriptor-companion'])
installed.dsh.profile.patchReload = 'live'
fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify(installed, null, 2))
const patch=path.join(profile,'cordis.patch.yml')
const localRequire=createRequire(cli)
const {parse}=createRequire(new URL('../../bundle/package.json',import.meta.url))('yaml')
const rows=fs.existsSync(patch)?parse(fs.readFileSync(patch,'utf8'))??[]:[]
rows.push({id:'agent-default-model',config:{provider:'whale-acceptance',model:'fixture'}})
const fixture = path.join(root, 'native-host.mjs')
fs.copyFileSync(path.join(packageRoot, 'tests/fixtures/native-host.mjs'), fixture)
rows.push({insert:[{id:'whale-acceptance',name:pathToFileURL(fixture).href}]})
fs.writeFileSync(patch,JSON.stringify(rows,null,2))
const port=Number(portArg ?? 6107)
assert.ok(Number.isInteger(port) && port > 1024 && port < 65536, 'Invalid test port')
const controlToken = randomUUID()
Object.assign(env,{WHALE_TEST_LLM:localRequire.resolve('@deepseek-ai/dsh-llm'),WHALE_TEST_WORKSPACE:workspace,WHALE_TEST_REPORT:path.join(evidence,'native-host.json'),WHALE_TEST_CONTROL_TOKEN:controlToken})
const out=fs.openSync(path.join(evidence,'native.log'),'a'),err=fs.openSync(path.join(evidence,'native-error.log'),'a')
const child=spawn(process.execPath,[cli,'--profile','whale-test','--host','127.0.0.1','--port',String(port),'--no-open'],{cwd:workspace,env,detached:true,windowsHide:true,stdio:['ignore',out,err]})
child.unref();fs.closeSync(out);fs.closeSync(err)
const report={root,home,workspace,profile,port,processId:child.pid,cli,hostVersion:baseline.registry.version,installed:true,uninstalled:true,reinstalled:true,tarball,coexist:Boolean(process.env.WHALE_SCRIPTOR_TGZ),controlToken}
fs.writeFileSync(path.join(evidence,'native-runtime.json'),JSON.stringify(report,null,2))
let ready=false
for(let attempt=0;attempt<90;attempt++) {
  const errors=fs.readFileSync(path.join(evidence,'native-error.log'),'utf8')
  if(errors.includes('startup failed')) throw Error(errors)
  const fixture=path.join(evidence,'native-host.json')
  if(fs.existsSync(fixture)) {
    try { ready=JSON.parse(fs.readFileSync(fixture,'utf8')).ready === true } catch { /* A write can overlap this read. */ }
  }
  if(ready) break
  await new Promise(resolve=>setTimeout(resolve,500))
}
assert.ok(ready,'Native fixture did not become ready; see native-error.log')
console.log(JSON.stringify(report,null,2))
