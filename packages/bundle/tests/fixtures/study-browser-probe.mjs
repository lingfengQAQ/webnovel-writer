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
const requests = []
const failedResponses = []
const layoutSamples = []
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
    const launch = page.getByRole('button', { name: '打开书稿与资料', exact: true })
    const column = page.getByRole('complementary', { name: '书稿与资料', exact: true })
    await launch.click()
    await column.getByText('暂无打开的文档', { exact: true }).waitFor()
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
    await column.waitFor({ state: 'hidden' })
    await launch.click(); await column.waitFor({ state: 'visible' })
    await page.getByRole('button', { name: '收起右侧边栏', exact: true }).click()
    await column.waitFor({ state: 'hidden' })
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
    await page.getByRole('tab', { name: '稿1.md', exact: true }).waitFor()
    await page.getByRole('button', { name: '关闭 稿1.md', exact: true }).click()
    checks.nestedBookTree = true
    await page.getByText('打开原文', { exact: true }).first().click()
    await page.getByRole('tab', { name: '稿1.md', exact: true }).waitFor()
    checks.nativeDocumentLink = true
    await page.getByRole('button', { name: '编辑', exact: true }).click()
    const editor = page.getByRole('textbox', { name: '文档正文', exact: true })
    await editor.click()
    await page.keyboard.press('Control+Home')
    await page.keyboard.press('Control+Shift+End')
    const selection = await editor.innerText()
    await page.getByRole('button', { name: /^引用到对话/ }).click()
    const composer = page.locator('[contenteditable="true"]:not([aria-label="文档正文"])').filter({ visible: true }).first()
    const quote = await composer.innerText()
    assert.ok(quote.includes('【书房原文引用】') && quote.includes('acceptance-a'))
    assert.ok(quote.includes(selection.trim().split('\n').filter(Boolean).at(-1)))
    assert.ok(quote.length > 1500)
    checks.fullQuote = true
    await composer.fill('')
    await page.getByRole('button', { name: '阅读', exact: true }).click()
    await page.getByRole('button', { name: '知识库', exact: true }).click()
    await page.getByRole('button', { name: '写作笔记.md', exact: true }).click()
    await page.getByRole('button', { name: '编辑', exact: true }).click()
    const sharedEditor = page.getByRole('textbox', { name: '文档正文', exact: true })
    await sharedEditor.click()
    await page.keyboard.press('Control+End')
    const marker = '浏览器保存验收 ' + Date.now()
    await page.keyboard.insertText('\n' + marker + '\n')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await page.getByText('文件已保存', { exact: true }).waitFor()
    await page.getByText('已交给主控，处理结果见对话', { exact: true }).waitFor()
    assert.ok(fs.readFileSync(path.join(runtime.workspace, '书房/知识库/写作笔记.md'), 'utf8').includes(marker))
    checks.authorSave = true
    await page.getByRole('button', { name: '改动', exact: true }).click()
    assert.ok((await page.locator('.nw-changes').innerText()).includes(marker))
    checks.savedDiff = true
    await page.getByRole('button', { name: '阅读', exact: true }).click()
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
    await page.getByRole('tab', { name: '写作笔记.md', exact: true }).waitFor()
    checks.sessionIsolation = true
    await page.getByRole('button', { name: '编辑', exact: true }).click()
    const retainedEditor = page.getByRole('textbox', { name: '文档正文', exact: true })
    await retainedEditor.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.insertText('\n收起后保留的编辑')
    const retainedText = await retainedEditor.innerText()
    await page.getByRole('button', { name: '收起编辑器', exact: true }).click()
    await settleLayout()
    await page.getByRole('button', { name: '打开书稿与资料', exact: true }).click()
    await settleLayout()
    assert.equal(await retainedEditor.innerText(), retainedText)
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    assert.ok(!(await retainedEditor.innerText()).includes('收起后保留的编辑'))
    await page.getByRole('button', { name: '重做', exact: true }).click()
    assert.equal(await retainedEditor.innerText(), retainedText)
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await page.getByRole('button', { name: '阅读', exact: true }).click()
    checks.collapsePreservesEditing = true
    await page.screenshot({ path: path.join(evidence, 'study-desktop.png'), fullPage: true })
    await page.setViewportSize({ width: 1190, height: 900 })
    await settleLayout()
    await page.screenshot({ path: path.join(evidence, 'study-medium.png'), fullPage: true })
    await page.setViewportSize({ width: 1440, height: 960 })
    await settleLayout()
    await page.getByRole('tab', { name: '可视化', exact: true }).click()
    await page.getByRole('heading', { name: '章节进度' }).waitFor()
    await page.locator('.nw-chapters>button').first().waitFor()
    await page.screenshot({ path: path.join(evidence, 'study-chapters.png'), fullPage: true })
    checks.chapters = true
    await page.setViewportSize({ width: 960, height: 900 })
    await settleLayout()
    const narrow = page.getByRole('complementary', { name: '书稿与资料', exact: true })
    await narrow.waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false)
    await page.screenshot({ path: path.join(evidence, 'study-narrow-desktop.png'), fullPage: true })
    await narrow.getByRole('button', { name: '编辑', exact: true }).click()
    const narrowEditor = narrow.getByRole('textbox', { name: '文档正文', exact: true })
    await narrowEditor.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.insertText('\n尚未保存的修改')
    page.once('dialog', dialog => dialog.dismiss())
    await narrow.getByRole('button', { name: '关闭 写作笔记.md', exact: true }).click()
    assert.ok(await narrow.getByRole('tab', { name: /写作笔记.md/ }).count())
    page.once('dialog', dialog => dialog.accept())
    await narrow.getByRole('button', { name: '关闭 写作笔记.md', exact: true }).click()
    await narrow.getByRole('tab', { name: '稿1.md', exact: true }).waitFor()
    checks.desktopWindowAndUnsavedGuard = true
    await narrow.getByRole('button', { name: '收起编辑器', exact: true }).click()
    await narrow.waitFor({ state: 'hidden' })
    await settleLayout()
    checks.closeRestoresHost = true
    const hostReport = JSON.parse(fs.readFileSync(path.join(evidence, 'browser-host-report.json'), 'utf8'))
    assert.ok(hostReport.savesReceived > initialReport.savesReceived)
    assert.equal(hostReport.customEvents, 0)
    checks.nativeFollowup = true
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
