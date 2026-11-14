import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const css = fs.readFileSync(path.resolve(import.meta.dirname, '../src/client/styles.css'), 'utf8')

/** Extract one top-level rule body so a declaration cannot silently disappear. */
function rule(selector: string): string {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)
  const match = Array.from(rules).find(([, selectors]) => selectors.trim() === selector)
  expect(match, `${selector} should exist in styles.css`).toBeDefined()
  return match![2]
}

describe('侧栏宿主插槽弹性', () => {
  // Regression: the native workspace browser inside `sidebar.workspaces` lays out with
  // `min-width: auto` and an intrinsic min-content width. As a COLUMN flex item under a
  // ROW flex wrapper it never shrank, so narrowing the sidebar clipped the header actions
  // (search / view options / new workspace) instead of reflowing them.
  it('外层容器按列布局并允许子项收缩', () => {
    const wrapper = rule('.nw-native-workspaces')
    expect(wrapper).toContain('flex-direction:column')
    expect(wrapper).toContain('min-width:0')
    expect(rule('.nw-native-workspaces>*')).toContain('min-width:0')
  })

  it('左侧栏自身不参与撑宽', () => {
    expect(rule('.nw-left')).toContain('min-width:0')
  })
})
