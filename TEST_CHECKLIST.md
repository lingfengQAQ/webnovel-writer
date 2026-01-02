# webnovel-writer 架构重构测试验证清单

> **目的**: 验证新架构（Skills自动触发 + Commands执行 + Agents隔离）是否正确工作

---

## 测试环境准备

### 前置条件

- [ ] Python 3.8+ 已安装
- [ ] Git 已初始化（`.git/` 目录存在）
- [ ] 项目结构完整：
  ```
  .claude/
  ├── skills/webnovel-writer/
  │   ├── SKILL.md (新版，343行知识库)
  │   ├── scripts/
  │   │   ├── extract_entities.py
  │   │   ├── update_state.py
  │   │   └── backup_manager.py
  │   └── references/ (可选)
  ├── commands/
  │   └── webnovel-write.md (新版，196行执行器)
  └── agents/
      ├── high-point-checker.md
      ├── consistency-checker.md
      ├── pacing-checker.md
      ├── ooc-checker.md
      └── continuity-checker.md
  ```

### 迁移步骤（如果agents在旧位置）

- [ ] 运行迁移脚本（dry-run模式）：
  ```bash
  python migrate_agents.py --dry-run
  ```
- [ ] 确认输出无误后，执行迁移：
  ```bash
  python migrate_agents.py
  ```
- [ ] 验证Git提交：
  ```bash
  git log --oneline -2
  # 应该看到两个提交：
  # - refactor(agents): Move agents to .claude/agents/
  # - chore: Remove old agents directory
  ```

---

## 测试用例

### Test 1: Skill 自动触发测试

**目标**: 验证 `webnovel-writer` skill 在执行 `/webnovel-write` 时自动加载

**步骤**:
1. 准备测试环境：
   ```bash
   # 创建最小测试结构
   mkdir -p .webnovel 大纲 正文
   echo '{}' > .webnovel/state.json
   echo '# 第1卷详细大纲' > 大纲/第1卷-详细大纲.md
   ```

2. 执行命令：
   ```bash
   claude-code /webnovel-write 1
   ```

3. 观察输出是否包含：
   - [ ] "Write a webnovel chapter following the outline"（说明command被触发）
   - [ ] 应用"防幻觉三大定律"相关提示（说明skill知识被加载）
   - [ ] 提及"爽点"或"Strand Weave"（说明skill自动激活）

**成功标准**:
- ✅ Claude 自动引用 skill 中的知识（三大定律、爽点策略、Strand Weave）
- ✅ 没有出现"找不到 skill"或"skill 未加载"错误
- ✅ 输出内容符合 webnovel-writer 知识库的规范

**失败处理**:
- ❌ 如果skill未自动加载 → 检查 SKILL.md 的 `description` 字段是否包含触发关键词
- ❌ 如果command未执行 → 检查 `.claude/commands/webnovel-write.md` 是否存在

---

### Test 2: Python 脚本执行测试

**目标**: 验证 command 能正确调用 Python 管理脚本

**步骤**:
1. 准备完整的 state.json：
   ```json
   {
     "current_chapter": 0,
     "total_words": 0,
     "protagonist": {
       "power": {"realm": "淬体期", "layer": 1},
       "location": "慕容家族"
     },
     "strand_tracker": {
       "last_quest_chapter": 0,
       "last_fire_chapter": 0,
       "last_constellation_chapter": 0
     }
   }
   ```

2. 手动测试 update_state.py：
   ```bash
   python .claude/skills/webnovel-writer/scripts/update_state.py --progress 1 3500
   ```

3. 验证输出：
   - [ ] state.json 的 `current_chapter` 更新为 1
   - [ ] state.json 的 `total_words` 更新为 3500
   - [ ] 没有报错（编码错误、路径错误等）

4. 测试 backup_manager.py：
   ```bash
   python .claude/skills/webnovel-writer/scripts/backup_manager.py --chapter 1 --chapter-title "测试章节"
   ```

5. 验证输出：
   - [ ] Git 创建了新提交（`git log -1`）
   - [ ] Git 创建了标签 `ch0001`（`git tag -l`）

**成功标准**:
- ✅ 所有脚本正常执行，无编码错误（Windows UTF-8）
- ✅ state.json 正确更新
- ✅ Git 操作成功（commit + tag）

**失败处理**:
- ❌ 编码错误 → 检查脚本是否包含 UTF-8 修复代码（见之前的fix提交）
- ❌ 路径错误 → 确认工作目录在项目根目录

---

### Test 3: Subagent 调用测试

**目标**: 验证通过 Task tool 调用 5 个 subagents 是否正常工作

**步骤**:
1. 创建测试章节：
   ```bash
   # 创建两章用于测试
   echo "# 第1章\n内容..." > 正文/第0001章.md
   echo "# 第2章\n内容..." > 正文/第0002章.md
   ```

2. 手动测试单个 subagent（在 Claude Code CLI 中）：
   ```
   请使用 Task tool 调用 high-point-checker subagent，检查 Chapters 1-2 的爽点密度
   ```

3. 观察 Claude Code 的行为：
   - [ ] 正确识别 `high-point-checker` 作为 subagent_type
   - [ ] Task tool 启动独立会话
   - [ ] Subagent 读取 `正文/第0001章.md` 和 `正文/第0002章.md`
   - [ ] 返回结构化报告（包含密度检查、类型分布、质量评级）

4. 测试所有 5 个 subagents（在 chapter_num = 2 时自动触发）：
   ```
   /webnovel-write 2
   ```

5. 验证双章审查逻辑：
   - [ ] 检测到 `chapter_num % 2 == 0`
   - [ ] 并行调用 5 个 subagents（high-point, consistency, pacing, ooc, continuity）
   - [ ] 等待所有审查完成后汇总报告

**成功标准**:
- ✅ Subagents 成功启动（独立会话）
- ✅ Subagents 使用 allowed-tools (Read, Grep) 读取章节
- ✅ 返回结构化报告（Markdown 格式，包含表格和建议）
- ✅ 双章审查自动触发（chapter_num % 2 == 0）

**失败处理**:
- ❌ "Subagent not found" → 检查 `.claude/agents/` 目录下是否有对应 .md 文件
- ❌ Subagent 无法读取文件 → 检查 frontmatter 的 `allowed-tools` 是否包含 Read
- ❌ 双章审查未触发 → 检查 webnovel-write.md 的 Step 7 逻辑

---

### Test 4: Skill 知识库内容验证

**目标**: 验证 SKILL.md 包含完整的网文创作知识

**步骤**:
1. 打开 `.claude/skills/webnovel-writer/SKILL.md`

2. 检查必备章节：
   - [ ] 🎯 核心原则：防幻觉三大定律
   - [ ] 📖 爽点设计指南
   - [ ] 📊 节奏平衡：Strand Weave
   - [ ] 📝 对话与描写规范
   - [ ] ✅ 写作检查清单
   - [ ] 🔍 常见错误与修正
   - [ ] 📚 参考文档链接

3. 验证爽点类型完整性（5种）：
   - [ ] 打脸型 (Face-slapping)
   - [ ] 升级型 (Level-up)
   - [ ] 收获型 (Reward)
   - [ ] 扮猪吃虎 (Underdog)
   - [ ] 装逼打脸 (Counter-flexing)

4. 验证 Strand Weave 警告阈值：
   - [ ] Quest 连续 5+ 章 → 警告
   - [ ] Fire 距上次 > 10 章 → 警告
   - [ ] Constellation 距上次 > 15 章 → 警告

5. 验证 frontmatter 触发关键词：
   - [ ] description 包含 "writing webnovel chapters"
   - [ ] description 包含 "anti-hallucination protocols"
   - [ ] description 包含 "cool-points"
   - [ ] description 包含 "Strand Weave"

**成功标准**:
- ✅ SKILL.md 为纯知识库（无执行步骤）
- ✅ 包含所有核心概念和检查清单
- ✅ frontmatter 的 description 能触发自动加载

**失败处理**:
- ❌ 缺少章节 → 从 crucible-temp/skills/crucible-planner/SKILL.md 参考结构
- ❌ 触发失败 → 调整 description 关键词

---

### Test 5: 完整工作流集成测试

**目标**: 端到端测试完整的章节创作 + 审查流程

**步骤**:
1. 准备完整项目环境：
   ```bash
   # 初始化state.json
   # 创建大纲文件
   # 准备设定集/
   ```

2. 执行完整工作流：
   ```bash
   /webnovel-write 1  # 第1章（无审查）
   /webnovel-write 2  # 第2章（触发双章审查）
   ```

3. 验证工作流每个环节：
   - [ ] **Step 1**: 自动读取 state.json, 大纲, 前置章节
   - [ ] **Step 2**: Skill 知识自动加载，生成章节正文（3000-5000字）
   - [ ] **Step 3**: 识别 [NEW_ENTITY] 标签，调用 extract_entities.py
   - [ ] **Step 4**: 调用 update_state.py 更新状态
   - [ ] **Step 5**: 调用 backup_manager.py 创建 Git commit
   - [ ] **Step 6**: 手动或自动更新 strand_tracker
   - [ ] **Step 7** (chapter 2): 触发 5 个 subagents 并汇总报告
   - [ ] **Final Output**: 输出结构化摘要（章节信息、状态更新、系统操作、双章审查）

4. 验证输出文件：
   - [ ] `正文/第0001章.md` 存在且字数合格
   - [ ] `正文/第0002章.md` 存在且字数合格
   - [ ] `.webnovel/state.json` 更新正确
   - [ ] Git 历史包含 ch0001, ch0002 标签

**成功标准**:
- ✅ 所有 7 个步骤顺序执行无错误
- ✅ 双章审查在 chapter 2 自动触发
- ✅ 输出文件完整且格式正确
- ✅ Git 历史追踪完整

**失败处理**:
- ❌ 某步骤报错 → 根据错误信息定位问题（脚本、路径、权限）
- ❌ Skill未加载 → 检查触发关键词
- ❌ Subagent未调用 → 检查 Task tool 语法和 chapter_num 判断逻辑

---

## 性能与质量指标

### 预期性能

| 指标 | 目标值 | 测试方法 |
|-----|--------|---------|
| Skill 加载延迟 | < 2s | 观察 `/webnovel-write` 首次响应时间 |
| 单章生成时间 | 2-5 min | 计时第1章生成（3000-5000字） |
| 双章审查时间 | 3-8 min | 计时第2章审查（5个subagents并行） |
| 脚本执行时间 | < 5s | 测试 update_state.py + backup_manager.py |

### 质量检查

- [ ] 生成章节符合"防幻觉三大定律"（无战力崩坏、无未标记新实体）
- [ ] 每章至少包含 1 个爽点
- [ ] Strand balance 在前 10 章内符合理想比例（Quest 60%, Fire 20%, Constellation 20%）
- [ ] Subagent 报告包含具体问题和可执行建议

---

## 回滚测试

### 验证迁移可逆性

1. 运行迁移脚本：
   ```bash
   python migrate_agents.py
   ```

2. 如需回滚：
   ```bash
   # 找到备份目录
   ls .claude/backups/

   # 回滚（手动）
   cp -r .claude/backups/agents_backup_XXXXXX/* .claude/skills/webnovel-writer/agents/
   rm -rf .claude/agents/

   # 或使用 Git 回滚
   git log --oneline  # 找到迁移前的commit
   git revert <commit-hash>
   ```

3. 验证回滚后：
   - [ ] Agents 回到旧位置 `skills/webnovel-writer/agents/`
   - [ ] 新位置 `.claude/agents/` 不存在或为空
   - [ ] 功能仍正常工作（兼容性测试）

---

## 常见问题排查

### 问题 1: Skill 未自动加载

**症状**: 执行 `/webnovel-write` 后，Claude 没有应用"防幻觉三大定律"等知识

**排查**:
1. 检查 `SKILL.md` frontmatter 的 `description` 字段
2. 确认 description 包含触发关键词（"writing webnovel chapters", "anti-hallucination"）
3. 尝试在对话中显式提及触发词："请按照网文创作规范写第1章"

### 问题 2: Subagent 调用失败

**症状**: "Subagent not found" 或 Task tool 报错

**排查**:
1. 确认 `.claude/agents/` 目录下有 5 个 .md 文件
2. 检查 frontmatter 的 `name` 字段是否与 subagent_type 一致
3. 检查 `allowed-tools` 是否包含 Read 和 Grep

### 问题 3: Python 脚本编码错误（Windows）

**症状**: `UnicodeEncodeError` 或乱码

**排查**:
1. 确认脚本包含 UTF-8 修复代码：
   ```python
   if sys.platform == 'win32':
       import io
       sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
   ```
2. 检查 Windows 终端是否设置为 UTF-8（`chcp 65001`）

### 问题 4: Git 操作失败

**症状**: backup_manager.py 报错 "git: command not found"

**排查**:
1. 确认 Git 已安装：`git --version`
2. 确认项目已初始化：`ls .git/`
3. 检查工作目录是否在项目根目录

---

## 验收标准（Acceptance Criteria）

### 必须通过（MUST）

- ✅ Test 1 通过（Skill 自动触发）
- ✅ Test 2 通过（Python 脚本执行）
- ✅ Test 3 通过（Subagent 调用）
- ✅ Test 5 通过（完整工作流）

### 建议通过（SHOULD）

- ✅ Test 4 通过（Skill 知识库内容完整）
- ✅ 回滚测试通过（可逆性）
- ✅ 性能指标达标（< 5min 单章生成）

### 可选（MAY）

- ✅ 质量指标达标（爽点密度、Strand balance）
- ✅ 所有常见问题排查步骤已文档化

---

## 测试报告模板

```markdown
# webnovel-writer 架构重构测试报告

**测试日期**: YYYY-MM-DD
**测试人员**: [姓名]
**项目版本**: [Git commit hash]

## 测试结果汇总

| Test Case | Status | Notes |
|-----------|--------|-------|
| Test 1: Skill Auto-trigger | ✅ PASS / ❌ FAIL | ... |
| Test 2: Python Scripts | ✅ PASS / ❌ FAIL | ... |
| Test 3: Subagent Invocation | ✅ PASS / ❌ FAIL | ... |
| Test 4: Skill Content | ✅ PASS / ❌ FAIL | ... |
| Test 5: End-to-End Workflow | ✅ PASS / ❌ FAIL | ... |

## 发现的问题

1. **问题描述**: ...
   - **严重程度**: Critical / High / Medium / Low
   - **复现步骤**: ...
   - **建议修复**: ...

2. ...

## 性能测试结果

- Skill 加载延迟: X.Xs
- 单章生成时间: X min
- 双章审查时间: X min
- 脚本执行时间: X.Xs

## 结论

- [ ] **通过验收** - 所有 MUST 测试通过，可投入使用
- [ ] **部分通过** - 存在 SHOULD 级别问题，建议修复后使用
- [ ] **未通过** - 存在 MUST 级别问题，必须修复

**下一步行动**: ...
```

---

**测试完成后，请将测试报告提交到项目仓库的 `docs/testing/` 目录。**
