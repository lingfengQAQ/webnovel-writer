/** Real DSH file-tree acceptance, including a source-built pre-fix comparison. */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import * as esbuild from 'esbuild'

const runtimePath = path.resolve(process.argv[2])
const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8').replace(/^\uFEFF/, ''))
const evidence = path.dirname(runtimePath)
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const repo = path.resolve(packageRoot, '../..')
const baselineRef = process.argv[3]
assert.ok(baselineRef, 'Supply a Git revision from before the file-tree fix as the third argument')
const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))
const currentClient = fs.readFileSync(path.join(packageRoot, 'lib/client.js'), 'utf8').trim()
const oldSources = new Map(['browser.tsx', 'styles.css'].map(name => [path.join(packageRoot, 'src/client', name),
  execFileSync('git', ['show', `${baselineRef}:packages/bundle/src/client/${name}`], { cwd: repo, encoding: 'utf8' })]))
const baseline = await esbuild.build({
  entryPoints: [path.join(packageRoot, 'src/client/index.tsx')], write: false,
  platform: 'browser', format: 'cjs', bundle: true, external: ['react'], target: 'chrome110',
  loader: { '.css': 'text' }, minify: true, legalComments: 'inline',
  banner: { js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => { const module = { exports: {} }; const exports = module.exports;` },
  footer: { js: 'return module.exports; } });' },
  plugins: [{ name: 'pre-fix-tree', setup(build) {
    build.onLoad({ filter: /(?:browser\.tsx|styles\.css)$/ }, args => {
      const contents = oldSources.get(path.normalize(args.path))
      return contents === undefined ? undefined : { contents, loader: args.path.endsWith('.css') ? 'text' : 'tsx', resolveDir: path.dirname(args.path) }
    })
  } }],
})
const { chromium } = await import(pathToFileURL(path.join(process.env.WEBNOVEL_PLAYWRIGHT, 'index.mjs')).href)
const browser = await chromium.launch({ headless: true, executablePath: process.env.WEBNOVEL_CHROMIUM })
const url = fs.readFileSync(path.join(runtime.root, 'stdout.log'), 'utf8').match(/dsh web: (http\S+)/)?.[1]
assert.ok(url, 'acceptance host must be ready')
const checks = {}
const report = { baselineRef, checks, errors: [] }
let activePage
const prefix = '验收树-' + Date.now()
const fixture = path.join(runtime.workspace, '书房', prefix)
const put = (name, body = '# 验收\n\n初始内容。\n') => {
  const target = path.join(fixture, name)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, body)
  return target
}
put('01目录A/01子层/深层.md')
put('02目录B/切换.md')
put('03慢目录/旧快照.md')
fs.mkdirSync(path.join(fixture, '04空目录'), { recursive: true })
put('读我.md'); put('笔记.txt'); put('配置.json', '{}'); put('图片.png', 'fixture')
const searchName = `检索标记-${Date.now()}.md`
put(searchName)
for (let index = 0; index < 20; index++) put(`01目录A/行${String(index).padStart(2, '0')}.md`)

async function openSession(page) {
  await page.goto(url)
  await page.getByRole('tab', { name: '书房', exact: true }).waitFor()
  const welcome = page.getByRole('button', { name: '继续', exact: true })
  await welcome.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
  if (await welcome.isVisible()) { await welcome.click(); await welcome.waitFor({ state: 'hidden' }) }
  await page.getByRole('tab', { name: '工作区', exact: true }).click()
  const group = page.locator('[role="treeitem"][aria-expanded]').filter({ has: page.getByText('S5 临时验收书房', { exact: true }) })
  await group.waitFor()
  if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
  await page.getByText('S5 书房验收', { exact: true }).click()
  await page.getByRole('tab', { name: '书房', exact: true }).click()
  await page.locator('.nw-book').first().locator('.nw-tree-row').first().waitFor()
}
const treeRow = (page, relative) => page.locator(`.nw-tree-row[title=${JSON.stringify(relative)}]`)
async function idle(page) { await page.waitForTimeout(950) }
async function shot(page, name) { await page.screenshot({ path: path.join(evidence, name + '.png') }) }
async function startSamples(page) {
  await page.evaluate(() => {
    window.__treeSamples = []
    window.__treeSampling = true
    const sample = () => {
      if (!window.__treeSampling) return
      const scroll = document.querySelector('.nw-shelf-scroll')
      const row = document.querySelector('.nw-book-row')
      if (scroll && row) window.__treeSamples.push({
        y: row.getBoundingClientRect().y, scroll: scroll.scrollTop,
        contentY: row.getBoundingClientRect().y - scroll.getBoundingClientRect().y + scroll.scrollTop,
        placeholder: !!Array.from(scroll.querySelectorAll('p')).find(node => node.textContent === '正在读取书房…'),
      })
      requestAnimationFrame(sample)
    }
    sample()
  })
}
async function stopSamples(page) {
  return page.evaluate(() => { window.__treeSampling = false; return window.__treeSamples })
}
async function setup(before) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
  activePage = page
  page.on('pageerror', error => report.errors.push(error.message))
  let replaced = 0, shelfRequests = 0
  const held = []
  let gatePath, failPath, delayShelf = true, holdSearch = false
  if (before) await page.route('**/plugins/**', async route => {
    if (!decodeURIComponent(route.request().url()).includes(manifest.name + '/client.js')) return route.continue()
    const response = await route.fetch()
    const body = await response.text()
    assert.ok(body.includes(currentClient), 'must replace the actual current bundle in the host module response')
    replaced++
    await route.fulfill({ response, body: body.replace(currentClient, () => baseline.outputFiles[0].text) })
  })
  await page.route('**/api/webnovel/study/*', async route => {
    const method = new URL(route.request().url()).pathname.split('/').at(-1)
    const body = route.request().postDataJSON()
    if (method === 'tree' && body.ref?.path === failPath) {
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: '验收读取失败', code: 'internal' }) })
    }
    const response = await route.fetch({ headers: { ...route.request().headers(), 'sec-fetch-site': 'same-origin' } })
    if (method === 'shelf') { shelfRequests++; if (delayShelf) await page.waitForTimeout(500) }
    if (method === 'tree' && body.ref?.path === gatePath) await new Promise(resolve => held.push(resolve))
    if (method === 'search' && holdSearch) await new Promise(resolve => held.push(resolve))
    await route.fulfill({ response }).catch(error => {
      // Collapsing a directory deliberately aborts its fetch.
      if (!/closed|disposed|cancel|abort|Invalid InterceptionId/i.test(String(error))) throw error
    })
  })
  await openSession(page)
  await idle(page)
  if (before) assert.equal(replaced, 1)
  return { context, page, held, shelfCount: () => shelfRequests,
    gate: value => { gatePath = value }, gateSearch: value => { holdSearch = value },
    fail: value => { failPath = value }, noDelay: () => { delayShelf = false } }
}

try {
  for (const before of [true, false]) {
    const h = await setup(before), { page } = h
    const label = before ? 'before' : 'after'
    const book = page.locator('.nw-book').first()
    await page.locator('.nw-shelf-scroll').evaluate(node => { node.scrollTop = 0 })
    await shot(page, label + '-collapsed')
    await startSamples(page)
    const count = h.shelfCount()
    for (const name of ['草稿区', '草稿', '卷01-来信']) {
      await book.getByRole('button', name === '草稿区' ? { name: /^草稿区/ } : { name, exact: true }).click()
      await idle(page)
    }
    for (let index = 0; index < 3; index++) {
      await book.getByRole('button', { name: '卷01-来信', exact: true }).click()
      await idle(page)
    }
    const samples = await stopSamples(page)
    const span = Math.max(...samples.map(sample => sample.contentY)) - Math.min(...samples.map(sample => sample.contentY))
    report[label] = { span, samples: samples.filter((sample, index) => !index || sample.placeholder !== samples[index - 1].placeholder || Math.abs(sample.contentY - samples[index - 1].contentY) > .1), refreshes: h.shelfCount() - count }
    assert.ok(h.shelfCount() > count, 'ready-triggered refresh must remain active')
    if (before) { assert.ok(span > 20); assert.ok(samples.some(sample => sample.placeholder)) }
    else { assert.ok(span < .5, `unexpected shelf movement: ${span}`); assert.ok(samples.every(sample => !sample.placeholder)) }
    await shot(page, label + '-expanded')
    if (before) { await h.context.close(); continue }
    checks.refreshGeometry = true
    h.noDelay()

    await treeRow(page, prefix).click()
    const a = prefix + '/01目录A', b = prefix + '/02目录B', slow = prefix + '/03慢目录'
    await treeRow(page, a).click()
    await treeRow(page, a + '/01子层').click()
    await treeRow(page, a + '/01子层/深层.md').click()
    await page.getByRole('textbox', { name: '文档正文', exact: true }).waitFor()
    await idle(page)
    const selectedTitle = await page.locator('.nw-tree-row.is-selected').getAttribute('title')
    const initialScroll = await page.locator('.nw-shelf-scroll').evaluate(node => node.scrollTop)
    const selectedY = (await page.locator('.nw-tree-row.is-selected').boundingBox()).y
    await page.getByRole('button', { name: '刷新书房', exact: true }).click()
    await idle(page)
    assert.equal(await treeRow(page, a).getAttribute('aria-expanded'), 'true')
    assert.equal(await treeRow(page, a + '/01子层').getAttribute('aria-expanded'), 'true')
    assert.equal(await page.locator('.nw-tree-row.is-selected').getAttribute('title'), selectedTitle)
    assert.ok(Math.abs(await page.locator('.nw-shelf-scroll').evaluate(node => node.scrollTop) - initialScroll) < .5)
    assert.ok(Math.abs((await page.locator('.nw-tree-row.is-selected').boundingBox()).y - selectedY) < .5)
    checks.manualRefreshKeepsSelectionAndScroll = true

    h.gate(slow)
    await treeRow(page, slow).click()
    await page.locator('.nw-tree-skeleton').waitFor()
    await page.waitForTimeout(400)
    const skeleton = await page.locator('.nw-tree-skeleton').evaluate(node => ({ height: node.getBoundingClientRect().height, rows: [...node.children].map(child => child.getBoundingClientRect().height) }))
    assert.deepEqual(skeleton, { height: 56, rows: [28, 28] })
    await shot(page, 'skeleton')
    assert.ok(h.held.length)
    await treeRow(page, slow).click()
    fs.renameSync(path.join(fixture, '03慢目录/旧快照.md'), path.join(fixture, '03慢目录/新快照.md'))
    await treeRow(page, b).click()
    await treeRow(page, b + '/切换.md').waitFor()
    await treeRow(page, slow).click()
    await page.waitForTimeout(700)
    assert.ok(h.held.length >= 2)
    h.gate(undefined)
    h.held.pop()()
    await treeRow(page, slow + '/新快照.md').waitFor()
    for (const release of h.held.splice(0)) release()
    await idle(page)
    assert.equal(await treeRow(page, slow + '/旧快照.md').count(), 0)
    assert.equal(await treeRow(page, b).getAttribute('aria-expanded'), 'true')
    assert.equal(await page.locator('.nw-tree-row.is-selected').getAttribute('title'), selectedTitle)
    checks.slowAndOutOfOrder = true

    const watched = put('02目录B/监听新增.md')
    await treeRow(page, b + '/监听新增.md').waitFor()
    await treeRow(page, b + '/监听新增.md').click()
    await page.getByRole('textbox', { name: '文档正文', exact: true }).filter({ hasText: '初始内容' }).waitFor()
    fs.writeFileSync(watched, '# 验收\n\n监听修改后的内容。\n')
    await page.getByRole('textbox', { name: '文档正文', exact: true }).filter({ hasText: '监听修改后的内容' }).waitFor()
    fs.unlinkSync(watched)
    await treeRow(page, b + '/监听新增.md').waitFor({ state: 'hidden' })
    checks.liveCreateModifyDelete = true

    const empty = prefix + '/04空目录'
    h.fail(empty)
    await treeRow(page, empty).click()
    await page.getByRole('alert').filter({ hasText: '验收读取失败' }).waitFor()
    h.fail(undefined)
    await page.getByRole('button', { name: '刷新书房', exact: true }).click()
    await page.locator('.nw-tree-note').filter({ hasText: '空目录' }).waitFor()
    checks.errorAndManualRecovery = true

    for (const media of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: media, reducedMotion: 'reduce' })
      await page.waitForFunction(dark => document.body.hasAttribute('data-ds-dark-theme') === dark, media === 'dark')
      await treeRow(page, prefix + '/读我.md').click()
      await idle(page)
      const style = await page.locator('.nw-shelf-scroll').evaluate(scroll => {
        const selected = scroll.querySelector('.nw-tree-row.is-selected')
        const list = selected.closest('.nw-tree')
        const row = list.parentElement.querySelector(':scope > .nw-tree-row')
        const svg = row.querySelector('.nw-chevron').getBoundingClientRect()
        const guide = getComputedStyle(list, '::before'), bar = getComputedStyle(selected, '::before')
        return {
          heights: [...scroll.querySelectorAll('.nw-tree-row')].map(node => node.getBoundingClientRect().height),
          parentCenter: svg.x + svg.width / 2,
          guideCenter: list.getBoundingClientRect().x + parseFloat(guide.left) + .5,
          selectedCenter: selected.getBoundingClientRect().x + parseFloat(bar.left) + 1,
          animations: [...scroll.querySelectorAll('.nw-tree, .nw-chevron')].map(node => ({ animation: getComputedStyle(node).animationName, transition: getComputedStyle(node).transitionDuration })),
          icons: [...list.querySelectorAll(':scope > li > button')].filter(node => !node.hasAttribute('aria-expanded')).map(node => ({ name: node.querySelector('.nw-file-name').textContent, icon: node.querySelector('svg').getAttribute('class') })),
        }
      })
      assert.ok(style.heights.every(height => Math.abs(height - 28) < .5))
      assert.ok(Math.abs(style.parentCenter - style.guideCenter) < .6)
      assert.ok(Math.abs(style.selectedCenter - style.guideCenter) < .6)
      assert.ok(style.animations.every(value => value.animation === 'none' && value.transition.split(',').every(value => parseFloat(value) === 0)))
      assert.match(style.icons.find(value => value.name === '读我.md').icon, /lucide-file-text/)
      assert.match(style.icons.find(value => value.name === '笔记.txt').icon, /lucide-file-type/)
      assert.match(style.icons.find(value => value.name === '配置.json').icon, /lucide-file-code/)
      assert.equal(style.icons.find(value => value.name === '图片.png').icon, 'lucide lucide-file')
      report[media] = style
      await shot(page, 'tree-' + media)
    }
    checks.stylesAndReducedMotion = true
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    assert.notEqual(await page.locator('.nw-chevron').first().evaluate(node => getComputedStyle(node).transitionDuration), '0s')
    checks.normalMotionEnabled = true

    await page.getByRole('textbox', { name: '搜索书名或文件', exact: true }).fill(searchName)
    await page.locator('.nw-search-result').filter({ hasText: searchName }).waitFor()
    const searchY = (await page.locator('.nw-search-result').first().boundingBox()).y
    h.gateSearch(true)
    await page.getByRole('button', { name: '刷新书房', exact: true }).click()
    await page.waitForTimeout(500)
    assert.ok(h.held.length, 'search refresh must actually be held')
    assert.equal(await page.getByText('搜索中…', { exact: true }).count(), 0)
    assert.equal(await page.getByText('正在读取书房…', { exact: true }).count(), 0)
    assert.ok(Math.abs((await page.locator('.nw-search-result').first().boundingBox()).y - searchY) < .5)
    h.gateSearch(false)
    for (const release of h.held.splice(0)) release()
    await idle(page)
    checks.searchRefreshKeepsResults = true
    await h.context.close()
  }
  assert.deepEqual(report.errors, [])
  console.log(JSON.stringify({ ok: true, before: report.before.span, after: report.after.span, checks }, null, 2))
} catch (error) {
  report.failed = error instanceof Error ? error.stack : String(error)
  await activePage?.screenshot({ path: path.join(evidence, 'tree-failure.png') }).catch(() => {})
  console.error(error)
  process.exitCode = 1
} finally {
  fs.writeFileSync(path.join(evidence, 'tree-report.json'), JSON.stringify(report, null, 2) + '\n')
  await browser.close()
}
