import { promises as fs } from 'node:fs'
import path from 'node:path'
import { detectHosts, parseHostsOverride } from './detect.js'
import { collectRuntimeFiles } from './vendor.js'
import { readManifest, writeManifest, classifyFile, sha256 } from './manifest.js'
import { buildShellFiles, mergeClaudeSettings, SESSION_HOOK_COMMAND } from './shells.js'

/**
 * 安装器编排（multi-agent spec §8）：init/update 同一核心——环境检测 → 组文件集
 * （vendor 运行时 + 平台壳 + AGENTS.md 标记块）→ 哈希三态写入 → books.jsonl 保底 →
 * hook 接线 → 清单 → 人话报告。幂等可重跑;不联网、不改全局、工作目录不建 git 仓库（§8.3）。
 */

const START = '<!-- WEBNOVEL:START -->'
const END = '<!-- WEBNOVEL:END -->'
const AGENTS = 'AGENTS.md'

export async function installWorkdir(ctx, { hostsOverride = null, force = false, env = process.env } = {}) {
  const { workdir, packageRoot } = ctx

  // 护栏：vendored 副本自我更新是空转
  if (path.basename(packageRoot) === '.webnovel') {
    return fail('这是装进工作目录的运行副本，自我更新是空转。请在工作目录运行：npx webnovel-writer update')
  }
  // 护栏：别把工作目录装进书仓库里
  if (await exists(path.join(workdir, 'book.yaml'))) {
    return fail('这里是书仓库（有 book.yaml）。工作目录应是它的上一层——请到上一层目录运行 init。')
  }

  let registry
  try {
    registry = JSON.parse(await fs.readFile(path.join(packageRoot, 'adapters', 'registry.json'), 'utf8'))
  } catch (err) {
    return fail(`安装包不完整（读不到宿主注册表）：${err.message}`)
  }
  let pkgVersion = ''
  try {
    pkgVersion = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8')).version || ''
  } catch {
    // 版本缺失不阻断
  }

  // 宿主集：显式覆盖 > 探测 ∪ 既装（update 时已装壳的宿主继续跟新）
  const detected = await detectHosts(registry, { env })
  const manifest = await readManifest(workdir)
  const alreadyInstalled = manifestHosts(manifest, registry)
  let hosts
  if (hostsOverride) {
    const p = parseHostsOverride(hostsOverride, registry)
    if (!p.ok) return fail(p.error)
    hosts = p.hosts
  } else {
    hosts = [...new Set([...detected, ...alreadyInstalled])]
  }

  // 文件集：vendor 运行时 + 平台壳（books.jsonl / settings.json 不在内,单独处理）
  let files
  try {
    files = {
      ...(await collectRuntimeFiles(packageRoot)),
      ...(await buildShellFiles(packageRoot, registry, hosts)),
    }
  } catch (err) {
    return fail(`组装安装文件失败：${err.message}`)
  }

  // 哈希三态写入。新清单以旧清单为底：本轮未涉及的宿主/文件保留旧记录，
  // 否则下次全量 update 会把它们判成 new 而静默覆盖用户手改（违反 §8 不静默覆盖）
  const written = []
  const skipped = []
  const newFiles = { ...(manifest?.files || {}) }
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(workdir, rel)
    const disk = await readIfExists(full)
    const cls = classifyFile(rel, disk == null ? null : sha256(disk), manifest)
    const newHash = sha256(content)
    if (cls === 'user-modified' && !force) {
      skipped.push(rel) // 旧记录已在底表,下次仍能识别用户改动
      continue
    }
    if (disk !== content) {
      await fs.mkdir(path.dirname(full), { recursive: true })
      await fs.writeFile(full, content, 'utf8')
      written.push(rel)
    }
    newFiles[rel] = newHash
  }

  // AGENTS.md：标记块管理（块内归安装器,块外归用户）
  const agents = await installAgentsMd(workdir, packageRoot, manifest, force)
  if (agents.written) written.push(AGENTS)
  if (agents.skipped) skipped.push(AGENTS)
  if (agents.hash) newFiles[AGENTS] = agents.hash

  // books.jsonl：用户数据,只保底存在,永不覆盖、不进清单
  const booksPath = path.join(workdir, '.webnovel', 'books.jsonl')
  if (!(await exists(booksPath))) {
    await fs.mkdir(path.dirname(booksPath), { recursive: true })
    await fs.writeFile(booksPath, '', 'utf8')
  }

  // claude-code hook 接线：settings.json 保留式合并,不进清单
  const notes = []
  if (hosts.includes('claude-code')) {
    const settingsPath = path.join(workdir, '.claude', 'settings.json')
    const merged = mergeClaudeSettings(await readIfExists(settingsPath), SESSION_HOOK_COMMAND)
    if (merged.error) notes.push(merged.error)
    else if (merged.changed) {
      await fs.mkdir(path.dirname(settingsPath), { recursive: true })
      await fs.writeFile(settingsPath, merged.content, 'utf8')
      written.push('.claude/settings.json')
    }
  }
  // OpenCode（F7）：skills/agents/plugins 为启动时加载——装完须重启宿主才生效（S0-B1 实测）
  if (hosts.includes('opencode')) {
    notes.push('OpenCode 请重启后生效：skills/agents/plugins 都在进程启动时加载一次。')
  }
  if (agents.note) notes.push(agents.note)

  await writeManifest(workdir, { version: pkgVersion, files: newFiles })

  const report = buildReport({
    workdir,
    version: pkgVersion,
    hosts,
    detected,
    registry,
    written,
    skipped,
    notes,
    updating: !!manifest,
    force,
  })
  return { ok: true, report, hosts, detected, written, skipped, notes, error: '' }
}

/* ---------- AGENTS.md 标记块 ---------- */

async function installAgentsMd(workdir, packageRoot, manifest, force) {
  let templateBlock
  try {
    const t = await fs.readFile(path.join(packageRoot, 'templates', 'AGENTS.md'), 'utf8')
    templateBlock = extractBlock(t) ?? t.trim()
  } catch (err) {
    return { note: `AGENTS.md 模板缺失，跳过：${err.message}` }
  }
  const full = path.join(workdir, AGENTS)
  const hash = sha256(templateBlock)
  const existing = await readIfExists(full)

  if (existing == null) {
    await fs.writeFile(full, templateBlock + '\n', 'utf8')
    return { written: true, hash }
  }
  const currentBlock = extractBlock(existing)
  if (currentBlock == null) {
    // 用户自己的 AGENTS.md（无标记块）：块前置,原内容全保留
    await fs.writeFile(full, templateBlock + '\n\n' + existing, 'utf8')
    return { written: true, hash, note: '你已有 AGENTS.md：webnovel 块已加到开头，原内容未动。' }
  }
  const cls = classifyFile(AGENTS, sha256(currentBlock), manifest)
  if (cls === 'user-modified' && !force) {
    return { skipped: true, hash: manifest.files[AGENTS] }
  }
  if (currentBlock !== templateBlock) {
    await fs.writeFile(full, existing.replace(currentBlock, templateBlock), 'utf8')
    return { written: true, hash }
  }
  return { hash }
}

function extractBlock(text) {
  const i = text.indexOf(START)
  const j = text.indexOf(END)
  if (i === -1 || j === -1 || j < i) return null
  return text.slice(i, j + END.length)
}

/* ---------- 报告与杂项 ---------- */

function manifestHosts(manifest, registry) {
  if (!manifest) return []
  const hosts = []
  for (const [host, cfg] of Object.entries(registry.hosts)) {
    if (host === '_default' || !cfg.install_dir) continue
    // 清单键统一正斜杠
    if (Object.keys(manifest.files).some((k) => k.startsWith(cfg.install_dir + '/'))) {
      hosts.push(host)
    }
  }
  return hosts
}

function buildReport({ workdir, version, hosts, detected, registry, written, skipped, notes, updating, force }) {
  const lines = []
  lines.push(`${updating ? '升级' : '安装'}完成：${path.basename(workdir) || workdir}（webnovel-writer ${version}）`)
  lines.push(`Node ${process.version} ✓（门槛 22.13.0）`)

  if (hosts.length) {
    lines.push('平台壳：')
    for (const h of hosts) {
      const cfg = registry.hosts[h] || {}
      const tier = cfg.tier ? `${cfg.tier === 1 ? '一' : cfg.tier === 2 ? '二' : '三'}级${cfg.verified ? `（${cfg.verified}）` : ''}` : ''
      const cap = []
      cap.push(cfg.agentCapable ? '两审=独立 subagent' : '两审=兼容模式（顺序自审，如实声明）')
      cap.push(
        cfg.hasHooks
          ? 'SessionStart 只注入当前书、本数与全书近况入口'
          : '启动时由 SKILL 显式运行 session-context'
      )
      lines.push(`  - ${h} → ${cfg.install_dir}/  ${tier}；${cap.join('；')}${detected.includes(h) ? '' : '（未在 PATH 检测到，按既装/指定生成）'}`)
    }
  } else {
    lines.push('未检测到任何 agent CLI：只装了公约数层（AGENTS.md + .webnovel/）。')
    lines.push('装好某个 agent CLI 后重跑 init，或显式指定：npx webnovel-writer init --hosts=claude-code,codex')
  }

  lines.push(`写入 ${written.length} 个文件${skipped.length ? `；跳过 ${skipped.length} 个你改过的文件：${skipped.join('、')}${force ? '' : '（要覆盖用 --force）'}` : ''}`)
  for (const n of notes) lines.push(`注意：${n}`)
  lines.push('下一步：在这个目录打开你的 agent CLI，对它说「开始写书」。')
  return lines.join('\n')
}

async function exists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}
async function readIfExists(p) {
  try {
    return await fs.readFile(p, 'utf8')
  } catch {
    return null
  }
}
function fail(error) {
  return { ok: false, report: '', hosts: [], detected: [], written: [], skipped: [], notes: [], error }
}
