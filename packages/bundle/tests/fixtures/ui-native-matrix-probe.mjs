/** Screenshot matrix for checking Scriptor surfaces against native DSH styling; only use the isolated fixture. */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

const runtimePath = path.resolve(process.argv[2])
const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8').replace(/^﻿/, ''))
const output = path.resolve(process.argv[3] ?? path.join(path.dirname(runtimePath), 'ui-matrix'))
fs.mkdirSync(output, { recursive: true })
const { chromium } = await import(pathToFileURL(path.join(process.env.WEBNOVEL_PLAYWRIGHT, 'index.mjs')).href)
const browser = await chromium.launch({ headless: true, executablePath: process.env.WEBNOVEL_CHROMIUM })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
page.setDefaultTimeout(15000)
const report = { shots: [], skipped: [], errors: [] }
page.on('pageerror', error => report.errors.push(error.message))
const save = () => fs.writeFileSync(path.join(output, 'ui-matrix-report.json'), JSON.stringify(report, null, 2) + '\n')

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
// A missing surface is recorded and skipped so one host difference does not hide the rest of the matrix.
async function step(name, run) {
  try { await run() } catch (error) {
    report.skipped.push({ name, error: String(error).split('\n')[0].slice(0, 300) }); save()
    await page.keyboard.press('Escape').catch(() => {})
  }
}
async function rightSidebar() {
  // Opening a document may expand the sidebar itself; the button can detach mid-click.
  const open = page.getByRole('button', { name: '打开右侧边栏', exact: true })
  if (await open.isVisible().catch(() => false)) await open.click({ timeout: 3000 }).catch(() => {})
  await settle()
}
async function theme(dark) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' })
  await page.waitForFunction(value => document.body.hasAttribute('data-ds-dark-theme') === value, dark, { timeout: 5000 }).catch(() => {})
  await settle()
}
async function contentFontSize(px) {
  await page.evaluate(value => document.body.style.setProperty('--dsh-content-font-size', value + 'px'), px)
  await settle()
}
async function openDraft() {
  await page.getByRole('tab', { name: '书房', exact: true }).click()
  const book = page.locator('.nw-book').filter({ hasText: '验收作品甲' })
  await book.getByRole('button', { name: /验收作品甲/ }).click()
  const drafts = book.getByRole('button', { name: /^草稿区/ })
  if (await drafts.getAttribute('aria-expanded') !== 'true') await drafts.click()
  const folder = book.getByRole('button', { name: '草稿', exact: true })
  if (await folder.getAttribute('aria-expanded') !== 'true') await folder.click()
  const chapter = book.getByRole('button', { name: '卷01-来信', exact: true })
  if (await chapter.getAttribute('aria-expanded') !== 'true') await chapter.click()
  await book.getByRole('button', { name: /^稿1.md/ }).click()
  await rightSidebar()
  await page.getByRole('textbox', { name: '文档正文', exact: true }).waitFor()
}
async function openSettingsModels() {
  // DSH 0.2.1 moves Settings into the sidebar's bottom More menu.
  const direct = page.getByRole('button', { name: '设置', exact: true })
  if (await direct.isVisible().catch(() => false)) await direct.click()
  else {
    await page.getByText('更多', { exact: true }).last().click()
    await page.getByText('设置', { exact: true }).last().click()
  }
  const dialog = page.getByRole('dialog').filter({ hasText: '通用设置' })
  await dialog.waitFor()
  await dialog.getByText('模型', { exact: true }).first().click()
  await dialog.getByText('混合检索 · 嵌入 API').first().scrollIntoViewIfNeeded()
}
// DSH Menu replaced the native select: open the trigger named by the choice, then pick the row.
async function choose(label, option) {
  await page.getByRole('button', { name: new RegExp('^' + label) }).click()
  await page.getByRole('menu').getByRole('menuitem', { name: option, exact: true }).click()
  await page.getByRole('menu').waitFor({ state: 'hidden' })
}
async function visual(view) {
  const tab = page.getByRole('tab', { name: '可视化', exact: true })
  if (await tab.isVisible().catch(() => false)) await tab.click()
  else {
    // Narrow conversation headers fold extra views into the overflow control after the last visible tab.
    await page.getByRole('tab', { name: '轨迹', exact: true }).locator('xpath=following::button[1]').click()
    await page.getByText('可视化', { exact: true }).last().click()
  }
  const choice = page.getByRole('button', { name: /^选择可视化作品/ })
  if (await choice.isVisible().catch(() => false)) await choose('选择可视化作品', '验收作品甲').catch(() => {})
  await page.getByRole('tab', { name: view, exact: true }).click()
  await page.getByRole('heading', { name: view }).first().waitFor()
}

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
  await openDraft()

  for (const dark of [false, true]) {
    const tone = dark ? 'dark' : 'light'
    await theme(dark)
    if (dark) {
      // Reload so folded turn and tool rows start from the same state as the light pass.
      await page.reload()
      await page.getByRole('tab', { name: '书房', exact: true }).waitFor({ timeout: 30000 })
      await openDraft().catch(() => {})
    }
    await step(`${tone}-workbench`, async () => { await page.getByRole('tab', { name: '书房', exact: true }).click(); await shot(`${tone}-workbench`) })
    await step(`${tone}-result-card`, async () => {
      await page.getByRole('tab', { name: '对话', exact: true }).click().catch(() => {})
      const heading = page.locator('.nw-result-heading').first()
      // Completed tool steps start folded under the turn's summary row, then each step under its own row.
      if (!await heading.isVisible().catch(() => false)) await page.getByText(/^已完成，用时/).first().click()
      await settle()
      if (!await heading.isVisible().catch(() => false)) await page.getByText('已调用工具', { exact: true }).first().click()
      await settle()
      await shot(`${tone}-turn-expanded`)
      if (!await heading.isVisible().catch(() => false)) await page.getByText(/选择作品|查看作品进度|查看写作状态/).first().click()
      await heading.waitFor()
      if (await heading.getAttribute('aria-expanded') !== 'true') await heading.click()
      await heading.scrollIntoViewIfNeeded()
      await shot(`${tone}-result-card`)
    })
    await step(`${tone}-editor-menu`, async () => {
      const editor = page.getByRole('textbox', { name: '文档正文', exact: true })
      await editor.click(); await editor.click({ button: 'right' })
      await page.getByRole('menu', { name: '编辑器菜单' }).waitFor()
      await shot(`${tone}-editor-menu`)
      await page.keyboard.press('Escape')
    })
    await step(`${tone}-index-panel`, async () => {
      const tab = page.getByRole('tab', { name: /检索索引/ }).first()
      if (!await tab.isVisible().catch(() => false)) {
        await page.getByRole('button', { name: '收起右侧边栏', exact: true }).click()
        await page.getByRole('button', { name: '查看检索索引', exact: true }).click()
      } else await tab.click()
      await page.getByRole('button', { name: /^选择索引作品/ }).waitFor()
      await choose('选择索引作品', '验收作品甲').catch(() => {})
      await shot(`${tone}-index-panel`)
      await page.getByRole('tab', { name: /稿1\.md/ }).first().click().catch(() => {})
    })
    for (const view of dark ? ['人物关系'] : ['写作流程', '人物关系', '章节进度']) {
      await step(`${tone}-viz-${view}`, async () => { await visual(view); await shot(`${tone}-viz-${view}`) })
    }
    await step(`${tone}-settings-models`, async () => {
      await openSettingsModels()
      await shot(`${tone}-settings-models`)
      await page.keyboard.press('Escape')
    })
    await page.getByRole('tab', { name: '对话', exact: true }).click().catch(() => {})
  }

  await theme(false)
  await page.setViewportSize({ width: 1100, height: 900 })
  await step('light-narrow-workbench', async () => { await page.getByRole('tab', { name: '书房', exact: true }).click(); await shot('light-narrow-workbench') })
  await step('light-narrow-viz-人物关系', async () => { await shot('light-narrow-header'); await visual('人物关系'); await shot('light-narrow-viz-人物关系') })
  await page.getByRole('tab', { name: '对话', exact: true }).click().catch(() => {})
  await page.setViewportSize({ width: 1440, height: 960 })
  for (const px of [10, 22]) {
    await step(`light-font-${px}`, async () => { await contentFontSize(px); await shot(`light-font-${px}-workbench`) })
  }
  await contentFontSize(14)
} catch (error) {
  report.failure = String(error)
  await page.screenshot({ path: path.join(output, 'ui-matrix-failure.png') }).catch(() => {})
} finally {
  save()
  await browser.close()
}
console.log(JSON.stringify({ output, shots: report.shots.length, skipped: report.skipped, errors: report.errors, failure: report.failure }, null, 2))
if (report.failure) process.exitCode = 1
