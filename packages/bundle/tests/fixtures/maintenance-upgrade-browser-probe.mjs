/** Run inside ego-browser nodejs after opening and expanding the maintenance demo's native tool group. */
import fs from 'node:fs/promises'
import path from 'node:path'

const expected = {
  '待批准': 'attention', '暂不可升级': 'attention', '无需升级': 'success',
  '已写待提交': 'error', '升级已提交': 'success', '已核实原提交': 'success',
}

export async function captureMaintenanceUpgradeCards(page, output, tone) {
  if (!path.isAbsolute(output) || !['light', 'dark'].includes(tone)) throw new Error('Supply an absolute output directory and light/dark tone')
  await fs.mkdir(output, { recursive: true })
  const cards = await page.evaluate(() => [...document.querySelectorAll('.nw-result')].map((card, index) => ({
    index, title: card.getAttribute('aria-label'), state: card.getAttribute('data-state'),
    label: card.querySelector('.nw-result-state')?.textContent?.trim(),
    summary: card.querySelector('.nw-result-summary')?.textContent?.trim(),
    expanded: card.querySelector('.nw-result-heading')?.getAttribute('aria-expanded') === 'true',
  })).filter(card => ['预览书仓升级', '执行书仓升级', '续办书仓升级'].includes(card.title)))
  for (const [label, state] of Object.entries(expected)) {
    const found = cards.find(card => card.label === label)
    if (!found || found.state !== state) throw new Error(`Actual maintenance card missing or wrong state: ${label} / ${state}; observed ${JSON.stringify(cards)}`)
  }
  const screenshots = []
  for (const label of Object.keys(expected)) {
    const card = cards.find(item => item.label === label)
    const selector = `loc=css:.nw-result-heading >> nth=${card.index}`
    if (card.expanded) {
      await page.click(selector, { label: '定位维护结果卡' })
      await page.click(selector, { label: '展开维护结果卡' })
    } else await page.click(selector, { label: '展开维护结果卡' })
    const file = path.join(output, `${tone}-${label}.png`)
    await page.screenshot({ path: file })
    screenshots.push(file)
  }
  const overflow = await page.evaluate(() => [...document.querySelectorAll('.nw-result')]
    .filter(card => ['预览书仓升级', '执行书仓升级', '续办书仓升级'].includes(card.getAttribute('aria-label')))
    .filter(card => card.scrollWidth > card.clientWidth + 2).map(card => card.getAttribute('aria-label')))
  if (overflow.length) throw new Error(`Maintenance cards overflow horizontally: ${overflow.join(', ')}`)
  const report = { ok: true, tone, cards, screenshots, noHorizontalOverflow: true, renderedStates: Object.keys(expected), notRendered: ['recovered'], note: '恢复卡的状态和文案由单元测试覆盖；本演示未制造进程中断，不伪造恢复结果。' }
  await fs.writeFile(path.join(output, `${tone}-report.json`), JSON.stringify(report, null, 2) + '\n')
  return report
}
