import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { parse as parseYaml } from 'yaml'

/**
 * 主控+节点+聚合技能（全生命周期 12 份）。
 * 目录名即 frontmatter name（Agent Skills 规范硬要求：name 必须与父目录名一致）。
 */
const EXPECTED_SKILLS: ReadonlyArray<{ readonly name: string; readonly 中文名: string }> = [
  { name: 'novel-director', 中文名: '工作台总控' },
  { name: 'novel-inspiration', 中文名: '灵感与立项' },
  { name: 'novel-design', 中文名: '定调设计' },
  { name: 'novel-outline', 中文名: '细纲备料' },
  { name: 'novel-drafting', 中文名: '正文起草' },
  { name: 'novel-review', 中文名: '全面审读' },
  { name: 'novel-polish', 中文名: '精修润色' },
  { name: 'novel-revision', 中文名: '改稿' },
  { name: 'novel-settle', 中文名: '定稿沉淀' },
  { name: 'novel-export', 中文名: '最小导出' },
  { name: 'novel-analyze', 中文名: '参考小说拆解' },
  { name: 'novel-maintenance', 中文名: '书仓维护' },
]

const BLACKLIST = ['家位', '门控', '闭环', '抓手', '世代']

function skillPath(name: string): string {
  return path.join(__dirname, '..', 'skills', name, 'SKILL.md')
}

function readSkill(name: string): string {
  return fs.readFileSync(skillPath(name), 'utf8')
}

const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * 解析 SKILL.md frontmatter，走真 YAML 解析而非逐行正则。
 *
 * 必须真解析（2026-09-01 真机实证）：novel-settle 的 description 里含未加引号的
 * `ch: 提交`，YAML 读成嵌套映射直接抛错，dsh 的 parseSkillFile 拿不到 name/description
 * 便 warn-and-drop —— 技能静默不装载，真机上从未生效。而逐行正则不在乎 YAML 合法性，
 * 一路绿灯，所以这个缺陷此前测试完全测不出来。
 */
function readFrontmatter(text: string): Record<string, unknown> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (m === null) throw new Error('缺少 frontmatter')
  const parsed: unknown = parseYaml(m[1]!)
  if (parsed === null || typeof parsed !== 'object') throw new Error('frontmatter 不是映射')
  return parsed as Record<string, unknown>
}

describe('聚合 skills 体系（渐进式披露与 Subagent 协同）', () => {
  it('交付 12 份 SKILL.md，文件名一一对应', () => {
    for (const s of EXPECTED_SKILLS) {
      expect(fs.existsSync(skillPath(s.name)), `${s.name}/SKILL.md 应存在`).toBe(true)
    }
    // 反向核对：磁盘上不得多出未登记的技能。此前《改稿》在盘上却不在表内、
    // 《技法路由》退役后残留也测不出来，都因为只做了单向检查。
    const onDisk = fs
      .readdirSync(path.join(__dirname, '..', 'skills'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
    expect(onDisk).toEqual([...EXPECTED_SKILLS.map((s) => s.name)].sort())
  })

  it('工作台总控：含状态校准 + 主控边界 + 节点路由 + 子代理交接 + 章内接续', () => {
    const text = readSkill('novel-director')
    expect(text).toContain('novel_get_story_status')
    expect(text).toContain('状态校准第一律')
    expect(text).toContain('主控六大边界')
    expect(text).toContain('严禁代写正文')
    expect(text).toContain('节点路由')
    expect(text).toContain('novel_create_book')
    expect(text).toContain('子代理')
    expect(text).toContain('自包含')
    expect(text).toContain('发现项')
    expect(text).toContain('建议稿')
    // 章内接续：机械步骤直接做下一步；决定点（发现项处置/定稿裁决/新选择）仍停稳
    expect(text).toContain('章内接续')
    expect(text).toContain('直接做下一步，不结束回合等一句「继续」')
    expect(text).toContain('不自动开下一章')
  })

  it('新章只读核对替换状态调用，恢复和改稿不机械改成开章', () => {
    const director = readSkill('novel-director'), outline = readSkill('novel-outline'), revision = readSkill('novel-revision')
    expect(director).toContain('novel_begin_chapter({ bookId })` 替换原状态查询')
    expect(director).toContain('不再前后加调 `novel_get_story_status`')
    expect(director).toContain('恢复同章、改稿和普通查询仍用 `novel_get_story_status`')
    expect(director).toContain('正常开章不额外加载维护技能')
    expect(director).toContain('不能用文件工具代修，不执行局部修复')
    expect(director).not.toContain('开场先调 `novel_get_story_status`')
    expect(outline).toContain('承接总控本次 `novel_begin_chapter` 返回的状态与检查结果')
    expect(outline).toContain('同章恢复、已有细纲再确认和普通查询仍沿用原状态工具')
    expect(revision).toContain('novel_get_story_status')
    expect(revision).not.toContain('novel_begin_chapter')
  })
  it('维护按整仓预览批准，续办与语义/正文/记忆写入分别处理', () => {
    const maintenance = readSkill('novel-maintenance')
    for (const text of ['novel_preview_book_upgrade', 'novel_apply_book_upgrade', 'novel_resume_book_upgrade', '必须整仓可升级', 'Git 干净', '作者问答批准', 'novel_record_memory', 'novel_apply_retcon', 'novel-revision', 'before', 'after', 'effects']) expect(maintenance).toContain(text)
    expect(maintenance).toContain('返回 `recovered` 只表示中断文件批次已恢复')
    expect(maintenance).toContain('必须重新预览并请求新的升级批准')
    expect(maintenance).toContain('不得覆盖作者后来的修改')
    expect(maintenance).toContain('当前没有主动撤销工具')
    expect(maintenance).toContain('改变线索兑现内容属于语义修改')
    expect(maintenance).toContain('添加一条新决定仍是记忆写入')
  })

  it('中文路由标题对应可加载的 frontmatter name，不能用中文标题调用 skill', () => {
    const director = readSkill('novel-director')
    const routes = [...director.matchAll(/^\| ([^|]+) \| `(novel-[a-z-]+)` \|$/gm)]
    expect(routes).toHaveLength(EXPECTED_SKILLS.length)
    for (const [, title, name] of routes) {
      expect(EXPECTED_SKILLS).toContainEqual({ name, 中文名: title })
      expect(SKILL_NAME_RE.test(name!)).toBe(true)
      expect(readFrontmatter(readSkill(name!)).name).toBe(name)
    }
    expect(director).toContain('{"name":"novel-director"}')
  })

  it('灵感与立项：含三步法 + 七要素 + 建书门槛', () => {
    const text = readSkill('novel-inspiration')
    expect(text).toContain('随手记')
    expect(text).toContain('七要素')
    expect(text).toContain('核心创意')
    expect(text).toContain('差异化')
    expect(text).toContain('禁区')
    expect(text).toContain('novel_create_book')
    expect(text).toContain('快速开写')
    expect(text).not.toContain('novel_seed_min_design')
    expect(text).toContain('未经作者明确批准，严禁进入建书')
  })

  it('定调设计：含契约六部 + 双路径 + 分部更新纪律 + 强制多方向', () => {
    const text = readSkill('novel-design')
    expect(text).toContain('契约六部')
    // 快速开写走起草确认,seed 只供测试/走查,不出现在作者面技能里
    expect(text).toContain('路径 A：快速开写')
    expect(text).not.toContain('novel_seed_min_design')
    expect(text).toContain('novel_update_contract')
    expect(text).toContain('题材与读者定位')
    expect(text).toContain('创作禁区与不可妥协项')
    expect(text).toContain('留白')
    expect(text).toContain('分部更新')
    expect(text).toContain('强制多方向')
    expect(text).toContain('不参与发散')
    expect(text).toContain('典型版')
    expect(text).toContain('代价与放弃项')
    expect(text).toContain('方向选择')
  })

  it('细纲备料：含定位段/细纲段 + 材料包十段 + 事实播报', () => {
    const text = readSkill('novel-outline')
    expect(text).toContain('定位段')
    expect(text).toContain('细纲段')
    expect(text).toContain('近期窗口')
    expect(text).toContain('材料清单.json')
    expect(text).toContain('条目切片')
    expect(text).toContain('来源与版本')
    expect(text).toContain('不是开写门槛')
    expect(text).toContain('本章形状')
    expect(text).toContain('已排除走向')
    // 任务19:已定稿章细纲勘误走候选→再确认,只改设计工件无需吃书补偿
    expect(text).toContain('已定稿章的细纲勘误')
    expect(text).toContain('窗口条目已消费不影响确认')
    expect(text).toContain('无需吃书补偿')
  })

  it('正文起草：含自包含任务包 + 子代理派发 + 单点重试', () => {
    const text = readSkill('novel-drafting')
    expect(text).toContain('起草子代理')
    expect(text).toContain('自包含')
    expect(text).toContain('确认细纲全文')
    expect(text).toContain('材料包切片')
    expect(text).toContain('文风基准')
    expect(text).toContain('单点重试')
    expect(text).toContain('绝不亲自写正文')
    expect(text).toContain('已排除走向')
  })

  it('定稿沉淀：含三步流程 + 七件 + 作者裁决 + 原子沉淀', () => {
    const text = readSkill('novel-settle')
    expect(text).toContain('novel_prepare_pack')
    expect(text).toContain('novel_settle_chapter')
    expect(text).toContain('待定稿包')
    expect(text).toContain('卷对账')
    expect(text).toContain('作者裁决')
    expect(text).toContain('未获作者明确批准')
    expect(text).toContain('只增不改')
    expect(text).toContain('吃书补偿')
    // 任务21 件一:卷末与卷摘要段(候选脚本＋确认落盘＋待核对不写无偏离)
    expect(text).toContain('卷摘要候选.mjs')
    expect(text).toContain('目标: 卷摘要')
    expect(text).toContain('待核对')
    expect(text).toContain('不设上限、不截断')
  })

  it('定稿沉淀：红线写成 WARNING 块，并点名 novel_settle_chapter', () => {
    const text = readSkill('novel-settle')
    const warning = text.split('\n').filter((line) => line.startsWith('> ')).join('\n')
    expect(warning).toContain('[!WARNING]')
    expect(warning).toContain('novel_settle_chapter')
    expect(warning).toContain('未获作者明确批准')
    expect(warning).toContain('严禁调用')
  })

  it('全面审读：含 8 维标准 + Subagent 派发指引 + 发现项规范', () => {
    const text = readSkill('novel-review')
    expect(text).toContain('章节结构')
    expect(text).toContain('人物与关系')
    expect(text).toContain('情节与因果')
    expect(text).toContain('信息披露')
    expect(text).toContain('线索与伏笔')
    expect(text).toContain('节奏与张力')
    expect(text).toContain('读者承诺')
    expect(text).toContain('文风与表达')
    expect(text).toContain('子代理')
    expect(text).toContain('发现项')
    expect(text).toContain('绝不直接修改正文')
  })

  it('全面审读：回写次数单独成行', () => {
    const text = readSkill('novel-review')
    expect(text).toMatch(/^\s*- \*\*一次全量报告要回写 8 次。\*\*$/m)
    expect(text).toContain('**严禁用通用写工具手写审核记录 JSON。**')
  })

  it('细纲备料：定位段九节写成有序列表；改稿：上游范围词单独列出', () => {
    const outline = readSkill('novel-outline')
    const sections = [...outline.matchAll(/^ {5}(\d)\. /gm)].map((match) => Number(match[1]))
    expect(sections.slice(0, 9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(outline).toContain('**前置条件核对结果**')
    const revision = readSkill('novel-revision')
    for (const word of ['世界书', '大纲', '作品契约', '构想', '账本', '本书记忆']) expect(revision).toContain(`\`${word}\``)
    expect(revision).toContain('须呈报上游')
  })

  it('精修润色：含 7 道工序 + 保真红线 + 逐道回退机制', () => {
    const text = readSkill('novel-polish')
    expect(text).toContain('去 AI 痕迹')
    expect(text).toContain('语言自然化')
    expect(text).toContain('句段节奏调整')
    expect(text).toContain('对话润色')
    expect(text).toContain('文风贴合')
    expect(text).toContain('冗余精简')
    expect(text).toContain('修辞与意象调整')
    expect(text).toContain('只改表达，不改事实')
    expect(text).toContain('可回退')
  })

  it('润色工序按语境保护含义，否定示例与两份审读底本不误导删改', () => {
    const refs = ['1-表达清理.md', '2-节奏与重塑.md'].map((file) =>
      fs.readFileSync(path.join(__dirname, '../skills/novel-polish/工序', file), 'utf8'))
    for (const text of refs) {
      const guard = text.split('## 按需保真核对')[1]?.split('## 第一节')[0]
      expect(guard).toBeDefined()
      for (const item of ['信息来源与确定程度', '指称、否定与时间关系', '对白言语行为', '保护的是含义，不是冻结词面', '本批无修改', '未决保真风险']) {
        expect(guard).toContain(item)
      }
    }
    const negation = refs[0]!.split('\n').find((line) => line.startsWith('| 双重否定'))!
    expect(negation).toContain('不得不说，他没考虑到')
    expect(negation).not.toMatch(/他想过|他确实没考虑到/)
    expect(refs[0]).toContain('读者已知不等于对方已知')
    expect(refs[1]).toContain('场景之间叙述距离与快慢的合理变化')
    for (const file of ['全量审读.md', '文风与表达审读.md']) {
      const text = fs.readFileSync(path.join(__dirname, '../skills/novel-review/底本', file), 'utf8')
      expect(text).not.toMatch(/5\s*[~～–-]\s*15/)
      expect(text).toContain('不设')
    }
  })

  it('润色派发携带零修改规则，混合批次、风险与复用来源有明确交付约定', () => {
    const text = readSkill('novel-polish')
    expect(text).toContain('完整带上下面的**零修改与交付规则**及回传格式')
    for (const rule of ['批 1 无修改不跳过批 2', '无修改／无修改→复用源稿', '无修改／有修改→只写批 2 稿', '有修改／无修改→只写批 1 稿', '有修改／有修改→两批两版', '已有待审标记正确时不写文件', '不伪造“生成模块: 润色”', '不清空风险', '已有审核证据仍有效时沿用处置', '本轮无修改']) {
      expect(text).toContain(rule)
    }
    expect(text).not.toMatch(/各产一版|每批一版/)
    const director = readSkill('novel-director')
    expect(director).toContain('零修改与交付规则')
    expect(director).toContain('仅实际修改的批次留新版')
    expect(director).not.toContain('批 1＋批 2 产两版')
  })

  it('最小导出：含范围选择 + 冲突不覆盖 + 清单最后落盘 + 逐字节一致', () => {
    const text = readSkill('novel-export')
    expect(text).toContain('最小导出.mjs')
    expect(text).toContain('已定稿')
    expect(text).toContain('--校验 true')
    expect(text).toContain('不支持原位覆盖')
    expect(text).toContain('校验.ok:true')
    expect(text).toContain('不覆盖')
    expect(text).toContain('逐字节一致')
    expect(text).toContain('SHA-256')
  })

  it('作者介入:五份章节节点技能各含「作者介入」小节与作者稿通道', () => {
    for (const name of ['novel-drafting', 'novel-polish', 'novel-review', 'novel-revision', 'novel-settle']) {
      const text = readSkill(name)
      expect(text, `${name}: 含「作者介入」小节`).toContain('## 作者介入')
    }
    expect(readSkill('novel-drafting')).toContain('作者手写')
    expect(readSkill('novel-revision')).toContain('novel_apply_revision_batch')
    expect(readSkill('novel-settle')).toContain('底本/沉淀对账.md')
  })

  it('零机器味：全部不含黑名单词', () => {
    for (const s of EXPECTED_SKILLS) {
      const text = readSkill(s.name)
      for (const w of BLACKLIST) {
        expect(text, `${s.中文名}: 不应含「${w}」`).not.toContain(w)
      }
    }
  })

  it('frontmatter：name 合法且与父目录名一致 + 非空中文 description', () => {
    for (const s of EXPECTED_SKILLS) {
      const text = readSkill(s.name)
      // 非法 YAML 在此直接抛错，与 dsh 的 warn-and-drop 静默丢弃形成对照
      const fm = readFrontmatter(text)
      const name = fm['name']
      const description = fm['description']
      expect(typeof name, `${s.中文名}: name 应是字符串`).toBe('string')
      expect(typeof description, `${s.中文名}: description 应是字符串`).toBe('string')
      if (typeof name === 'string' && typeof description === 'string') {
        expect(SKILL_NAME_RE.test(name), `${s.中文名}: name 应是英文 kebab-case`).toBe(true)
        expect(name, `${s.中文名}: name 应与父目录名一致`).toBe(s.name)
        expect(name.length, `${s.中文名}: name ≤64`).toBeLessThanOrEqual(64)
        expect(description.trim().length, `${s.中文名}: description 非空`).toBeGreaterThan(0)
        expect(description.length, `${s.中文名}: description ≤1024`).toBeLessThanOrEqual(1024)
        expect(description, `${s.中文名}: description 中文`).toMatch(/[一-鿿]/)
      }
    }
  })
})

describe('禁令与实际流程一致', () => {
  it('小修快路：persona、改稿技能与工具描述都限定为作者逐字改法，生成模块记作者手改', async () => {
    const { personaText } = await import('../src/persona')
    const tools = fs.readFileSync(path.join(__dirname, '../src/novel-tools.ts'), 'utf8')
    expect(personaText).toMatch(/作者逐字给出的替换或明确删除.*novel_apply_revision/)
    expect(personaText).toContain('作者手改')
    expect(readSkill('novel-revision')).toMatch(/作者只给方向[^\n]*派改稿子代理/)
    expect(tools).toMatch(/补丁新文只能是作者给出的原文改法/)
  })
  it('定稿区只读，更正走吃书补偿；「已转提案」写进审读与改稿技能', async () => {
    const { personaText } = await import('../src/persona')
    expect(personaText).toMatch(/定稿区只读.*novel_apply_retcon/)
    expect(readSkill('novel-director')).toMatch(/定稿区只读，更正只走吃书补偿/)
    expect(readSkill('novel-review')).toContain('`已转提案` 六个')
    expect(readSkill('novel-revision')).toMatch(/记 `已转提案`/)
  })
})
