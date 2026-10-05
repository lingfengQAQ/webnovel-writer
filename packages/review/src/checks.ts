/**
 * M0 两项确定性检查:文本规范 + 设定与时序核对。
 */

import { classifyHardConstraint, parseOutline, type Finding } from '@webnovel/core'
import { makeFinding } from './finding'
import { getCheck, registerCheck, type CheckInput, type CheckModule } from './registry'

export const 文本规范检查名 = '文本规范检查'
export const 设定与时序核对名 = '设定与时序核对'
export const M0_REQUIRED_CHECKS = [文本规范检查名, 设定与时序核对名] as const

const BANNED = ['综上所述', '值得注意的是'] as const

/** 发现项编号是单轮模块内定位符,由生产方统一生成。 */
export function findingId(审核编号: string, 模块名: string, n: number): string {
  return `${审核编号}-${模块名}-${n}`
}

export function runTextNorm(input: CheckInput): Finding[] {
  const body = input.待审稿.replace(/\r\n/g, '\n')
  const out = []
  let n = 1
  const length = input.篇幅核对
  if (length && (length.结果 === '偏短' || length.结果 === '偏长' || length.结果 === '配置错误')) {
    const policy = length.约定
    const configError = policy.状态 === '配置错误'
    const detail = '范围' in policy
      ? `正文篇幅${length.结果}：实测 ${length.实测汉字数} 汉字，契约目标 ${policy.范围.目标汉字数}，范围 ${policy.范围.下限汉字数}–${policy.范围.上限汉字数}，${length.结果 === '偏短' ? '少于下限' : '超过上限'} ${length.差额} 汉字`
      : `作品契约章节篇幅配置错误：${configError ? policy.原因 : '无法解析'}`
    out.push(makeFinding({
      审核编号: input.审核编号, 模块名: 文本规范检查名,
      发现项编号: findingId(input.审核编号, '文本', n++),
      严重程度: '低', 是否建议阻断: false,
      证据位置: configError ? policy.来源 : '正文汉字数（不含 frontmatter 和草稿候选事实）',
      所依据材料及版本: `${input.材料版本}；${policy.来源}${policy.来源哈希 ? `@${policy.来源哈希}` : ''}`,
      问题说明: detail, 影响范围: configError ? '作品契约' : '正文', 不确定性说明: '',
      修改建议: configError ? '核对作品契约的章节篇幅三项数值，经原契约更新工具修正。' : '结合本章任务检查是否需要精简、补足因果或调整细纲；篇幅合理可由作者保留，不自动裁剪或凑字。',
      建议返回节点: configError ? '作品定调' : '改稿', 建议复审模块: 文本规范检查名, 材料完整性: configError ? '残缺' : '完整',
    }))
  }
  if (body.trim() === '') {
    out.push(makeFinding({
      审核编号: input.审核编号,
      模块名: 文本规范检查名,
      发现项编号: findingId(input.审核编号, '文本', n++),
      严重程度: '高',
      是否建议阻断: true,
      证据位置: '待审稿全文',
      所依据材料及版本: input.材料版本,
      问题说明: '待审稿正文为空',
      影响范围: '正文',
      不确定性说明: '',
      修改建议: '补写正文',
      建议返回节点: '写稿',
      建议复审模块: 文本规范检查名,
      材料完整性: '完整',
    }))
  }
  for (const phrase of BANNED) {
    if (body.includes(phrase)) {
      out.push(makeFinding({
        审核编号: input.审核编号,
        模块名: 文本规范检查名,
        发现项编号: findingId(input.审核编号, '文本', n++),
        严重程度: '中',
        是否建议阻断: false,
        证据位置: phrase,
        所依据材料及版本: input.材料版本,
        问题说明: `残留套话「${phrase}」`,
        影响范围: '正文',
        不确定性说明: '',
        修改建议: `删除「${phrase}」`,
        建议返回节点: '改稿',
        建议复审模块: 文本规范检查名,
        材料完整性: '完整',
      }))
    }
  }
  if (/ {2,}/.test(body)) {
    out.push(makeFinding({
      审核编号: input.审核编号,
      模块名: 文本规范检查名,
      发现项编号: findingId(input.审核编号, '文本', n++),
      严重程度: '低',
      是否建议阻断: false,
      证据位置: '连续空格',
      所依据材料及版本: input.材料版本,
      问题说明: '正文含连续空格',
      影响范围: '正文',
      不确定性说明: '',
      修改建议: '合并为单个空格',
      建议返回节点: '改稿',
      建议复审模块: 文本规范检查名,
      材料完整性: '完整',
    }))
  }
  return out
}

/**
 * 硬约束核对(F1 契约,2026-09-05):逐条分类,不把约束原句当正文证据。
 * - 出现/禁止类:term 的字面判定是显式规则的确定性结论(出处=规则名+约束原句);
 * - 需审读类:语义约束确定性代码无法判定,产出「需审读」发现项交语义审读——
 *   不伪装成通过,也不伪装成违反。
 */
export function runCanonCheck(input: CheckInput): Finding[] {
  const rules = parseOutline(input.细纲).constraints
    .filter((c) => c.mark === '硬')
    .map((c) => classifyHardConstraint(c.line))
  const out = []
  let n = 1
  for (const rule of rules) {
    if (rule.kind === '需审读') {
      out.push(makeFinding({
        审核编号: input.审核编号,
        模块名: 设定与时序核对名,
        发现项编号: findingId(input.审核编号, '设定', n++),
        严重程度: '中',
        是否建议阻断: false,
        证据位置: '待语义审读（无确定性正文位置）',
        所依据材料及版本: input.材料版本,
        问题说明: `需审读:硬约束「${rule.出处}」为语义类约束,确定性代码无法判定`,
        影响范围: '正文',
        不确定性说明: '语义类约束无法由确定性代码判定,不能以字面包含代替语义判断',
        修改建议: '派语义审读子代理核对本约束,并给出处置',
        建议返回节点: '审核',
        建议复审模块: 设定与时序核对名,
        材料完整性: '完整',
      }))
      continue
    }
    const 命中 = input.待审稿.includes(rule.term)
    if (rule.kind === '出现' && !命中) {
      out.push(makeFinding({
        审核编号: input.审核编号,
        模块名: 设定与时序核对名,
        发现项编号: findingId(input.审核编号, '设定', n++),
        严重程度: '高',
        是否建议阻断: true,
        证据位置: rule.term,
        所依据材料及版本: input.材料版本,
        问题说明: `硬约束(出现规则)未满足:正文未出现「${rule.term}」。约束原句:${rule.出处}`,
        影响范围: '正文',
        不确定性说明: '',
        修改建议: `在正文补写「${rule.term}」对应内容,或经提案修订该约束`,
        建议返回节点: '改稿',
        建议复审模块: 设定与时序核对名,
        材料完整性: '完整',
      }))
      continue
    }
    if (rule.kind === '禁止' && 命中) {
      const at = input.待审稿.indexOf(rule.term)
      const 片段 = input.待审稿.slice(Math.max(0, at - 20), at + rule.term.length + 20)
      out.push(makeFinding({
        审核编号: input.审核编号,
        模块名: 设定与时序核对名,
        发现项编号: findingId(input.审核编号, '设定', n++),
        严重程度: '高',
        是否建议阻断: true,
        证据位置: 片段,
        所依据材料及版本: input.材料版本,
        问题说明: `硬约束(禁止规则)被违反:禁止词「${rule.term}」出现在正文。约束原句:${rule.出处}`,
        影响范围: '正文',
        不确定性说明: '',
        修改建议: `删除或改写「${rule.term}」相关内容,或经提案修订该约束`,
        建议返回节点: '改稿',
        建议复审模块: 设定与时序核对名,
        材料完整性: '完整',
      }))
    }
    // 出现且命中 / 禁止且未命中 → 显式规则判定通过,不产发现项(通过也是分类结论,静默即通过)
  }
  return out
}

export const 文本规范检查: CheckModule = {
  名称: 文本规范检查名,
  审什么: '套话、连续空格、空稿、契约章节篇幅',
  依赖材料: ['待审稿'],
  执行形态: '确定性代码',
  适用范围: '章',
  run: runTextNorm,
}

export const 设定与时序核对: CheckModule = {
  名称: 设定与时序核对名,
  审什么: '硬约束是否落在待审稿',
  依赖材料: ['待审稿', '确认细纲'],
  执行形态: '确定性代码',
  适用范围: '章',
  run: runCanonCheck,
}

/** 8 个语义审读（隔离子 Agent 形态，人设/做法由 skill 承载，§11.1）。 */
const 审读模块元: ReadonlyArray<{ readonly 名称: string; readonly 审什么: string; readonly skill: string }> = [
  { 名称: '章节结构审读', 审什么: '章节完成度与结构完整', skill: '章节结构审读' },
  { 名称: '人物与关系审读', 审什么: '人物忠于人设、关系有铺垫', skill: '人物与关系审读' },
  { 名称: '情节与因果审读', 审什么: '事件链自洽、悬念转折可信', skill: '情节与因果审读' },
  { 名称: '信息披露审读', 审什么: '信息边界、披露节奏、保密完整', skill: '信息披露审读' },
  { 名称: '线索与伏笔审读', 审什么: '埋设/维持/兑现与账本一致', skill: '线索与伏笔审读' },
  { 名称: '节奏与张力审读', 审什么: '节奏曲线与张力管理', skill: '节奏与张力审读' },
  { 名称: '读者承诺审读', 审什么: '读者承诺兑现', skill: '读者承诺审读' },
  { 名称: '文风与表达审读', 审什么: '文风贴合与表达准确', skill: '文风与表达审读' },
]

/** 作者亲自回写发现项的通道:永不自动跑、不进默认方案、不卡完成态(design §5.3)。 */
export const 作者意见模块名 = '作者意见'
export const 作者意见: CheckModule = {
  名称: 作者意见模块名,
  审什么: '作者亲自提出的发现项或对子代理发现项的驳回',
  依赖材料: [],
  执行形态: '作者',
  适用范围: '章',
}

export function registerDefaultChecks(): void {
  if (getCheck(文本规范检查名) === undefined) registerCheck(文本规范检查)
  if (getCheck(设定与时序核对名) === undefined) registerCheck(设定与时序核对)
  if (getCheck(作者意见模块名) === undefined) registerCheck(作者意见)
  for (const m of 审读模块元) {
    if (getCheck(m.名称) === undefined) {
      registerCheck({
        名称: m.名称,
        审什么: m.审什么,
        依赖材料: ['待审稿', '细纲', '任务证据'],
        执行形态: '隔离子 Agent',
        skill: m.skill,
        适用范围: '章',
      })
    }
  }
}
