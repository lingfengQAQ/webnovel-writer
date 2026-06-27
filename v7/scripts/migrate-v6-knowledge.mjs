#!/usr/bin/env node
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 一次性知识层平移（M4 P4）。真源选定（用户指令:题材以 CSV 为准,不维护双表）:
 *   题材模板 → genre-index.csv + 题材与调性推理.csv（CSV 权威；弃 markdown genre-profiles/genre-tropes）
 *   爽点节奏 → 爽点与节奏.csv
 *   追读力   → reading-power-taxonomy.md
 * 逐源清 v6 遗毒:CSV 删 适用技能/推荐检索表 列;模板剥「创意约束(Pack)」段;reading-power 清 v6 skill 头。
 * 输出 v7/references/，并生成迁移报告。
 */

const v7 = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.join(v7, '..')
const v6ref = path.join(repoRoot, 'webnovel-writer', 'references')
const v6genres = path.join(repoRoot, 'webnovel-writer', 'templates', 'genres')
const out = path.join(v7, 'references')

const log = []

async function write(rel, content) {
  const full = path.join(out, rel)
  await fs.mkdir(path.dirname(full), { recursive: true })
  await fs.writeFile(full, content, 'utf8')
}
const stripBOM = (s) => s.replace(/^﻿/, '')

function dropCsvColumns(csv, dropNames) {
  const lines = stripBOM(csv).split(/\r?\n/).filter((l) => l.length > 0)
  const header = lines[0].split(',')
  const keep = header.map((h, i) => ({ h: h.trim(), i })).filter((x) => !dropNames.includes(x.h)).map((x) => x.i)
  return lines.map((l) => { const c = l.split(','); return keep.map((i) => c[i] ?? '').join(',') }).join('\n') + '\n'
}

function stripConstraintSection(md) {
  const lines = md.split(/\r?\n/)
  const res = []
  let i = 0
  while (i < lines.length) {
    if (/^##\s*创意约束/.test(lines[i])) {
      while (res.length && res[res.length - 1].trim() === '') res.pop()
      i++
      while (i < lines.length && !/^##\s/.test(lines[i]) && !/^---\s*$/.test(lines[i])) i++
      res.push('')
      continue
    }
    res.push(lines[i])
    i++
  }
  return res.join('\n')
}

function cleanReadingPower(md) {
  const kept = md.split(/\r?\n/).filter((l) => !/主服务 skill|次服务 skill|内容层级/.test(l))
  return kept.join('\n').replace(/Step 1\.5 \/ Context Agent \/ Checkers/g, '细纲与两审')
}

async function main() {
  // 1. 题材索引(CSV 权威,清洁)
  await write('题材模板/genre-index.csv', stripBOM(await fs.readFile(path.join(v6ref, 'taxonomy', 'genre-index.csv'), 'utf8')))
  log.push('题材模板/genre-index.csv ← taxonomy/genre-index.csv（清 BOM）')

  // 2. 题材路由推理(删 v6 列)
  const tone = dropCsvColumns(await fs.readFile(path.join(v6ref, 'csv', '题材与调性推理.csv'), 'utf8'), ['适用技能', '推荐基础检索表', '推荐动态检索表'])
  await write('题材模板/题材与调性推理.csv', tone)
  log.push('题材模板/题材与调性推理.csv ← csv/题材与调性推理.csv（删列:适用技能/推荐基础检索表/推荐动态检索表）')

  // 3. 爽点与节奏(删 v6 列)
  const pacing = dropCsvColumns(await fs.readFile(path.join(v6ref, 'csv', '爽点与节奏.csv'), 'utf8'), ['适用技能'])
  await write('爽点节奏/爽点与节奏.csv', pacing)
  log.push('爽点节奏/爽点与节奏.csv ← csv/爽点与节奏.csv（删列:适用技能）')

  // 4. 追读力(清 v6 skill 头)
  await write('追读力/reading-power-taxonomy.md', cleanReadingPower(await fs.readFile(path.join(v6ref, 'reading-power-taxonomy.md'), 'utf8')))
  log.push('追读力/reading-power-taxonomy.md ← reading-power-taxonomy.md（删主/次服务 skill 与内容层级行；Step1.5/Context Agent/Checkers→细纲与两审）')

  // 5. 题材模板正文(剥创意约束段；系统流另修 v6 命令)
  const genreFiles = (await fs.readdir(v6genres)).filter((f) => f.endsWith('.md')).sort()
  let fixed = 0
  for (const f of genreFiles) {
    let md = stripConstraintSection(await fs.readFile(path.join(v6genres, f), 'utf8'))
    if (md.includes('/webnovel-write')) {
      md = md.replace(/在 `\/webnovel-write` 中，/g, '起草细纲时，').replace(/\/webnovel-write/g, '写章流程')
      fixed++
    }
    await write(path.join('题材模板', 'genres', f), md)
  }
  log.push(`题材模板/genres/ ← templates/genres/（${genreFiles.length} 个，全剥创意约束段，${fixed} 个另修 v6 命令引用）`)

  // 6. 迁移报告
  const report = [
    '# 知识层迁移报告（M4 P4）',
    '',
    '> 用户指令(2026-06-27):题材以 CSV 最新版为准，不要像 v6 维护两张表。',
    '',
    '## 真源选定',
    '',
    '| 知识体 | v7 唯一真源 | 弃用(双表/v6) |',
    '|---|---|---|',
    '| 题材模板 | `题材模板/genre-index.csv` + `题材与调性推理.csv` + `genres/*.md` | `genre-profiles.md`、`skills/.../genre-tropes.md`、`anti-trope-*.md`（markdown 双表，不迁） |',
    '| 爽点与节奏 | `爽点节奏/爽点与节奏.csv` | 老 markdown 重复部分 |',
    '| 追读力 | `追读力/reading-power-taxonomy.md` | （唯一源） |',
    '',
    '## 逐源清洗',
    '',
    ...log.map((l) => `- ${l}`),
    '',
    '## 保留',
    '- craft 内容（题材原型/流派/调性/节奏/毒点/钩子兑现）架构无关，原样保留。',
    '- CSV 保持 CSV 形态（机器友好、即单源），不复刻 markdown 表。',
    '',
    '## 备注',
    '- 「卡点」(付费/精准卡点)为短篇平台真实术语，与 spec 退场的「卡」(停滞义)不同，保留。',
  ].join('\n') + '\n'
  await write('迁移报告.md', report)

  console.log('知识层迁移完成：')
  for (const l of log) console.log('  - ' + l)
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
