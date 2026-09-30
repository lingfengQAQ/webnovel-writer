/** Real Chromium regression checks against the isolated study-browser-host fixture. */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const runtimePath = path.resolve(process.argv[2])
const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8').replace(/^\uFEFF/, ''))
const evidence = path.dirname(runtimePath)
const { chromium } = await import(pathToFileURL(path.join(process.env.WEBNOVEL_PLAYWRIGHT, 'index.mjs')).href)
const browser = await chromium.launch({ headless: true, executablePath: process.env.WEBNOVEL_CHROMIUM })
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
const page = await context.newPage()
page.setDefaultTimeout(15000)
const report = { checks: {}, screenshots: [], pageErrors: [], consoleErrors: [], requestFailures: [], controlRequests: [], saveRequests: [] }
const reportPath = path.join(evidence, 'adversarial-browser.json')
const persist = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const until = async (predicate, label, timeout = 15000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { if (await predicate()) return; await pause(50) }
  throw new Error('Timed out: ' + label)
}
const screenshot = async name => {
  const file = name + '.png'
  await page.screenshot({ path: path.join(evidence, file), fullPage: true })
  report.screenshots.push(file); persist()
}
const stage = async (name, run) => {
  report.current = name; persist()
  await run()
  report.checks[name] = true; persist()
}
page.on('pageerror', error => { report.pageErrors.push(error.message); persist() })
page.on('console', message => {
  if (message.type() === 'error') {
    const location = message.location()
    report.consoleErrors.push({ message: message.text(), path: location.url ? new URL(location.url).pathname : '' }); persist()
  }
})
page.on('requestfailed', request => {
  report.requestFailures.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText }); persist()
})
page.on('dialog', dialog => dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss())

const mainTitle = 'S6 后台索引验收'
const openSession = async (title = mainTitle, workspaceTitle = 'S5 临时验收书房') => {
  await page.getByRole('tab', { name: '工作区', exact: true }).click()
  const native = page.locator('.nw-native-workspaces')
  const session = native.getByText(title, { exact: true })
  if (!await session.isVisible()) {
    // DSH 0.1.7 renders each workspace group as a treeitem whose click toggles
    // expansion, and the current group auto-expands after the saved selection is
    // restored. Toggle only an actually-collapsed row, never a blind title click.
    const group = native.getByRole('treeitem', { name: new RegExp('^' + workspaceTitle) })
    await group.waitFor()
    if (await group.getAttribute('aria-expanded') === 'false') await group.click()
    await session.waitFor()
  }
  await session.click()
  await page.getByRole('tab', { name: '书房', exact: true }).click()
}
const editor = () => page.getByRole('textbox', { name: '文档正文', exact: true })
const editAppend = async text => {
  await page.getByRole('button', { name: '编辑', exact: true }).click()
  await editor().click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('\n' + text + '\n')
}
// CodeMirror virtualizes long documents: innerText returns only the rendered
// viewport, and a remounted editor scrolls back to the top. Read the end slice.
const editorEndText = async () => {
  await editor().click(); await page.keyboard.press('Control+End')
  return await editor().innerText()
}
const expand = async locator => {
  if (await locator.getAttribute('aria-expanded') === 'false') await locator.click()
}
const openDraft = async file => {
  await page.getByRole('tab', { name: '书房', exact: true }).click()
  await page.getByRole('textbox', { name: '搜索书名或文件', exact: true }).fill('')
  const book = page.locator('.nw-book').filter({ hasText: '验收作品甲' })
  await expand(book.getByRole('button', { name: /验收作品甲/ }))
  await expand(book.getByRole('button', { name: /^草稿区/ }))
  await expand(book.getByRole('button', { name: '草稿', exact: true }))
  await expand(book.getByRole('button', { name: '卷01-来信', exact: true }))
  await book.getByRole('button', { name: new RegExp('^' + file.replace('.', '\\.')) }).click()
  await page.getByRole('tab', { name: new RegExp('^' + file.replace('.', '\\.')) }).waitFor()
}
const openShared = async () => {
  const search = page.getByRole('textbox', { name: '搜索书名或文件', exact: true })
  await search.fill('写作笔记.md')
  await page.locator('.nw-search-result').filter({ hasText: '写作笔记.md' }).click()
  await search.fill('')
  await page.getByRole('tab', { name: '写作笔记.md', exact: true }).waitFor()
}

const held = []
try {
  await until(() => {
    const file = path.join(evidence, 'browser-host-report.json')
    if (!fs.existsSync(file)) return false
    const host = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (host.fixtureError) throw new Error(host.fixtureError)
    return host.ready === true && /dsh web: http/.test(fs.readFileSync(path.join(runtime.root, 'stdout.log'), 'utf8'))
  }, 'DSH Loader and synthetic fixture are ready', 30000)
  const url = fs.readFileSync(path.join(runtime.root, 'stdout.log'), 'utf8').match(/dsh web: (http\S+)/)?.[1]
  if (!url) throw new Error('Acceptance host is not ready')
  await page.goto(url)
  await page.getByRole('tab', { name: '书房', exact: true }).waitFor({ state: 'visible', timeout: 30000 })
  const welcome = page.getByRole('button', { name: '继续', exact: true })
  await welcome.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
  if (await welcome.isVisible()) { await welcome.click(); await welcome.waitFor({ state: 'hidden' }) }
  await openSession()
  await stage('normal-save-and-reload', async () => {
    await openShared()
    const marker = '正常保存验收：原文来自临时书房。'
    await editAppend(marker)
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await page.getByText('文件已保存', { exact: true }).waitFor()
    await page.getByText('已交给主控，处理结果见对话', { exact: true }).waitFor()
    assert.ok(fs.readFileSync(path.join(runtime.workspace, '书房/知识库/写作笔记.md'), 'utf8').includes(marker))
    await screenshot('normal-save')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('tab', { name: '书房', exact: true }).waitFor()
    await openSession(); await openShared()
    assert.ok((await page.getByLabel('文档预览', { exact: true }).innerText()).includes(marker))
  })
  await stage('session-separation', async () => {
    await openSession('S5 会话隔离验收', 'S5 空工作范围')
    await page.getByText(/当前工作范围还没有作品/).waitFor()
    assert.equal(await page.getByRole('tab', { name: '写作笔记.md', exact: true }).count(), 0)
    await screenshot('separate-session')
    await openSession()
    await page.getByRole('tab', { name: '写作笔记.md', exact: true }).waitFor()
  })
  await stage('F01-save-retry-keeps-both-dirty-buffers', async () => {
    let firstPayload, droppedResponse
    // Playwright's fetch engine drops browser fetch-metadata headers, and the
    // study API requires sec-fetch-site: same-origin; restore it on replays.
    const replay = route => route.fetch({ headers: { ...route.request().headers(), 'sec-fetch-site': 'same-origin' } })
    await page.route('**/api/webnovel/study/save', async route => {
      const payload = route.request().postDataJSON()
      report.saveRequests.push({ operationId: payload.operationId, ref: payload.ref, body: payload.body, sessionId: payload.sessionId }); persist()
      if (!firstPayload) {
        firstPayload = payload
        const response = await replay(route)
        droppedResponse = await response.json()
        assert.equal(response.status(), 200)
        assert.equal(droppedResponse.ok, true)
        assert.match(droppedResponse.value.document.ref.path, /稿2\.md$/)
        // The real writer completed; only its transport response is lost.
        await route.abort('failed')
      } else {
        assert.deepEqual(payload, firstPayload, 'retry must preserve the original operation and payload')
        await route.continue()
      }
    })
    await openDraft('稿1.md')
    const firstMarker = 'F01 原保存的作者文字。'
    const secondMarker = 'F01 目标稿尚未保存的另一份作者文字。'
    await editAppend(firstMarker)
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await page.getByRole('button', { name: '重试保存', exact: true }).waitFor()
    const dir = path.join(runtime.workspace, '验收作品甲/草稿区/草稿/卷01-来信')
    const disk = fs.readFileSync(path.join(dir, '稿2.md'), 'utf8')
    assert.ok(disk.includes(firstMarker))
    await page.getByRole('button', { name: '刷新书房', exact: true }).click()
    await openDraft('稿2.md'); await editAppend(secondMarker)
    const targetText = await editor().innerText()
    await page.getByRole('tab', { name: /^稿1\.md/ }).click()
    await page.getByRole('button', { name: '重试保存', exact: true }).click()
    await page.getByText(/目标稿已有未合并的编辑或保存请求/).waitFor()
    assert.equal(report.saveRequests.length, 2)
    assert.equal(await page.getByRole('tab', { name: /^稿1\.md/ }).getByLabel('未保存', { exact: true }).count(), 1)
    assert.equal(await page.getByRole('tab', { name: /^稿2\.md/ }).getByLabel('未保存', { exact: true }).count(), 1)
    // The retried request body is the preserved buffer text: the server-visible
    // proof the lost-response save kept the author's words in the source buffer.
    assert.ok(report.saveRequests[1].body.includes(firstMarker))
    assert.ok((await editorEndText()).includes(firstMarker))
    await screenshot('F01-source-conflict')
    await page.getByRole('tab', { name: /^稿2\.md/ }).click()
    assert.ok((await editorEndText()).includes(secondMarker))
    assert.ok(targetText.includes(secondMarker))
    assert.equal(fs.readFileSync(path.join(dir, '稿2.md'), 'utf8'), disk)
    assert.deepEqual(fs.readdirSync(dir).filter(name => /^稿\d+\.md$/.test(name)).sort(), ['稿1.md', '稿2.md'])
    report.F01 = { sameOperationId: firstPayload.operationId, bothDirty: true, savedTargetUnchanged: true, versions: ['稿1.md', '稿2.md'] }
    await screenshot('F01-target-preserved')
    await page.unroute('**/api/webnovel/study/save')
  })
  await stage('sidebar-keeps-dirty-editor', async () => {
    const text = await editorEndText()
    await page.getByRole('button', { name: '收起右侧边栏', exact: true }).click()
    await page.getByRole('button', { name: '打开书稿与资料', exact: true }).click()
    await editor().waitFor()
    assert.equal(await editorEndText(), text)
  })
  await stage('F11-index-control-cancellation-and-new-request', async () => {
    await page.getByRole('button', { name: '查看检索索引', exact: true }).click()
    const choice = page.getByRole('combobox', { name: '选择索引作品', exact: true })
    await choice.selectOption('book:acceptance-a')
    const checkbox = page.getByRole('checkbox', { name: '提交后自动更新', exact: true })
    await checkbox.waitFor()
    assert.equal(await checkbox.isEnabled(), true)
    await page.route('**/api/webnovel/study/index-control', async route => {
      const payload = route.request().postDataJSON()
      let release
      const gate = new Promise(resolve => { release = resolve })
      const entry = { release, payload, completed: false, responseReady: false }
      held.push(entry)
      report.controlRequests.push({ sessionId: payload.sessionId, space: payload.space, action: payload.action }); persist()
      try {
        // Restore the browser fetch-metadata header Playwright's fetch engine drops.
        const response = await route.fetch({ headers: { ...route.request().headers(), 'sec-fetch-site': 'same-origin' } })
        assert.equal(response.status(), 200)
        entry.responseReady = true
        await gate
        await route.fulfill({ response })
      } catch (error) {
        entry.transportError = String(error)
        if (!entry.cancelled) throw error
      } finally { entry.completed = true }
    })
    await checkbox.click()
    await until(() => held[0]?.responseReady, 'first real control completed behind delayed response')
    assert.equal(await checkbox.isEnabled(), false)
    held[0].cancelled = true
    await choice.selectOption('book:acceptance-b')
    await until(() => checkbox.isEnabled(), 'other book control is usable')
    await choice.selectOption('book:acceptance-a')
    await until(() => checkbox.isEnabled(), 'cancelled book control is usable on return')
    await checkbox.click()
    await until(() => held[1]?.responseReady, 'new real control completed behind delayed response')
    assert.equal(await checkbox.isEnabled(), false)
    held[0].release()
    await until(() => held[0].completed, 'old response transport settles')
    // Waiting one animation frame ensures any queued completion can render.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal(await checkbox.isEnabled(), false, 'old response must not release newer request busy state')
    await screenshot('F11-new-control-still-busy')
    held[1].release()
    await until(() => checkbox.isEnabled(), 'new request releases its own busy state')
    assert.equal(report.controlRequests.length, 2)
    assert.equal(report.controlRequests.every(item => item.sessionId === 'webnovel-browser-acceptance' && item.space === 'book:acceptance-a'), true)
    report.F11 = { cancelledBookReusable: true, staleResponseKeptNewRequestBusy: true, newRequestReleased: true }
    await screenshot('F11-controls-recovered')
    await page.unroute('**/api/webnovel/study/index-control')
  })
  await stage('settings-open-and-return', async () => {
    // Use the host's own settings entry, discovered by its accessible label.
    const settings = page.getByRole('button', { name: /设置/ }).filter({ visible: true })
    assert.ok(await settings.count() > 0, 'host exposes settings')
    await settings.first().click()
    await page.getByText('模型', { exact: true }).first().waitFor()
    await screenshot('host-settings')
    await page.keyboard.press('Escape')
  })
  report.host = JSON.parse(fs.readFileSync(path.join(evidence, 'browser-host-report.json'), 'utf8'))
  assert.ok(report.host.savesReceived > 0)
  assert.equal(report.host.customEvents, 0)
  assert.deepEqual(report.pageErrors, [])
  report.expectedConsoleErrors = report.consoleErrors.filter(item => item.path === '/api/webnovel/study/save' && item.message.includes('net::ERR_FAILED'))
  report.unexpectedConsoleErrors = report.consoleErrors.filter(item => !report.expectedConsoleErrors.includes(item))
  assert.deepEqual(report.unexpectedConsoleErrors, [])
  report.ok = true; report.current = 'complete'; persist()
  console.log(JSON.stringify({ ok: report.ok, checks: report.checks, screenshots: report.screenshots, pageErrors: report.pageErrors, unexpectedConsoleErrors: report.unexpectedConsoleErrors }))
} catch (error) {
  report.ok = false; report.failure = String(error); persist()
  await screenshot('browser-regression-failure').catch(() => {})
  fs.writeFileSync(path.join(evidence, 'browser-failure-ui.txt'), await page.locator('body').innerText().catch(() => 'Page unavailable'))
  console.error(JSON.stringify({ stage: report.current, failure: report.failure, pageErrors: report.pageErrors, consoleErrors: report.consoleErrors }))
  process.exitCode = 1
} finally {
  for (const entry of held) { entry.cancelled = true; entry.release() }
  await browser.close()
}
