/** Real product UI against an isolated synthetic book and a controlled host adapter. */
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const runtimePath = path.resolve(process.argv[2]), runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'))
const output = path.dirname(runtimePath)
const { chromium } = await import(pathToFileURL(path.join(process.env.WEBNOVEL_PLAYWRIGHT, 'index.mjs')).href)
const browser = await chromium.launch({ headless: true, executablePath: process.env.WEBNOVEL_CHROMIUM })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, hasTouch: true })
page.setDefaultTimeout(15000)
const report = { synthetic: true, checks: [], screenshots: [], errors: [] }
const matrixOnly = process.argv.includes('--matrix-only')
let graphSnapshot
page.on('response', async response => {
  if (response.url().endsWith('/api/webnovel/study/graph') && response.ok()) graphSnapshot = await response.json().catch(() => graphSnapshot)
})
page.on('pageerror', error => report.errors.push(error.message))
const save = () => fs.writeFileSync(path.join(output, matrixOnly ? 'visualization-matrix-report.json' : 'visualization-report.json'), JSON.stringify(report, null, 2) + '\n')
const shot = async name => { await page.screenshot({ path: path.join(output, name + '.png') }); report.screenshots.push(name + '.png'); save() }
const top = () => page.locator('.nw-viz').evaluate(element => { element.scrollTop = 0 })
const ready = async () => { await page.locator('.nw-g6-map[data-ready="true"]').waitFor(); await page.waitForTimeout(150) }
const camera = () => page.locator('.nw-g6-map').evaluate(element => ({ zoom: Number(element.dataset.graphZoom), center: JSON.parse(element.dataset.graphCenter) }))
const choose = async (label, option) => {
  await page.getByRole('button', { name: new RegExp('^' + label) }).click()
  await page.getByRole('menuitem', { name: option, exact: true }).click()
}
const hostReport = () => JSON.parse(fs.readFileSync(path.join(output, 'browser-host-report.json'), 'utf8'))
const started = Date.now()
while (Date.now() - started < 30000) {
  if (fs.existsSync(path.join(output, 'browser-host-report.json')) && /dsh web: http/.test(fs.readFileSync(path.join(runtime.root, 'stdout.log'), 'utf8'))) break
  await new Promise(resolve => setTimeout(resolve, 200))
}
const initialGraphRequests = hostReport().graphRequests ?? 0
let completedRequests = initialGraphRequests
try {
  const urls = [...fs.readFileSync(path.join(runtime.root, 'stdout.log'), 'utf8').matchAll(/dsh web: (http\S+)/g)]
  assert.ok(urls.length)
  await page.goto(urls.at(-1)[1])
  const welcome = page.getByRole('button', { name: '继续', exact: true })
  await welcome.waitFor({ timeout: 5000 }).catch(() => {})
  if (await welcome.isVisible()) await welcome.click()
  await page.getByRole('tab', { name: '工作区', exact: true }).click()
  const workspace = page.getByRole('treeitem', { name: /^S5 临时验收书房/ }).first()
  if (await workspace.getAttribute('aria-expanded') === 'false') await workspace.click()
  await page.getByText('S6 后台索引验收', { exact: true }).first().click()
  await page.getByRole('tab', { name: '可视化', exact: true }).click()
  await page.getByRole('tab', { name: '关系', exact: true }).click()
  await choose('选择可视化作品', '验收作品甲')
  await ready()
  if (!matrixOnly) {
  assert.equal(await page.getByText('图谱暂未加载，请重试。').count(), 0)
  assert.equal(hostReport().graphRequests ?? 0, initialGraphRequests)
  report.checks.push('Actual G6 first render; relation/progress pages; no extraction on read')
  await shot('relations-initial')

  const canvas = page.getByRole('group', { name: '人物关系图', exact: true })
  await canvas.focus(); const beforeZoom = await camera(); await page.keyboard.press('+'); await ready()
  const zoomed = await camera(); assert.ok(zoomed.zoom > beforeZoom.zoom)
  await top(); await page.getByLabel('图谱章节', { exact: true }).fill('5'); await ready()
  const chapterCamera = await camera()
  assert.ok(Math.abs(chapterCamera.zoom - zoomed.zoom) < .001)
  assert.ok(Math.hypot(chapterCamera.center[0] - zoomed.center[0], chapterCamera.center[1] - zoomed.center[1]) < .1)
  await page.getByLabel('图谱章节', { exact: true }).fill('1'); await ready()
  await page.getByLabel('图谱章节', { exact: true }).fill('5'); await ready()
  assert.ok(Math.abs((await camera()).zoom - zoomed.zoom) < .001)
  report.checks.push('Keyboard zoom and chapter/empty-filter changes preserve the actual G6 camera')

  await page.locator('.nw-map-tools').getByRole('button', { name: '全屏', exact: true }).click()
  await page.locator('.nw-story-explorer[data-visual-expanded]').waitFor()
  assert.ok(await page.locator('.nw-story-explorer[data-visual-expanded] .nw-inspector').isVisible())
  await shot('relations-expanded')
  await page.keyboard.press('Escape')
  await page.locator('.nw-story-explorer[data-visual-expanded]').waitFor({ state: 'hidden' })
  report.checks.push('Expansion contains the evidence panel; Escape exits')

  await top(); await page.getByRole('tab', { name: '进度', exact: true }).click()
  await page.getByRole('region', { name: '章节进度', exact: true }).waitFor()
  assert.equal(await page.getByRole('group', { name: '写作流程图', exact: true }).count(), 0)
  await page.getByRole('button', { name: '展开完整流程', exact: true }).click()
  await page.getByRole('group', { name: '写作流程图', exact: true }).waitFor()
  assert.equal(await page.locator('.nw-archify g[data-node-id]').count(), 13)
  await shot('progress-expanded-workflow')
  report.checks.push('Progress combines activity and chapter facts; approved 13-node artwork remains available')

  await top(); await page.getByRole('tab', { name: '关系', exact: true }).click(); await ready()
  await page.getByRole('button', { name: '图谱模型', exact: true }).click()
  await page.getByRole('checkbox', { name: '提供图谱抽取模型', exact: true }).waitFor()
  await shot('graph-model-settings')
  await page.getByRole('checkbox', { name: '提供图谱抽取模型', exact: true }).check()
  await page.getByRole('button', { name: /^图谱抽取模型/ }).click()
  await page.getByRole('menuitem', { name: /本地验收提供方.*本地验收/ }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.waitForTimeout(250)
  assert.equal(hostReport().graphRequests ?? 0, initialGraphRequests)
  report.checks.push('Native graph model form saves independently; configuration alone makes no extraction request')
  await page.getByText('S6 后台索引验收', { exact: true }).first().click()
  await page.getByRole('tab', { name: '可视化', exact: true }).click()
  await page.getByRole('tab', { name: '关系', exact: true }).click()
  await choose('选择可视化作品', '验收作品甲'); await ready()
  const enable = page.getByRole('button', { name: '启用沉淀抽取', exact: true })
  if (await enable.isVisible()) {
    await enable.click()
    const preview = page.getByRole('dialog', { name: '确认图谱抽取范围' })
    await preview.waitFor()
    assert.match(await preview.innerText(), /不发送定稿全文/)
    assert.equal(hostReport().graphRequests ?? 0, initialGraphRequests)
    await preview.getByRole('button', { name: '确认范围并继续', exact: true }).click()
  }
  await page.getByText('索引已就绪', { exact: true }).waitFor({ timeout: 30000 })
  await page.locator('.nw-relation-line').filter({ hasText: '师徒' }).first().waitFor()
  assert.equal(await page.locator('.nw-relation-line').filter({ hasText: '师徒' }).count(), 2)
  completedRequests = hostReport().graphRequests
  await top(); await page.getByRole('button', { name: '刷新作品视图', exact: true }).click(); await ready()
  assert.equal(hostReport().graphRequests, completedRequests)
  report.checks.push('Explicit per-book enable produces two validated synthetic extracted relations; refresh reuses results')
  await shot('relations-extracted')

  await top(); await page.getByRole('button', { name: '暂停', exact: true }).click()
  await page.getByText('已暂停', { exact: true }).waitFor()
  await page.locator('.nw-relation-line').filter({ hasText: '师徒' }).last().click()
  const latestSource = () => page.locator('.nw-inspector .nw-graph-history li').filter({ hasText: '第 5 章记载' }).getByRole('button', { name: /打开第/ })
  await latestSource().click()
  const editor = page.getByRole('textbox', { name: '文档正文', exact: true })
  await editor.waitFor()
  await page.waitForTimeout(200)
  report.sourceSelection = await editor.evaluate(element => {
    const selected = window.getSelection(), line = selected?.anchorNode?.parentElement?.closest('.cm-line')
    return { selected: selected?.toString(), lineIndex: [...element.querySelectorAll('.cm-line')].indexOf(line), lines: [...element.querySelectorAll('.cm-line')].map(item => item.textContent) }
  })
  assert.equal(report.sourceSelection.selected, '林舟是沈青的师父。')
  assert.equal(report.sourceSelection.lineIndex, 6)
  report.checks.push('Actual editor selects the second repeated source quote from a BOM/CRLF worldbook')
  await shot('source-selected')
  const originalSource = path.join(runtime.workspace, '验收作品甲/世界书/人物档案/林舟.md')
  const originalBytes = fs.readFileSync(originalSource)
  await editor.press('End'); await editor.pressSequentially('未保存校验')
  assert.match(await editor.innerText(), /未保存校验/)
  await latestSource().click()
  await page.getByText('当前文档有未保存编辑，已保留编辑；保存或处理差异后可重新定位来源。', { exact: true }).waitFor()
  assert.match(await editor.innerText(), /未保存校验/)
  assert.deepEqual(fs.readFileSync(originalSource), originalBytes)
  report.checks.push('Reopening evidence preserves an actual dirty editor buffer without a disk write')
  await editor.focus(); await editor.press('Control+z')
  assert.ok(graphSnapshot?.ok)
  const frozenGraph = JSON.stringify(graphSnapshot)
  const freezeGraph = route => route.fulfill({ status: 200, contentType: 'application/json', body: frozenGraph })
  await page.route('**/api/webnovel/study/graph', freezeGraph)
  fs.writeFileSync(originalSource, Buffer.concat([originalBytes, Buffer.from('\r\n来源变化校验。\r\n')]))
  try {
    await latestSource().click()
    await page.getByText('来源已变化或位置无法核对，请刷新关系视图后重试。', { exact: true }).waitFor()
    report.checks.push('Source hash mismatch refuses stale selection in the actual editor')
  } finally { fs.writeFileSync(originalSource, originalBytes); await page.unroute('**/api/webnovel/study/graph', freezeGraph) }
  await ready()
  assert.ok((await page.locator('.nw-g6-canvas').boundingBox()).width >= 150, 'Graph remains readable beside the native document panel')
  report.checks.push('Graph and evidence stack according to actual pane width beside the native editor')
  const closeSidebar = page.getByRole('button', { name: '收起右侧边栏', exact: true })
  if (await closeSidebar.isVisible()) await closeSidebar.click()
  await top(); await page.getByRole('button', { name: '刷新作品视图', exact: true }).click(); await ready()
  }
  report.matrix = []
  for (const [width, height] of [[1280, 720], [778, 776], [600, 760], [390, 844]]) {
    await page.setViewportSize({ width, height })
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
      await page.waitForFunction(dark => document.body.hasAttribute('data-ds-dark-theme') === dark, theme === 'dark')
      for (const fontSize of [10, 16, 22]) {
        await page.evaluate(size => document.body.style.setProperty('--dsh-content-font-size', `${size}px`), fontSize)
        await top(); await ready()
        await page.getByRole('group', { name: '人物关系图', exact: true }).focus()
        await page.keyboard.press('0'); await ready()
        const metrics = await page.locator('.nw-viz').evaluate(element => {
          const canvas = element.querySelector('.nw-g6-canvas'), bounds = canvas.getBoundingClientRect()
          return { clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, canvasWidth: bounds.width, canvasHeight: bounds.height }
        })
        assert.ok(metrics.scrollWidth <= metrics.clientWidth + 2, `horizontal overflow: ${JSON.stringify({ width, theme, fontSize, ...metrics })}`)
        assert.ok(metrics.canvasWidth >= 150 && metrics.canvasHeight >= 150, JSON.stringify({ width, theme, fontSize, ...metrics }))
        const name = `relations-${width}-${theme}-${fontSize}`
        await shot(name); report.matrix.push({ width, height, theme, fontSize, ...metrics }); save()
      }
    }
    await page.locator('.nw-map-tools').getByRole('button', { name: '全屏', exact: true }).click()
    await page.locator('.nw-story-explorer[data-visual-expanded]').waitFor()
    await page.locator('.nw-inspector .nw-graph-history li').first().scrollIntoViewIfNeeded()
    await shot(`expanded-${width}`)
    await page.keyboard.press('Escape')
    await top(); await page.getByRole('tab', { name: '进度', exact: true }).click()
    await page.getByRole('list', { name: '章节进度列表', exact: true }).waitFor()
    await page.waitForFunction(() => !document.querySelector('.nw-flow-summary')?.textContent.includes('正在连接'))
    assert.ok(Number(await page.getByRole('progressbar', { name: '全书定稿进度', exact: true }).getAttribute('value')) >= 1)
    await page.getByRole('region', { name: '章节进度', exact: true }).scrollIntoViewIfNeeded()
    await shot(`progress-${width}`)
    await top(); await page.getByRole('tab', { name: '关系', exact: true }).click(); await ready()
  }
  await page.getByLabel('搜索图谱', { exact: true }).fill('沈青')
  await page.locator('.nw-map-search-results').getByRole('button', { name: /沈青/ }).first().tap()
  assert.match(await page.locator('.nw-inspector').innerText(), /沈青/)
  assert.equal(hostReport().graphRequests, completedRequests)
  report.checks.push('Four viewport sizes × two native themes × three reading font sizes; expansion, progress, touch search and reduced motion')
  const pressureRecords = Array.from({ length: 185 }, (_, index) => ({ id: `pressure-${index + 1}`, label: index === 184 ? '末尾人物185' : index === 180 || index === 181 ? '同名' : `人物${index + 1}`,
    kind: '人物', status: '已成事实', chapter: 1, recordChapter: 1, plan: false, line: 1, preview: '合成压力夹具，不是作品内容。',
    source: { space: 'book:acceptance-a', path: `世界书/人物档案/人物${index + 1}.md` } }))
  const pressure = { ...graphSnapshot.value, records: pressureRecords, edges: [], events: [], evidence: [], warnings: [], index: undefined,
    entities: pressureRecords.map(item => ({ id: item.id, label: item.label, kind: item.kind, aliases: item.id === 'pressure-185' ? ['远方来客'] : [] })) }
  await page.route('**/api/webnovel/study/graph', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, value: pressure }) }))
  await top(); await page.getByRole('button', { name: '刷新作品视图', exact: true }).click(); await ready()
  const search = page.getByLabel('搜索图谱', { exact: true })
  await search.fill('末尾人物185')
  await page.locator('.nw-map-search-results').getByRole('button', { name: /末尾人物185/ }).click()
  assert.equal(await page.getByLabel('选择图谱记录', { exact: true }).inputValue(), 'pressure-185')
  await search.fill('同名')
  const names = page.locator('.nw-map-search-results').getByRole('button', { name: /同名/ })
  assert.equal(await names.count(), 2)
  assert.notEqual(await names.first().innerText(), await names.last().innerText())
  await names.last().click()
  assert.equal(await page.getByLabel('选择图谱记录', { exact: true }).inputValue(), 'pressure-182')
  await search.fill('')
  assert.equal(await page.getByLabel('选择图谱记录', { exact: true }).inputValue(), 'pressure-182')
  await search.fill('远方来客')
  await page.locator('.nw-map-search-results').getByRole('button', { name: /末尾人物185/ }).click()
  assert.equal(await page.getByLabel('选择图谱记录', { exact: true }).inputValue(), 'pressure-185')
  report.checks.push('Separate synthetic 185-entity pressure fixture: last-result search, duplicate-name paths, stable selection and alias lookup')
  await shot('pressure-search-390')
  assert.deepEqual(report.errors, [])
  report.complete = true
  save()
  console.log(JSON.stringify({ checks: report.checks, screenshots: report.screenshots, errors: report.errors, sourceSelection: report.sourceSelection }))
} catch (error) {
  report.failure = String(error).replace(/https?:\/\/\S+/g, '[URL]')
  report.body = (await page.locator('body').innerText()).slice(-3500)
  await shot('probe-failure'); save()
  console.log(JSON.stringify({ failure: report.failure, body: report.body, checks: report.checks, errors: report.errors }))
  process.exitCode = 1
} finally { await browser.close() }
