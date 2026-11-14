/** DSH ui-primitives in Scriptor: keyboard paths, host material and plugin-style isolation; only use the isolated fixture. */
import * as fs from 'node:fs'
import * as path from 'node:path'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const runtimePath = path.resolve(process.argv[2])
const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8').replace(/^\uFEFF/, ''))
const output = path.resolve(process.argv[3] ?? path.join(path.dirname(runtimePath), 'primitives'))
fs.mkdirSync(output, { recursive: true })
const { chromium } = await import(pathToFileURL(path.join(process.env.WEBNOVEL_PLAYWRIGHT, 'index.mjs')).href)
const browser = await chromium.launch({ headless: true, executablePath: process.env.WEBNOVEL_CHROMIUM })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
page.setDefaultTimeout(15000)
const report = { checks: {}, primitives: {}, leaks: {}, shots: [], errors: [] }
page.on('pageerror', error => report.errors.push(error.message))
const save = () => fs.writeFileSync(path.join(output, 'primitives-report.json'), JSON.stringify(report, null, 2) + '\n')

async function settle() {
  await page.waitForFunction(() => document.getAnimations().every(animation => {
    const timing = animation.effect && 'getTiming' in animation.effect ? animation.effect.getTiming() : null
    return (timing && (timing.iterations === Infinity || timing.iterations > 20)) || animation.playState !== 'running'
  }), null, { timeout: 3000 }).catch(() => {})
  await page.waitForTimeout(300)
}
async function shot(name) {
  await settle()
  await page.screenshot({ path: path.join(output, name + '.png') })
  report.shots.push(name); save()
}
async function theme(dark) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })
  await page.waitForFunction(value => document.body.hasAttribute('data-ds-dark-theme') === value, dark, { timeout: 5000 }).catch(() => {})
  await settle()
}
const focusedLabel = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim() ?? '')
async function choose(label, option) {
  await page.getByRole('button', { name: new RegExp('^' + label) }).click()
  await page.getByRole('menu').getByRole('menuitem', { name: option, exact: true }).click()
  await page.getByRole('menu').waitFor({ state: 'hidden' })
}
async function openDraft() {
  await page.getByRole('tab', { name: '书房', exact: true }).click()
  const book = page.locator('.nw-book').filter({ hasText: '验收作品甲' })
  const drafts = book.getByRole('button', { name: /^草稿区/ })
  if (!await drafts.isVisible().catch(() => false)) await book.getByRole('button', { name: /验收作品甲/ }).click()
  if (await drafts.getAttribute('aria-expanded') !== 'true') await drafts.click()
  const folder = book.getByRole('button', { name: '草稿', exact: true })
  if (await folder.getAttribute('aria-expanded') !== 'true') await folder.click()
  const chapter = book.getByRole('button', { name: '卷01-来信', exact: true })
  if (await chapter.getAttribute('aria-expanded') !== 'true') await chapter.click()
  await book.getByRole('button', { name: /^稿1.md/ }).click()
  const open = page.getByRole('button', { name: '打开右侧边栏', exact: true })
  if (await open.isVisible().catch(() => false)) await open.click({ timeout: 3000 }).catch(() => {})
  await page.getByRole('textbox', { name: '文档正文', exact: true }).waitFor()
}
async function openIndex() {
  await page.getByRole('tab', { name: '书房', exact: true }).click()
  const tab = page.getByRole('tab', { name: /检索索引/ }).first()
  if (await tab.isVisible().catch(() => false)) await tab.click()
  else await page.getByRole('button', { name: '查看检索索引', exact: true }).click()
  await page.getByRole('button', { name: /^选择索引作品/ }).waitFor()
}
async function openVisual() {
  await page.getByRole('tab', { name: '可视化', exact: true }).click()
  await page.getByRole('tablist', { name: '可视化视图' }).waitFor()
}

/*
 * A primitive's first class is its CSS Module class (`_button_1rv3m_2`); our classes only follow it. With the
 * plugin stylesheet on and off, the box a primitive draws must not change. Inherited text properties and
 * flex blockification are not leaks; heights are compared only where DSH fixes them.
 */
const leaks = state => page.evaluate(() => {
  // Border width and style only: the shorthand also carries currentColor, which is inherited text colour.
  const BOX = ['box-sizing', 'min-height', 'padding', 'border-width', 'border-style', 'border-radius', 'background-color', 'gap', 'box-shadow']
  const FIXED = /^(button|wrap|pill|tab|tag|checkbox|control|tabs|dot|icon)$/
  const plugin = document.querySelector('style[data-webnovel]')
  const found = [...document.querySelectorAll('.webnovel *')].filter(node => /^_[A-Za-z]+_[\w]+_\d+$/.test(node.classList[0] ?? '') && node.getClientRects().length > 0)
  const kind = node => node.classList[0].split('_')[1]
  const props = node => kind(node) === 'surface' ? ['border-radius', 'background-color'] : FIXED.test(kind(node)) ? [...BOX, 'height'] : BOX
  const pick = node => Object.fromEntries(props(node).map(name => [name, getComputedStyle(node).getPropertyValue(name)]))
  const before = found.map(pick)
  plugin.disabled = true
  const after = found.map(pick)
  plugin.disabled = false
  const counts = {}
  for (const node of found) counts[kind(node)] = (counts[kind(node)] ?? 0) + 1
  // `min-height: auto` is how a flex item reports 0; it flips with our container's display, not with the primitive.
  const same = (name, a, b) => a === b || (name === 'min-height' && [a, b].every(value => value === 'auto' || value === '0px'))
  const diffs = found.map((node, index) => ({
    kind: kind(node), label: (node.getAttribute('aria-label') || node.textContent || '').trim().slice(0, 30),
    diff: Object.fromEntries(Object.keys(before[index]).filter(name => !same(name, before[index][name], after[index][name])).map(name => [name, { plugin: before[index][name], dsh: after[index][name] }])),
  })).filter(entry => Object.keys(entry.diff).length)
  return { counts, diffs }
}).then(result => { report.primitives[state] = result.counts; report.leaks[state] = result.diffs; save(); return result })

try {
  let url
  for (let i = 0; i < 160 && !url; i++) {
    url = fs.readFileSync(path.join(runtime.root, 'stdout.log'), 'utf8').match(/dsh web: (http\S+)/)?.[1]
    if (!url) await new Promise(resolve => setTimeout(resolve, 250))
  }
  if (!url) throw new Error('DSH web address not found in stdout.log')
  await page.goto(url)
  await page.getByRole('tab', { name: '书房', exact: true }).waitFor({ timeout: 30000 })
  const welcome = page.getByRole('button', { name: '继续', exact: true })
  await welcome.waitFor({ timeout: 5000 }).catch(() => {})
  if (await welcome.isVisible()) await welcome.click()
  await theme(false)
  await page.getByRole('tab', { name: '工作区', exact: true }).click()
  const workspace = page.getByRole('treeitem', { name: /^S5 临时验收书房/ }).first()
  await workspace.waitFor()
  if (await workspace.getAttribute('aria-expanded') === 'false') await workspace.click()
  await page.getByText(/^(写作交互演示 · DSH 0\.2|S6 后台索引验收|S5 书房验收)$/).first().click()
  await page.getByRole('tab', { name: '书房', exact: true }).click()
  await page.locator('.nw-study').waitFor()

  // Study tabs are DSH SegmentedTabs: arrows move the selection, each tab owns its panel.
  const navigation = page.getByRole('tablist', { name: '导航分类' })
  await navigation.getByRole('tab', { name: '书房', exact: true }).focus()
  await page.keyboard.press('ArrowLeft')
  assert.equal(await navigation.getByRole('tab', { name: '工作区', exact: true }).getAttribute('aria-selected'), 'true')
  const workspacePanel = await navigation.getByRole('tab', { name: '工作区', exact: true }).getAttribute('aria-controls')
  assert.equal(await page.locator(`[id="${workspacePanel}"]`).isVisible(), true)
  await page.keyboard.press('ArrowRight')
  assert.equal(await navigation.getByRole('tab', { name: '书房', exact: true }).getAttribute('aria-selected'), 'true')
  report.checks.studyTabs = true

  await openIndex()
  await leaks('study-and-index')

  // Select menu: Enter opens, arrows walk, Enter picks and returns focus, Escape closes without picking.
  const bookTrigger = page.getByRole('button', { name: /^选择索引作品/ })
  // The trigger stays disabled until the shelf has books to offer.
  await page.waitForFunction(() => document.querySelector('[aria-haspopup=menu][aria-label^="选择索引作品"]')?.disabled === false)
  await bookTrigger.focus()
  await page.keyboard.press('Enter')
  const menu = page.getByRole('menu')
  await menu.waitFor()
  assert.equal(await bookTrigger.getAttribute('aria-expanded'), 'true')
  await shot('light-select-menu')
  const rows = await menu.getByRole('menuitem').allTextContents()
  assert.ok(rows.length >= 2)
  await page.keyboard.press('ArrowDown')
  await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'menuitem')
  assert.equal(await focusedLabel(), rows[0])
  await page.keyboard.press('ArrowDown')
  assert.equal(await focusedLabel(), rows[1])
  await page.keyboard.press('Enter')
  await menu.waitFor({ state: 'hidden' })
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.startsWith('选择索引作品'))
  assert.equal(await bookTrigger.getAttribute('aria-label'), '选择索引作品：' + rows[1])
  await page.keyboard.press('Enter')
  await menu.waitFor()
  await page.keyboard.press('Escape')
  await menu.waitFor({ state: 'hidden' })
  assert.equal(await focusedLabel(), '选择索引作品：' + rows[1])
  report.selectRows = rows
  await choose('选择索引作品', '验收作品甲')
  report.checks.selectMenu = true; save()

  await openVisual()
  await choose('选择可视化作品', '验收作品甲')
  await leaks('visual-workflow')

  // Hint tooltip: keyboard focus shows it, Escape puts it away, moving to another control and back shows it again.
  await page.getByRole('button', { name: /^选择可视化作品/ }).focus()
  await page.keyboard.press('Tab')
  assert.equal(await focusedLabel(), '打开视图设置')
  await page.keyboard.press('Tab')
  assert.equal(await focusedLabel(), '刷新作品视图')
  const tip = page.getByRole('tooltip').filter({ hasText: '刷新作品视图' })
  await tip.waitFor()
  await shot('light-tooltip')
  await page.keyboard.press('Escape')
  await tip.waitFor({ state: 'hidden' })
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  assert.equal(await focusedLabel(), '刷新作品视图')
  await tip.waitFor()
  report.checks.tooltipEscape = true; save()

  // View switch is DSH SegmentedControl: arrows select and move focus, the panel follows the selected tab.
  const views = page.getByRole('tablist', { name: '可视化视图' })
  await views.getByRole('tab', { name: '进度', exact: true }).focus()
  await page.keyboard.press('ArrowLeft')
  await page.locator('.nw-reader[aria-busy="false"] .nw-g6-map[data-ready="true"]').waitFor()
  const graphTab = views.getByRole('tab', { name: '关系', exact: true })
  assert.equal(await graphTab.getAttribute('aria-selected'), 'true')
  assert.equal(await focusedLabel(), '关系')
  assert.equal(await page.locator(`[id="${await graphTab.getAttribute('aria-controls')}"]`).count(), 1)
  report.checks.segmentedControl = true

  // Checkbox: Space toggles the graph filter and back.
  await page.getByText('阅读范围', { exact: true }).click()
  const plans = page.getByRole('checkbox', { name: '包括计划资料', exact: true })
  await plans.waitFor()
  const planned = await plans.isChecked()
  await plans.focus()
  await page.keyboard.press('Space')
  await page.waitForFunction(value => document.querySelector('input[type=checkbox]:focus')?.checked === !value, planned)
  await page.keyboard.press('Space')
  await page.waitForFunction(value => document.querySelector('input[type=checkbox]:focus')?.checked === value, planned)
  report.checks.checkbox = true
  await leaks('visual-graph')
  await views.getByRole('tab', { name: '进度', exact: true }).click()
  await page.getByRole('heading', { name: '章节进度', exact: true }).waitFor()
  await page.locator('.nw-chapter-line').first().waitFor()
  await leaks('visual-chapters')
  save()

  // Editor context menu on DSH MenuSurface: Right/Left enter and leave the submenu, Escape returns to the text.
  await openDraft()
  const editor = page.getByRole('textbox', { name: '文档正文', exact: true })
  await editor.click(); await editor.click({ button: 'right' })
  const editorMenu = page.getByRole('menu', { name: '编辑器菜单' })
  await editorMenu.waitFor()
  assert.equal(await editorMenu.getAttribute('data-menu-material'), 'translucent')
  await shot('light-editor-menu')
  await leaks('editor-menu')
  await editorMenu.getByRole('menuitem', { name: '段落格式', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '章标题')
  await page.keyboard.press('ArrowLeft')
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '段落格式')
  assert.equal(await page.getByRole('menuitem', { name: '章标题', exact: true }).count(), 0)
  await page.keyboard.press('ArrowDown')
  assert.equal(await focusedLabel(), '查找替换')
  await page.keyboard.press('Escape')
  await editorMenu.waitFor({ state: 'hidden' })
  await page.waitForFunction(() => !!document.activeElement?.closest('.cm-editor'))
  report.checks.editorMenu = true

  // Find panel inputs are DSH Input.
  await page.keyboard.press('Control+f')
  await page.getByRole('search', { name: '查找替换' }).waitFor()
  await leaks('editor-find')
  await page.keyboard.press('Escape')
  await page.getByRole('search', { name: '查找替换' }).waitFor({ state: 'hidden' })

  // Save notice is DSH Toast: top-centred over the editor pane, gone after its hold and fade.
  await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('\n控件验收标记' + Date.now())
  await page.keyboard.press('Control+s')
  const toast = page.locator('body > [role="alert"]').filter({ hasText: /文件已保存/ })
  await toast.waitFor({ timeout: 20000 })
  const shown = Date.now()
  const placement = await page.evaluate(() => {
    const banner = [...document.querySelectorAll('body > [role="alert"]')].find(node => /文件已保存/.test(node.textContent ?? ''))
    const box = banner.getBoundingClientRect(), pane = document.querySelector('.nw-focus').getBoundingClientRect()
    return { top: Math.round(box.top), center: Math.round(box.left + box.width / 2), paneCenter: Math.round(pane.left + pane.width / 2) }
  })
  await page.screenshot({ path: path.join(output, 'light-toast.png') }); report.shots.push('light-toast')
  // A save that writes a new draft remounts the editor and re-announces once; wait until no banner is left.
  await page.waitForFunction(() => {
    const live = [...document.querySelectorAll('body > [role="alert"]')].some(node => /文件已保存/.test(node.textContent ?? ''))
    const state = window.__toastGone ??= { since: 0 }
    if (live) state.since = 0
    else if (!state.since) state.since = performance.now()
    return !live && performance.now() - state.since > 300
  }, null, { timeout: 10000, polling: 100 })
  report.toast = { ...placement, visibleMs: Date.now() - shown - 300 }
  assert.ok(placement.top < 80, 'toast sits at the top')
  assert.ok(Math.abs(placement.center - placement.paneCenter) <= 3, 'toast centres on the editor pane')
  assert.ok(report.toast.visibleMs >= 1500 && report.toast.visibleMs <= 6000, 'toast holds and fades')
  report.checks.toast = true; save()

  // Dark theme: the same controls take DSH's dark material.
  await theme(true)
  await openIndex()
  await page.getByRole('button', { name: /^选择索引作品/ }).click()
  await page.getByRole('menu').waitFor()
  await shot('dark-select-menu')
  await page.keyboard.press('Escape')
  await leaks('dark-study-and-index')
  await openVisual()
  await page.getByRole('tablist', { name: '可视化视图' }).getByRole('tab', { name: '关系', exact: true }).click()
  await page.locator('.nw-reader[aria-busy="false"] .nw-g6-map[data-ready="true"]').waitFor()
  await shot('dark-visual-graph')
  await theme(false)

  const seen = Object.values(report.primitives).flatMap(counts => Object.keys(counts))
  for (const kind of ['button', 'wrap', 'checkbox', 'pill', 'tab', 'tag', 'path', 'surface']) assert.ok(seen.includes(kind), 'primitive rendered: ' + kind)
  assert.ok(seen.includes('dot') || seen.includes('spinner'), 'primitive rendered: StateDot')
  const leaked = Object.entries(report.leaks).filter(([, entries]) => entries.length)
  assert.deepEqual(leaked, [], 'plugin styles reach primitive boxes')
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) {
  report.failure = String(error)
  await page.screenshot({ path: path.join(output, 'primitives-failure.png') }).catch(() => {})
} finally {
  save()
  await browser.close()
}
console.log(JSON.stringify({ output, passed: report.passed ?? false, failure: report.failure, checks: report.checks, toast: report.toast, leaks: report.leaks }, null, 2))
if (!report.passed) process.exitCode = 1
