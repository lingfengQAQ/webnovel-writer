import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseFrontMatter } from '../storage/parsers/front-matter.js'
import { FACT_CATEGORIES, EDIT_CATEGORIES, SEVERITIES, SCHEMA_EXAMPLE } from '../review/schema.js'

/**
 * 宿主壳生成器（多智能体 spec v3.4 §6.3）：读 roles/ + skills/ + adapters/registry.json，
 * 渲染平台条件块 + 注入 schema 单源，产各平台 agent 壳与编译后 SKILL。
 * 确定性:同输入必同输出（drift check 基础）。不联网、不改业务源。
 */

/** schema 单源注入上下文(category/severity/范例来自 schema.js,角色与校验器不双表) */
function schemaContext() {
  return {
    categories: { factCheck: FACT_CATEGORIES.join('、'), editorial: EDIT_CATEGORIES.join('、') },
    severities: SEVERITIES.join(' | '),
    schema: { example: JSON.stringify(SCHEMA_EXAMPLE, null, 2) },
  }
}

/** 零依赖模板渲染:{{#if v}}/{{#unless v}} 条件块（非嵌套）+ {{a.b}} 变量插值 */
export function renderTemplate(text, ctx) {
  let t = text.replace(/\{\{#if (\w+)\}\}\n?([\s\S]*?)\{\{\/if\}\}\n?/g, (_, v, b) => (ctx[v] ? b : ''))
  t = t.replace(/\{\{#unless (\w+)\}\}\n?([\s\S]*?)\{\{\/unless\}\}\n?/g, (_, v, b) => (!ctx[v] ? b : ''))
  t = t.replace(/\{\{([\w.]+)\}\}/g, (_, key) => {
    const val = key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), ctx)
    return val == null ? '' : String(val)
  })
  return t
}

async function readRoles(rolesDir) {
  const files = (await fs.readdir(rolesDir)).filter((f) => f.endsWith('.md')).sort()
  const roles = []
  for (const f of files) {
    const parsed = parseFrontMatter(await fs.readFile(path.join(rolesDir, f), 'utf8'))
    roles.push({ name: parsed.data.name, description: parsed.data.description, body: parsed.body })
  }
  return roles
}

function roleToMarkdown(role, ctx) {
  return `---\nname: ${role.name}\ndescription: ${role.description}\n---\n${renderTemplate(role.body, ctx)}`
}
function roleToToml(role, ctx) {
  return `name = "${role.name}"\ndescription = "${role.description}"\n\ninstructions = """\n${renderTemplate(role.body, ctx)}\n"""\n`
}

/**
 * 生成所有宿主壳（内存态,确定性）。
 * @param {string} baseDir v7 包根（含 roles/ skills/ adapters/）
 * @returns {Promise<Object>} { <host>: { <相对路径>: 内容 } }，host 与文件按字典序
 */
export async function generateHostShells(baseDir) {
  const registry = JSON.parse(await fs.readFile(path.join(baseDir, 'adapters', 'registry.json'), 'utf8'))
  const roles = await readRoles(path.join(baseDir, 'roles'))
  const skillRaw = await fs.readFile(path.join(baseDir, 'skills', 'webnovel-writer', 'SKILL.md'), 'utf8')
  const sc = schemaContext()

  const out = {}
  const hosts = Object.keys(registry.hosts)
    .filter((h) => h !== '_default')
    .sort()
  for (const host of hosts) {
    const h = registry.hosts[host]
    const ctx = { ...sc, agentCapable: !!h.agentCapable, hasHooks: !!h.hasHooks }
    const files = {}
    files['skills/webnovel-writer/SKILL.md'] = renderTemplate(skillRaw, ctx)
    for (const role of roles) {
      if (host === 'codex') files[`agents/${role.name}.toml`] = roleToToml(role, ctx)
      else files[`agents/${role.name}.md`] = roleToMarkdown(role, ctx)
    }
    out[host] = files
  }
  return out
}

/** 写生成物到 dist/<host>/（dist 不提交） */
export async function writeHostShells(baseDir, distDir) {
  const out = await generateHostShells(baseDir)
  for (const [host, files] of Object.entries(out)) {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(distDir, host, rel)
      await fs.mkdir(path.dirname(full), { recursive: true })
      await fs.writeFile(full, content, 'utf8')
    }
  }
  return out
}
