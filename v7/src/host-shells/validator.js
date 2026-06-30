import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseFrontMatter } from '../storage/parsers/front-matter.js'
import { generateHostShells } from './generate.js'

/** package validator（多智能体 spec v3.4 §9）:registry/support.md/description 预算/无本机绝对路径 */

// 本机绝对路径：Windows 盘符(C:\ / C:/) | UNC(\\host) | Unix 绝对路径(/tmp/x /opt/foo /root/bar /mnt/d ...)
// 盘符前加 (?<![A-Za-z]) 避开 URL scheme(https://)误判;Unix 段以字母起、2+ 段,避开 and/or 这类
const ABS_PATH = /(?<![A-Za-z])[A-Za-z]:[\\/]|\\{2}[^\\]|(?<![\w/])\/[A-Za-z][\w-]*(?:\/[A-Za-z][\w-]*)+/
const CODEX_DESC_BUDGET = 8192

export async function validatePackage(baseDir) {
  const errors = []

  let registry
  try {
    registry = JSON.parse(await fs.readFile(path.join(baseDir, 'adapters', 'registry.json'), 'utf8'))
  } catch (e) {
    return { ok: false, errors: [`registry.json 读取/解析失败：${e.message}`] }
  }
  if (!registry.schema_version) errors.push('registry 缺 schema_version')
  if (!registry.hosts || typeof registry.hosts !== 'object') {
    return { ok: false, errors: [...errors, 'registry 缺 hosts'] }
  }
  for (const [host, h] of Object.entries(registry.hosts)) {
    if (host === '_default') continue
    if (h.tier == null) errors.push(`${host} 缺 tier`)
    if (h.tier === 1) {
      try {
        await fs.access(path.join(baseDir, 'adapters', host, 'support.md'))
      } catch {
        errors.push(`一级宿主 ${host} 缺 support.md`)
      }
    }
  }

  const rolesDir = path.join(baseDir, 'roles')
  let roleFiles = []
  try {
    roleFiles = (await fs.readdir(rolesDir)).filter((f) => f.endsWith('.md'))
  } catch {
    errors.push('缺 roles/ 目录')
  }
  for (const f of roleFiles) {
    const raw = await fs.readFile(path.join(rolesDir, f), 'utf8')
    const parsed = parseFrontMatter(raw)
    if (!parsed.ok || !parsed.data.name) errors.push(`角色 ${f} 缺 frontmatter name`)
    if (!parsed.ok || !parsed.data.description) errors.push(`角色 ${f} 缺 description`)
    if (ABS_PATH.test(raw)) errors.push(`角色 ${f} 含本机绝对路径`)
  }

  try {
    const skillRaw = await fs.readFile(path.join(baseDir, 'skills', 'webnovel-writer', 'SKILL.md'), 'utf8')
    const skill = parseFrontMatter(skillRaw)
    const desc = (skill.ok && skill.data.description) || ''
    if (desc.length > CODEX_DESC_BUDGET) errors.push(`SKILL description 超 Codex 8k 预算：${desc.length}`)
    if (ABS_PATH.test(skillRaw)) errors.push('SKILL.md 含本机绝对路径')
  } catch (e) {
    errors.push(`SKILL.md 读取失败：${e.message}`)
  }

  // 生成物无本机绝对路径
  try {
    const out = await generateHostShells(baseDir)
    for (const [host, files] of Object.entries(out)) {
      for (const [rel, content] of Object.entries(files)) {
        if (ABS_PATH.test(content)) errors.push(`生成物 ${host}/${rel} 含本机绝对路径`)
      }
    }
  } catch (e) {
    errors.push(`生成器运行失败：${e.message}`)
  }

  return { ok: errors.length === 0, errors }
}

/** drift check:同输入连跑两次逐字节一致(确定性) + validator 通过。CI 必跑。 */
export async function driftCheck(baseDir) {
  const a = JSON.stringify(await generateHostShells(baseDir))
  const b = JSON.stringify(await generateHostShells(baseDir))
  if (a !== b) return { ok: false, error: '生成器输出非确定（drift）' }
  const v = await validatePackage(baseDir)
  return { ok: v.ok, error: v.ok ? '' : `validator 失败：${v.errors.join('；')}` }
}
