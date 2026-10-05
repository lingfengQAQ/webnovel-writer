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
const errors = []
const posts = []
const askResponses = []
const checks = {}
let shots = 0
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
page.on('request', request => {
  if (request.method() !== 'POST') return
  const url = new URL(request.url())
  if (!url.pathname.includes('/api/webnovel/study/')) return
  let body = {}
  try { body = JSON.parse(request.postData() || '{}') } catch { body = {} }
  posts.push({
    method: url.pathname.split('/').pop(),
    intent: body.intent,
    requestId: body.requestId,
    requestIds: body.requestIds,
    accepted: body.accepted,
    dirty: body.dirty,
    hashPrefix: typeof body.hash === 'string' ? body.hash.slice(0, 12) : undefined,
    line: body.selection?.line,
    chars: typeof body.selection?.text === 'string' ? Array.from(body.selection.text).length : undefined,
  })
})
page.on('response', async response => {
  if (!new URL(response.url()).pathname.endsWith('/ask')) return
  askResponses.push({ status: response.status(), body: (await response.text()).slice(0, 300) })
})

const draftDir = path.join(runtime.workspace, '验收作品甲', '草稿区', '草稿', '卷01-来信')
const reportPath = path.join(evidence, 'browser-host-report.json')
const hostReport = () => fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : { requests: 0, editorScripts: [] }
const editorCount = () => {
  const report = hostReport()
  return { requests: report.requests ?? 0, scripts: (report.editorScripts ?? []).length }
}
async function shot(name) {
  if (shots >= 12) return
  shots += 1
  await page.waitForFunction(() => document.getAnimations().every(animation => {
    const timing = animation.effect && 'getTiming' in animation.effect ? animation.effect.getTiming() : null
    if (timing && (timing.iterations === Infinity || timing.iterations > 20)) return true
    return animation.playState !== 'running'
  }), null, { timeout: 3000 }).catch(() => {})
  await page.waitForTimeout(200)
  await page.screenshot({ path: path.join(evidence, name) })
}
async function waitPosts(method, count, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (posts.filter(item => item.method === method).length >= count) return
    await page.waitForTimeout(100)
  }
  throw new Error('timed out waiting for ' + method + ' #' + count)
}
async function waitToast(pattern, timeout = 8000) {
  const source = pattern.source
  const flags = pattern.flags
  const start = await page.evaluate(() => (window.__editorToasts ?? []).length)
  try {
    await page.waitForFunction(({ source, flags, start }) => (window.__editorToasts ?? []).slice(start).some(text => new RegExp(source, flags).test(text)), { source, flags, start }, { timeout })
  } catch (error) {
    const seen = await page.evaluate(from => (window.__editorToasts ?? []).slice(from), start).catch(() => [])
    throw new Error('toast /' + source + '/ missing; saw ' + JSON.stringify(seen) + '\n' + (error instanceof Error ? error.message : ''))
  }
}
async function expandWorkspace(name) {
  const group = page.locator('[role="treeitem"][aria-expanded]').filter({ has: page.getByText(name, { exact: true }) })
  await group.waitFor({ timeout: 8000 })
  if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
}
async function openSession() {
  if (!await page.getByRole('tab', { name: '工作区', exact: true }).isVisible()) {
    const expand = page.getByRole('button', { name: '展开书房', exact: true })
    if (await expand.isVisible()) await expand.click()
    else await page.getByRole('button', { name: '打开侧边栏', exact: true }).click()
  }
  await page.getByRole('tab', { name: '工作区', exact: true }).click()
  await expandWorkspace('S5 临时验收书房')
  await page.getByText('S5 书房验收', { exact: true }).click()
}
async function revealDrafts() {
  await page.getByRole('tab', { name: '书房', exact: true }).click()
  const book = page.locator('.nw-book').filter({ hasText: '验收作品甲' })
  const file = book.getByRole('button', { name: /^稿\d+\.md/ }).first()
  if (!await file.isVisible()) {
    if (!await book.getByRole('button', { name: /^草稿区/ }).isVisible()) await book.getByRole('button', { name: /验收作品甲/ }).click()
    if (!await book.getByRole('button', { name: '草稿', exact: true }).isVisible()) await book.getByRole('button', { name: /^草稿区/ }).click()
    if (!await book.getByRole('button', { name: '卷01-来信', exact: true }).isVisible()) await book.getByRole('button', { name: '草稿', exact: true }).click()
    if (!await file.isVisible()) await book.getByRole('button', { name: '卷01-来信', exact: true }).click()
  }
  const loading = book.getByText('读取中')
  if (await loading.isVisible()) await loading.waitFor({ state: 'hidden', timeout: 15000 })
  await file.waitFor({ timeout: 15000 })
  return book
}
async function openLatestDraft() {
  const book = await revealDrafts()
  const buttons = book.getByRole('button', { name: /^稿\d+\.md/ })
  const count = await buttons.count()
  if (!count) throw new Error('no draft')
  let best = 0
  let bestN = -1
  let bestLabel = '稿1.md'
  for (let index = 0; index < count; index++) {
    const label = (await buttons.nth(index).getAttribute('aria-label')) || await buttons.nth(index).innerText()
    const number = Number(label.match(/稿(\d+)\.md/)?.[1] ?? -1)
    if (number > bestN) { bestN = number; best = index; bestLabel = label.match(/稿\d+\.md/)?.[0] ?? bestLabel }
  }
  await buttons.nth(best).click()
  await page.getByRole('tab', { name: new RegExp(bestLabel.replace('.', '\\.')) }).first().waitFor()
  await page.getByRole('textbox', { name: '文档正文', exact: true }).waitFor()
  if (await page.getByText('已有更新版本').isVisible()) throw new Error(latest + ' is not the writable draft')
}
function editorBox() { return page.getByRole('textbox', { name: '文档正文', exact: true }) }
async function selectPhrase(phrase) {
  let last
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const box = editorBox()
      await box.click()
      await page.keyboard.press('Escape')
      await page.keyboard.press('Control+f')
      const input = page.getByRole('textbox', { name: '查找内容' })
      await input.waitFor()
      await input.fill(phrase)
      await page.getByRole('button', { name: '下一个', exact: true }).click({ timeout: 8000 })
      await page.keyboard.press('Escape')
      await page.getByRole('toolbar', { name: '选区操作' }).waitFor({ timeout: 5000 })
      return
    } catch (error) {
      last = error
      await page.keyboard.press('Escape').catch(() => {})
    }
  }
  throw last
}
async function currentDraftPath() {
  const label = await page.locator('[role="tab"]').filter({ hasText: /稿\d+\.md/ }).first().innerText()
  const name = label.match(/稿\d+\.md/)?.[0] ?? '稿1.md'
  return path.join(draftDir, name)
}
function fileHas(marker) {
  const hits = fs.readdirSync(draftDir).filter(name => name.endsWith('.md')).map(name => {
    const file = path.join(draftDir, name)
    const text = fs.readFileSync(file, 'utf8')
    return text.includes(marker) ? { name, bytes: fs.statSync(file).size, at: text.indexOf(marker) } : undefined
  }).filter(Boolean)
  return hits
}

const summary = { checks, posts, askResponses, disk: [], errors }
try {
  const url = fs.readFileSync(path.join(runtime.root, 'stdout.log'), 'utf8').match(/dsh web: (http\S+)/)?.[1]
  if (!url) throw new Error('Acceptance host is not ready')
  await page.goto(url)
  await page.getByRole('tab', { name: '书房', exact: true }).waitFor({ state: 'visible', timeout: 30000 })
  const welcome = page.getByRole('button', { name: '继续', exact: true })
  await welcome.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
  if (await welcome.isVisible()) { await welcome.click(); await welcome.waitFor({ state: 'hidden' }) }
  const expandRight = page.getByRole('button', { name: '打开右侧边栏', exact: true })
  if (await expandRight.isVisible()) await expandRight.click()
  await openSession()
  await openLatestDraft()
  await page.evaluate(() => {
    const log = []
    window.__editorToasts = log
    const push = text => { if (text) log.push(text) }
    const see = node => {
      if (!node || node.nodeType !== 1) return
      if (node.matches?.('.ed-toast')) push(node.textContent || '')
      for (const toast of node.querySelectorAll?.('.ed-toast') ?? []) push(toast.textContent || '')
    }
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) see(node)
    }).observe(document.body, { subtree: true, childList: true })
  })
  const keep = page.getByRole('button', { name: '已比较，保留我的编辑', exact: true })
  if (await keep.isVisible()) await keep.click()
  const swapBack = page.getByRole('button', { name: '把对话移回中间', exact: true })
  if (await swapBack.isVisible()) await swapBack.click()

  const externalBefore = editorCount()
  const externalMarker = '外部同步' + Date.now()
  fs.appendFileSync(await currentDraftPath(), '\n' + externalMarker + '\n')
  await waitToast(/磁盘上的新版本已同步/)
  const externalAfter = editorCount()
  assert.equal(externalAfter.scripts, externalBefore.scripts)
  assert.equal(externalAfter.requests, externalBefore.requests)
  checks.externalModifyNoFollowup = true

  await selectPhrase('信封上的字迹依然清晰')
  await shot('01-bubble.png')
  const undoneBefore = editorCount()
  await page.getByRole('button', { name: '让主 Agent 润色', exact: true }).click()
  await page.getByRole('button', { name: '接受', exact: true }).waitFor({ timeout: 20000 })
  await shot('02-suggestion.png')
  const undoneId = posts.filter(item => item.method === 'ask').at(-1)?.requestId
  assert.ok(undoneId)
  assert.equal(editorCount().scripts, undoneBefore.scripts + 1)
  await page.keyboard.press('Tab')
  await page.getByRole('button', { name: '接受', exact: true }).waitFor({ state: 'hidden', timeout: 5000 })
  await page.keyboard.press('Control+z')
  await page.getByRole('button', { name: '接受', exact: true }).waitFor({ timeout: 5000 })
  await page.keyboard.press('Control+End')
  const undoMarker = '撤销后另存' + Date.now()
  await page.keyboard.insertText('\n' + undoMarker + '\n')
  const savesBeforeUndo = posts.filter(item => item.method === 'save').length
  await page.keyboard.press('Control+s')
  await waitPosts('save', savesBeforeUndo + 1)
  await waitToast(/文件已保存|已交给主控/)
  const undoSave = posts.filter(item => item.method === 'save').slice(savesBeforeUndo).at(-1)
  assert.ok(undoSave)
  assert.ok(!undoSave.accepted || !undoSave.accepted.includes(undoneId))
  checks.undoThenSaveOmitsId = { requestId: undoneId, accepted: undoSave.accepted ?? [] }
  await page.getByRole('button', { name: '拒绝', exact: true }).click()

  await selectPhrase('潮声越过石阶')
  const savedBefore = editorCount()
  await page.getByRole('button', { name: '让主 Agent 润色', exact: true }).click()
  await page.getByRole('button', { name: '接受', exact: true }).waitFor({ timeout: 20000 })
  const savedId = posts.filter(item => item.method === 'ask').at(-1)?.requestId
  assert.ok(savedId)
  assert.equal(editorCount().scripts, savedBefore.scripts + 1)
  await page.keyboard.press('Tab')
  await page.getByRole('button', { name: '接受', exact: true }).waitFor({ state: 'hidden', timeout: 5000 })
  const savesBefore = posts.filter(item => item.method === 'save').length
  await page.keyboard.press('Control+s')
  await waitPosts('save', savesBefore + 1)
  await waitToast(/文件已保存|已交给主控/)
  const save = posts.filter(item => item.method === 'save').slice(savesBefore).at(-1)
  assert.ok(save?.accepted?.includes(savedId))
  let diskHits = []
  const diskDeadline = Date.now() + 3000
  while (Date.now() <= diskDeadline) {
    diskHits = fileHas('（验收改写）')
    if (diskHits.length) break
    await page.waitForTimeout(100)
  }
  assert.ok(diskHits.length > 0)
  summary.disk.push({ marker: '（验收改写）', hits: diskHits })
  const headers = page.getByRole('button', { name: /收到执行请求/ })
  await headers.last().waitFor({ timeout: 8000 })
  const noticeDeadline = Date.now() + 12000
  let notice = ''
  let adoptedText = []
  let mine
  while (Date.now() < noticeDeadline) {
    const headerCount = await headers.count()
    for (let index = 0; index < headerCount; index++) {
      const header = headers.nth(index)
      if ((await header.getAttribute('aria-expanded')) === 'true') continue
      await header.click({ timeout: 3000 })
    }
    notice = await page.locator('body').innerText()
    adoptedText = notice.match(/本次改动含 \d+ 处作者在编辑器中采纳的主 Agent 建议（[^）]+）/g) ?? []
    mine = adoptedText.find(line => line.includes('#' + savedId))
    if (mine) break
    await page.waitForTimeout(250)
  }
  assert.ok(mine, adoptedText.join('\n') || notice.slice(Math.max(0, notice.length - 800)))
  assert.ok(!mine.includes('#' + undoneId))
  checks.toolCardLive = false
  const suggestionCard = () => page.locator('.nw-result', { hasText: '交回编辑建议' }).locator('visible=true').last()
  if (!(await suggestionCard().count())) {
    const turnOfCard = await page.evaluate(() => {
      const card = [...document.querySelectorAll('.nw-result')].filter(node => (node.textContent || '').includes('交回编辑建议')).at(-1)
      let node = card?.parentElement ?? null
      while (node) {
        if (node.hasAttribute('hidden')) node.dispatchEvent(new Event('beforematch'))
        node = node.parentElement
      }
      return card?.closest('[data-chat-turn]')?.getAttribute('data-chat-turn') ?? ''
    })
    if (turnOfCard && !(await suggestionCard().count())) {
      const toggle = page.locator('button[data-turn-process="' + turnOfCard + '"]')
      const toggles = await toggle.count()
      for (let index = 0; index < toggles; index++) {
        const button = toggle.nth(index)
        if (!(await button.isVisible())) continue
        if ((await button.getAttribute('aria-expanded')) === 'true') continue
        await button.click({ timeout: 5000 })
        break
      }
    }
  }
  const card = suggestionCard()
  try {
    await card.waitFor({ state: 'visible', timeout: 8000 })
  } catch (error) {
    const detail = await page.evaluate(() => {
      const card = [...document.querySelectorAll('.nw-result')].filter(node => (node.textContent || '').includes('交回编辑建议')).at(-1)
      const chain = []
      let node = card
      for (let depth = 0; depth < 8 && node; depth++) {
        chain.push({
          tag: node.tagName,
          hidden: node.getAttribute('hidden'),
          turn: node.getAttribute('data-chat-turn'),
          kind: node.getAttribute('data-chat-flow-kind'),
          member: node.getAttribute('data-turn-process-hidden'),
        })
        node = node.parentElement
      }
      return { chain, text: (card?.textContent || '').slice(0, 180) }
    })
    throw new Error('工具卡仍不可见 ' + JSON.stringify(detail) + '\n' + (error instanceof Error ? error.message : ''))
  }
  const heading = card.locator('.nw-result-heading')
  if ((await heading.getAttribute('aria-expanded')) !== 'true') await heading.click()
  try {
    await page.waitForFunction(id => {
      const cards = [...document.querySelectorAll('.nw-result')].filter(node => (node.textContent || '').includes('交回编辑建议'))
      const text = cards.at(-1)?.innerText ?? ''
      return text.includes('#' + id) && text.includes('已采纳')
    }, savedId, { timeout: 8000 })
  } catch (error) {
    const text = await card.innerText().catch(() => '')
    throw new Error('工具卡未同时出现 #' + savedId + ' 与已采纳：' + text.slice(0, 500) + '\n' + (error instanceof Error ? error.message : ''))
  }
  const text = await card.innerText()
  assert.ok(text.includes('#' + savedId) && text.includes('已采纳'), text.slice(0, 500))
  checks.toolCardText = text.slice(0, 400)
  checks.toolCardLive = true
  await shot('08-card.png')
  checks.polishAcceptSave = { requestId: savedId, accepted: save.accepted, disk: diskHits, notice: adoptedText }

  await selectPhrase('林舟在渡口停下脚步')
  const reviewBefore = editorCount()
  await page.getByRole('button', { name: '让主 Agent 审读', exact: true }).click()
  const marker = page.getByRole('button', { name: /查看审读批注/ }).first()
  await marker.waitFor({ timeout: 20000 })
  assert.equal(editorCount().scripts, reviewBefore.scripts + 1)
  await marker.click()
  await page.getByRole('dialog', { name: '审读批注' }).waitFor()
  await page.getByText('验收批注。', { exact: true }).waitFor()
  await shot('03-comment.png')
  checks.reviewComment = true
  const openName = (await page.locator('[role="tab"]').filter({ hasText: /稿\d+\.md/ }).first().innerText()).match(/稿\d+\.md/)?.[0] ?? '稿1.md'
  await page.locator('[role="tab"]').filter({ hasText: openName }).getByRole('button', { name: '关闭', exact: true }).click()
  const book = await revealDrafts()
  await book.getByRole('button', { name: new RegExp('^' + openName.replace('.', '\\.')) }).click()
  await page.getByRole('tab', { name: new RegExp(openName.replace('.', '\\.')) }).first().waitFor()
  await page.getByRole('button', { name: /查看审读批注/ }).first().waitFor({ timeout: 8000 })
  checks.reopenKeepsSuggestion = true
  await shot('09-reopen.png')

  await editorBox().click()
  await page.keyboard.press('Control+End')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('Shift+F10')
  const continueBefore = editorCount()
  let releaseSuggestions
  const suggestionsGate = new Promise(resolve => { releaseSuggestions = resolve })
  const holdSuggestions = async route => { await suggestionsGate; await route.continue() }
  await page.route('**/api/webnovel/study/suggestions', holdSuggestions)
  await page.getByRole('menuitem', { name: '从这里续写', exact: true }).click()
  await page.getByRole('status', { name: '处理中', exact: true }).waitFor({ timeout: 8000 })
  const continueAsks = posts.filter(item => item.method === 'ask').length
  await page.keyboard.press('Shift+F10')
  await Promise.all([
    waitToast(/这段已经有一条在处理的请求/),
    page.getByRole('menuitem', { name: '从这里续写', exact: true }).click(),
  ])
  assert.equal(posts.filter(item => item.method === 'ask').length, continueAsks)
  releaseSuggestions()
  await page.unroute('**/api/webnovel/study/suggestions', holdSuggestions)
  await page.getByText('验收续写。').waitFor({ timeout: 20000 })
  assert.equal(editorCount().scripts, continueBefore.scripts + 1)
  await shot('04-ghost.png')
  checks.continueGhost = true
  await editorBox().focus()
  await page.keyboard.press('Shift+F10')
  await Promise.all([
    waitToast(/这段已经有一条在处理的请求/),
    page.getByRole('menuitem', { name: '从这里续写', exact: true }).click(),
  ])
  assert.equal(posts.filter(item => item.method === 'ask').length, continueAsks)
  checks.duplicatePendingAndGhostBlocked = true
  await editorBox().focus()
  await page.keyboard.press('Escape')

  await selectPhrase('林舟在渡口停下脚步')
  await page.keyboard.press('Shift+F10')
  await shot('07-menu.png')
  await page.keyboard.press('Escape')
  const retryBefore = editorCount()
  await page.getByRole('button', { name: '让主 Agent 润色', exact: true }).click()
  await page.getByRole('button', { name: '换一版', exact: true }).waitFor({ timeout: 20000 })
  await page.getByRole('button', { name: '换一版', exact: true }).click()
  await page.getByRole('button', { name: '接受', exact: true }).waitFor({ timeout: 20000 })
  assert.equal(editorCount().scripts, retryBefore.scripts + 2)
  checks.retryVersion = true
  await page.getByRole('button', { name: '拒绝', exact: true }).click()

  await selectPhrase('潮声越过石阶')
  const noneBefore = editorCount()
  await page.getByRole('button', { name: '让主 Agent 精简', exact: true }).click()
  await waitToast(/主 Agent 没有交回修改，见对话/, 20000)
  assert.equal(editorCount().scripts, noneBefore.scripts + 1)
  const lastScript = hostReport().editorScripts?.at(-1)
  assert.equal(lastScript?.action, 'finish')
  checks.unanswered = true

  await selectPhrase('信封上的字迹依然清晰')
  await page.keyboard.press('Control+k')
  const prompt = page.getByRole('textbox', { name: '给主 Agent 的要求' })
  await prompt.waitFor()
  await prompt.fill('【脚本:hold】把这句改得更短')
  const touchedBefore = posts.filter(item => item.method === 'ask').length
  await page.getByRole('button', { name: '发送给主 Agent', exact: true }).click()
  await page.getByRole('status', { name: '处理中', exact: true }).waitFor({ timeout: 8000 })
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.insertText('啊')
  await page.getByRole('button', { name: '原文已被你改动，点一次查看提示，再点确认替换', exact: true }).waitFor({ timeout: 20000 })
  await shot('05-touched.png')
  await page.getByRole('button', { name: '原文已被你改动，点一次查看提示，再点确认替换', exact: true }).click()
  await page.getByRole('button', { name: '确认替换：会覆盖你在这段里的改动', exact: true }).waitFor()
  checks.touchedConfirm = true
  await page.getByRole('button', { name: '拒绝', exact: true }).click()
  assert.equal(posts.filter(item => item.method === 'ask').length, touchedBefore + 1)

  await selectPhrase('林舟在渡口停下脚步')
  await page.keyboard.press('Control+k')
  await prompt.fill('【脚本:hold】先占住主 Agent')
  const cancelBefore = editorCount()
  await page.getByRole('button', { name: '发送给主 Agent', exact: true }).click()
  await page.getByRole('status', { name: '处理中', exact: true }).waitFor({ timeout: 8000 })
  await selectPhrase('潮声越过石阶')
  await page.getByRole('button', { name: '让主 Agent 润色', exact: true }).click()
  await page.getByRole('status', { name: '排队中', exact: true }).waitFor({ timeout: 8000 })
  await shot('06-cancel.png')
  await page.locator('.cm-collab-pending-chip.is-queued').getByRole('button', { name: '取消这次请求', exact: true }).click()
  await page.getByRole('status', { name: '排队中', exact: true }).waitFor({ state: 'hidden', timeout: 5000 })
  await page.locator('.cm-collab-pending-chip.is-working').getByRole('button', { name: '取消这次请求', exact: true }).click()
  await page.getByRole('status', { name: '处理中', exact: true }).waitFor({ state: 'hidden', timeout: 5000 })
  const cancelDeadline = Date.now() + 15000
  while (Date.now() < cancelDeadline && editorCount().scripts < cancelBefore.scripts + 2) await page.waitForTimeout(200)
  assert.equal(editorCount().scripts, cancelBefore.scripts + 2)
  const queuedAsk = askResponses.filter(item => item.status === 200).at(-1)
  assert.match(queuedAsk?.body ?? '', /"busy":true/)
  checks.cancelQueuedAndWorking = true

  // Delay delivery to the server, cancel locally, and resubmit before the old ask acknowledges.
  const releases = []
  const holdAsk = async route => {
    await new Promise(resolve => releases.push(resolve))
    const response = await route.fetch({ headers: { ...route.request().headers(), 'sec-fetch-site': 'same-origin' } })
    await route.fulfill({ response })
  }
  await page.route('**/api/webnovel/study/ask', holdAsk)
  const sendingBefore = posts.filter(item => item.method === 'ask').length
  const sendingScripts = editorCount().scripts
  const cancelledBefore = posts.filter(item => item.method === 'ask-cancel').length
  const sendingChip = page.locator('.cm-collab-pending-chip.is-sending')
  await selectPhrase('信封上的字迹依然清晰')
  await page.getByRole('button', { name: '让主 Agent 润色', exact: true }).click()
  await sendingChip.waitFor()
  await sendingChip.getByRole('button', { name: '取消这次请求', exact: true }).click()
  await sendingChip.waitFor({ state: 'hidden', timeout: 2000 })
  assert.equal(posts.filter(item => item.method === 'ask-cancel').length, cancelledBefore)
  await selectPhrase('信封上的字迹依然清晰')
  await page.getByRole('button', { name: '让主 Agent 润色', exact: true }).click()
  await sendingChip.waitFor()
  assert.equal(releases.length, 2)
  releases[0]()
  await waitPosts('ask-cancel', cancelledBefore + 1)
  await selectPhrase('潮声越过石阶')
  await page.getByRole('button', { name: '让主 Agent 润色', exact: true }).click()
  assert.equal(posts.filter(item => item.method === 'ask').length, sendingBefore + 2, 'old response must not unlock the newer sending request')
  await sendingChip.getByRole('button', { name: '取消这次请求', exact: true }).click()
  await sendingChip.waitFor({ state: 'hidden', timeout: 2000 })
  releases[1]()
  await waitPosts('ask-cancel', cancelledBefore + 2)
  await page.unroute('**/api/webnovel/study/ask', holdAsk)
  // The fixture holds every model step for 4.5s after the earlier hold case;
  // these two queued requests must both reach the tool before checking late delivery.
  const sendingDeadline = Date.now() + 30000
  while (Date.now() < sendingDeadline && editorCount().scripts < sendingScripts + 2) await page.waitForTimeout(100)
  assert.equal(editorCount().scripts, sendingScripts + 2)
  assert.deepEqual(posts.filter(item => item.method === 'ask-cancel').slice(cancelledBefore).map(item => item.requestIds),
    posts.filter(item => item.method === 'ask').slice(sendingBefore).map(item => [item.requestId]))
  assert.equal(await page.locator('.cm-collab-pending-chip, .cm-sg-ins, .cm-sg-old, .cm-ghost').count(), 0)
  checks.cancelSendingAndResubmit = true

  await selectPhrase('信封上的字迹依然清晰')
  await page.keyboard.press('Control+k')
  await prompt.fill('【脚本:hold】切走再回来')
  const switchBefore = editorCount()
  await page.getByRole('button', { name: '发送给主 Agent', exact: true }).click()
  await page.getByRole('status', { name: '处理中', exact: true }).waitFor({ timeout: 8000 })
  await page.getByRole('tab', { name: '工作区', exact: true }).click()
  await expandWorkspace('S5 空工作范围')
  await page.getByText('S5 会话隔离验收', { exact: true }).click()
  await page.getByText('确认这个工作范围是空的。').waitFor({ timeout: 8000 })
  assert.equal(await page.getByRole('button', { name: '接受', exact: true }).count(), 0)
  await page.waitForTimeout(5000)
  assert.equal(await page.getByRole('button', { name: '接受', exact: true }).count(), 0)
  await openSession()
  await page.getByRole('tab', { name: /稿\d+\.md/ }).last().click()
  await page.getByRole('button', { name: '接受', exact: true }).waitFor({ timeout: 15000 })
  assert.equal(editorCount().scripts, switchBefore.scripts + 1)
  checks.sessionIsolation = true
  await page.getByRole('button', { name: '拒绝', exact: true }).click()

  const swap = page.getByRole('button', { name: '把对话移到右侧', exact: true })
  await swap.click()
  await page.getByRole('button', { name: '把对话移回中间', exact: true }).waitFor()
  await selectPhrase('林舟在渡口停下脚步')
  const swapBefore = editorCount()
  await page.getByRole('button', { name: '让主 Agent 润色', exact: true }).click()
  await page.getByRole('button', { name: '接受', exact: true }).waitFor({ timeout: 20000 })
  await shot('10-swapped.png')
  await page.keyboard.press('Tab')
  const swapSaves = posts.filter(item => item.method === 'save').length
  await page.keyboard.press('Control+s')
  await waitPosts('save', swapSaves + 1)
  await waitToast(/文件已保存|已交给主控/)
  assert.equal(editorCount().scripts, swapBefore.scripts + 1)
  checks.swappedChain = true
  await page.getByRole('button', { name: '把对话移回中间', exact: true }).click()

  const conflictFile = await currentDraftPath()
  await editorBox().click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText('\n脏缓冲' + Date.now() + '\n')
  fs.appendFileSync(conflictFile, '\n磁盘冲突' + Date.now() + '\n')
  await page.getByText('磁盘上的这份文档被改动了，你未保存的编辑都还在。').waitFor({ timeout: 8000 })
  await selectPhrase('潮声越过石阶')
  const asksBefore = askResponses.length
  await page.getByRole('button', { name: '让主 Agent 润色', exact: true }).click()
  await waitToast(/先处理磁盘版本冲突/)
  const conflict = askResponses.slice(asksBefore).find(item => item.status === 409)
  assert.ok(conflict)
  assert.match(conflict.body, /磁盘版本已变化/)
  assert.equal(await page.getByRole('status', { name: '处理中', exact: true }).count(), 0)
  await shot('11-conflict.png')
  checks.dirtyConflict409 = { status: conflict.status, body: conflict.body }
  const keepAfter = page.getByRole('button', { name: '已比较，保留我的编辑', exact: true })
  if (await keepAfter.isVisible()) await keepAfter.click()

  // Published chapters expose the same formatting shortcuts with a readonly EditorState.
  const readonlyBook = await revealDrafts()
  await readonlyBook.getByRole('button', { name: /^定稿/ }).click()
  await readonlyBook.getByRole('button', { name: '卷01', exact: true }).click()
  await readonlyBook.getByRole('button', { name: /^0002-归航/ }).click()
  await page.getByText('定稿更正通过吃书补偿流程处理', { exact: true }).waitFor()
  await editorBox().click()
  await page.keyboard.press('Control+Home')
  await page.keyboard.press('Shift+End')
  const readonlyText = await editorBox().innerText()
  const readonlySaves = posts.filter(item => item.method === 'save').length
  for (const shortcut of ['Control+b', 'Control+i', 'Control+1', 'Control+2', 'Control+3', 'Control+0', 'Control+s']) await page.keyboard.press(shortcut)
  assert.equal(await editorBox().innerText(), readonlyText)
  assert.equal(posts.filter(item => item.method === 'save').length, readonlySaves)
  await page.keyboard.press('Shift+F10')
  assert.equal(await page.getByRole('menuitem', { name: '已保存', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('menuitem', { name: '撤销', exact: true }).isDisabled(), true)
  await page.keyboard.press('Escape')
  checks.readonlyFormatting = true

  summary.shots = shots
  summary.scriptCount = editorCount()
  fs.writeFileSync(path.join(evidence, 'collab-report.json'), JSON.stringify(summary, null, 2) + '\n')
  console.log(JSON.stringify({ ok: true, checks: Object.keys(checks), shots, errors }, null, 2))
} catch (error) {
  summary.failed = error instanceof Error ? error.message : String(error)
  summary.toasts = await page.evaluate(() => window.__editorToasts ?? []).catch(() => [])
  summary.shots = shots
  fs.writeFileSync(path.join(evidence, 'collab-report.json'), JSON.stringify(summary, null, 2) + '\n')
  await page.screenshot({ path: path.join(evidence, 'collab-failure.png') }).catch(() => {})
  console.error(error)
  process.exitCode = 1
} finally {
  await browser.close()
}
