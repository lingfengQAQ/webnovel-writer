/** Product browser regression with explicit synthetic API states, not live writing. */
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const runtimePath = path.resolve(process.argv[2])
const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'))
const output = path.dirname(runtimePath)
const { chromium } = await import(pathToFileURL(path.join(process.env.WEBNOVEL_PLAYWRIGHT, 'index.mjs')).href)
const browser = await chromium.launch({ headless: true, executablePath: process.env.WEBNOVEL_CHROMIUM })
const page = await browser.newPage({ viewport: { width: 1500, height: 1300 } })
page.setDefaultTimeout(15000)
const report = { simulated: true, checks: [], errors: [], screenshots: [] }
page.on('pageerror', e => report.errors.push(e.message))
const now = Date.now()
const call = (id, chapter, stage, state, age) => ({ id, bookId: 'acceptance-a', chapter, stage,
  name: stage === 'confirm' ? 'novel_settle_chapter' : stage === 'revise' ? 'novel_apply_revision_batch' : 'novel_assemble_materials',
  state, started: now - age, summary: id,
  ...(['running', 'waiting', 'preparing'].includes(state) ? {} : { ended: now - age + 1 }) })
let calls = [call('第12章上次改稿失败', 12, 'revise', 'error', 10000), call('第12章正在重试', 12, 'revise', 'running', 4000), call('第13章等待资料取舍', 13, 'materials', 'waiting', 1000)]
let active = true, syncing = false, disconnected = false, finalized = false, chapterReads = 0, holdFacts = false, releaseFacts
await page.route('**/api/webnovel/study/workflow', route => {
  if (disconnected) return route.abort()
  const body = route.request().postDataJSON()
  return route.fulfill({ json: { ok: true, value: { available: true, active, syncing, asOf: calls.length,
    calls: body.space === 'book:acceptance-a' ? calls : [], otherActive: 0, waiting: active && calls.some(c => c.state === 'waiting') } } })
})
await page.route('**/api/webnovel/study/chapters', async route => {
  chapterReads++
  if (holdFacts) await new Promise(resolve => { releaseFacts = resolve })
  await route.fulfill({ json: { ok: true, value: { bookId: 'acceptance-a', bookName: '合成样本', chapters: [
    { volume: 1, chapter: 11, title: '旧信', status: '完成', finalized: true },
    { volume: 1, chapter: 12, title: '夜渡', status: finalized ? '完成' : '改稿', finalized },
    { volume: 1, chapter: 13, title: '归航', status: '备料', finalized: false },
  ] } } })
})
const node = id => page.locator('.nw-archify g[data-node-id="' + id + '"]')
const state = async (id, value) => page.waitForFunction(({ id, value }) => document.querySelector('[data-node-id="' + id + '"]')?.getAttribute('data-run-state') === value, { id, value })
const capture = async name => {
  await page.locator('.nw-viz').evaluate(el => { el.scrollTop = 0 })
  const target = await page.evaluate(() => !!document.fullscreenElement) ? page : page.locator('.nw-viz')
  await target.screenshot({ path: path.join(output, name + '.png') })
  report.screenshots.push(name + '.png')
}
try {
  const url = fs.readFileSync(path.join(runtime.root, 'stdout.log'), 'utf8').match(/dsh web: (http\S+)/)?.[1]
  assert.ok(url)
  await page.goto(url)
  const welcome = page.getByRole('button', { name: '继续', exact: true })
  await welcome.waitFor({ timeout: 5000 }).catch(() => {})
  if (await welcome.isVisible()) await welcome.click()
  await page.getByRole('tab', { name: '工作区', exact: true }).click()
  const workspace = page.getByRole('treeitem', { name: /^S5 临时验收书房/ }).first()
  if (await workspace.getAttribute('aria-expanded') === 'false') await workspace.click()
  await page.getByText('S5 书房验收', { exact: true }).first().click()
  await page.getByRole('tab', { name: '可视化', exact: true }).click()
  await page.getByLabel('选择可视化作品', { exact: true }).selectOption('book:acceptance-a')
  await node('concept').waitFor()
  assert.equal(await page.locator('.nw-archify g[data-node-id]').count(), 13)
  await capture('archify-overview-light')
  report.checks.push('原13节点成图与全部章节状态')

  await page.getByLabel('选择流程章节', { exact: true }).selectOption('12')
  await page.locator('.nw-flow-summary').filter({ hasText: '改稿 · 进行中' }).waitFor()
  await state('materials', '')
  await node('revision').click()
  await page.getByText('第12章上次改稿失败', { exact: true }).waitFor()
  await page.getByText('第12章正在重试', { exact: true }).waitFor()
  assert.equal(await page.locator('.nw-inspector').getByText('第13章等待资料取舍', { exact: true }).count(), 0)
  await capture('archify-retry-details')
  await page.getByLabel('选择流程章节', { exact: true }).selectOption('13')
  await page.locator('.nw-flow-summary').filter({ hasText: '备料 · 待确认' }).waitFor()
  await state('revision', '')
  await page.getByRole('button', { name: '回到当前', exact: true }).click()
  await page.getByText('第13章等待资料取舍', { exact: true }).waitFor()
  report.checks.push('12章重试/失败历史、13章等待及当前定位完全隔离')

  await page.getByRole('button', { name: '查看全图', exact: true }).click()
  const svg = page.locator('svg[aria-label="写作流程图"]')
  const initial = await svg.getAttribute('viewBox')
  await page.getByRole('button', { name: '放大', exact: true }).click()
  assert.notEqual(await svg.getAttribute('viewBox'), initial)
  await svg.focus(); await page.keyboard.press('ArrowRight')
  await page.keyboard.press('0')
  assert.equal(await svg.getAttribute('viewBox'), initial)
  await node('review').focus(); await page.keyboard.press('Enter')
  await page.getByRole('heading', { name: '全面审读', exact: true }).waitFor()
  await page.getByRole('button', { name: '查看关联', exact: true }).click()
  assert.equal(await node('concept').getAttribute('data-related-hidden'), 'true')
  await page.getByRole('button', { name: '查看关联', exact: true }).click()
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  await page.getByRole('button', { name: '全屏', exact: true }).click()
  await page.waitForFunction(() => !!document.fullscreenElement)
  await node('review').click()
  assert.equal(await page.locator('.nw-inspector').evaluate(el => document.fullscreenElement.contains(el)), true)
  await capture('archify-fullscreen-details')
  await page.getByRole('button', { name: '退出全屏', exact: true }).click()
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  report.checks.push('缩放、键盘平移/重置、键盘节点选择、关联及全屏')

  const light = await node('concept').locator('rect').first().evaluate(el => getComputedStyle(el).fill)
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForFunction(previous => getComputedStyle(document.querySelector('[data-node-id="concept"] rect')).fill !== previous, light)
  await capture('archify-overview-dark')
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 720, height: 1100 })
  await node('materials').click()
  await page.locator('.nw-viz').evaluate(el => { el.scrollTop = el.scrollHeight })
  await page.getByText('第13章等待资料取舍', { exact: true }).waitFor()
  assert.equal(await page.getByText('第13章等待资料取舍', { exact: true }).evaluate(el => {
    const composer = Number.parseFloat(getComputedStyle(document.querySelector('.nw-viz')).getPropertyValue('--dsh-composer-height')) || 152
    return el.getBoundingClientRect().bottom < innerHeight - composer
  }), true, 'the final history row must be reachable above the composer')
  await page.locator('.nw-viz').screenshot({ path: path.join(output, 'archify-narrow-inspector.png') })
  report.screenshots.push('archify-narrow-inspector.png')
  await capture('archify-narrow-details')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
  await page.setViewportSize({ width: 1500, height: 1300 })
  report.checks.push('深浅主题及720px窄窗口详情无横向溢出')

  await page.getByLabel('选择流程章节', { exact: true }).selectOption('12')
  calls = [call('等待作者批准入档', 12, 'confirm', 'waiting', 0)]
  await state('approval', 'waiting'); await state('settled', '')
  await node('approval').click()
  await capture('archify-author-approval')
  calls = calls.map(c => ({ ...c, state: 'running', summary: '作者已答复，入档中' }))
  await state('settled', 'running'); await state('approval', '')
  const readsBefore = chapterReads
  holdFacts = true
  calls = calls.map(c => ({ ...c, state: 'success', ended: now + 100, summary: '定稿工具返回' }))
  active = false
  await state('settled', 'success')
  const until = Date.now() + 5000
  while (!releaseFacts && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 25))
  assert.ok(chapterReads > readsBefore && releaseFacts, 'settlement must reread chapter facts')
  assert.equal(await page.locator('.nw-archify-badge').filter({ hasText: '已定稿' }).count(), 0)
  finalized = true; holdFacts = false; releaseFacts()
  await page.locator('.nw-archify-badge').filter({ hasText: '已定稿' }).waitFor()
  await node('wait').click(); await page.getByText('本章已有定稿记录。', { exact: true }).waitFor()
  await capture('archify-finalized-fact')
  report.checks.push('真实等待/入档执行分别映射；工具成功触发事实重读，事实返回后才显示已定稿')

  calls = [call('审核仍在执行', 12, 'review', 'running', 0)]; active = true
  await state('review', 'running')
  syncing = true; await state('review', 'unknown')
  syncing = false; await state('review', 'running')
  disconnected = true; await page.locator('.nw-flow-summary').filter({ hasText: '连接已断' }).waitFor()
  await state('review', 'unknown')
  disconnected = false; await state('review', 'running')
  await page.getByLabel('选择可视化作品', { exact: true }).selectOption('book:acceptance-b')
  await node('concept').waitFor()
  assert.equal(await page.locator('.nw-inspector').count(), 0)
  assert.equal(await page.getByLabel('选择流程章节').inputValue(), '0')
  await state('review', '')
  report.checks.push('同步/断线移除假运行、重连恢复及切书清空旧章节与详情')
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) { report.failure = String(error); await capture('archify-failure'); throw error }
finally {
  fs.writeFileSync(path.join(output, 'archify-browser-report.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
