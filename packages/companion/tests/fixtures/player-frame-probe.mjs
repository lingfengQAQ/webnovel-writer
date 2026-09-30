/** Check actual composited video opacity during action changes in the native client. */
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const evidence = path.resolve(process.argv[2])
const { chromium } = await import(pathToFileURL(path.join(process.env.WHALE_PLAYWRIGHT, 'index.mjs')).href)
const log = fs.readFileSync(path.join(evidence, 'native.log'), 'utf8')
const url = log.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/g).at(-1)
const browser = await chromium.launch({ headless: true, executablePath: process.env.WHALE_CHROMIUM })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
try {
  await page.goto(url)
  const welcome = page.getByRole('button', { name: '继续', exact: true })
  if (await welcome.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false)) await welcome.click()
  const workspaceTab = page.getByRole('tab', { name: '工作区', exact: true })
  if (await workspaceTab.isVisible()) await workspaceTab.click()
  await page.getByText('桌宠验收 · 第二会话', { exact: true }).first().click()
  await page.waitForFunction(() => [...document.querySelectorAll('.whale-media video')].some(v => v.currentTime > .2))
  const idleDuration = await page.evaluate(() => [...document.querySelectorAll('.whale-media video')].find(v => v.dataset.clip === 'idle')?.duration)
  await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 48; canvas.height = 64
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    window.whaleFrameProbe = { samples: [], running: true }
    const sample = () => {
      if (!window.whaleFrameProbe.running) return
      ctx.clearRect(0, 0, 48, 64)
      for (const element of document.querySelectorAll('.whale-media img,.whale-media canvas,.whale-media video')) {
        ctx.globalAlpha = Number(getComputedStyle(element).opacity)
        if (!ctx.globalAlpha || (element.tagName === 'VIDEO' && element.readyState < 2)) continue
        ctx.drawImage(element, 0, 0, 48, 64)
      }
      window.whaleFrameProbe.samples.push({
        // The book edge crosses transparency while moving. Sample the opaque
        // knee instead (verified against every decoded source frame).
        alpha: ctx.getImageData(24, 44, 1, 1).data[3],
        clip: document.querySelector('.whale-media').dataset.clip,
      })
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  const preview = async name => {
    await page.locator('.whale-companion').hover()
    await page.getByRole('button', { name: '打开桌宠菜单' }).click()
    await page.getByText('预览动作', { exact: true }).click()
    await page.locator('.whale-previews').getByRole('button', { name, exact: true }).click()
  }
  await preview('正在构思')
  await page.waitForTimeout(1000)
  await preview('正在写作')
  await page.waitForFunction(() => document.querySelector('.whale-media')?.dataset.clip === 'writing-loop')
  await page.waitForTimeout(4300)
  await preview('休息一下')
  await page.waitForFunction(() => document.querySelector('.whale-media')?.dataset.clip === 'rest')
  await page.waitForTimeout(700)
  const report = await page.evaluate(() => {
    window.whaleFrameProbe.running = false
    const { samples } = window.whaleFrameProbe
    return { samples: samples.length, minAlpha: Math.min(...samples.map(s => s.alpha)),
      dips: samples.filter(s => s.alpha < 245).slice(0, 20),
      mediaError: document.querySelector('.whale-media').dataset.static === 'true' }
  })
  report.errors = errors
  report.idleDuration = idleDuration
  const file = process.argv.includes('--observe') ? 'frame-probe-before.json' : 'frame-probe.json'
  fs.writeFileSync(path.join(evidence, file), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
  if (!process.argv.includes('--observe')) {
    assert.ok(report.samples > 100)
    assert.ok(report.minAlpha >= 245, 'Character becomes translucent between presented frames')
    assert.ok(report.idleDuration >= 4.95, 'Idle repeats the blink too frequently')
    assert.equal(report.mediaError, false)
    assert.deepEqual(errors, [])
  }
} finally {
  await browser.close()
}
