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
const captureScreen = page.screenshot.bind(page)
page.screenshot = async options => {
  await page.waitForFunction(() => document.getAnimations().every(animation => {
    const timing = animation.effect && 'getTiming' in animation.effect ? animation.effect.getTiming() : null
    if (timing && (timing.iterations === Infinity || timing.iterations > 20)) return true
    return animation.playState !== 'running'
  }), null, { timeout: 3000 }).catch(() => {})
  await page.waitForTimeout(200)
  return captureScreen(options)
}
const errors = []
const requests = []
const failedResponses = []
const layoutSamples = []
async function openEditorMenu(page, atEdge, keepSelection) {
  const editor = page.getByRole('textbox', { name: '文档正文', exact: true })
  if (!keepSelection) await editor.click()
  if (!atEdge) await editor.click({ button: 'right' })
  else {
    const box = await editor.boundingBox()
    if (!box) throw new Error('editor box missing')
    await editor.click({ button: 'right', position: { x: Math.max(12, box.width - 18), y: Math.min(72, Math.max(12, box.height / 3)) } })
  }
  await page.getByRole('menu', { name: '编辑器菜单' }).waitFor()
  return page.getByRole('menu', { name: '编辑器菜单' })
}
async function searchCount(page, text) {
  const editor = page.getByRole('textbox', { name: '文档正文', exact: true })
  await editor.click()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+f')
  const input = page.getByRole('textbox', { name: '查找内容' })
  await input.waitFor()
  await input.fill(text)
  const count = page.locator('.ed-find-count')
  await count.waitFor()
  const value = (await count.innerText()).trim()
  await page.keyboard.press('Escape')
  return value
}
async function editorShell(page, runtime, evidence, checks) {
  await page.setViewportSize({ width: 1440, height: 960 })
  const expandRight = page.getByRole('button', { name: '打开右侧边栏', exact: true })
  if (await expandRight.isVisible()) { await expandRight.click(); await settleLayout() }
  const editor = page.getByRole('textbox', { name: '文档正文', exact: true })
  await editor.waitFor()
  await editor.click()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText('中文输入验收句')
  assert.match(await searchCount(page, '中文输入验收句'), /\/1$/)
  await openEditorMenu(page, false)
  await page.getByRole('menuitem', { name: '撤销', exact: true }).click()
  assert.equal(await searchCount(page, '中文输入验收句'), '无结果')
  checks.chineseInput = true
  await editor.click()
  await page.keyboard.press('Control+h')
  await page.getByRole('textbox', { name: '替换为' }).fill('共享材料')
  await page.getByRole('textbox', { name: '查找内容' }).fill('共享资料')
  await page.locator('.ed-find-count').filter({ hasText: '/1' }).waitFor()
  await waitForPop(page)
  await page.screenshot({ path: path.join(evidence, 'editor-find.png') })
  const replaceCurrent = page.getByRole('button', { name: '替换当前', exact: true })
  await replaceCurrent.click()
  await replaceCurrent.click()
  await page.keyboard.press('Escape')
  assert.match(await searchCount(page, '共享材料'), /\/1$/)
  await openEditorMenu(page, false)
  await page.getByRole('menuitem', { name: '撤销', exact: true }).click()
  checks.findReplace = true
  await page.getByRole('tab', { name: /稿1\.md/ }).first().click()
  await editor.click()
  await page.keyboard.press('Control+Shift+O')
  const outline = page.getByRole('dialog', { name: '大纲' })
  await outline.waitFor()
  await page.screenshot({ path: path.join(evidence, 'editor-outline.png') })
  await outline.getByRole('button', { name: '来信', exact: true }).click()
  checks.outline = true
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForFunction(() => document.body.hasAttribute('data-ds-dark-theme'), null, { timeout: 8000 })
  await page.screenshot({ path: path.join(evidence, 'editor-dark.png') })
  checks.editorDark = true
  await page.emulateMedia({ colorScheme: 'light' })
  await page.waitForFunction(() => !document.body.hasAttribute('data-ds-dark-theme'))
  const book = page.locator('.nw-book').filter({ hasText: '验收作品甲' })
  await page.getByRole('tab', { name: '书房', exact: true }).click()
  await book.getByRole('button', { name: /验收作品甲/ }).click()
  await book.getByRole('button', { name: /^定稿/ }).click()
  await book.getByRole('button', { name: '卷01', exact: true }).click()
  await book.getByRole('button', { name: /^0002-归航/ }).click()
  await page.getByText('定稿更正通过吃书补偿流程处理', { exact: true }).waitFor()
  await openEditorMenu(page, false)
  assert.equal(await page.getByRole('menuitem', { name: '已保存', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('menuitem', { name: '剪切', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('menuitem', { name: '引用到对话', exact: true }).isDisabled(), false)
  await waitForPop(page)
  await page.screenshot({ path: path.join(evidence, 'editor-readonly.png') })
  await page.keyboard.press('Escape')
  checks.readOnly = true
  const skeleton = path.join(runtime.workspace, '验收作品甲/大纲/故事骨架.md')
  await page.getByRole('tab', { name: '书房', exact: true }).click()
  await book.getByRole('button', { name: /^大纲/ }).click()
  await book.getByRole('button', { name: '故事骨架.md', exact: true }).click()
  await editor.click()
  fs.appendFileSync(skeleton, '\n磁盘同步句。\n')
  let cleanToast = false
  try {
    await waitForEditorToast(page, '磁盘上的新版本已同步', 8000)
    cleanToast = true
  } catch { cleanToast = false }
  await page.waitForFunction(() => document.querySelector('.nw-focus .cm-content')?.textContent?.includes('磁盘同步句'), null, { timeout: 10000 })
  checks.externalClean = true
  checks.externalCleanToast = cleanToast
  await editor.click()
  await page.keyboard.insertText('脏')
  fs.appendFileSync(skeleton, '\n又一次外部修改。\n')
  await page.getByText('磁盘上的这份文档被改动了', { exact: false }).waitFor({ timeout: 10000 })
  await page.getByRole('button', { name: '在正文中标出与磁盘版本的差异', exact: true }).click()
  await page.screenshot({ path: path.join(evidence, 'editor-conflict.png') })
  await page.getByRole('button', { name: '已比较，保留我的编辑', exact: true }).click()
  await waitForEditorToast(page, '已保留你的编辑，保存时以磁盘新版本为基线')
  checks.externalDirty = true
  fs.writeFileSync(path.join(runtime.workspace, '书房/知识库/备忘.txt'), '# 不是标题\n\n纯文本备忘。\n')
  await page.getByRole('tab', { name: '书房', exact: true }).click()
  const library = page.getByRole('button', { name: '知识库', exact: true })
  if (await page.getByRole('button', { name: /写作笔记\.md/ }).isVisible()) await library.click()
  await library.click()
  const memo = page.getByRole('button', { name: '备忘.txt', exact: true })
  await memo.click()
  await page.locator('.nw-focus.is-plain').waitFor()
  assert.match(await page.locator('.nw-focus.is-plain .cm-content').innerText(), /# 不是标题/)
  assert.equal(await page.locator('.cm-lp-h1').count(), 0)
  checks.plainText = true
  await page.getByRole('tab', { name: /稿1\.md/ }).first().click()
  await editor.click()
  await page.keyboard.press('Control+End')
  const stamp = '新稿状态' + Date.now()
  await page.keyboard.insertText('\n' + stamp)
  await page.keyboard.press('Control+s')
  const newDraftToast = waitForEditorToast(page, /已生成新稿/)
  await page.getByRole('tab', { name: /稿2\.md/ }).first().waitFor({ timeout: 15000 })
  await newDraftToast
  checks.newDraftToast = true
  const ownSaveStarted = Date.now()
  let ownSaveToast = false
  while (Date.now() - ownSaveStarted < 1500) {
    ownSaveToast = await page.getByText('磁盘上的新版本已同步', { exact: true }).isVisible().catch(() => false)
    if (ownSaveToast) break
    await page.waitForTimeout(100)
  }
  assert.equal(ownSaveToast, false, '自己的保存不该提示磁盘同步')
  checks.ownSaveSilent = true
  assert.match(await searchCount(page, stamp), /\/1$/)
  await openEditorMenu(page, false)
  await page.getByRole('menuitem', { name: '撤销', exact: true }).click()
  assert.equal(await searchCount(page, stamp), '无结果')
  checks.saveKeepsHistory = true
  await page.setViewportSize({ width: 960, height: 900 })
  await settleLayout()
  const menu = await openEditorMenu(page, true)
  await waitForPop(page)
  const menuBox = await menu.boundingBox()
  const shellBox = await page.locator('.nw-focus').boundingBox()
  const viewport = page.viewportSize()
  await page.screenshot({ path: path.join(evidence, 'editor-menu-edge.png') })
  if (!menuBox || !shellBox || !viewport) throw new Error('menu geometry missing')
  assert.ok(menuBox.x >= shellBox.x - 2 && menuBox.x + menuBox.width <= shellBox.x + shellBox.width + 2, 'menu stays inside the editor')
  assert.ok(menuBox.y >= shellBox.y - 2 && menuBox.y + menuBox.height <= shellBox.y + shellBox.height + 2, 'menu stays inside the editor vertically')
  assert.ok(menuBox.x >= -1 && menuBox.x + menuBox.width <= viewport.width + 1, 'menu stays inside the viewport')
  await page.keyboard.press('Escape')
  checks.menuStaysInside = true
}
async function waitForDisk(file, marker, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(marker)) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('saved text missing on disk: ' + marker)
}
async function waitForEditorToast(page, pattern, timeout = 15000) {
  const source = pattern instanceof RegExp ? pattern.source : pattern
  const flags = pattern instanceof RegExp ? pattern.flags : ''
  await page.waitForFunction(({ source, flags }) => {
    const text = document.querySelector('.nw-focus .ed-toast')?.textContent ?? ''
    return new RegExp(source, flags).test(text)
  }, { source, flags }, { timeout })
}
async function waitForPop(page) {
  await page.waitForFunction(() => document.getAnimations().every(animation => {
    const timing = animation.effect && 'getTiming' in animation.effect ? animation.effect.getTiming() : null
    if (timing && (timing.iterations === Infinity || timing.iterations > 20)) return true
    return animation.playState !== 'running'
  }), null, { timeout: 3000 }).catch(() => {})
  await page.waitForTimeout(200)
}
async function settleLayout() {
  await page.evaluate(async () => {
    const deadline = performance.now() + 5000
    let previous = '', stable = 0
    while (performance.now() < deadline) {
      await new Promise(resolve => requestAnimationFrame(resolve))
      const frame = document.querySelector('[data-shell-overlay]')?.parentElement
      const column = document.querySelector('.nw-native-writing')
      const geometry = JSON.stringify([frame, frame?.children[0], column].map(element => element?.getBoundingClientRect().toJSON()))
      const moving = document.getAnimations().some(animation => animation instanceof CSSTransition && animation.playState === 'running')
      stable = !moving && geometry === previous ? stable + 1 : 0
      if (stable >= 8) return
      previous = geometry
    }
    throw new Error('Writing layout did not settle')
  })
}
page.on('response', async response => {
  if (response.status() < 400) return
  const url = new URL(response.url()).pathname
  failedResponses.push({ url, status: response.status(), ...(url.startsWith('/api/webnovel/') ? { body: (await response.text()).slice(0,500) } : {}) })
})
page.on('request', request => { if (request.method() === 'POST') requests.push({ url: new URL(request.url()).pathname, body: request.postData()?.slice(0,800) }) })
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
try {
  const url = fs.readFileSync(path.join(runtime.root, 'stdout.log'), 'utf8').match(/dsh web: (http\S+)/)?.[1]
  if (!url) throw new Error('Acceptance host is not ready')
  await page.goto(url)
  await page.getByRole('tab', { name: '书房', exact: true }).waitFor({ state: 'visible', timeout: 30000 })
  const welcome = page.getByRole('button', { name: '继续', exact: true })
  await welcome.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
  if (await welcome.isVisible()) { await welcome.click(); await welcome.waitFor({ state: 'hidden' }) }
  if (['verify', 'production'].includes(process.argv[3])) {
    const column = page.locator('[data-rightbar-col]')
    const expandRight = page.getByRole('button', { name: '打开右侧边栏', exact: true })
    if (await expandRight.isVisible()) await expandRight.click()
    await column.waitFor({ state: 'visible' })
    for (const width of [1920, 1680, 1440, 1280, 1190, 1100, 1024, 960, 1100, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await settleLayout()
      const geometry = await column.evaluate(element => {
        const box = element.getBoundingClientRect()
        const frame = document.querySelector('[data-shell-overlay]')?.parentElement
        const center = frame.children[1].getBoundingClientRect()
        return { left: box.left, right: box.right, width: box.width, frameWidth: frame.getBoundingClientRect().width, sidebarWidth: frame.children[0].getBoundingClientRect().width, centerRight: center.right, overflow: document.documentElement.scrollWidth > window.innerWidth }
      })
      layoutSamples.push({ viewport: width, ...geometry })
      assert.ok(geometry.width >= 240, `Native writing width at viewport ${width}`)
      assert.ok(geometry.right <= width + 1)
      assert.ok(geometry.left >= 0)
      assert.equal(geometry.overflow, false)
    }
    // Native Sidebar owns resize, fullscreen and collapse; no custom frame reservation.
    await page.getByRole('button', { name: '收起右侧边栏', exact: true }).click()
    await page.locator('[data-rightbar-collapsed]').waitFor()
    await page.getByRole('button', { name: '打开右侧边栏', exact: true }).click()
    await page.locator('[data-rightbar-collapsed]').waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: '收起右侧边栏', exact: true }).click()
    await page.locator('[data-rightbar-collapsed]').waitFor()
    assert.equal(await page.locator('[data-webnovel-writing-frame]').count(), 0)
  }
  if (process.argv[3] === 'production') {
    await page.screenshot({ path: path.join(evidence, 'production-desktop.png'), fullPage: true })
    assert.equal(await page.getByRole('tab', { name: '工作区', exact: true }).isVisible(), true)
    assert.equal(await page.getByRole('tab', { name: '书房', exact: true }).isVisible(), true)
    assert.equal(await page.getByRole('button', { name: '刷新书房', exact: true }).isVisible(), true)
    console.log(JSON.stringify({ productionClient: true, url: page.url().split('?')[0], layoutSamples, failedResponses, errors }))
    process.exitCode = errors.length ? 1 : 0
  } else {
  if (!await page.getByRole('tab', { name: '工作区', exact: true }).isVisible()) {
    const expand = page.getByRole('button', { name: '展开书房', exact: true })
    if (await expand.isVisible()) await expand.click()
    else await page.getByRole('button', { name: '打开侧边栏', exact: true }).click()
  }
  await page.getByRole('tab', { name: '工作区', exact: true }).click()
  await page.getByText('S5 临时验收书房', { exact: true }).click()
  await page.getByText('S5 书房验收', { exact: true }).click()
  await page.getByRole('tab', { name: '书房', exact: true }).click()
  await page.getByRole('button', { name: /验收作品甲/ }).waitFor()
  if (process.argv[3] === 'verify') {
    const checks = { blankSessionPanel: true, widthsAndNoOverlay: true, sidebarAndWritingToggle: true, keyboardAndPointerResize: true }
    const initialReport = JSON.parse(fs.readFileSync(path.join(evidence, 'browser-host-report.json'), 'utf8'))
    const firstBook = page.locator('.nw-book').filter({ hasText: '验收作品甲' })
    await firstBook.getByRole('button', { name: /验收作品甲/ }).click()
    await firstBook.getByRole('button', { name: /^草稿区/ }).click()
    await firstBook.getByRole('button', { name: '草稿', exact: true }).click()
    await firstBook.getByRole('button', { name: '卷01-来信', exact: true }).click()
    await firstBook.getByRole('button', { name: /^稿1.md/ }).click()
    await page.getByRole('tab', { name: /稿1\.md/ }).first().waitFor()
    await page.locator('[role="tab"]').filter({ hasText: '稿1.md' }).getByRole('button', { name: '关闭', exact: true }).click()
    checks.nestedBookTree = true
    await page.getByText('打开原文', { exact: true }).first().click()
    await page.getByRole('tab', { name: /稿1\.md/ }).first().waitFor()
    checks.nativeDocumentLink = true
    const editor = page.getByRole('textbox', { name: '文档正文', exact: true })
    await editor.click()
    await page.keyboard.press('Control+a')
    const selection = await editor.innerText()
    await openEditorMenu(page, false, true)
    await page.getByRole('menuitem', { name: '引用到对话', exact: true }).click()
    const composer = page.locator('[contenteditable="true"]:not([aria-label="文档正文"])').filter({ visible: true }).first()
    const quote = await composer.innerText()
    assert.ok(quote.includes('【书房原文引用】') && quote.includes('acceptance-a'))
    assert.ok(quote.includes(selection.trim().split('\n').filter(Boolean).at(-1)))
    assert.ok(quote.length > 1500)
    checks.fullQuote = true
    await composer.fill('')
    await page.getByRole('button', { name: '知识库', exact: true }).click()
    await page.getByRole('button', { name: '写作笔记.md', exact: true }).click()
    const sharedEditor = page.getByRole('textbox', { name: '文档正文', exact: true })
    await sharedEditor.click()
    await page.keyboard.press('Control+End')
    const marker = '浏览器保存验收 ' + Date.now()
    await page.keyboard.insertText('\n' + marker + '\n')
    await page.keyboard.press('Control+s')
    const notesPath = path.join(runtime.workspace, '书房/知识库/写作笔记.md')
    await Promise.all([
      waitForEditorToast(page, /文件已保存[\s\S]*已交给主控，处理结果见对话/),
      waitForDisk(notesPath, marker),
      page.getByRole('button', { name: /收到执行请求/ }).first().waitFor({ timeout: 15000 }),
    ])
    checks.authorSave = true
    checks.savedDiff = true
    await page.getByRole('tab', { name: '工作区', exact: true }).click()
    const native = page.locator('.nw-native-workspaces')
    await native.getByText('S5 空工作范围', { exact: true }).hover()
    await native.getByRole('button', { name: '在“S5 空工作范围”中新建会话', exact: true }).click()
    await page.getByRole('tab', { name: '书房', exact: true }).click()
    await page.getByText(/当前工作范围还没有作品/).waitFor()
    assert.equal(await page.getByRole('tab', { name: '写作笔记.md', exact: true }).count(), 0)
    await page.getByRole('tab', { name: '工作区', exact: true }).click()
    await native.getByText('S5 书房验收', { exact: true }).click()
    await page.getByRole('tab', { name: '书房', exact: true }).click()
    await page.getByRole('tab', { name: /写作笔记\.md/ }).first().waitFor()
    checks.sessionIsolation = true
    const retainedEditor = page.getByRole('textbox', { name: '文档正文', exact: true })
    await retainedEditor.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.insertText('\n收起后保留的编辑')
    await page.getByRole('button', { name: '收起右侧边栏', exact: true }).click()
    await settleLayout()
    await page.getByRole('button', { name: '打开右侧边栏', exact: true }).click()
    await settleLayout()
    assert.match(await searchCount(page, '收起后保留的编辑'), /\/1$/)
    await openEditorMenu(page, false)
    await page.getByRole('menuitem', { name: '撤销', exact: true }).click()
    assert.equal(await searchCount(page, '收起后保留的编辑'), '无结果')
    await openEditorMenu(page, false)
    await page.getByRole('menuitem', { name: '重做', exact: true }).click()
    assert.match(await searchCount(page, '收起后保留的编辑'), /\/1$/)
    await openEditorMenu(page, false)
    await page.getByRole('menuitem', { name: '撤销', exact: true }).click()
    checks.collapsePreservesEditing = true
    await page.screenshot({ path: path.join(evidence, 'study-desktop.png'), fullPage: true })
    await page.setViewportSize({ width: 1190, height: 900 })
    await settleLayout()
    await page.screenshot({ path: path.join(evidence, 'study-medium.png'), fullPage: true })
    await page.setViewportSize({ width: 1440, height: 960 })
    await settleLayout()
    await page.getByRole('tab', { name: '可视化', exact: true }).click()
    await page.getByRole('button', { name: '章节进度', exact: true }).click()
    await page.getByRole('heading', { name: '章节进度' }).waitFor()
    await page.locator('.nw-chapter-line').first().waitFor()
    await page.screenshot({ path: path.join(evidence, 'study-chapters.png'), fullPage: true })
    checks.chapters = true
    await page.setViewportSize({ width: 960, height: 900 })
    await settleLayout()
    const narrow = page.locator('[data-rightbar-col]')
    await narrow.waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false)
    await page.screenshot({ path: path.join(evidence, 'study-narrow-desktop.png'), fullPage: true })
    const narrowEditor = narrow.getByRole('textbox', { name: '文档正文', exact: true })
    await narrowEditor.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.insertText('\n尚未保存的修改')
    let unexpectedDialog = ''
    page.once('dialog', dialog => { unexpectedDialog = dialog.message(); void dialog.dismiss() })
    await page.locator('[role="tab"]').filter({ hasText: '写作笔记.md' }).getByRole('button', { name: '关闭', exact: true }).click()
    await page.getByRole('tab', { name: /稿1\.md/ }).first().waitFor()
    assert.equal(unexpectedDialog, '')
    await page.setViewportSize({ width: 1440, height: 960 })
    await settleLayout()
    const expandStudy = page.getByRole('button', { name: '展开书房', exact: true })
    if (await expandStudy.isVisible()) await expandStudy.click()
    await page.getByRole('tab', { name: '书房', exact: true }).click()
    await page.getByRole('button', { name: '知识库', exact: true }).click()
    await page.getByRole('button', { name: /写作笔记\.md/ }).click()
    assert.match(await searchCount(page, '尚未保存的修改'), /\/1$/)
    checks.desktopWindowAndUnsavedGuard = true
    checks.reopenKeepsBuffer = true
    await page.getByRole('button', { name: '收起右侧边栏', exact: true }).click()
    await page.locator('[data-rightbar-collapsed]').waitFor()
    await settleLayout()
    checks.closeRestoresHost = true
    const hostReport = JSON.parse(fs.readFileSync(path.join(evidence, 'browser-host-report.json'), 'utf8'))
    assert.ok(hostReport.savesReceived > initialReport.savesReceived)
    assert.equal(hostReport.customEvents, 0)
    checks.nativeFollowup = true
    await editorShell(page, runtime, evidence, checks)
    assert.deepEqual(errors, [])
    fs.writeFileSync(path.join(evidence, 'browser-acceptance.json'), JSON.stringify({ checks, layoutSamples, hostReport, errors }, null, 2) + '\n')
    console.log(JSON.stringify({ checks, layoutSamples, hostReport, errors }, null, 2))
  }
  await page.screenshot({ path: path.join(evidence, 'study-browser-inspect.png'), fullPage: true })
  if (process.argv[3] !== 'verify') console.log(JSON.stringify({ url: page.url().split('?')[0], text: (await page.locator('body').innerText()).slice(0,12000), buttons: await page.getByRole('button').evaluateAll(elements => elements.map(element => ({ text: element.innerText, title: element.title, aria: element.getAttribute('aria-label') }))), errors }, null, 2))
  }
} catch (error) {
  await page.screenshot({ path: path.join(evidence, 'study-browser-failure.png'), fullPage: true })
  console.log(JSON.stringify({ text: (await page.locator('body').innerText()).slice(0,10000), links: await page.locator('a').evaluateAll(elements => elements.map(element => ({ text: element.innerText, href: element.getAttribute('href'), html: element.outerHTML.slice(0,1000) }))), requests: requests.slice(-15), failedResponses, errors }, null, 2))
  throw error
} finally {
  await browser.close()
}
