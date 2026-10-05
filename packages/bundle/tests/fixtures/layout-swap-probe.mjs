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
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })

async function shot(name) {
  await page.waitForFunction(() => document.getAnimations().every(animation => {
    const timing = animation.effect && 'getTiming' in animation.effect ? animation.effect.getTiming() : null
    if (timing && (timing.iterations === Infinity || timing.iterations > 20)) return true
    return animation.playState !== 'running'
  }), null, { timeout: 3000 }).catch(() => {})
  await page.waitForTimeout(200)
  await page.screenshot({ path: path.join(evidence, name) })
}
const swapButton = () => page.getByRole('button', { name: /把对话移/ })
async function placeCount() {
  return page.evaluate(() => window.__webnovelSwapPlaces ?? 0)
}
async function expandWorkspace(name) {
  const group = page.locator('[role="treeitem"][aria-expanded]').filter({ has: page.getByText(name, { exact: true }) })
  await group.waitFor({ timeout: 8000 })
  if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
}
async function openAcceptanceSession() {
  if (!await page.getByRole('tab', { name: '工作区', exact: true }).isVisible()) {
    const expand = page.getByRole('button', { name: '展开书房', exact: true })
    if (await expand.isVisible()) await expand.click()
    else await page.getByRole('button', { name: '打开侧边栏', exact: true }).click()
  }
  await page.getByRole('tab', { name: '工作区', exact: true }).click()
  await expandWorkspace('S5 临时验收书房')
  await page.getByText('S5 书房验收', { exact: true }).click()
}

async function waitForLayout() {
  await page.waitForFunction(() => {
    const frame = document.querySelector('[data-rightbar-col]')?.parentElement
    if (frame?.hasAttribute('data-animating')) return false
    return document.getAnimations().every(animation => {
      const timing = animation.effect && 'getTiming' in animation.effect ? animation.effect.getTiming() : null
      if (timing && (timing.iterations === Infinity || timing.iterations > 20)) return true
      return animation.playState !== 'running'
    })
  }, null, { timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(200)
}

async function columns() {
  return page.evaluate(() => {
    const rightbar = document.querySelector('[data-rightbar-col]')
    const frame = rightbar?.parentElement ?? null
    const center = rightbar?.previousElementSibling ?? null
    const box = (element) => {
      const rect = element.getBoundingClientRect()
      return { x: rect.x, width: rect.width, right: rect.right }
    }
    return {
      swapped: document.documentElement.hasAttribute('data-webnovel-swap'),
      collapsed: !!frame?.hasAttribute('data-rightbar-collapsed'),
      fullscreen: !!frame?.hasAttribute('data-rightbar-fullscreen'),
      center: center ? box(center) : null,
      rightbar: rightbar ? box(rightbar) : null,
    }
  })
}

async function dragDivider(y, dx) {
  const handle = page.locator('[data-side="rightbar"]')
  const box = await handle.boundingBox()
  if (!box) throw new Error('right divider missing')
  const x = box.x + box.width / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y, { steps: 12 })
  await page.mouse.up()
  await waitForLayout()
}

try {
  const url = fs.readFileSync(path.join(runtime.root, 'stdout.log'), 'utf8').match(/dsh web: (http\S+)/)?.[1]
  if (!url) throw new Error('Acceptance host is not ready')
  await page.goto(url)
  await page.waitForFunction(() => {
    const names = [...document.querySelectorAll('[role="tab"]')].map(tab => tab.textContent?.trim())
    return names.includes('书房') || names.includes('工作区')
  }, null, { timeout: 30000 })
  const welcome = page.getByRole('button', { name: '继续', exact: true })
  await welcome.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
  if (await welcome.isVisible()) { await welcome.click(); await welcome.waitFor({ state: 'hidden' }) }
  await openAcceptanceSession()
  const expandRight = page.getByRole('button', { name: '打开右侧边栏', exact: true })
  if (await expandRight.isVisible()) { await expandRight.click(); await waitForLayout() }
  await page.locator('[data-rightbar-col]').waitFor({ state: 'visible', timeout: 8000 })
  await swapButton().waitFor({ timeout: 8000 })
  const checks = {}
  const flood = await page.evaluate(async () => {
    const before = window.__webnovelSwapPlaces ?? 0
    const column = document.querySelector('[data-rightbar-col]')?.previousElementSibling
    const target = column?.querySelector('[data-conversation-scroll]') ?? column
    if (!target) return { before, after: before, inserted: 0, delta: -1 }
    const host = document.createElement('div')
    host.setAttribute('data-swap-flood', '')
    host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none'
    target.append(host)
    for (let index = 0; index < 40; index += 1) {
      const node = document.createElement('div')
      node.textContent = `flood ${index} `.repeat(8)
      host.append(node)
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    }
    await new Promise(resolve => setTimeout(resolve, 80))
    const after = window.__webnovelSwapPlaces ?? 0
    host.remove()
    return { before, after, inserted: 40, delta: after - before }
  })
  assert.ok(flood.delta >= 0 && flood.delta <= 3, `conversation inserts must not retrigger place, delta=${flood.delta}`)
  checks.placeBound = flood
  const before = await columns()
  assert.equal(before.swapped, false)
  assert.ok(before.center && before.rightbar && before.center.x < before.rightbar.x, 'host order puts the conversation left of the sidebar')
  await waitForLayout()
  await shot('layout-before.png')
  checks.hostOrder = true

  await swapButton().click()
  await waitForLayout()
  const swapped = await columns()
  assert.equal(swapped.swapped, true)
  assert.equal(await swapButton().getAttribute('aria-pressed'), 'true')
  assert.equal(await swapButton().getAttribute('aria-label'), '把对话移回中间')
  assert.ok(swapped.center && swapped.rightbar)
  assert.ok(swapped.center.x > swapped.rightbar.x, 'conversation moves to the right')
  assert.ok(Math.abs(swapped.center.width - before.rightbar.width) < 12, 'conversation takes the old sidebar width')
  assert.ok(swapped.rightbar.width >= 400, 'sidebar column keeps the center minimum')
  const buttonBox = await swapButton().boundingBox()
  const handleBox = await page.locator('[data-side="rightbar"]').boundingBox()
  assert.ok(buttonBox && handleBox)
  assert.ok(Math.abs((buttonBox.x + buttonBox.width / 2) - (handleBox.x + handleBox.width / 2)) < 8, 'button sits on the divider')
  assert.ok(buttonBox.width <= 24 && buttonBox.height <= 24)
  const hits = await page.evaluate(({ above, below, midX, midY }) => {
    const name = (x, y) => {
      const node = document.elementFromPoint(x, y)
      return {
        side: node?.closest('[data-side]')?.getAttribute('data-side') ?? '',
        label: node?.closest('button')?.getAttribute('aria-label') ?? '',
      }
    }
    return { above: name(midX, above), below: name(midX, below), button: name(midX, midY) }
  }, {
    above: buttonBox.y - 28,
    below: buttonBox.y + buttonBox.height + 28,
    midX: buttonBox.x + buttonBox.width / 2,
    midY: buttonBox.y + buttonBox.height / 2,
  })
  assert.equal(hits.button.label, '把对话移回中间')
  assert.equal(hits.above.side, 'rightbar', 'divider above the button still receives the pointer')
  assert.equal(hits.below.side, 'rightbar', 'divider below the button still receives the pointer')
  checks.dividerHits = hits
  const widthHandle = await page.evaluate(() => {
    const handle = document.querySelector('[data-conversation-content] > [data-width-handle]')
    return handle ? getComputedStyle(handle).display : 'absent'
  })
  assert.ok(widthHandle === 'none' || widthHandle === 'absent', 'swapped conversation hides the content-width handle')
  checks.widthHandle = widthHandle
  await shot('layout-after.png')
  checks.swapped = true

  const above = buttonBox.y - 28
  const below = buttonBox.y + buttonBox.height + 28
  const wide = swapped.center.width
  const placesBeforeDrag = await placeCount()
  await dragDivider(above, -70)
  const dragged = await columns()
  assert.ok(dragged.center && dragged.center.width > wide + 20, 'dragging above the button widens the conversation')
  await dragDivider(below, 40)
  const draggedBack = await columns()
  assert.ok(draggedBack.center && draggedBack.center.width < dragged.center.width - 10, 'dragging below the button still moves the conversation')
  const placesAfterDrag = await placeCount()
  assert.ok(placesAfterDrag > placesBeforeDrag, 'resizing the frame still moves the button')
  checks.dragRightColumn = true
  checks.placeOnResize = { before: placesBeforeDrag, after: placesAfterDrag }

  await swapButton().click()
  await waitForLayout()
  const restored = await columns()
  assert.equal(restored.swapped, false)
  assert.ok(restored.center && restored.rightbar && restored.center.x < restored.rightbar.x)
  checks.restored = true
  await swapButton().click()
  await waitForLayout()

  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForFunction(() => document.body.hasAttribute('data-ds-dark-theme'), null, { timeout: 8000 })
  await waitForLayout()
  await shot('layout-dark.png')
  checks.dark = true
  await page.emulateMedia({ colorScheme: 'light' })
  await page.waitForFunction(() => !document.body.hasAttribute('data-ds-dark-theme'))

  await page.getByRole('button', { name: '收起右侧边栏', exact: true }).click()
  await page.locator('[data-rightbar-collapsed]').waitFor()
  await waitForLayout()
  assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-webnovel-swap')), true)
  assert.equal(await swapButton().count(), 0)
  const collapsed = await columns()
  assert.equal(collapsed.collapsed, true)
  assert.ok(collapsed.center && collapsed.rightbar && collapsed.center.width > collapsed.rightbar.width)
  await shot('layout-collapsed.png')
  checks.collapsedFallback = true
  await page.getByRole('button', { name: '打开右侧边栏', exact: true }).click()
  await page.locator('[data-rightbar-collapsed]').waitFor({ state: 'hidden' })
  await waitForLayout()
  await swapButton().waitFor()
  const recollapsed = await columns()
  assert.ok(recollapsed.center && recollapsed.rightbar && recollapsed.center.x > recollapsed.rightbar.x)
  checks.collapseRestores = true

  const fullscreen = page.getByRole('button', { name: '全屏', exact: true })
  await fullscreen.click()
  await page.locator('[data-rightbar-fullscreen]').waitFor()
  await waitForLayout()
  assert.equal(await swapButton().count(), 0)
  await shot('layout-fullscreen.png')
  checks.fullscreenFallback = true
  await page.getByRole('button', { name: '退出全屏', exact: true }).click()
  await page.locator('[data-rightbar-fullscreen]').waitFor({ state: 'hidden' })
  await waitForLayout()
  await swapButton().waitFor()
  checks.fullscreenRestores = true

  await page.getByRole('button', { name: '插件', exact: true }).click()
  await page.locator('[data-rightbar-collapsed]').waitFor({ timeout: 8000 })
  await waitForLayout()
  assert.equal(await swapButton().count(), 0)
  await shot('layout-plugin.png')
  checks.pluginFallback = true
  await openAcceptanceSession()
  const reopen = page.getByRole('button', { name: '打开右侧边栏', exact: true })
  if (await reopen.isVisible()) await reopen.click()
  await waitForLayout()
  await swapButton().waitFor()
  const afterPlugin = await columns()
  assert.ok(afterPlugin.center && afterPlugin.rightbar && afterPlugin.center.x > afterPlugin.rightbar.x)
  checks.pluginRestores = true

  await page.setViewportSize({ width: 720, height: 800 })
  await page.locator('[data-rightbar-collapsed]').waitFor({ timeout: 8000 })
  await waitForLayout()
  assert.equal(await swapButton().count(), 0)
  await shot('layout-narrow.png')
  checks.narrowFallback = true
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.locator('[data-rightbar-collapsed]').waitFor({ state: 'hidden', timeout: 8000 })
  await waitForLayout()
  await swapButton().waitFor()
  const widened = await columns()
  assert.ok(widened.center && widened.rightbar && widened.center.x > widened.rightbar.x && widened.rightbar.width >= 400)
  checks.narrowRestores = true

  await page.getByRole('tab', { name: '书房', exact: true }).click()
  const book = page.locator('.nw-book').filter({ hasText: '验收作品甲' })
  await book.getByRole('button', { name: /验收作品甲/ }).click()
  await book.getByRole('button', { name: /^草稿区/ }).click()
  await book.getByRole('button', { name: '草稿', exact: true }).click()
  await book.getByRole('button', { name: '卷01-来信', exact: true }).click()
  await book.getByRole('button', { name: /^稿1.md/ }).click()
  await page.getByRole('tab', { name: /稿1\.md/ }).first().waitFor()
  await page.getByRole('tab', { name: '书房', exact: true }).click()
  await page.getByRole('button', { name: '知识库', exact: true }).click()
  await page.getByRole('button', { name: '写作笔记.md', exact: true }).click()
  await page.getByRole('tab', { name: /写作笔记\.md/ }).first().waitFor()
  await page.getByRole('tab', { name: /稿1\.md/ }).first().click()
  await page.getByRole('tab', { name: /稿1\.md/ }).first().waitFor()
  checks.tabSwitch = true
  await page.getByText('打开原文', { exact: true }).first().click()
  await page.getByRole('tab', { name: /稿1\.md/ }).first().waitFor()
  checks.fileLink = true
  const composer = page.locator('[contenteditable="true"]:not([aria-label="文档正文"])').filter({ visible: true }).first()
  await composer.click()
  const sent = `互换布局发送 ${Date.now()}`
  await page.keyboard.insertText(sent)
  const send = page.getByRole('button', { name: '发送消息', exact: true })
  if (await send.isVisible()) await send.click()
  else await page.keyboard.press('Enter')
  await page.getByText(sent, { exact: true }).waitFor({ timeout: 10000 })
  checks.send = true
  await page.getByRole('tab', { name: '工作区', exact: true }).click()
  await expandWorkspace('S5 空工作范围')
  await page.getByText('S5 会话隔离验收', { exact: true }).click()
  await page.getByText('确认这个工作范围是空的。', { exact: false }).waitFor({ timeout: 8000 })
  assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-webnovel-swap')), true)
  await page.getByRole('tab', { name: '工作区', exact: true }).click()
  await expandWorkspace('S5 临时验收书房')
  await page.getByText('S5 书房验收', { exact: true }).click()
  await swapButton().waitFor({ timeout: 8000 })
  checks.sessionSwitch = true

  await page.reload()
  await page.getByRole('tab', { name: '书房', exact: true }).waitFor({ timeout: 30000 })
  if (await expandRight.isVisible()) await expandRight.click()
  await waitForLayout()
  await swapButton().waitFor()
  const reloaded = await columns()
  assert.equal(reloaded.swapped, true)
  assert.equal(await swapButton().getAttribute('aria-label'), '把对话移回中间')
  assert.ok(reloaded.center && reloaded.rightbar && reloaded.center.x > reloaded.rightbar.x)
  checks.reloadKeepsPreference = true

  const removed = await page.evaluate(() => {
    const column = document.querySelector('[data-rightbar-col]')
    if (!column) return null
    column.setAttribute('data-swap-probe-col', '')
    column.removeAttribute('data-rightbar-col')
    const frame = column.parentElement
    const center = column.previousElementSibling
    return {
      inline: column.style.gridColumn + '|' + (center?.style.gridColumn ?? ''),
      centerX: center?.getBoundingClientRect().x ?? 0,
      columnX: column.getBoundingClientRect().x,
    }
  })
  await page.waitForFunction(() => !document.querySelector('[aria-label="把对话移回中间"], [aria-label="把对话移到右侧"]'))
  assert.ok(removed)
  assert.equal(removed.inline, '|')
  assert.ok(removed.centerX < removed.columnX, 'without the column marker the host order returns')
  assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-webnovel-swap')), false)
  checks.probeFailure = true

  assert.deepEqual(errors, [])
  fs.writeFileSync(path.join(evidence, 'layout-swap-acceptance.json'), JSON.stringify({ checks, errors }, null, 2) + '\n')
  console.log(JSON.stringify({ checks, errors }, null, 2))
} catch (error) {
  await page.screenshot({ path: path.join(evidence, 'layout-swap-failure.png'), fullPage: true }).catch(() => {})
  console.log(JSON.stringify({ errors, message: error instanceof Error ? error.message : String(error) }, null, 2))
  throw error
} finally {
  await browser.close()
}
