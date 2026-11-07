import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Plugin stylesheets follow the DSH ui-theme contracts (DSH docs/web-styling.md, docs/ui-radius.md).
const repo = path.resolve(import.meta.dirname, '../../..')
const ROOTS = ['packages/bundle/src/client', 'packages/embedding-provider/src']
const DSH_SOURCE = process.env['WEBNOVEL_DSH_SOURCE']
const RADIUS_TOKENS = new Set(['xs', 'sm', 'md', 'lg', 'xl', 'panel'].map(size => `--dsw-radius-${size}`))
// Literal sizes DSH itself uses for chrome text; content text uses its typography variables instead.
const FONT_SIZES = new Set([10, 11, 12, 13, 14, 16, 18, 20, 24, 28])
const COLOR_PROPERTY = /^(?:color|background(?:-color)?|border(?:-[\w-]+)?|outline(?:-color)?|fill|stroke|box-shadow|text-decoration(?:-color)?|caret-color|accent-color|--[\w-]+)$/
const COLOR_LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(|\b(?:white|black|gr[ae]y|silver|red|green|blue|orange|yellow|purple)\b/i
const TIME_LITERAL = /(?<![\w-])\d*\.?\d+m?s\b/
const BORDER = /^border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?$/
// Elements DSH ui-primitives render inside our DOM. A rule ending on one of them without a class or id also
// lands on the primitive's own element, and no specificity trick undoes it (DSH leaves many properties unset).
const PRIMITIVE_ELEMENT = /^(?:\*|div|span|button|input|select|textarea|label|svg|kbd)(?![\w-])/

/** The last compound of each selector in a list, with :not()/:has()/:is() arguments removed. */
function lastCompounds(selectors: string): string[] {
  const flat = (text: string) => { let out = text; for (let prev = ''; prev !== out;) { prev = out; out = out.replace(/\([^()]*\)/g, '') } return out }
  return selectors.split(',').map(selector => flat(selector.trim()).split(/\s*[\s>+~]\s*/).filter(Boolean).at(-1) ?? '')
}

interface Rule { selectors: string; declarations: [string, string][] }

/** Flatten a stylesheet into rules; nesting is unused here, and at-rule preludes drop out of the selectors. */
function parseRules(css: string): Rule[] {
  const rules: Rule[] = []
  for (const [, selectors = '', body = ''] of css.replace(/\/\*[\s\S]*?\*\//g, ' ').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = body.split(';').map(part => part.trim()).filter(part => part.includes(':'))
      .map((part): [string, string] => [part.slice(0, part.indexOf(':')).trim(), part.slice(part.indexOf(':') + 1).trim()])
    rules.push({ selectors: selectors.trim(), declarations })
  }
  return rules
}

/** Local custom properties such as --nw-line count as neutral borders when they resolve to a DSH border token. */
function neutralAliases(sheets: readonly string[]): Set<string> {
  return new Set(sheets.flatMap(css => parseRules(css)).flatMap(rule => rule.declarations)
    .filter(([name, value]) => name.startsWith('--') && value.includes('--dsw-alias-border-')).map(([name]) => name))
}

/** Every contract violation in one stylesheet, as `selector: property: value`. */
function violations(css: string, neutral = neutralAliases([css]), primitives = true): string[] {
  const isNeutral = (value: string) => value.includes('--dsw-alias-border-')
    || [...value.matchAll(/var\(\s*(--[\w-]+)/g)].some(([, name = '']) => neutral.has(name))
  const found: string[] = []
  if (css.includes('prefers-color-scheme')) found.push('@media: prefers-color-scheme')
  for (const rule of parseRules(css)) {
    const own = (name: string) => rule.declarations.find(([property]) => property === name)?.[1]
    const report = (property: string, value: string) => found.push(`${rule.selectors}: ${property}: ${value}`)
    if (/data-ds-dark-theme|::-webkit-scrollbar/.test(rule.selectors)) report('selector', rule.selectors)
    if (primitives && !rule.selectors.startsWith('@') && !/^(?:from|to|\d+%)/.test(rule.selectors)
      && lastCompounds(rule.selectors).some(compound => PRIMITIVE_ELEMENT.test(compound) && !/[.#]/.test(compound))) report('element', rule.selectors)
    for (const [property, value] of rule.declarations) {
      if (/^border(?:-[\w-]+)?-radius$/.test(property)) {
        const literal = [...value.matchAll(/(\d+(?:\.\d+)?)px/g)].some(([, size = '0']) => Number(size) > 4 && Number(size) < 99)
        const unknown = [...value.matchAll(/var\(\s*(--dsw-radius-[\w-]+)/g)].some(([, name = '']) => !RADIUS_TOKENS.has(name))
        const round = /\b(?:50|100)%|\b\d{3,}px/.test(value)
        if (literal || unknown || (round && own('corner-shape') !== 'round')) report(property, value)
      }
      if (BORDER.test(property) && isNeutral(value) && !/\bdashed\b/.test(value) && !/^0?\.5px\b/.test(value)) report(property, value)
      if (property === 'box-shadow' && value.includes('--dsw-elevation-')
        && rule.declarations.some(([name, other]) => BORDER.test(name) && isNeutral(other))) report(property, value)
      if (COLOR_PROPERTY.test(property) && COLOR_LITERAL.test(value)) report(property, value)
      if (property === 'scrollbar-color' || property === 'scrollbar-width') report(property, value)
      if (property === 'font-size') {
        // SVG text (rules that paint with fill) has no line box, so only its size is checked.
        const size = value.match(/^(\d+(?:\.\d+)?)px$/)?.[1]
        const unpaired = own('line-height') === undefined && own('fill') === undefined
        if (size !== undefined && (!FONT_SIZES.has(Number(size)) || unpaired)) report(property, value)
      }
      if (/^(?:transition|transition-duration|animation|animation-duration)$/.test(property)
        && TIME_LITERAL.test(value) && !value.includes('--ds-transition-')) report(property, value)
    }
  }
  return found
}

function sources(extensions: readonly string[]): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(path.join(repo, dir), { withFileTypes: true })) {
      const relative = `${dir}/${entry.name}`
      if (entry.isDirectory()) walk(relative)
      else if (extensions.some(extension => entry.name.endsWith(extension))) found.push(relative)
    }
  }
  for (const root of ROOTS) walk(root)
  return found.sort()
}

describe('插件样式贴合 DSH 主题规范', () => {
  it('识别越档圆角、粗中性边框、颜色字面量、无行高字号与写死时长', () => {
    expect(violations('.a{border-radius:6px}')).toHaveLength(1)
    expect(violations('.a{border-radius:var(--dsw-radius-sm)}.b{border-radius:2px}')).toEqual([])
    expect(violations('.a{border-radius:var(--dsw-radius-huge)}')).toHaveLength(1)
    expect(violations('.a{border-radius:50%}')).toHaveLength(1)
    expect(violations('.a{border-radius:50%;corner-shape:round}')).toEqual([])
    expect(violations('.a{border:1px solid var(--dsw-alias-border-l3)}')).toHaveLength(1)
    expect(violations('.a{border:.5px solid var(--dsw-alias-border-l3)}.b{border:1px dashed var(--dsw-alias-border-l3)}')).toEqual([])
    expect(violations('.a{--line:var(--dsw-alias-border-l3)}.b{border-top:1px solid var(--line)}')).toHaveLength(1)
    expect(violations('.a{border:1px solid var(--dsw-alias-state-warn-primary)}')).toEqual([])
    expect(violations('.a{border:.5px solid var(--dsw-alias-border-l3);box-shadow:var(--dsw-elevation-panel)}')).toHaveLength(1)
    expect(violations('.a{color:#fff}.b{background:rgb(0 0 0 / 10%)}')).toHaveLength(2)
    expect(violations('.a{background:color-mix(in srgb,var(--dsw-alias-link) 10%,transparent)}')).toEqual([])
    expect(violations('.a{font-size:12px}')).toHaveLength(1)
    expect(violations('.a{font-size:12px;line-height:18px}.b{font-size:var(--dsh-content-font-size)}')).toEqual([])
    expect(violations('.a{font-size:9px;line-height:16px}')).toHaveLength(1)
    expect(violations('.a text{font-size:11px;fill:var(--dsw-alias-label-secondary)}.b text{font-size:9px;fill:currentColor}')).toHaveLength(1)
    expect(violations('.a{transition:opacity .15s}')).toHaveLength(1)
    expect(violations('.a{transition:opacity var(--ds-transition-duration) var(--ds-ease-in-out)}')).toEqual([])
    expect(violations('.a::-webkit-scrollbar{width:8px}.b{scrollbar-width:thin}')).toHaveLength(2)
    expect(violations('@media (prefers-color-scheme: dark){.a{color:var(--dsw-alias-label-primary)}}')).toHaveLength(1)
  })

  it('不以原语会渲染的裸元素收尾', () => {
    expect(violations('.webnovel button{min-height:30px}')).toHaveLength(1)
    expect(violations('.a>svg{color:var(--dsw-alias-label-tertiary)}')).toHaveLength(1)
    expect(violations('.a input::placeholder{color:var(--dsw-alias-label-tertiary)}')).toHaveLength(1)
    expect(violations('.a button:hover:not(:disabled){opacity:1}')).toHaveLength(1)
    expect(violations('.webnovel *{box-sizing:border-box}')).toHaveLength(1)
    expect(violations('.a>div{display:flex}')).toHaveLength(1)
    expect(violations('.a button.b{opacity:1}.a .b:not(button){opacity:1}.a strong{font-weight:600}.a>[data-x]{opacity:1}')).toEqual([])
    expect(violations('@keyframes k{from{opacity:0}to{opacity:1}}')).toEqual([])
  })

  it('插件样式表只保留登记过的例外', () => {
    const files = sources(['.css'])
    const sheets = files.map(file => fs.readFileSync(path.join(repo, file), 'utf8'))
    const neutral = neutralAliases(sheets)
    const actual = Object.fromEntries(files.map((file, index): [string, string[]] => [file, violations(sheets[index] ?? '', neutral)]).filter(([, found]) => found.length > 0))
    const expected = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'expected/client-style-exceptions.json'), 'utf8')) as Record<string, Record<string, string>>
    expect(actual).toEqual(Object.fromEntries(Object.entries(expected).map(([file, entries]) => [file, Object.keys(entries)])))
  })

  // An undefined theme token silently falls back to the inherited value; check it against the pinned DSH checkout.
  it.skipIf(DSH_SOURCE === undefined)('只引用固定 DSH 基线已定义的主题变量', () => {
    const themes = path.join(DSH_SOURCE ?? '', 'packages/client/ui-theme/src/styles')
    const defined = new Set(fs.readdirSync(themes).filter(name => name.endsWith('.css'))
      .flatMap(name => [...fs.readFileSync(path.join(themes, name), 'utf8').matchAll(/(--dsw?-[\w-]+)\s*:/g)].map(([, token = '']) => token)))
    const missing = sources(['.css', '.ts', '.tsx']).flatMap(file => [...fs.readFileSync(path.join(repo, file), 'utf8').matchAll(/var\(\s*(--dsw?-[\w-]+)/g)]
      .map(([, token = '']) => token).filter(token => !defined.has(token)).map(token => `${file}: ${token}`))
    expect([...new Set(missing)]).toEqual([])
  })
})
