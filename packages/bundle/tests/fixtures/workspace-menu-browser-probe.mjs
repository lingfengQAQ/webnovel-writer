/** Run against start-study-check.mjs's isolated DSH profile, never a user profile. */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const runtimePath = path.resolve(process.argv[2])
const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8').replace(/^\uFEFF/, ''))
assert.equal(path.basename(runtime.root).startsWith('webnovel-browser-'), true)
const evidence = path.dirname(runtimePath)
const { chromium } = await import(pathToFileURL(path.join(process.env.WEBNOVEL_PLAYWRIGHT, 'index.mjs')).href)
const browser = await chromium.launch({ headless: true, executablePath: process.env.WEBNOVEL_CHROMIUM })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
page.setDefaultTimeout(15000)
const report = { checks: [], pageErrors: [] }
page.on('pageerror', error => report.pageErrors.push(error.message))
const title = 'S5 会话隔离验收'
const renamed = title + '（菜单回归）'
const row = name => page.getByRole('treeitem').filter({ has: page.getByText(name, { exact: true }) })
const openMenu = async name => {
  await row(name).hover()
  await page.getByRole('button', { name: `会话“${name}”的操作`, exact: true }).click()
  await page.getByRole('menu').waitFor()
}
const rename = async (from, to) => {
  await openMenu(from)
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click()
  await page.getByRole('menu').waitFor({ state: 'hidden' })
  const dialog = page.getByRole('dialog', { name: '重命名会话' })
  await dialog.getByRole('textbox', { name: '会话名称' }).fill(to)
  await dialog.getByRole('button', { name: '重命名', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  await row(to).waitFor()
}
try {
  const url = fs.readFileSync(path.join(runtime.root, 'stdout.log'), 'utf8').match(/dsh web: (http\S+)/)?.[1]
  assert.ok(url, 'Acceptance host is not ready')
  await page.goto(url)
  await page.getByRole('tab', { name: '工作区', exact: true }).waitFor({ timeout: 30000 })
  const welcome = page.getByRole('button', { name: '继续', exact: true })
  await welcome.waitFor({ timeout: 3000 }).catch(() => {})
  if (await welcome.isVisible()) await welcome.click()
  await page.getByRole('tab', { name: '工作区', exact: true }).click()
  const group = page.getByRole('treeitem', { name: /^S5 空工作范围/ })
  if (await group.getAttribute('aria-expanded') === 'false') await group.click()
  await openMenu(title)
  for (const name of ['置顶会话', '重命名', '分叉会话', '归档会话']) {
    const item = page.getByRole('menuitem', { name, exact: true })
    await item.waitFor()
    assert.equal(await item.evaluate(element => {
      const box = element.getBoundingClientRect()
      return box.height > 0 && element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
    }), true, `${name} must be painted and reachable`)
  }
  report.menu = await page.getByRole('menu').evaluate(element => ({ text: element.textContent, height: element.getBoundingClientRect().height, insideSidebar: !!element.closest('.nw-left') }))
  assert.equal(report.menu.insideSidebar, false)
  await page.screenshot({ path: path.join(evidence, 'workspace-menu.png'), fullPage: true })
  report.checks.push('native menu items are visible outside the clipping sidebar')
  await page.keyboard.press('Escape')
  await rename(title, renamed)
  report.checks.push('rename dialog receives the session and commits the new title')

  await openMenu(renamed)
  await page.getByRole('menuitem', { name: '置顶会话', exact: true }).click()
  await page.getByRole('menu').waitFor({ state: 'hidden' })
  await row(renamed).hover()
  await row(renamed).getByRole('button', { name: '取消置顶', exact: true }).click()
  await row(renamed).getByRole('button', { name: '置顶会话', exact: true }).waitFor()
  report.checks.push('menu pin and native inline unpin both work')

  await openMenu(renamed)
  await page.getByRole('menuitem', { name: '归档会话', exact: true }).click()
  await row(renamed).waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '视图选项', exact: true }).click()
  await page.getByText('全部对话（显示已归档）', { exact: true }).click()
  await row(renamed).waitFor()
  await openMenu(renamed)
  await page.getByRole('menuitem', { name: '取消归档', exact: true }).click()
  await row(renamed).hover()
  await row(renamed).getByRole('button', { name: '归档会话', exact: true }).waitFor()
  await rename(renamed, title)
  report.checks.push('archive, show archived and unarchive preserve native behavior')

  await page.getByRole('tab', { name: '书房', exact: true }).click()
  assert.equal(await page.locator('.nw-native-workspaces').isVisible(), false)
  await page.getByRole('tab', { name: '工作区', exact: true }).click()
  await page.setViewportSize({ width: 1100, height: 720 })
  await openMenu(title)
  await page.getByRole('menuitem', { name: '重命名', exact: true }).waitFor()
  await page.screenshot({ path: path.join(evidence, 'workspace-menu-narrow.png'), fullPage: true })
  report.checks.push('tab switching and narrower windows preserve menu contents')
  assert.deepEqual(report.pageErrors, [])
  report.ok = true
} catch (error) {
  report.error = String(error)
  await page.screenshot({ path: path.join(evidence, 'workspace-menu-failure.png'), fullPage: true }).catch(() => {})
  throw error
} finally {
  fs.writeFileSync(path.join(evidence, 'workspace-menu-report.json'), JSON.stringify(report, null, 2) + '\n')
  await browser.close()
}
