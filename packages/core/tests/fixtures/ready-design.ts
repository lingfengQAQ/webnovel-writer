/** A real, short design for happy-path tests; seedMinDesign remains an empty-shell fixture. */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { 契约六部, 故事骨架九部 } from '../../src/derive/design'
import { parseDocument, serializeDocument } from '../../src/repo/frontmatter'
import { paths } from '../../src/repo/paths'

export function writeReadyDesign(root: string): void {
  const put = (file: string, text: string) => {
    const target = path.join(root, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, text)
  }
  const existing = fs.existsSync(path.join(root, paths.契约())) ? parseDocument(fs.readFileSync(path.join(root, paths.契约()), 'utf8')) : null
  const contract = ['志怪读者。', '以铜铃追查旧案。', '紧张中留温情。', '主角不以无辜者换取真相。', '第三人称，克制叙述。', '不加入现代科技。']
  const skeleton = ['追查父亲失踪。', '主角与隐瞒旧案的宗门对抗。', '先寻线索，再进入宗门。', '同伴从怀疑转为信任。', '旧案为主线，同伴成长为支线。', '铜铃记录旧案的一段声音。', '卷末才揭示声音的主人。', '首卷解开铜铃来历。', '主角最终选择公开真相。']
  put(paths.构想快照(), '# 构想\n铜铃引出旧案。\n')
  put(paths.契约(), serializeDocument(existing?.ok ? existing.data.fields : {}, 契约六部.map((name, i) => `## ${name} 〔已确认〕\n${contract[i]}\n`).join('\n')))
  put(paths.故事骨架(), 故事骨架九部.map((name, i) => `## ${name} 〔已确认〕\n${skeleton[i]}\n`).join('\n'))
  put('世界书/模块声明.md', '# 模块声明\n- 人物档案\n- 世界规则\n')
  put('世界书/人物档案/主角.md', serializeDocument({ 状态: '已确认' }, '少年寻找失踪的父亲。'))
  put('世界书/世界规则/基础规则.md', serializeDocument({ 状态: '已确认' }, '铜铃只有雨夜才会响起。'))
  put(paths.分卷布局(), '# 分卷布局\n## 故事阶段分配\n- 卷01：追查铜铃的来历 〔已确认〕\n## 卷间衔接 〔留白〕\n')
  put(paths.卷纲(1), '# 卷纲\n## 叙事结构 〔已确认〕\n主角先听见铜铃，再追查来源。\n## 弧线 〔留白〕\n## 线索推进 〔留白〕\n## 卷末兑现 〔留白〕\n')
  put(paths.计划时间线(1), '# 计划时间线\n## 窗口覆盖\n- 雨夜听见铜铃\n## 窗口外锚点\n- 〔留白〕\n')
  if (!fs.existsSync(path.join(root, paths.近期窗口(1)))) put(paths.近期窗口(1), '- 初见 〔已确认〕\n')
}
