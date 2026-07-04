import { promises as fs } from 'node:fs'
import path from 'node:path'
import { assembleBookStatus } from './book-status.js'
import { extractSection } from '../util/markdown.js'
import { TimelineReader } from '../storage/adapters/TimelineReader.js'
import { SecretReader } from '../storage/adapters/SecretReader.js'
import { ChapterReader } from '../storage/adapters/ChapterReader.js'

/**
 * 备料：组装 工作区/本章写作材料.md（spec §8 step3，默认精准片段）。
 * 八组件：全书近况 + 要写到的事 + 事实切片 + 信息差边界 + 近章结尾 + 反复读清单 + 文风锚点 + 反和解规则。
 * @param {{repoPath: string, cache: object}} ctx
 * @param {{chapterNum: number}} args
 * @returns {Promise<{ok: boolean, filePath: string, content: string, error: string}>}
 */
export async function prepareChapterMaterials(ctx, { chapterNum }) {
  try {
    const { repoPath, cache } = ctx

    const status = await assembleBookStatus(ctx)
    const 当前卷 = status.ok ? status.data.当前卷 : 1

    // 本章要写到的事（读细纲）
    let 要写到的事 = '（无细纲）'
    try {
      const outline = await fs.readFile(path.join(repoPath, '工作区', '细纲.md'), 'utf8')
      要写到的事 = extractSection(outline, '本章要写到的事') || '（细纲未声明）'
    } catch {
      // 无细纲
    }

    // 事实切片：当前卷+上一卷时间线（精准片段）
    const tl = await new TimelineReader(repoPath, cache).readVolumeRange(
      Math.max(1, 当前卷 - 1),
      当前卷
    )
    const 时间线md =
      tl.ok && tl.timeline.length
        ? tl.timeline.map((row) => `- ${row.章 ?? ''} ${row.一句话事件 ?? ''}`).join('\n')
        : '（无）'

    // 信息差边界（未揭晓，勿泄）：短题+知情人+关键词+内容首句——写稿 AI 知道秘密才守得住秘密
    const secretReader = new SecretReader(repoPath, cache)
    const secrets = await secretReader.listUnrevealed()
    const 信息差行 = []
    for (const s of secrets) {
      const fl = await secretReader.readContentFirstLine(s.id)
      const 知情人 = s.知情人.length ? s.知情人.join('、') : '（未登记）'
      const 关键词 = s.关键词.length ? s.关键词.join('/') : '（无）'
      信息差行.push(
        `- ${s.id}（${s.短题}）：知情人=${知情人}；关键词=${关键词}；内容：${fl.line || '（未读到）'}——读者未知，除知情人的对话与视角外不得出现`
      )
    }
    const 信息差md = 信息差行.length ? 信息差行.join('\n') : '（无）'

    // 近章结尾（近 2 章末尾 150 字，反复读防接不上）
    const recent = await cache.query(
      'SELECT chapter_num FROM chapters ORDER BY chapter_num DESC LIMIT 2'
    )
    const reader = new ChapterReader(repoPath, cache)
    const tails = []
    for (const r of recent.reverse()) {
      const t = await reader.readTail(r.chapter_num, 150)
      tails.push(`### 第${r.chapter_num}章结尾\n${t.ok ? t.text : ''}`)
    }

    // 文风锚点 + 反和解（读文风铁律）
    let 文风锚点 = '（无文风铁律）'
    let 反和解 = ''
    try {
      const fl = await fs.readFile(path.join(repoPath, '文风', '文风铁律.md'), 'utf8')
      const 铁律 = extractSection(fl, '铁律')
      const 节奏 = extractSection(fl, '节奏偏好')
      文风锚点 = [铁律 && `铁律：${铁律}`, 节奏 && `节奏偏好：${节奏}`].filter(Boolean).join('\n')
      反和解 = extractSection(fl, '反和解')
    } catch {
      // 无文风铁律
    }

    // 反复读清单：体检产出的跨章高频意象（meta imagery_top），提醒本章避免再用
    let 反复读 = '（尚未体检，暂无数据——首次体检后自动填充）'
    try {
      const metaRows = await cache.query("SELECT value FROM meta WHERE key = 'imagery_top'")
      if (metaRows.length) {
        const top = JSON.parse(metaRows[0].value || '[]')
        反复读 = top.length
          ? top
              .slice(0, 10)
              .map(
                (t) => `- 「${t.phrase}」全书已用 ${t.count} 次（${t.chapterCount} 章出现），本章避免再用`
              )
              .join('\n')
          : '（最近一次体检没有查出跨章高频复用短语）'
      }
    } catch {
      // meta 读不到按未体检处理
    }

    const parts = [
      `# 第 ${chapterNum} 章写作材料`,
      '',
      status.ok ? status.markdown : '## 全书近况\n（组装失败）',
      '',
      `## 本章要写到的事\n${要写到的事}`,
      '',
      `## 事实切片：时间线（当前卷+上一卷）\n${时间线md}`,
      '',
      `## 信息差边界（未揭晓，勿泄）\n${信息差md}`,
      '',
      `## 近章结尾\n${tails.join('\n\n') || '（无）'}`,
      '',
      `## 文风锚点\n${文风锚点}`,
      '',
      反和解 ? `## 反和解规则\n${反和解}` : '## 反和解规则\n（无）',
      '',
      `## 反复读清单\n${反复读}`,
      '',
    ]
    const content = parts.join('\n')

    const dir = path.join(repoPath, '工作区')
    await fs.mkdir(dir, { recursive: true })
    const filePath = path.join(dir, '本章写作材料.md')
    await fs.writeFile(filePath, content, 'utf8')

    return { ok: true, filePath, content, error: '' }
  } catch (err) {
    return { ok: false, filePath: '', content: '', error: `备料失败：${err.message}` }
  }
}
