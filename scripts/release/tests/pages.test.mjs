import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { buildSite, createMarkdown, createSlugger, srtToVtt } from '../../../site/build.mjs'
import { PALETTES } from '../../../site/palettes.mjs'
import { root } from '../version.mjs'

function channel(value) {
  const s = value / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function luminance(hex) {
  const n = Number.parseInt(hex.slice(1), 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

function contrast(foreground, background) {
  const left = luminance(foreground)
  const right = luminance(background)
  const lighter = Math.max(left, right)
  const darker = Math.min(left, right)
  return (lighter + 0.05) / (darker + 0.05)
}

const CONTRAST_PAIRS = [
  ['正文 / 底', 'text', 'bg'],
  ['次要字 / 底', 'soft', 'bg'],
  ['次要字 / 浅底', 'soft', 'bgAlt'],
  ['链接 / 底', 'link', 'bg'],
  ['链接 / 卡片', 'link', 'panel'],
  ['按钮字 / 主色', 'onAccent', 'accent'],
  ['按钮字 / 主色悬停', 'onAccent', 'accentStrong'],
  ['点缀 / 底', 'mark', 'bg'],
  ['点缀 / 浅底', 'mark', 'bgAlt'],
  ['说明 / 底', 'note', 'bg'],
  ['提示 / 底', 'tip', 'bg'],
  ['重要 / 底', 'important', 'bg'],
  ['警告 / 底', 'warning', 'bg'],
  ['注意 / 底', 'caution', 'bg'],
]

test('palette contrast meets WCAG AA for every scheme and mode', () => {
  const failures = []
  for (const [id, palette] of Object.entries(PALETTES)) {
    for (const mode of ['light', 'dark']) {
      const tokens = palette[mode]
      for (const [name, foreground, background] of CONTRAST_PAIRS) {
        const ratio = contrast(tokens[foreground], tokens[background])
        if (!(ratio >= 4.5)) failures.push(`${id} ${mode} ${name} ${ratio.toFixed(2)}:1`)
      }
    }
  }
  assert.equal(failures.length, 0, failures.join('; '))
})

function renderFixture(source, file = 'docs/user/fixture.md') {
  return createMarkdown(root).render(source, { file })
}

test('markdown renders alerts, prompts, steps, shortcuts and captions', () => {
  const alerts = renderFixture('> [!NOTE]\n> 说明正文\n\n> [!TIP]\n> 提示正文\n\n> [!IMPORTANT]\n> 重要正文\n\n> [!WARNING]\n> 警告正文\n\n> [!CAUTION]\n> 注意正文\n')
  for (const [kind, label] of [['note', '说明'], ['tip', '提示'], ['important', '重要'], ['warning', '警告'], ['caution', '注意']]) {
    assert.match(alerts, new RegExp(`class="callout callout-${kind}"`))
    assert.match(alerts, new RegExp(`callout-${kind}[\\s\\S]*${label}`))
  }
  assert.doesNotMatch(alerts, /\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/)

  assert.throws(
    () => renderFixture('> [!NOPE]\n> 不行\n', 'docs/user/bad.md'),
    /Unknown alert type in docs\/user\/bad\.md: \[!NOPE\]/,
  )

  const prompt = renderFixture('> 继续写下一章\n')
  assert.match(prompt, /<figure class="prompt">/)
  assert.match(prompt, /<figcaption>发给工作台<\/figcaption>/)
  assert.match(prompt, /data-copy-prompt/)
  assert.match(prompt, /继续写下一章/)

  const steps = renderFixture('1. 第一步\n   1. 嵌套\n2. 第二步\n')
  const lists = [...steps.matchAll(/<ol\b[^>]*>/g)].map(match => match[0])
  assert.equal(lists.filter(tag => tag.includes('class="steps"')).length, 1)
  assert.ok(lists.some(tag => !tag.includes('steps')))

  const resumedSteps = renderFixture('3. 接着核对正文\n4. 保存文件\n')
  assert.match(resumedSteps, /<ol start="3" class="steps">/)
  const css = fs.readFileSync(path.join(root, 'site/assets/style.css'), 'utf8')
  assert.match(css, /ol\.steps > li::before\s*\{\s*content: counter\(list-item\)/)
  assert.doesNotMatch(css, /counter-reset:\s*(?:step|list-item)\b/)

  const keys = renderFixture('用 `Ctrl+K` 打开，单个 `A` 仍是代码，搜索是 `/`。\n')
  assert.match(keys, /<kbd>Ctrl\+K<\/kbd>/)
  assert.match(keys, /<code>A<\/code>/)
  assert.doesNotMatch(keys, /<kbd>A<\/kbd>/)
  assert.match(keys, /<kbd>\/<\/kbd>/)

  const shot = renderFixture('![书房书架](images/beginner/09-study-bookshelf.png)\n')
  assert.match(shot, /<figure class="shot">/)
  assert.match(shot, /<figcaption>书房书架<\/figcaption>/)
  assert.match(shot, /alt="书房书架"/)
})

test('site stylesheet keeps palette colors in variables', () => {
  const css = fs.readFileSync(path.join(root, 'site/assets/style.css'), 'utf8')
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/)
  assert.doesNotMatch(css, /SimSun|Songti|STSong|Source Han Serif|Noto Serif|(?<!sans-)serif/)
})

test('theme boots from storage before stylesheets', () => {
  withTempDir(out => {
    buildSite({ root, out })
    const home = fs.readFileSync(path.join(out, 'index.html'), 'utf8')
    assert.match(home, /<html[^>]* data-palette="A"/)
    const head = home.slice(0, home.indexOf('</head>'))
    const boot = head.indexOf("localStorage.getItem('scriptor-palette')")
    const sheet = head.indexOf('<link rel="stylesheet"')
    assert.ok(boot >= 0 && boot < sheet, 'palette script must run before the first stylesheet')
    assert.match(head, /scriptor-theme/)
    const theme = fs.readFileSync(path.join(out, 'assets/theme.css'), 'utf8')
    for (const id of ['A', 'B', 'C']) {
      assert.match(theme, new RegExp(`:root\\[data-palette="${id}"\\]\\{`))
      assert.match(theme, new RegExp(`:root\\[data-palette="${id}"\\]\\[data-theme="dark"\\]`))
      assert.match(theme, new RegExp(`:root\\[data-palette="${id}"\\]:not\\(\\[data-theme="light"\\]\\)`))
    }
    assert.match(theme, /--bg:#f6f4ee/)
    assert.match(theme, /--bg-alt:/)
    assert.match(theme, /--accent-strong:/)
    assert.match(theme, /--on-accent:/)
    const js = fs.readFileSync(path.join(out, 'assets/site.js'), 'utf8')
    assert.match(js, /scriptor-palette/)
    assert.match(js, /scriptor-theme/)
    assert.match(home, /property="og:url" content="https:\/\/lingfengqaq\.github\.io\/webnovel-writer\/"/)
    assert.match(home, /property="og:image" content="https:\/\/lingfengqaq\.github\.io\/webnovel-writer\/docs\/images\/video-poster\.png"/)
    assert.match(home, /name="twitter:card" content="summary_large_image"/)
    assert.match(home, /data-appearance/)
    assert.match(home, /role="dialog" aria-label="外观设置"/)
    assert.doesNotMatch(home, /data-theme-toggle/)
    assert.match(home, /class="editor-mock"/)
    assert.match(home, /专用工具写入/)
    assert.match(home, /作者批准/)
    assert.match(home, /class="timeline"/)
    assert.match(home, /唯一门禁/)
    assert.match(home, /有发现项时/)
    assert.match(home, /data-gallery/)
    assert.match(home, /docs\/images\/editor-8\.2\/menu\.png/)
    const install = fs.readFileSync(path.join(out, 'docs/install.html'), 'utf8')
    assert.match(install, /property="og:url" content="https:\/\/lingfengqaq\.github\.io\/webnovel-writer\/docs\/install\.html"/)
    assert.match(install, /href="\.\.\/docs\/install\.html" aria-current="page">安装<\/a>/)
  })
})

function withTempDir(fn) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'scriptor-pages-')))
  try { return fn(dir) } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

function listFiles(directory) {
  const files = []
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name)
      if (entry.isDirectory()) walk(file)
      else files.push(path.relative(directory, file).replaceAll('\\', '/'))
    }
  }
  walk(directory)
  return files.sort()
}

test('github slugger keeps Chinese anchors compatible with existing links', () => {
  const slug = createSlugger()
  assert.equal(slug('旧项目需要更新作品契约'), '旧项目需要更新作品契约')
  assert.equal(slug('9. 全文字数与正文汉字数'), '9-全文字数与正文汉字数')
  assert.equal(slug('从单装切换为完整版'), '从单装切换为完整版')
  assert.equal(slug('为什么要固定 DSH 版本'), '为什么要固定-dsh-版本')
  assert.equal(slug('为什么要固定 DSH 版本'), '为什么要固定-dsh-版本-1')
  assert.equal(slug('保存和结果核对'), '保存和结果核对')
})

test('srt subtitles convert to webvtt cues', () => {
  const vtt = srtToVtt('﻿1\r\n00:00:01,199 --> 00:00:05,310\r\n第一句话\r\n')
  assert.match(vtt, /^WEBVTT\n\n1\n00:00:01\.199 --> 00:00:05\.310\n第一句话\n$/)
})

test('site build renders every guide and keeps links inside the artifact', () => {
  withTempDir(out => {
    const result = buildSite({ root, out })
    assert.deepEqual(result.warnings, [], `unexpected anchor warnings: ${result.warnings.join('; ')}`)
    const files = listFiles(out)
    const guides = fs.readdirSync(path.join(root, 'docs/user')).filter(file => file.endsWith('.md'))
    assert.equal(result.pages, guides.length + 1)
    for (const guide of guides) assert.ok(files.includes(`docs/${guide.replace(/\.md$/, '.html')}`), `missing page for ${guide}`)
    for (const required of ['index.html', '404.html', 'assets/style.css', 'assets/site.js', 'assets/theme.css', 'assets/search-index.js',
      'assets/favicon.svg', 'docs/media/intro.mp4', 'docs/media/intro.srt', 'docs/media/intro.vtt']) {
      assert.ok(files.includes(required), `missing ${required}`)
    }
    const home = fs.readFileSync(path.join(out, 'index.html'), 'utf8')
    assert.match(home, /@linfengqaqtat\/dsh-scriptor@8\.2\.0/)
    assert.match(home, /docs\/media\/intro\.mp4/)
    assert.doesNotMatch(home, /<(?:script|link|img|video|source|iframe)\b[^>]*\s(?:src|href)="https?:/i, 'home page must not load third-party resources')
    const install = fs.readFileSync(path.join(out, 'docs/install.html'), 'utf8')
    assert.match(install, /href="beginner\.html"/)
    assert.match(install, /href="https:\/\/github\.com\/lingfengQAQ\/webnovel-writer\/blob\/v8\/docs\/maintenance\/cli-install\.md"/)
    assert.match(install, /id="为什么要固定-dsh-版本"/)
    assert.match(install, /id="从单装切换为完整版"/)
    assert.doesNotMatch(install, /href="(?!https?:)[^"#]+\.md(#|")/, 'no raw .md links remain')
    // Every relative href/src in every page resolves inside the artifact.
    // 404.html intentionally uses repository-scoped absolute URLs (served at
    // arbitrary paths), so local resolution only covers non-absolute targets.
    for (const file of files.filter(name => name.endsWith('.html') && name !== '404.html')) {
      const html = fs.readFileSync(path.join(out, file), 'utf8')
      for (const match of html.matchAll(/(?:href|src|poster)="([^"#]+?)(?:#[^"]*)?"/g)) {
        const target = decodeURIComponent(match[1])
        if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) continue
        const resolved = target.startsWith('/') ? path.join(out, target) : path.resolve(out, path.dirname(file), target)
        assert.ok(fs.existsSync(resolved), `${file}: broken reference ${target}`)
      }
    }
    // The search index stays offline-consumable and escapes script terminators.
    const indexJs = fs.readFileSync(path.join(out, 'assets/search-index.js'), 'utf8')
    assert.match(indexJs, /^window\.__SCRIPTOR_SEARCH__=/)
    assert.ok(!indexJs.includes('</script'), 'search index must escape closing script tags')
  })
})

test('site build refuses to read or emit private paths', () => {
  withTempDir(out => {
    buildSite({ root, out })
    for (const file of listFiles(out)) {
      assert.ok(!/(^|\/)(\.trellis|session[^/]*\.jsonl|\.credentials|\.env|\.webnovel)(\/|$)/.test(file), `private path leaked: ${file}`)
      if (/\.(html|js|css|vtt|srt)$/.test(file)) {
        const text = fs.readFileSync(path.join(out, file), 'utf8')
        assert.ok(!/-----BEGIN [A-Z ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9_-]{30,}/.test(text), `credential-shaped content in ${file}`)
        assert.ok(!/[A-Z]:[\\/](?:Users|wk)[\\/]/.test(text), `absolute path in ${file}`)
      }
    }
  })
})

test('site build fails on broken guide links', () => {
  withTempDir(out => {
    const bad = path.join(root, 'docs/user/__pages_broken_link_probe.md')
    fs.writeFileSync(bad, '# 临时探针\n\n[缺失](missing-target.md)\n', 'utf8')
    try {
      assert.throws(() => buildSite({ root, out }), /Broken link/)
    } finally {
      fs.unlinkSync(bad)
      buildSite({ root, out })
    }
  })
})

test('pages workflow only deploys pushes and keeps minimal permissions', () => {
  const workflow = path.join(root, '.github/workflows/v8-pages.yml')
  const text = fs.readFileSync(workflow, 'utf8')
  assert.match(text, /branches: \[v8\]/)
  assert.match(text, /if: github\.event_name == 'push'/)
  assert.match(text, /pages: write/)
  assert.match(text, /id-token: write/)
  assert.doesNotMatch(text, /secrets\./, 'pages workflow must not use secrets')
  // Actions stay pinned to full commits like the rest of the repository; the
  // pins are resolved against the live remote only when CI provides network.
  if (process.env.CI) {
    for (const match of text.matchAll(/uses: ([^\s]+)@([0-9a-f]{40})/g)) {
      // ls-remote patterns match ref names, not commit ids. Fetch the pinned
      // object so valid historical commits do not fail merely for lacking a tag.
      withTempDir(cwd => {
        const run = args => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
        run(['init', '--quiet'])
        run(['fetch', '--quiet', '--depth=1', '--filter=blob:none', '--no-tags', `https://github.com/${match[1]}`, match[2]])
        assert.equal(run(['rev-parse', 'FETCH_HEAD^{commit}']), match[2], `unresolvable action pin ${match[1]}@${match[2]}`)
      })
    }
  }
  const unpinned = [...text.matchAll(/uses: ([^\s]+)@([^\s#]+)/g)].filter(match => !/^[0-9a-f]{40}$/.test(match[2]))
  assert.deepEqual(unpinned, [], 'every action reference must be a full commit pin')
})
