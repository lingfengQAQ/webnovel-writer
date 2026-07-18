import { promises as fs } from 'node:fs'
import path from 'node:path'
import { assembleBookStatus } from '../prep/book-status.js'
import { BookConfigReader } from '../storage/adapters/BookConfigReader.js'
import { readBatch, judgeStop, 章状态 } from '../staging/index.js'
import { loadRoutes, listChapterIndex, sceneCandidates } from '../knowledge/index.js'
import { OutlineReader } from '../storage/adapters/OutlineReader.js'
import { ChapterReader } from '../storage/adapters/ChapterReader.js'
import {
  evaluateContractIssueSignals,
  readContractIssueHistory,
  summarizeContractIssues,
} from '../knowledge/contract-issues.js'

/**
 * 为 AI 态组装上下文 DTO（M3 只备料，不调 AI）。M4 吃 DTO 出结构化产物，
 * 产物回流由 M3 落盘（M4 不碰文件）。每个 DTO 标注 `期望产物` 告诉 M4 该产出什么。
 * @param {{repoPath, cache}} ctx
 * @param {number} 序
 * @param {object} base 路由已知信息（failures / manualEdits / 现存与从哪继续 / 卷 / nextChapter）
 */
export async function buildDto(ctx, 序, base = {}) {
  switch (序) {
    case 0:
      return {
        state: 'repair-confirm',
        failures: base.failures || [],
        期望产物: '逐个给出「保留作者意图」的修复方案，作者确认后由 M3 写回',
      }
    case 1: {
      const routes = ctx.packageRoot ? await loadRoutes(ctx.packageRoot) : []
      return {
        state: 'create-book',
        缺: await whatsMissing(ctx),
        知识路由: {
          题材: routes.filter((r) => r.维度 === '题材').map((r) => r.名称),
          流派: routes.filter((r) => r.维度 === '流派').map((r) => r.名称),
        },
        知识材料命令:
          'knowledge-pack --类型=<主题材> --副题材=<a,b> --流派=<a,b>；真实未决的创意问题再用 knowledge-query --维度=创意约束 --问题=<问题>',
        期望产物:
          '作者确认后生成 persist-book JSON：{book（含类型/副题材/流派）,总纲,卷纲,作品契约,知识选择,实际裁决?,作者已确认:true}。作品契约须含版本/生效起章/来源版本与八个必需小节；路由只归一名称，不替作者选择创意。',
      }
    }
    case 2:
      return {
        state: 'relink-manual-edits',
        变更文件: base.manualEdits || [],
        补登命令: 'relink --message=<一句话说明>',
        期望产物: '向作者出示变更清单问「补登吗」，确认后运行补登命令（fix(手改) 入档并刷新缓存）；不补登则按作者指示处理',
      }
    case 3:
      return {
        state: 'resume',
        工作区现存: base.现存 || [],
        从哪继续: base.从哪继续 || '',
        ...(await batchDetail(ctx, base)),
        期望产物: '按「从哪继续」回到写章流程对应步骤（spec §10 续跑映射）',
      }
    case 4: {
      const status = await assembleBookStatus(ctx)
      const contractHistory = await readContractIssueHistory(ctx.repoPath, { volume: base.卷 })
      const contractSummary = summarizeContractIssues(contractHistory)
      return {
        state: 'volume-review',
        卷: base.卷,
        全书近况: status.ok ? status.markdown : '',
        悬了太久: status.ok ? status.data.悬了太久 : [],
        作品契约复盘: contractSummary.length
          ? contractSummary
          : '本卷没有实际记录的作品契约问题，默认保持现契约不变。',
        期望产物: '卷摘要 + 下卷卷纲 + 伏笔机会候选（作者勾选后 M3 生成条目）+ 作品契约复盘；契约无问题就保持不变，有问题也只提出修订候选，作者确认后才运行 persist-contract',
      }
    }
    case 6: {
      const status = await assembleBookStatus(ctx)
      const config = await new BookConfigReader(ctx.repoPath).read()
      const 自动确认细纲 = !!(config.ok && config.data.自动确认细纲)
      const 知识 = await chapterKnowledge(ctx, {
        当前卷: status.ok ? status.data.当前卷 : 1,
        nextChapter: base.nextChapter,
      })
      const contractSignals = evaluateContractIssueSignals(
        await readContractIssueHistory(ctx.repoPath),
        { volume: status.ok ? status.data.当前卷 : null }
      )
      return {
        state: 'draft-outline',
        nextChapter: base.nextChapter,
        全书近况: status.ok ? status.markdown : '',
        自动确认细纲,
        ...知识,
        ...(contractSignals.length ? { 作品契约复盘提示: contractSignals } : {}),
        期望产物: `${
          自动确认细纲
            ? '工作区/细纲.md（含本章定位声明 + 本章要写到的事 + 备选，由 M3 落盘）；自动确认细纲已开：提案直接 persist-outline 生效，不再问作者；卷近尾声时提案可含收卷提议'
            : '工作区/细纲.md（含本章定位声明 + 本章要写到的事 + 备选，由 M3 落盘）；卷近尾声时提案可含收卷提议（依据卷纲进度与卷规模参考值，作者确认后定稿写入 收卷: 是）'
        }；本章提案段内按需声明知识位（皆可空，从菜单点选或自定义）：本章节拍：<编号或名称> / 章尾钩子：<类型> / 本章场景：<顿号分隔多值>`,
      }
    }
    default:
      return { state: base.state || 'unknown' }
  }
}

/**
 * 序6 的章级知识菜单（spec §7 声明位）：节拍/钩子/场景紧凑索引 + 场景候选。
 * 知识库缺失一律空集降级（旁路增益不是必经关卡）。
 */
async function chapterKnowledge(ctx, { 当前卷, nextChapter }) {
  if (!ctx.packageRoot) return {}
  const fmt = (list) =>
    list.map((e) => `${e.编号 ? `${e.编号} ` : ''}${e.名称}${e.一句话 ? `——${e.一句话}` : ''}`)
  const 节拍 = await listChapterIndex(ctx.packageRoot, '节拍')
  const 钩子 = await listChapterIndex(ctx.packageRoot, '追读')
  const 场景 = await listChapterIndex(ctx.packageRoot, '场景')
  // 场景候选语料：当前卷卷纲 + 上一章结尾——脚本只出候选，不拦截
  const corpus = []
  try {
    const vol = await new OutlineReader(ctx.repoPath).readVolumeOutline(当前卷)
    if (vol.ok) corpus.push(vol.content || vol.text || '')
  } catch {
    // 无卷纲
  }
  if (Number.isInteger(nextChapter) && nextChapter > 1 && ctx.cache) {
    try {
      const t = await new ChapterReader(ctx.repoPath, ctx.cache).readTail(nextChapter - 1, 300)
      if (t.ok) corpus.push(t.text)
    } catch {
      // 无上一章
    }
  }
  const 候选 = await sceneCandidates(ctx.packageRoot, corpus)
  const out = {}
  if (节拍.length) out.节拍索引 = fmt(节拍)
  if (钩子.length) out.钩子清单 = fmt(钩子)
  if (场景.length) out.场景索引 = fmt(场景)
  if (候选.length) out.场景候选 = 候选.map((c) => `${c.名称}${c.一句话 ? `——${c.一句话}` : ''}`)
  return out
}

// 序 3 的待定稿批次明细（无批次时不加字段）。heal:false——路由组包是名义只读路径，
// 批次.json 缺失时只重建内存视图，不落盘自愈（D5）
async function batchDetail(ctx, base) {  if (!(base.现存 || []).includes('待定稿/')) return {}
  const batch = await readBatch(ctx.repoPath, { heal: false })
  if (!batch.exists) return {}
  const 打回 = batch.章列表.filter((r) => r.状态 === 章状态.打回).map((r) => r.章号)
  const 受影响 = batch.章列表.filter((r) => r.状态 === 章状态.受影响).map((r) => r.章号)
  const 契约变更 = batch.章列表.filter((r) => r.状态 === 章状态.契约变更).map((r) => r.章号)
  const 停止 = await judgeStop(ctx, batch, { heal: false })
  let 建议
  if (打回.length) {
    建议 = `重写打回章（第 ${打回.join('、')} 章）：走写章流程后 stage-chapter 覆盖`
  } else if (契约变更.length) {
    建议 = `重做受契约变更影响的章（第 ${契约变更.join('、')} 章）：重新备料、修订、两审后用 stage-chapter 覆盖`
  } else if (受影响.length) {
    建议 = `重审受影响章（第 ${受影响.join('、')} 章）：重跑两审 save-review 后 batch-restage`
  } else if (停止.stop) {
    建议 = '批次已停：batch-status 呈报作者批量过稿，裁决后 finalize-batch'
  } else {
    // 批内全部过审且未停：主场景是连写中断续写；但作者若刚用 --until 先发过前段，
    // 剩余章已是裁决后的留存，指路转正而不只是闷头堆章（E5）
    const 下一章 = batch.章列表[batch.章列表.length - 1].章号 + 1
    建议 = `继续批内下一章（第 ${下一章} 章）；批内 ${batch.章列表.length} 章均已过审，若作者要先发这批，可 finalize-batch 直接转正`
  }
  return {
    批次: {
      起章: batch.起章,
      章数: batch.章列表.length,
      章: batch.章列表.map((r) => ({ 章号: r.章号, 标题: r.标题, 状态: r.状态 })),
      停止,
      建议,
    },
  }
}

async function whatsMissing(ctx) {
  if (!ctx.repoPath) return ['book.yaml', '总纲'] // 空工作目录：书仓库还不存在
  const missing = []
  for (const [label, rel] of [
    ['book.yaml', 'book.yaml'],
    ['总纲', '大纲/总纲.md'],
    ['作品契约', '作品契约/作品契约.md'],
  ]) {
    try {
      await fs.access(path.join(ctx.repoPath, rel))
    } catch {
      missing.push(label)
    }
  }
  return missing
}
