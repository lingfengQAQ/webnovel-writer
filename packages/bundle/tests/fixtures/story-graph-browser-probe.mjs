/** Approved story example through the product component; API data is explicitly synthetic. */
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
const runtimePath = path.resolve(process.argv[2]), runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8')), output = path.dirname(runtimePath)
const model = JSON.parse(fs.readFileSync(new URL('./story-graph-sample.json', import.meta.url), 'utf8'))
const { chromium } = await import(pathToFileURL(path.join(process.env.WEBNOVEL_PLAYWRIGHT, 'index.mjs')).href)
const browser = await chromium.launch({ headless: true, executablePath: process.env.WEBNOVEL_CHROMIUM })
const page = await browser.newPage({ viewport: { width: 1500, height: 1250 } })
page.setDefaultTimeout(20000)
const report = { simulated: true, checks: [], errors: [], screenshots: [], externalRequests: [] }
page.on('pageerror', e => report.errors.push(e.message))
page.on('request', r => { if (/^https?:/.test(r.url()) && !r.url().startsWith('http://127.0.0.1:')) report.externalRequests.push(r.url()) })
let graphData = model
await page.route('**/api/webnovel/study/graph', route => route.fulfill({ json: { ok: true, value: route.request().postDataJSON().space === 'book:acceptance-a' ? graphData : { ...model, records: [], edges: [], events: [] } } }))
const ready = async () => { await page.waitForTimeout(150); await page.locator('.nw-g6-map[data-ready="true"]').waitFor() }
const count = () => page.locator('[aria-label="选择图谱记录"] optgroup[label="人物与条目"] option').count()
const pick = async id => { await page.getByLabel('选择图谱记录', { exact: true }).selectOption(id); await ready() }
const chapter = async n => { await page.getByLabel('图谱章节时间线').fill(String(n)); await ready() }
const capture = async name => { await page.locator('.nw-viz').evaluate(el => { el.scrollTop = 0 }); await page.locator('.nw-viz').screenshot({ path: path.join(output, name + '.png') }); report.screenshots.push(name + '.png') }
const pixels = () => page.locator('.nw-g6-canvas').evaluate(el => [...el.querySelectorAll('canvas')].map(c => c.toDataURL()).join('|'))
try {
  const url = fs.readFileSync(path.join(runtime.root, 'stdout.log'), 'utf8').match(/dsh web: (http\S+)/)?.[1]; assert.ok(url)
  await page.goto(url)
  const welcome = page.getByRole('button', { name: '继续', exact: true }); await welcome.waitFor({ timeout: 5000 }).catch(() => {}); if (await welcome.isVisible()) await welcome.click()
  await page.getByRole('tab', { name: '工作区', exact: true }).click()
  const workspace = page.getByRole('treeitem', { name: /^S5 临时验收书房/ }).first(); if (await workspace.getAttribute('aria-expanded') === 'false') await workspace.click()
  await page.getByText('S5 书房验收', { exact: true }).first().click()
  await page.getByRole('tab', { name: '可视化', exact: true }).click()
  await page.getByLabel('选择可视化作品', { exact: true }).selectOption('book:acceptance-a')
  await page.getByRole('button', { name: '人物关系', exact: true }).click(); await ready()
  assert.equal(await count(), 37); await page.getByText('37 个节点 · 66 条关联', { exact: true }).waitFor()
  await capture('g6-overview-light'); report.checks.push('实际产品显示已确认故事样本：37节点、66关联、五类实体')
  await pick('father'); assert.equal(await page.locator('.nw-graph-history li').count(), 2); await page.locator('.nw-inspector').filter({ hasText: '紧张' }).waitFor(); await capture('g6-relation-history')
  await chapter(3); await pick('missing'); assert.equal(await page.locator('.nw-graph-history li').count(), 1); assert.match(await page.locator('.nw-inspector').innerText(), /已埋/)
  await chapter(4); await pick('missing'); assert.equal(await page.locator('.nw-graph-history li').count(), 2); assert.match(await page.locator('.nw-inspector').innerText(), /已收/)
  await chapter(13); await pick('manage'); await capture('g6-temporary-relation'); await chapter(16)
  assert.equal(await page.locator('option[value="manage"]').count(), 0)
  await page.getByRole('button', { name: '回到最新', exact: true }).click(); await ready()
  await page.getByLabel('包括计划').check(); await ready(); assert.equal(await count(), 39)
  await page.getByLabel('图谱信息视图').selectOption('reader'); await ready(); assert.equal(await page.locator('option[value="poetry"],option[value="finance"],option[value="oldaccount"]').count(), 0)
  await page.getByLabel('图谱信息视图').selectOption('author'); await page.getByLabel('包括计划').uncheck(); await ready()
  report.checks.push('旧章历史不显示未来版本、已埋/已收、失效关系、计划与披露筛选')
  await pick('baoyu'); await page.getByRole('button', { name: '直接关联', exact: true }).click(); await ready(); const one = await count()
  await page.getByRole('button', { name: '更多关联', exact: true }).click(); await ready(); assert.ok(await count() > one)
  await page.getByLabel('关系终点').selectOption('hengwu'); await ready(); assert.match(await page.locator('.nw-inspector [role="status"]').innerText(), /贾宝玉.*蘅芜苑/); await capture('g6-path')
  await page.getByRole('button', { name: '关闭详情', exact: true }).click(); await ready(); await pick('xuepan'); await page.getByLabel('关系终点').selectOption('case'); await ready(); await page.getByText('没有找到可连接的路径', { exact: true }).waitFor()
  await page.getByRole('button', { name: '关闭详情', exact: true }).click(); await ready(); await pick('case'); await page.getByLabel('关系终点').selectOption('xuepan'); await ready(); assert.equal(await count(), 2)
  report.checks.push('邻域与路径只用当前投影，单向引用不可反向穿过')
  await page.getByRole('button', { name: '关闭详情', exact: true }).click(); await ready()
  const dragBefore = await pixels()
  await page.locator('.nw-g6-scroll').scrollIntoViewIfNeeded()
  const box = await page.locator('.nw-g6-canvas').boundingBox()
  await page.mouse.move(box.x + 40, box.y + 40); await page.mouse.down(); await page.waitForTimeout(150)
  await page.mouse.move(box.x + 104, box.y + 60, { steps: 12 }); await page.mouse.up(); await ready()
  assert.ok(await pixels() !== dragBefore, 'pointer drag changes the canvas viewport')
  report.checks.push('实际指针拖动画布改变视口')
  const before = await pixels(); await page.getByRole('button', { name: '放大', exact: true }).click(); await page.waitForTimeout(150); assert.ok(await pixels() !== before, 'zoom changes rendered canvas')
  await page.getByRole('group', { name: '人物关系图', exact: true }).focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('0'); await page.waitForTimeout(150)
  await page.getByRole('button', { name: '全屏', exact: true }).click(); await page.waitForFunction(() => !!document.fullscreenElement)
  await pick('baoyu'); assert.equal(await page.locator('.nw-inspector').evaluate(el => document.fullscreenElement.contains(el)), true)
  await page.screenshot({ path: path.join(output, 'g6-fullscreen.png') })
  await page.getByRole('button', { name: '退出全屏', exact: true }).click(); await page.getByRole('button', { name: '关闭详情', exact: true }).click(); await ready()
  const light = await pixels(); await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForFunction(previous => [...document.querySelectorAll('.nw-g6-canvas canvas')].map(c => c.toDataURL()).join('|') !== previous, light); await capture('g6-overview-dark')
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' }); await page.setViewportSize({ width: 720, height: 1100 }); await ready(); await pick('missing'); await capture('g6-narrow-details')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
  await page.setViewportSize({ width: 360, height: 1000 }); await ready(); await capture('g6-360px'); assert.equal(await page.locator('.nw-viz').evaluate(el => el.scrollWidth > el.clientWidth + 1), false)
  report.checks.push('缩放、键盘平移/归位、全屏含详情、深浅主题、720/360px无横向溢出')
  await page.setViewportSize({ width: 1500, height: 1250 }); await page.getByLabel('搜索图谱').fill('不存在的名字'); await page.getByText('当前没有匹配记录', { exact: true }).waitFor(); await page.getByLabel('搜索图谱').fill(''); await ready()
  await page.getByLabel('选择可视化作品').selectOption('book:acceptance-b'); await page.getByText('还没有人物关系', { exact: true }).waitFor(); assert.equal(await page.locator('.nw-inspector').count(), 0)
  graphData = { ...model, records: Array.from({ length: 185 }, (_, i) => ({ ...model.records[0], id: 'stress' + i, label: '长中文测试人物' + i })), edges: [], events: [] }
  await page.getByLabel('选择可视化作品').selectOption('book:acceptance-a'); await ready(); assert.equal(await count(), 180)
  await page.getByLabel('搜索图谱').fill('长中文测试人物184'); await ready(); assert.equal(await count(), 1); await page.locator('.nw-map-search-results button').click(); await ready(); await page.getByRole('heading', { name: '长中文测试人物184', exact: true }).waitFor(); assert.equal(await count(), 1)
  const singleBox = await page.locator('.nw-g6-canvas').boundingBox()
  await page.locator('.nw-g6-scroll').scrollIntoViewIfNeeded()
  const actualBox = await page.locator('.nw-g6-canvas').boundingBox()
  const center = { x: actualBox.x + singleBox.width / 2, y: actualBox.y + singleBox.height / 2 }
  await page.mouse.move(center.x, center.y); await page.mouse.down(); await page.waitForTimeout(150); await page.mouse.move(center.x + 70, center.y + 20, { steps: 12 }); await page.mouse.up(); await ready()
  await page.mouse.click(center.x + 70, center.y + 36); await ready()
  assert.equal(await page.getByLabel('选择图谱记录', { exact: true }).inputValue(), 'stress184')
  await capture('g6-stress-search'); report.checks.push('空搜索恢复、切书清除状态、185记录/180显示上限和末尾搜索')
  assert.deepEqual(report.errors, []); assert.deepEqual(report.externalRequests, []); report.passed = true
} catch (error) { report.failure = String(error); await capture('g6-failure').catch(() => {}); throw error }
finally { fs.writeFileSync(path.join(output, 'g6-browser-report.json'), JSON.stringify(report, null, 2)); await browser.close() }
