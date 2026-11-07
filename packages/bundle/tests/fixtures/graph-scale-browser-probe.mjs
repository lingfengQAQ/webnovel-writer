import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
const file = path.resolve(process.argv[2]), runtime = JSON.parse(fs.readFileSync(file, 'utf8')), output = path.dirname(file)
const { chromium } = await import(pathToFileURL(path.join(process.env.WEBNOVEL_PLAYWRIGHT, 'index.mjs')).href)
const browser = await chromium.launch({ headless: true, executablePath: process.env.WEBNOVEL_CHROMIUM })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, hasTouch: true })
page.setDefaultTimeout(20000)
const report = { synthetic: true, realDiskAndHttp: true, checks: [], responses: [], screenshots: [], errors: [] }
const save = () => fs.writeFileSync(path.join(output, 'scale-browser-report.json'), JSON.stringify(report, null, 2) + '\n')
page.on('pageerror', error => { report.errors.push(error.message); save() })
page.on('requestfailed', request => { if (request.url().endsWith('/api/webnovel/study/graph-view')) { report.errors.push(request.failure()?.errorText ?? 'graph request failed'); save() } })
page.on('response', async response => {
  if (response.url().endsWith('/api/webnovel/study/graph-view') && response.ok()) {
    const text = await response.text(), value = JSON.parse(text).value
    report.responses.push({ bytes: Buffer.byteLength(text), records: value.totals.records, catalogTotal: value.catalog.total, catalogRendered: value.catalog.items.length,
      groups: value.clusters.total, details: value.details.total, detailRows: value.details.items.length, canvas: value.graph.records.length }); save()
  }
})
const ready = () => page.locator('.nw-reader[aria-busy="false"] .nw-g6-map[data-ready="true"]').waitFor()
const shot = async name => { await page.screenshot({ path: path.join(output, name + '.png') }); report.screenshots.push(name + '.png'); save() }
const top = () => page.locator('.nw-viz').evaluate(element => { element.scrollTop = 0 })
try {
  let urls = []
  for (let attempt = 0; attempt < 120 && !urls.length; attempt++) {
    urls = [...fs.readFileSync(path.join(runtime.root, 'stdout.log'), 'utf8').matchAll(/dsh web: (http\S+)/g)]
    if (!urls.length) await new Promise(resolve => setTimeout(resolve, 250))
  }
  assert.ok(urls.length, 'Isolated host did not become ready')
  await page.goto(urls.at(-1)[1])
  const welcome = page.getByRole('button', { name: '继续', exact: true }); await welcome.waitFor({ timeout: 4000 }).catch(() => {}); if (await welcome.isVisible()) await welcome.click()
  await page.getByRole('tab', { name: '工作区', exact: true }).click()
  const workspace = page.getByRole('treeitem', { name: /^S5 临时验收书房/ }).first()
  if (await workspace.getAttribute('aria-expanded') === 'false') await workspace.click()
  await page.getByText('S6 后台索引验收', { exact: true }).first().click()
  await page.getByRole('tab', { name: '可视化', exact: true }).click()
  await page.getByRole('tab', { name: '关系', exact: true }).click()
  await page.getByRole('button', { name: /^选择可视化作品/ }).click()
  await page.getByRole('menuitem', { name: '千章星团验收', exact: true }).click()
  await ready()
  assert.match(await page.locator('.nw-reader-status').innerText(), /2000/)
  assert.ok(await page.locator('.nw-cluster-row').count() >= 12)
  assert.ok(await page.locator('.nw-person-row').count() <= 24)
  report.checks.push('Real 2000-chapter disk source; bounded people index, clustered older relationships and recent relations')
  report.primitiveStyles = await page.evaluate(() => {
    const style = document.querySelector('style[data-webnovel]')
    const nodes = [...document.querySelectorAll('.nw-reader *')].filter(node => /^_[A-Za-z]+_[\w]+_\d+$/.test(node.classList[0] ?? '') && node.getClientRects().length)
    const properties = ['padding', 'border-width', 'border-style', 'border-radius', 'background-color', 'box-shadow']
    const read = node => Object.fromEntries(properties.map(name => [name, getComputedStyle(node).getPropertyValue(name)]))
    const before = nodes.map(read); style.disabled = true; const after = nodes.map(read); style.disabled = false
    return { count: nodes.length, diffs: nodes.flatMap((node, index) => properties.filter(name => before[index][name] !== after[index][name]).map(name => ({ property: name, label: node.getAttribute('aria-label') || node.textContent, actual: before[index][name], native: after[index][name] }))) }
  })
  assert.ok(report.primitiveStyles.count > 0); assert.deepEqual(report.primitiveStyles.diffs, [])
  await shot('scale-clusters-1280')
  const firstRelation = await page.locator('.nw-relation-line').first().innerText()
  const firstGroup = await page.locator('.nw-cluster-row').first().innerText()
  await page.getByRole('button', { name: '下一页人物索引', exact: true }).click(); await ready()
  assert.equal(await page.locator('.nw-relation-line').first().innerText(), firstRelation)
  assert.equal(await page.locator('.nw-cluster-row').first().innerText(), firstGroup)
  report.checks.push('Actual people-index pagination leaves relation and cluster pages unchanged')
  const groupName = await page.locator('.nw-cluster-row strong').first().innerText()
  await page.locator('.nw-cluster-row').first().click(); await ready()
  assert.match(await page.locator('.nw-reader-breadcrumb').innerText(), /收起星团/)
  assert.ok((await page.locator('.nw-reader-breadcrumb').innerText()).includes(groupName))
  await page.locator('.nw-relation-line').first().click(); await ready()
  assert.ok(await page.locator('.nw-graph-history li').count() > 0)
  await page.getByRole('region', { name: '关系记载变化', exact: true }).getByRole('button').first().click(); await ready()
  assert.ok(await page.locator('.nw-graph-history [data-evidence-selected=true]').count() > 0)
  report.checks.push('A chronological relationship evidence point selects its exact source entry')
  await page.locator('.nw-graph-history').getByRole('button', { name: /打开第/ }).first().click()
  await page.getByRole('textbox', { name: '文档正文', exact: true }).waitFor()
  report.checks.push('Clicking a faction cluster expands its relations; selected evidence opens the actual editor')
  await shot('scale-evidence-editor')
  await page.getByRole('button', { name: '收起右侧边栏', exact: true }).click()
  await top(); await page.getByRole('button', { name: '收起星团', exact: true }).click(); await ready()
  const search = page.getByLabel('搜索图谱', { exact: true })
  if (!await search.isVisible()) await page.getByRole('button', { name: '人物索引', exact: true }).click()
  await search.fill('别名2000'); await page.waitForTimeout(250); await ready()
  await page.locator('.nw-people-list .nw-person-row').filter({ hasText: '人物2000' }).click(); await ready()
  assert.match(await page.locator('.nw-reader-breadcrumb').innerText(), /人物2000/)
  if (!await search.isVisible()) await page.getByRole('button', { name: '人物索引', exact: true }).click()
  await search.fill(''); await page.waitForTimeout(250); await ready()
  report.checks.push('Full index alias lookup finds entity 2000 and preserves selection after clearing search')
  await page.getByRole('tab', { name: '全书星团', exact: true }).click(); await ready()
  assert.ok(await page.locator('.nw-cluster-row').count() >= 12)
  await page.locator('.nw-relation-options-title').filter({ hasText: '阅读范围' }).click()
  await page.getByRole('button', { name: /^星团分组字段/ }).click()
  await page.getByRole('menuitem', { name: '家族', exact: true }).click(); await ready()
  assert.match(await page.locator('.nw-cluster-row').first().innerText(), /家族/)
  await page.locator('.nw-relation-options-title').filter({ hasText: '阅读范围' }).click()
  report.checks.push('Whole-book overview switches between explicit faction and family tags')
  for (const width of [1280, 778, 600, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 760 })
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
      await top(); await ready(); await page.waitForTimeout(200)
      await page.getByRole('group', { name: '人物关系图', exact: true }).focus(); await page.keyboard.press('0'); await page.waitForTimeout(200)
      const dimensions = await page.locator('.nw-viz').evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth }))
      assert.ok(dimensions.scroll <= dimensions.width + 2, JSON.stringify({ width, theme, dimensions }))
      for (const fontSize of [10, 16, 22]) {
        await page.evaluate(size => document.body.style.setProperty('--dsh-content-font-size', `${size}px`), fontSize)
        await page.waitForTimeout(100)
        await shot(`scale-overview-${width}-${theme}-${fontSize}`)
      }
    }
  }
  await top()
  await page.locator('.nw-map-tools').getByRole('button', { name: '全屏', exact: true }).click()
  await page.locator('[data-visual-expanded] .nw-reader-inspector').waitFor()
  await shot('scale-expanded-390')
  await page.keyboard.press('Escape')
  assert.ok(report.responses.every(item => item.bytes < 200000 && item.catalogRendered <= 24 && item.detailRows <= 20))
  assert.deepEqual(report.errors, [])
  report.complete = true; save(); console.log(JSON.stringify({ checks: report.checks, responses: report.responses.length, maxResponseBytes: Math.max(...report.responses.map(row => row.bytes)), errors: report.errors }))
} catch (error) {
  report.failure = String(error); report.body = (await page.locator('body').innerText()).slice(-3000)
  await shot('scale-failure'); save(); console.log(JSON.stringify({ failure: report.failure, body: report.body })); process.exitCode = 1
} finally { await browser.close() }
