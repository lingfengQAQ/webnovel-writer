import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * P0-F5：十个章号/卷号入口统一口径——parseInt+isNaN 拦不住 "3.5" 静默截断、
 * "1e3"、负数、0。全部改用 parsePositiveInt，非法输入一律人话拒绝且含「正整数」。
 * 本测试不建书仓：参数校验必须先于任何流程逻辑触发（非法即拒，不碰 repoPath）。
 */

const CASES = [
  ['batch-reject', (m) => m.run(['3.5'], {}, {})],
  ['batch-restage', (m) => m.run(['-1'], {}, {})],
  ['export', (m) => m.run(['1e3'], {}, {})],
  ['finalize', (m) => m.run(['0'], {}, {})],
  ['finalize-batch', (m) => m.run([], { until: '3.5' }, {})],
  ['goto-chapter', (m) => m.run(['3.5'], {}, {})],
  ['mechanical-check', (m) => m.run(['-1'], {}, {})],
  ['prepare-chapter', (m) => m.run(['0'], {}, {})],
  ['read-chapter', (m) => m.run(['1e3'], {}, {})],
  ['review-input', (m) => m.run(['3.5'], {}, {})],
  ['save-review', (m) => m.run(['3.5'], {}, {})],
  ['stage-chapter', (m) => m.run(['-1'], {}, {})],
]

for (const [name, invoke] of CASES) {
  test(`章号/卷号口径统一：${name} 拒绝非正整数`, async () => {
    const m = await import(`../../src/commands/${name}.js`)
    const r = await invoke(m)
    assert.equal(r.ok, false, name)
    assert.match(r.error, /正整数/, `${name} 报错须含「正整数」：${r.error}`)
    // 参数先决：不得因后续流程（repoPath 为 undefined）抛出 TypeError 之类
    assert.doesNotMatch(String(r.error), /undefined|null is not|Cannot read/)
  })
}
