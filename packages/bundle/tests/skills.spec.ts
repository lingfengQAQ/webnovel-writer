import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { parse as parseYaml } from 'yaml'

/**
 * 主控+节点+聚合技能（全生命周期 10 份）。
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
  it('交付 10 份 SKILL.md，文件名一一对应', () => {
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

  it('工作台总控：含状态校准第一律 + 六大铁律 + 节点路由 + 子代理交接 + 章内接续', () => {
    const text = readSkill('novel-director')
    expect(text).toContain('novel_get_story_status')
    expect(text).toContain('状态校准第一律')
    expect(text).toContain('六大铁律')
    expect(text).toContain('严禁代写正文')
    expect(text).toContain('节点路由')
    expect(text).toContain('novel_create_book')
    expect(text).toContain('Subagent')
    expect(text).toContain('自包含')
    expect(text).toContain('发现项')
    expect(text).toContain('建议稿')
    // 章内接续：机械步骤直接做下一步；决定点（发现项处置/定稿裁决/新选择）仍停稳
    expect(text).toContain('章内接续')
    expect(text).toContain('直接做下一步，不结束回合等一句「继续」')
    expect(text).toContain('不自动开下一章')
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
    expect(text).toContain('未经作者明确同意，严禁进入建书')
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
    expect(text).toContain('Subagent')
    expect(text).toContain('发现项')
    expect(text).toContain('绝不直接修改正文')
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

  it('最小导出：含范围选择 + 冲突不覆盖 + 清单最后落盘 + 逐字节一致', () => {
    const text = readSkill('novel-export')
    expect(text).toContain('最小导出.mjs')
    expect(text).toContain('已定稿')
    expect(text).toContain('--校验 true')
    expect(text).toContain('首版不支持原位覆盖')
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
