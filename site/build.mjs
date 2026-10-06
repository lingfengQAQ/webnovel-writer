// GitHub Pages generator: product home page plus the public user guides in docs/user.
// Reads only public files, derives versions from their sources of truth and writes a
// self-contained static site (relative links, no external scripts) to .tmp/pages.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { checkPublicPath, checkPublicText } from '../scripts/release/check-public-tree.mjs'
import { DEFAULT_PALETTE, PALETTE_KEYS, PALETTES } from './palettes.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
export const defaultRoot = path.resolve(here, '..')
export const defaultOut = path.join(defaultRoot, '.tmp', 'pages')
const BRANCH = 'v8'
const GUIDES = 'docs/user/'

/** Sidebar order. Guides not listed here are appended to the last group automatically. */
export const NAV = [
  { title: '入门', pages: [
    { name: 'beginner', label: '新手教程' },
    { name: 'install', label: '安装' },
    { name: 'configuration', label: '模型配置' },
    { name: 'first-book', label: '第一本书' },
  ] },
  { title: '写作', pages: [
    { name: 'editor', label: '编辑器' },
    { name: 'workflows', label: '日常写作' },
    { name: 'reference-analysis', label: '参考分析' },
    { name: 'enhanced-index', label: '增强索引' },
    { name: 'result-cards', label: '结果卡' },
  ] },
  { title: '参考与维护', pages: [
    { name: 'ui-reference', label: '界面参考' },
    { name: 'upgrade-backup', label: '备份升级' },
    { name: 'troubleshooting', label: '故障排查' },
    { name: 'privacy', label: '隐私' },
  ] },
]

const esc = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])

/** GitHub-compatible heading ids, so existing `page.md#标题` links keep working. */
export function createSlugger() {
  const seen = new Map()
  return text => {
    const base = text.trim().toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '').replace(/ /g, '-')
    let slug = base
    if (seen.has(slug)) {
      let count = seen.get(base)
      do { count++; slug = `${base}-${count}` } while (seen.has(slug))
      seen.set(base, count)
    }
    seen.set(slug, 0)
    return slug
  }
}

export function srtToVtt(text) {
  const body = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim()
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
  return `WEBVTT\n\n${body}\n`
}

const plainText = inline => (inline?.children ?? []).map(child =>
  child.type === 'text' || child.type === 'code_inline' ? child.content : child.type === 'softbreak' || child.type === 'hardbreak' ? ' ' : '').join('')

const alertIcon = body => `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
const ALERTS = {
  NOTE: { label: '说明', icon: alertIcon('<circle cx="8" cy="8" r="6"/><path d="M8 7.2V11.5M8 4.8h.01"/>') },
  TIP: { label: '提示', icon: alertIcon('<path d="M8 1.8a3.6 3.6 0 0 0-1.5 6.9c.3.2.5.6.5 1V11h2v-1.3c0-.4.2-.8.5-1A3.6 3.6 0 0 0 8 1.8z"/><path d="M6.6 13h2.8"/>') },
  IMPORTANT: { label: '重要', icon: alertIcon('<path d="M8 1.6 9.5 6H14l-3.6 2.6 1.4 4.2L8 10.2 4.2 12.8 5.6 8.6 2 6h4.5z"/>') },
  WARNING: { label: '警告', icon: alertIcon('<path d="M8 1.8 14.5 13.4H1.5z"/><path d="M8 6.2v3.2M8 11.4h.01"/>') },
  CAUTION: { label: '注意', icon: alertIcon('<circle cx="8" cy="8" r="6"/><path d="M5.4 5.4 10.6 10.6"/>') },
}
const SHORTCUT = /^(?:(?:Ctrl|Alt|Shift|Win|Cmd|Option)\+)*(?:Ctrl|Alt|Shift|Win|Cmd|Option|Esc|Enter|Tab|Space|Backspace|Delete|F(?:[1-9]|1[0-2])|[A-Z0-9]|\/)$/
const isShortcut = text => SHORTCUT.test(text) && !/^[A-Z0-9]$/.test(text)

function blockEnd(tokens, start, openType, closeType) {
  let depth = 0
  for (let index = start; index < tokens.length; index++) {
    if (tokens[index].type === openType) depth++
    else if (tokens[index].type === closeType) {
      depth--
      if (depth === 0) return index
    }
  }
  return -1
}

function annotateQuote(tokens, openIndex, file) {
  const closeIndex = blockEnd(tokens, openIndex, 'blockquote_open', 'blockquote_close')
  let inline = null
  for (let index = openIndex + 1; index < closeIndex; index++) {
    if (tokens[index].type === 'inline') { inline = tokens[index]; break }
  }
  const first = inline?.children?.[0]
  if (first?.type !== 'text' || !first.content.startsWith('[!')) {
    if (tokens[openIndex].level === 0 && closeIndex >= 0) {
      tokens[openIndex].meta = { ...tokens[openIndex].meta, prompt: true }
      tokens[closeIndex].meta = { ...tokens[closeIndex].meta, prompt: true }
    }
    return
  }
  const matched = /^\[!([^\]]*)\]/.exec(first.content)
  const type = matched?.[1] ?? ''
  if (!matched || !ALERTS[type]) throw new Error(`Unknown alert type in ${file}: [!${type}]`)
  first.content = first.content.slice(matched[0].length)
  if (!first.content) inline.children.shift()
  if (inline.children[0]?.type === 'softbreak') inline.children.shift()
  tokens[openIndex].meta = { ...tokens[openIndex].meta, alert: type }
  tokens[closeIndex].meta = { ...tokens[closeIndex].meta, alert: type }
}

function annotateShot(tokens, index) {
  const inline = tokens[index + 1]
  const close = tokens[index + 2]
  if (!inline || inline.type !== 'inline' || !close || close.type !== 'paragraph_close') return
  const meaningful = (inline.children ?? []).filter(child => !(child.type === 'text' && !child.content.trim()))
  if (meaningful.length !== 1 || meaningful[0].type !== 'image') return
  const image = meaningful[0]
  tokens[index].meta = { ...tokens[index].meta, shot: true }
  close.meta = { ...close.meta, shot: true, alt: image.content || '' }
  image.meta = { ...image.meta, shot: true }
}

function annotateBlocks(state) {
  const file = state.env?.file || 'markdown'
  for (let index = 0; index < state.tokens.length; index++) {
    if (state.tokens[index].type === 'blockquote_open') annotateQuote(state.tokens, index, file)
    else if (state.tokens[index].type === 'paragraph_open') annotateShot(state.tokens, index)
  }
}

export function createMarkdown(root) {
  const MarkdownIt = createRequire(path.join(root, 'packages/bundle/package.json'))('markdown-it')
  const md = new MarkdownIt({ html: false, linkify: false, typographer: false })
  const token = (tokens, idx, options, env, self) => self.renderToken(tokens, idx, options)
  md.core.ruler.after('inline', 'scriptor_blocks', annotateBlocks)
  md.renderer.rules.table_open = (...args) => '<div class="table-wrap">' + token(...args)
  md.renderer.rules.table_close = (...args) => token(...args) + '</div>\n'
  md.renderer.rules.heading_close = (tokens, idx, options, env, self) => {
    const open = tokens[idx - 2]
    const id = open.attrGet('id')
    const anchor = id && open.tag !== 'h1' ? `<a class="heading-anchor" href="#${esc(id)}" aria-label="本节链接">#</a>` : ''
    return anchor + self.renderToken(tokens, idx, options)
  }
  md.renderer.rules.fence = (tokens, idx) => {
    const fence = tokens[idx]
    const lang = fence.info.trim().split(/\s+/)[0]
    return `<div class="code-block"><button class="copy-button" type="button" data-copy-code>复制</button><pre><code${lang ? ` class="language-${esc(lang)}"` : ''}>${esc(fence.content)}</code></pre></div>\n`
  }
  md.renderer.rules.blockquote_open = (tokens, idx, options, env, self) => {
    const alert = tokens[idx].meta?.alert
    if (alert) {
      const info = ALERTS[alert]
      return `<div class="callout callout-${alert.toLowerCase()}" role="note"><p class="callout-title">${info.icon}${esc(info.label)}</p>\n`
    }
    if (tokens[idx].meta?.prompt) return '<figure class="prompt"><figcaption>发给工作台</figcaption><blockquote>\n'
    return self.renderToken(tokens, idx, options)
  }
  md.renderer.rules.blockquote_close = (tokens, idx, options, env, self) => {
    if (tokens[idx].meta?.alert) return '</div>\n'
    if (tokens[idx].meta?.prompt) return '</blockquote><button class="copy-button" type="button" data-copy-prompt>复制</button></figure>\n'
    return self.renderToken(tokens, idx, options)
  }
  md.renderer.rules.paragraph_open = (tokens, idx, options, env, self) => tokens[idx].meta?.shot ? '<figure class="shot">' : self.renderToken(tokens, idx, options)
  md.renderer.rules.paragraph_close = (tokens, idx, options, env, self) => {
    if (!tokens[idx].meta?.shot) return self.renderToken(tokens, idx, options)
    const alt = tokens[idx].meta.alt
    return `${alt ? `<figcaption>${esc(alt)}</figcaption>` : ''}</figure>\n`
  }
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const image = tokens[idx]
    const alt = self.renderInlineAsText(image.children, options, env)
    const altIndex = image.attrIndex('alt')
    if (altIndex >= 0) image.attrs[altIndex][1] = alt
    if (image.meta?.shot) {
      image.attrSet('tabindex', '0')
      image.attrSet('role', 'button')
      image.attrSet('aria-haspopup', 'dialog')
      image.attrSet('aria-label', alt ? `放大：${alt}` : '放大图片')
    }
    return self.renderToken(tokens, idx, options)
  }
  md.renderer.rules.code_inline = (tokens, idx) => {
    const text = tokens[idx].content
    return isShortcut(text) ? `<kbd>${esc(text)}</kbd>` : `<code>${esc(text)}</code>`
  }
  md.renderer.rules.ordered_list_open = (tokens, idx, options, env, self) => {
    if (tokens[idx].level === 0) tokens[idx].attrJoin('class', 'steps')
    return self.renderToken(tokens, idx, options)
  }
  return md
}

function readContext(root) {
  const bundle = JSON.parse(fs.readFileSync(path.join(root, 'packages/bundle/package.json'), 'utf8'))
  const baseline = JSON.parse(fs.readFileSync(path.join(root, 'dsh-baseline.json'), 'utf8'))
  const repo = String(bundle.repository?.url ?? '').replace(/^git\+/, '').replace(/\.git$/, '')
  assert.match(repo, /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/, 'packages/bundle repository.url must be a GitHub URL')
  assert.match(bundle.version, /^\d+\.\d+\.\d+$/, 'Main package version must be a stable SemVer')
  const dsh = baseline.source?.version
  assert.ok(dsh, 'dsh-baseline.json source.version is required')
  const [, owner, repoName] = new URL(repo).pathname.split('/')
  // Custom domains must change this derivation; see docs/maintenance/pages.md.
  const siteUrl = `https://${owner.toLowerCase()}.github.io/${repoName}/`
  return {
    version: bundle.version, dsh, dshWebsite: 'https://www.deepseek.com/harness/', repo, branch: BRANCH, siteUrl,
    tree: `${repo}/tree/${BRANCH}`, release: `${repo}/releases/tag/scriptor-v${bundle.version}`,
    pkg: name => `@linfengqaqtat/${name}@${bundle.version}`,
  }
}

function orderGuides(names) {
  const listed = new Set(NAV.flatMap(group => group.pages.map(page => page.name)))
  for (const page of listed) assert.ok(names.includes(page), `Navigation lists missing guide: docs/user/${page}.md`)
  const groups = NAV.map(group => ({ title: group.title, pages: group.pages.map(page => ({ ...page })) }))
  for (const name of names.filter(name => !listed.has(name)).sort()) groups.at(-1).pages.push({ name, label: '' })
  return groups
}

function parseGuide(md, root, name) {
  const file = `${GUIDES}${name}.md`
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  const env = { file }
  const tokens = md.parse(source, env)
  const slug = createSlugger()
  const headings = []
  let title = null, description = ''
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.type === 'heading_open') {
      const text = plainText(tokens[i + 1]).trim()
      const id = slug(text)
      token.attrSet('id', id)
      headings.push({ level: Number(token.tag.slice(1)), text, id })
      if (token.tag === 'h1' && !title) title = text
    } else if (!description && token.type === 'paragraph_open' && token.level === 0 && title) {
      description = plainText(tokens[i + 1]).replace(/\s+/g, ' ').trim()
    }
  }
  assert.ok(title, `${file} needs a level-1 heading`)
  if ([...description].length > 90) description = [...description].slice(0, 88).join('') + '…'
  return { name, file, source, env, tokens, title, description, headings, ids: new Set(headings.map(h => h.id)) }
}

function rewriteLinks(guide, guides, ctx, root, assets, warnings) {
  const resolve = (href, kind) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return { href, external: /^https?:/i.test(href) }
    const cut = href.indexOf('#')
    const rawPath = cut < 0 ? href : href.slice(0, cut)
    const hash = cut < 0 ? '' : decodeURIComponent(href.slice(cut + 1))
    const fragment = hash ? `#${encodeURIComponent(hash)}` : ''
    const checkAnchor = target => {
      if (hash && !target.ids.has(hash)) warnings.push(`${guide.file}: #${hash} not found in ${target.file}`)
    }
    if (!rawPath) { checkAnchor(guide); return { href: fragment } }
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(guide.file), decodeURIComponent(rawPath)))
    assert.ok(!target.startsWith('../') && target !== '..', `Link escapes the repository: ${guide.file} -> ${href}`)
    const absolute = path.join(root, ...target.split('/'))
    assert.ok(fs.existsSync(absolute), `Broken link in ${guide.file}: ${href}`)
    if (target.startsWith(GUIDES)) {
      const local = target.slice(GUIDES.length)
      if (!local.includes('/') && local.endsWith('.md')) {
        const page = guides.get(local.slice(0, -3))
        assert.ok(page, `Unknown guide in ${guide.file}: ${href}`)
        checkAnchor(page)
        return { href: `${encodeURIComponent(page.name)}.html${fragment}` }
      }
      if (fs.statSync(absolute).isFile() && !local.endsWith('.md')) {
        checkPublicPath(target)
        assets.add(local)
        return { href: local.split('/').map(encodeURIComponent).join('/') + fragment }
      }
    }
    assert.ok(kind === 'link', `Images must live under docs/user: ${guide.file} -> ${href}`)
    const directory = fs.statSync(absolute).isDirectory()
    if (!directory) checkPublicPath(target)
    return { href: `${ctx.repo}/${directory ? 'tree' : 'blob'}/${ctx.branch}/${encodeURI(target)}${fragment}`, external: true }
  }
  const walk = tokens => {
    for (const token of tokens) {
      if (token.type === 'link_open') {
        const result = resolve(token.attrGet('href'), 'link')
        token.attrSet('href', result.href)
        if (result.external) { token.attrSet('target', '_blank'); token.attrSet('rel', 'noopener noreferrer') }
      } else if (token.type === 'image') {
        token.attrSet('src', resolve(token.attrGet('src'), 'image').href)
        token.attrSet('loading', 'lazy')
        token.attrSet('decoding', 'async')
      }
      if (token.children) walk(token.children)
    }
  }
  walk(guide.tokens)
}

function searchSections(guide) {
  const sections = []
  let current = { heading: guide.title, id: '', text: [] }
  const push = () => { const text = current.text.join(' ').replace(/\s+/g, ' ').trim(); if (text || current.id) sections.push({ heading: current.heading, id: current.id, text }) }
  for (let i = 0; i < guide.tokens.length; i++) {
    const token = guide.tokens[i]
    if (token.type === 'heading_open' && token.tag !== 'h1') {
      push()
      current = { heading: plainText(guide.tokens[i + 1]).trim(), id: token.attrGet('id'), text: [] }
      i++
    } else if (token.type === 'inline' && guide.tokens[i - 1]?.type !== 'heading_open') {
      current.text.push(plainText(token))
    } else if (token.type === 'fence') {
      current.text.push(token.content)
    }
  }
  push()
  return sections
}

const icon = {
  github: '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>',
  menu: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z"/></svg>',
  search: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M10 2a8 8 0 0 1 6.32 12.9l5.39 5.4-1.41 1.4-5.4-5.38A8 8 0 1 1 10 2zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12z"/></svg>',
}
const logo = '<span class="logo" aria-hidden="true"><svg viewBox="0 0 32 32" width="26" height="26"><rect width="32" height="32" rx="8" fill="currentColor"/><path d="M8 9.5c2.6-1.4 4.8-1 6.5.2 1.7-1.2 3.9-1.6 6.5-.2v13.2c-2.6-1.4-4.8-1-6.5.2-1.7-1.2-3.9-1.6-6.5-.2z" fill="none" stroke-width="1.7" stroke-linejoin="round"/><path d="M14.5 9.7v13.2" fill="none" stroke-width="1.7" stroke-linecap="round"/></svg></span>'
const glyph = body => `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`


const infoIcons = {
  windows: glyph('<path d="M3 5.5 11 4.4v7H3zm10-1.4L21 3v8.4h-8zM3 13.4h8v7L3 19.3zm10 0h8V22l-8-1.2z"/>'),
  linux: glyph('<path d="M8 8c0-4 1.5-6 4-6s4 2 4 6c0 2 3 5 3 8 0 3-3 5-7 5s-7-2-7-5c0-3 3-6 3-8z"/><path d="m10 8 2 2 2-2M9 6h.01M15 6h.01M5 18l-2 3h5m11-3 2 3h-5"/>'),
  mac: glyph('<path d="M16 8V5a2 2 0 1 1 2 2H6a2 2 0 1 1 2-2v14a2 2 0 1 1-2-2h12a2 2 0 1 1-2 2V8"/>'),
  local: glyph('<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>'),
  api: glyph('<circle cx="8" cy="9" r="4"/><path d="m11 12 8 8 2-2-2-2 1-1-2-2-1 1"/>'),
  license: glyph('<path d="M12 3v18M7 21h10M4 7h16M6 7l-3 7h6zm12 0-3 7h6z"/>'),
  download: glyph('<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>'),
  captions: glyph('<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M10 9H6v6h4m8-6h-4v6h4"/>'),
  feedback: glyph('<path d="M21 11a8 8 0 0 1-8 8H7l-5 3 2-6a8 8 0 1 1 17-5z"/><path d="M8 10h8M8 14h5"/>'),
  mail: glyph('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>'),
  heart: glyph('<path d="M20.5 5.5a5 5 0 0 0-7 0L12 7l-1.5-1.5a5 5 0 0 0-7 7L12 21l8.5-8.5a5 5 0 0 0 0-7z"/>'),
  shield: glyph('<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>'),
}
const infoLink = (href, label, svg) => `<a class="info-link" href="${esc(href)}" aria-label="${esc(label)}" title="${esc(label)}">${svg}</a>`

function renderThemeCss() {
  const kebab = key => key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)
  const block = tokens => PALETTE_KEYS.map(key => `--${kebab(key)}:${tokens[key]}`).join(';')
  return Object.entries(PALETTES).flatMap(([id, palette]) => {
    const light = block(palette.light)
    const dark = block(palette.dark)
    return [
      `:root[data-palette="${id}"]{${light};color-scheme:light}`,
      `:root[data-palette="${id}"][data-theme="dark"]{${dark};color-scheme:dark}`,
      `@media (prefers-color-scheme: dark){:root[data-palette="${id}"]:not([data-theme="light"]){${dark};color-scheme:dark}}`,
    ]
  }).join('\n') + '\n'
}

function themeBootScript() {
  const allowed = Object.keys(PALETTES).map(id => `p==='${id}'`).join('||')
  return `<script>try{var r=document.documentElement,p=localStorage.getItem('scriptor-palette'),t=localStorage.getItem('scriptor-theme');if(${allowed})r.dataset.palette=p;if(t==='light'||t==='dark')r.dataset.theme=t}catch(e){}</script>`
}

function renderAppearance() {
  const swatches = Object.entries(PALETTES).map(([id, palette]) => {
    const dots = [palette.light.bg, palette.light.accent, palette.dark.bg].map(color => `<i style="background:${color}"></i>`).join('')
    const checked = id === DEFAULT_PALETTE ? 'true' : 'false'
    return `<button class="swatch" type="button" role="radio" data-palette="${id}" aria-checked="${checked}"><span class="dots">${dots}</span><span>${id} · ${esc(palette.name)}</span><span class="check" aria-hidden="true">✓</span></button>`
  }).join('')
  return `<div class="appearance">
    <button class="appearance-button" type="button" aria-haspopup="dialog" aria-expanded="false" aria-label="外观" data-appearance><span class="chip" aria-hidden="true"></span><span class="appearance-label">外观</span></button>
    <div class="appearance-panel" role="dialog" aria-label="外观设置" hidden data-appearance-panel>
      <p class="panel-title">配色</p>
      <div class="swatches" role="radiogroup" aria-label="配色">${swatches}</div>
      <p class="panel-title">模式</p>
      <div class="segmented" role="radiogroup" aria-label="明暗模式">
        <button type="button" role="radio" data-theme-option="" aria-checked="true">跟随系统</button>
        <button type="button" role="radio" data-theme-option="light" aria-checked="false">浅色</button>
        <button type="button" role="radio" data-theme-option="dark" aria-checked="false">深色</button>
      </div>
    </div>
  </div>`
}

function layout(ctx, { title, description, rel, body, page, sidebar = '', pathname = '' }) {
  const fullTitle = title === 'DSH Scriptor' ? 'DSH Scriptor · 长篇小说写作工作台' : `${title} · DSH Scriptor`
  const pageUrl = new URL(pathname, ctx.siteUrl).href
  const imageUrl = new URL('docs/images/video-poster.png', ctx.siteUrl).href
  return `<!doctype html>
<html lang="zh-CN" data-root="${rel}" data-palette="${DEFAULT_PALETTE}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(pageUrl)}">
<meta property="og:image" content="${esc(imageUrl)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="color-scheme" content="light dark">
${themeBootScript()}
<link rel="icon" href="${rel}assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${rel}assets/theme.css">
<link rel="stylesheet" href="${rel}assets/style.css">
<script src="${rel}assets/search-index.js" defer></script>
<script src="${rel}assets/site.js" defer></script>
</head>
<body class="${page === 'home' ? 'home' : 'doc'}">
<a class="skip-link" href="#main">跳到正文</a>
<header class="site-header">
  <div class="header-inner">
    ${sidebar ? `<button class="icon-button menu-button" type="button" aria-label="打开目录" aria-expanded="false" data-menu>${icon.menu}</button>` : ''}
    <a class="brand" href="${rel}index.html">${logo}<span>DSH Scriptor</span></a>
    <span class="version-pill" title="当前正式版">v${esc(ctx.version)}</span>
    <nav class="top-nav" aria-label="站点">
      <a href="${rel}index.html"${page === 'home' ? ' aria-current="page"' : ''}>首页</a>
      <a href="${rel}docs/beginner.html"${page !== 'home' ? ' aria-current="page"' : ''}>文档</a>
      <a href="${esc(ctx.release)}" target="_blank" rel="noopener noreferrer">下载</a>
      <a href="${rel}index.html#community-title">交流</a>
    </nav>
    <div class="search" role="search">
      <span class="search-icon">${icon.search}</span>
      <input id="search-input" type="search" placeholder="搜索文档" aria-label="搜索文档" autocomplete="off" spellcheck="false">
      <kbd class="search-key">/</kbd>
      <div id="search-results" class="search-results" role="listbox" hidden></div>
    </div>
    ${renderAppearance()}
    <a class="icon-button" href="${esc(ctx.tree)}" target="_blank" rel="noopener noreferrer" aria-label="GitHub 仓库">${icon.github}</a>
  </div>
</header>
${sidebar}
<main id="main">
${body}
</main>
<footer class="site-footer">
  <div class="footer-inner">
    <p>DSH Scriptor ${esc(ctx.version)} <span class="footer-origin">· 源自 Webnovel Writer</span></p>
    <nav class="footer-links" aria-label="项目链接">${infoLink(`${ctx.repo}/issues/new/choose`, '反馈问题', infoIcons.feedback)}${infoLink(`${ctx.repo}/discussions`, '讨论区', icon.github)}${infoLink(`${ctx.repo}/blob/${ctx.branch}/SECURITY.md`, '安全报告', infoIcons.shield)}${infoLink(`${ctx.repo}/blob/${ctx.branch}/LICENSE`, 'GPL-3.0-only 开源许可证', infoIcons.license)}</nav>
  </div>
</footer>
<dialog class="lightbox" aria-label="放大的图片"><figure><img alt=""><figcaption></figcaption></figure></dialog>
</body>
</html>
`
}

function renderSidebar(groups, guides, current, rel) {
  const items = groups.map(group => `<div class="nav-group"><p class="nav-title">${esc(group.title)}</p><ul>${group.pages.map(page => {
    const guide = guides.get(page.name)
    const label = page.label || guide.title
    return `<li><a href="${rel}docs/${encodeURIComponent(page.name)}.html"${page.name === current ? ' aria-current="page"' : ''}>${esc(label)}</a></li>`
  }).join('')}</ul></div>`).join('')
  return `<aside class="sidebar" id="sidebar" aria-label="文档目录"><nav>${items}</nav></aside><div class="sidebar-backdrop" data-menu-close></div>`
}

function renderGuide(md, ctx, guide, groups, guides, order) {
  const html = md.renderer.render(guide.tokens, md.options, guide.env)
  const toc = guide.headings.filter(h => h.level === 2 || h.level === 3)
  const index = order.indexOf(guide.name)
  const prev = guides.get(order[index - 1]), next = guides.get(order[index + 1])
  const pager = `<nav class="pager" aria-label="上一篇和下一篇">${prev ? `<a class="prev" href="${encodeURIComponent(prev.name)}.html"><span>上一篇</span>${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a class="next" href="${encodeURIComponent(next.name)}.html"><span>下一篇</span>${esc(next.title)}</a>` : '<span></span>'}</nav>`
  const body = `<div class="doc-layout">
<article class="prose">
${html}
<p class="edit-link"><a href="${esc(ctx.repo)}/blob/${ctx.branch}/${guide.file}" target="_blank" rel="noopener noreferrer">在 GitHub 上查看或改进此页</a></p>
${pager}
</article>
${toc.length ? `<aside class="toc" aria-label="本页目录"><p class="toc-title">本页内容</p><ul>${toc.map(h => `<li class="toc-${h.level}"><a href="#${esc(h.id)}">${esc(h.text)}</a></li>`).join('')}</ul></aside>` : ''}
</div>`
  return layout(ctx, { title: guide.title, description: guide.description || guide.title, rel: '../', body, page: guide.name, pathname: `docs/${guide.name}.html`, sidebar: renderSidebar(groups, guides, guide.name, '../') })
}

const copyable = value => `<span class="copyable"><code>${esc(value)}</code><button class="copy-button" type="button" data-copy="${esc(value)}" aria-label="复制 ${esc(value)}">复制</button></span>`

function renderHome(ctx, groups, guides) {
  const flow = steps => `<ol class="flow">${steps.map(([name, note]) => `<li><strong>${esc(name)}</strong><span>${esc(note)}</span></li>`).join('')}</ol>`
  const features = [
    ['三区分治，真源纪律', '草稿、设定与定稿，各守边界。', glyph('<rect x="3" y="5" width="4.5" height="14" rx="1"/><rect x="9.75" y="5" width="4.5" height="14" rx="1"/><rect x="16.5" y="5" width="4.5" height="14" rx="1"/>')],
    ['断更无损恢复', '从真实文件找回进度，随时继续。', glyph('<path d="M4 12a8 8 0 1 0 2.2-5.5"/><path d="M4 4.5V9h4.5"/>')],
    ['AI 辅助，作者掌舵', 'AI 提建议，你决定写什么、留什么。', glyph('<circle cx="12" cy="12" r="8"/><path d="M8.2 12.2 10.6 14.6 15.8 9.2"/>')],
    ['书稿编辑器', '选中即改，建议逐条采纳。', glyph('<path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"/><path d="M14 3.5V8h4M8 12h8M8 16h5"/>')],
    ['八维审读与篇幅核对', '检查故事与文字，核对章节篇幅。', glyph('<path d="M9 7h10M9 12h10M9 17h10"/><path d="M4.2 7.2 5.4 8.4 7.4 6.2M4.2 12.2 5.4 13.4 7.4 11.2M4.2 17.2 5.4 18.4 7.4 16.2"/>')],
    ['参考分析与检索增强', '分析参考作品，查找已写内容。', glyph('<path d="M4 6.5c2-.8 3.6-.4 5 .5 1.4-.9 3-.3 5-.5v11c-2 .8-3.6.4-5-.5-1.4.9-3 .3-5 .5z"/><circle cx="17" cy="16" r="2.4"/><path d="M18.8 17.8 21 20"/>')],
  ]
  const featureCard = ([title, text, iconSvg]) => `<article class="feature"><div class="feature-icon">${iconSvg}</div><h3>${esc(title)}</h3><p>${esc(text)}</p></article>`
  const shots = [
    ['menu', '选区菜单', '新编辑器右键菜单', 'docs/images/editor-8.2/menu.png'],
    ['suggestion', '行内建议', '行内改写候选', 'docs/images/editor-8.2/suggestion.png'],
    ['comment', '批注', '原文上的审读批注', 'docs/images/editor-8.2/comment.png'],
  ]
  const plugins = [
    ['写作工作台', 'dsh-scriptor', '核心写作功能 · 必装'],
    ['检索增强', 'dsh-scriptor-retrieval', '长篇回查，按意思找旧章节 · 可选'],
    ['鲸鱼娘', 'dsh-scriptor-companion', '桌面陪伴 · 可选'],
    ['完整版', 'dsh-scriptor-full', '写作 + 检索，不含桌宠；与单装二选一'],
  ]
  const body = `<section class="hero">
  <div class="hero-inner">
    <div>
      <p class="eyebrow">为长篇创作而设计</p>
      <h1>DSH Scriptor</h1>
      <p class="tagline">长篇小说写作工作台</p>
      <p class="lead">从构想到定稿，陪你把一本书写完。</p>
      <div class="actions">
        <a class="button primary" href="docs/install.html">开始安装</a>
        <a class="button" href="docs/beginner.html">新手教程</a>
        <a class="button ghost" href="${esc(ctx.tree)}" target="_blank" rel="noopener noreferrer">${icon.github}<span>GitHub</span></a>
      </div>
      <div class="product-meta" aria-label="产品信息">${infoLink('docs/install.html#平台与测试范围', 'Windows：完整测试与安装验证', infoIcons.windows)}${infoLink('docs/install.html#平台与测试范围', 'Linux：已纳入自动构建和测试', infoIcons.linux)}${infoLink('docs/install.html#平台与测试范围', 'macOS：暂无测试环境，未验证不代表不支持', infoIcons.mac)}<span class="meta-divider" aria-hidden="true"></span>${infoLink('docs/privacy.html', '作品保存在本地', infoIcons.local)}${infoLink('docs/configuration.html', '自备模型 API', infoIcons.api)}${infoLink(`${ctx.repo}/blob/${ctx.branch}/LICENSE`, 'GPL-3.0-only 开源许可证', infoIcons.license)}</div>
    </div>
    <div class="editor-mock" aria-hidden="true">
      <div class="editor-mock-bar"><i></i><i></i><i></i><span>河埠旧事 · 退潮以前</span></div>
      <div class="editor-mock-body">
        <p>“我知道。”母亲说。</p>
        <p><span class="mock-del">林岑准备好的话反而说不出来了。</span></p>
        <p><span class="mock-ins">林岑准备好的话没出口。手指在桌沿停了一下。</span><span class="mock-tools"><span>采纳</span><span>拒绝</span><span>换一版</span></span></p>
        <p>房租、水电、母亲一个人撑着的店，她一样也没提。</p>
      </div>
    </div>
  </div>
</section>

<section class="section video-section" aria-labelledby="video-title">
  <div class="section-inner">
    <h2 id="video-title">两分钟了解 Scriptor</h2>
    <div class="video-frame">
      <video controls preload="none" playsinline poster="docs/images/video-poster.png">
        <source src="docs/media/intro.mp4" type="video/mp4">
        <track kind="subtitles" srclang="zh" label="中文" src="docs/media/intro.vtt" default>
        你的浏览器不支持内嵌视频，可<a href="docs/media/intro.mp4">直接下载 MP4</a>。
      </video>
    </div>
    <p class="video-links">${infoLink("docs/media/intro.mp4", "下载视频（1080P MP4）", infoIcons.download)}${infoLink("docs/media/intro.srt", "下载 SRT 字幕", infoIcons.captions)}</p>
  </div>
</section>

<section class="section" aria-labelledby="zones-title">
  <div class="section-inner">
    <h2 id="zones-title">三区分治</h2>
    <div class="zones">
      <article class="zone"><h3>草稿区</h3><p>自由试写，逐稿留存。</p></article>
      <p class="zone-gate">专用工具写入</p>
      <article class="zone"><h3>真源区</h3><p>契约、设定、大纲与记忆。</p></article>
      <p class="zone-gate">作者批准</p>
      <article class="zone zone-final"><h3>定稿区</h3><p>作者批准，留档可追溯。</p></article>
    </div>
  </div>
</section>

<section class="section alt" aria-labelledby="features-title">
  <div class="section-inner">
    <h2 id="features-title">为长篇连载而设计</h2>
    <div class="feature-grid feature-main">${features.slice(0, 3).map(featureCard).join('')}</div>
    <div class="feature-grid feature-sub">${features.slice(3).map(featureCard).join('')}</div>
  </div>
</section>

<section class="section" aria-labelledby="editor-title">
  <div class="section-inner">
    <h2 id="editor-title">在编辑器里改稿</h2>
    <div class="gallery" data-gallery>
      <div class="gallery-tabs" role="tablist" aria-label="编辑器界面">
        ${shots.map(([id, label], index) => `<button type="button" role="tab" id="tab-${id}" aria-controls="panel-${id}" aria-selected="${index === 0 ? 'true' : 'false'}" data-tab="${id}">${esc(label)}</button>`).join('')}
      </div>
      ${shots.map(([id, , caption, src]) => `<figure class="gallery-panel" role="tabpanel" id="panel-${id}" aria-labelledby="tab-${id}" data-tab="${id}"><img src="${src}" alt="${esc(caption)}"></figure>`).join('')}
    </div>
  </div>
</section>

<section class="section alt" aria-labelledby="flow-title">
  <div class="section-inner">
    <h2 id="flow-title">创作工作流程</h2>
    <div class="workflow-layout">
      <section class="workflow-phase" aria-labelledby="design-phase-title">
        <header class="workflow-heading"><span class="phase-label">01</span><h3 id="design-phase-title">作品设计</h3></header>
        ${flow([['灵感与立项', '探索题材、人物与核心冲突'], ['作品契约', '确定风格、篇幅与创作边界'], ['世界书', '整理人物、规则与地点'], ['卷章大纲', '铺好骨架、分卷与近期窗口']])}
      </section>
      <section class="workflow-phase chapter-phase" aria-labelledby="chapter-phase-title">
        <header class="workflow-heading"><span class="phase-label">02</span><h3 id="chapter-phase-title">每章创作</h3></header>
        <ol class="timeline">
          <li class="chapter-row"><div class="chapter-step"><span class="step-index">01</span><div><strong>确认细纲</strong><p>明确本章目标与场景</p></div></div><span class="stage-arrow" aria-hidden="true">→</span><div class="chapter-step"><span class="step-index">02</span><div><strong>写作备料</strong><p>取用已确认的设定</p></div></div></li>
          <li class="revision-stage"><div class="chapter-row"><div class="chapter-step"><span class="step-index">03</span><div><strong>正文起草</strong><p>专注子代理完成草稿</p></div></div><span class="stage-arrow" aria-hidden="true">→</span><div class="chapter-step"><span class="step-index">04</span><div><strong>八维审读</strong><p>从结构检查到文本规范</p></div></div></div><p class="loop-return"><span aria-hidden="true">↶</span> 有发现项时：改稿 → 再审读</p></li>
          <li class="chapter-row"><div class="chapter-step is-gate"><span class="step-index">05</span><div><strong>作者裁决 <span class="gate-flag">唯一门禁</span></strong><p>由你核对并批准定稿</p></div></div><span class="stage-arrow" aria-hidden="true">→</span><div class="chapter-step"><span class="step-index">06</span><div><strong>定稿入档</strong><p>保存正文与版本记录</p></div></div></li>
        </ol>
      </section>
    </div>
  </div>
</section>

<section class="section" aria-labelledby="install-title">
  <div class="section-inner">
    <h2 id="install-title">三步开始</h2>
    <ol class="steps">
      <li><h3>安装客户端</h3><p>前往 <a href="${esc(ctx.dshWebsite)}" target="_blank" rel="noopener noreferrer">DeepSeek Harness 官网</a>，安装配套的 <strong>${esc(ctx.dsh)}</strong>，打开 <strong>插件 → 添加插件</strong>。</p></li>
      <li><h3>安装插件</h3><p>粘贴下面的标识，核对预览后安装，按提示应用变更：</p>${copyable(ctx.pkg('dsh-scriptor'))}</li>
      <li><h3>开始第一本书</h3><p>配置聊天模型与凭据，选择作品工作区，按 <a href="docs/first-book.html">第一本书与第一章</a> 开始。</p></li>
    </ol>
    <div class="table-wrap"><table class="plugin-table">
      <thead><tr><th>插件</th><th>安装标识</th><th>用途</th></tr></thead>
      <tbody>${plugins.map(([name, id, use]) => `<tr><td>${esc(name)}</td><td>${copyable(ctx.pkg(id))}</td><td>${esc(use)}</td></tr>`).join('')}</tbody>
    </table></div>
    <p class="home-links"><a href="docs/upgrade-backup.html">升级指南 →</a><a href="${esc(ctx.release)}" target="_blank" rel="noopener noreferrer">发行件与校验和 →</a></p>
  </div>
</section>

<section class="section alt" aria-labelledby="docs-title">
  <div class="section-inner">
    <h2 id="docs-title">文档</h2>
    ${groups.map(group => `<h3 class="docs-group">${esc(group.title)}</h3><div class="doc-grid">${group.pages.map(page => {
    const guide = guides.get(page.name)
    return `<a class="doc-card" href="docs/${encodeURIComponent(page.name)}.html"><strong>${esc(page.label || guide.title)}</strong><span aria-hidden="true">↗</span></a>`
  }).join('')}</div>`).join('')}
    <p class="home-links"><a href="${esc(ctx.repo)}/tree/master" target="_blank" rel="noopener noreferrer" title="Claude Code v6：安装方式不同，暂无直接迁移方案">Claude Code 版（v6）↗</a></p>
  </div>
</section>
<section class="section" aria-labelledby="community-title">
  <div class="section-inner">
    <h2 id="community-title">赞助与交流</h2>
    <div class="community-grid">
      <article class="community-card"><div class="feature-icon">${infoIcons.feedback}</div><h3>交流与反馈</h3><p>公开问题欢迎讨论；不便公开的交流，请邮件联系。</p><div class="home-links"><a href="${esc(ctx.repo)}/discussions">参与讨论 ↗</a><a class="contact-mail" href="mailto:ksdflisjdf@gmail.com">${infoIcons.mail}<span>ksdflisjdf@gmail.com</span></a></div></article>
      <article class="community-card"><div class="feature-icon">${infoIcons.heart}</div><h3>赞助与合作</h3><p>支持项目维护，或洽谈 README 赞助商展示与广告合作。</p><div class="home-links"><a href="mailto:ksdflisjdf@gmail.com?subject=Scriptor%20%E8%B5%9E%E5%8A%A9%E4%B8%8E%E5%90%88%E4%BD%9C">邮件沟通 ↗</a><a href="${esc(ctx.repo)}/blob/${ctx.branch}/README.md#赞助商与广告合作">合作说明 ↗</a></div></article>
    </div>
  </div>
</section>`
  return layout(ctx, { title: 'DSH Scriptor', description: '基于 DeepSeek Harness 的本地优先长篇小说写作工作台：构想、设定、大纲、写章、审读、定稿、记忆与导出一体化。', rel: '', pathname: '', body, page: 'home' })
}

function render404(ctx) {
  const body = `<section class="hero not-found"><div class="hero-inner"><p class="eyebrow">404</p><h1>页面不存在</h1><p class="lead">链接可能已经变更。可以从首页或文档目录继续。</p><div class="actions"><a class="button primary" href="index.html">返回首页</a><a class="button" href="docs/beginner.html">打开文档</a></div></div></section>`
  // 404.html is served from arbitrary paths, so it uses absolute repository-scoped URLs.
  const base = `/${ctx.repo.split('/').at(-1)}/`
  return layout(ctx, { title: '页面不存在', description: '页面不存在', rel: base, pathname: '404.html', body: body.replaceAll('href="index.html"', `href="${base}index.html"`).replaceAll('href="docs/', `href="${base}docs/`), page: 'home' })
}

function writeFile(out, relative, content) {
  const file = path.join(out, ...relative.split('/'))
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

function copyFile(from, out, relative) {
  const file = path.join(out, ...relative.split('/'))
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.copyFileSync(from, file)
}

export function buildSite({ root = defaultRoot, out = defaultOut } = {}) {
  root = path.resolve(root)
  out = path.resolve(out)
  assert.ok(out !== root && !root.startsWith(out + path.sep), 'Output directory must not contain the repository')
  const ctx = readContext(root)
  const md = createMarkdown(root)
  const names = fs.readdirSync(path.join(root, GUIDES)).filter(file => file.endsWith('.md')).map(file => file.slice(0, -3)).sort()
  const groups = orderGuides(names)
  const order = groups.flatMap(group => group.pages.map(page => page.name))
  const guides = new Map(names.map(name => [name, parseGuide(md, root, name)]))
  const assets = new Set(['images/video-poster.png', 'media/intro.mp4', 'media/intro.srt', 'images/editor-8.2/menu.png', 'images/editor-8.2/suggestion.png', 'images/editor-8.2/comment.png'])
  const warnings = []
  for (const guide of guides.values()) rewriteLinks(guide, guides, ctx, root, assets, warnings)

  fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(out, { recursive: true })
  for (const guide of guides.values()) writeFile(out, `docs/${guide.name}.html`, renderGuide(md, ctx, guide, groups, guides, order))
  writeFile(out, 'index.html', renderHome(ctx, groups, guides))
  writeFile(out, '404.html', render404(ctx))
  for (const asset of [...assets].sort()) {
    checkPublicPath(`${GUIDES}${asset}`)
    copyFile(path.join(root, GUIDES, ...asset.split('/')), out, `docs/${asset}`)
  }
  writeFile(out, 'docs/media/intro.vtt', srtToVtt(fs.readFileSync(path.join(root, GUIDES, 'media/intro.srt'), 'utf8')))
  for (const file of fs.readdirSync(path.join(here, 'assets'))) copyFile(path.join(here, 'assets', file), out, `assets/${file}`)
  writeFile(out, 'assets/theme.css', renderThemeCss())
  const index = order.map(name => {
    const guide = guides.get(name)
    return { title: guide.title, url: `docs/${encodeURIComponent(name)}.html`, sections: searchSections(guide) }
  })
  writeFile(out, 'assets/search-index.js', `window.__SCRIPTOR_SEARCH__=${JSON.stringify(index).replace(/</g, '\\u003c')};\n`)

  const files = []
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(file)
      else files.push(file)
    }
  }
  walk(out)
  for (const file of files) {
    if (/\.(html|js|css|vtt|srt|svg)$/.test(file)) checkPublicText(path.relative(out, file), fs.readFileSync(file))
  }
  return { out, pages: guides.size + 1, files: files.length, warnings }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const outFlag = process.argv.indexOf('--out')
  const result = buildSite({ out: outFlag > 0 ? process.argv[outFlag + 1] : defaultOut })
  for (const warning of result.warnings) console.warn(`[pages] warning: ${warning}`)
  console.log(`[pages] ${result.pages} pages, ${result.files} files -> ${path.relative(process.cwd(), result.out) || result.out}`)
  if (process.argv.includes('--strict') && result.warnings.length) process.exitCode = 1
}
