# Webnovel Writer

[![License](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)](https://www.python.org/)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-Compatible-purple.svg)](https://claude.ai/claude-code)

基于 Claude Code 的长篇网文辅助创作系统，解决 AI 写作中的「遗忘」和「幻觉」问题，支持 **200 万字量级** 连载创作。

---

## 目录

- [核心理念](#核心理念)
- [系统架构](#系统架构)
- [快速开始](#快速开始)
- [命令详解](#命令详解)
- [双 Agent 架构](#双-agent-架构)
- [六维并行审查](#六维并行审查)
- [RAG 检索系统](#rag-检索系统)
- [题材模板](#题材模板)
- [配置说明](#配置说明)
- [项目结构](#项目结构)
- [故障恢复](#故障恢复)
- [License](#license)

---

## 核心理念

### 防幻觉三定律

| 定律 | 说明 | 执行方式 |
|------|------|---------|
| **大纲即法律** | 遵循大纲，不擅自发挥 | Context Agent 强制加载章节大纲 |
| **设定即物理** | 遵守设定，不自相矛盾 | Consistency Checker 实时校验 |
| **发明需识别** | 新实体必须入库管理 | Data Agent 自动提取并消歧 |

### 创意约束系统 (v5.4.2 引入)

| 机制 | 说明 |
|------|------|
| **三轴混搭** | 题材基础 + 规则限制 + 角色矛盾（至少2/3非默认） |
| **反套路触发器** | 每项目必选至少1条反常规规则 |
| **镜像对抗** | 反派与主角共享欲望/缺陷，采取相反道路 |
| **约束继承** | 大纲规划时继承创意约束，每N章触发 |

### 追读力机制 (v5.3 引入)

**约束分层系统**：

| 层级 | 说明 | 处理方式 |
|------|------|---------|
| **Hard Invariants** | 不可违反的硬约束 | 必须修复，无法跳过 |
| **Soft Guidance** | 可违反的软建议 | 可通过 Override Contract 跳过 |

**Hard Invariants (4条)**：
- HARD-001: 可读性底线 - 读者必须能理解发生了什么
- HARD-002: 承诺违背 - 上章钩子必须有回应
- HARD-003: 节奏灾难 - 不可连续N章无推进
- HARD-004: 冲突真空 - 每章必须有问题/目标/代价

**Override Contract 机制**：
- 违反软建议时需记录理由和偿还计划
- 每个 Override 产生债务，利息为可选机制（默认不自动计算）
- 逾期债务会影响后续章节评分（仅在开启追踪时生效）

### Strand Weave 节奏系统

三线交织的叙事节奏控制：

| Strand | 含义 | 理想占比 | 说明 |
|--------|------|---------|------|
| **Quest** | 主线剧情 | 60% | 推动核心冲突 |
| **Fire** | 感情线 | 20% | 人物关系发展 |
| **Constellation** | 世界观扩展 | 20% | 背景/势力/设定 |

**节奏红线**：
- Quest 连续不超过 5 章
- Fire 断档不超过 10 章
- 每章至少包含 2 种 Strand

---

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                      Claude Code                             │
├─────────────────────────────────────────────────────────────┤
│  Skills (7个)                                                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                     │
│  │  init    │ │   plan   │ │  write   │ │  learn   │        │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                     │
│  │  review  │ │  query   │ │  resume  │                     │
│  └──────────┘ └──────────┘ └──────────┘                     │
├─────────────────────────────────────────────────────────────┤
│  Agents (8个)                                                │
│  ┌─────────────────┐  ┌─────────────────┐                   │
│  │  Context Agent  │  │   Data Agent    │                   │
│  │     (读取)      │  │     (写入)      │                   │
│  └─────────────────┘  └─────────────────┘                   │
│  ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐│
│  │ 爽点  │ │ 一致性│ │ 节奏  │ │  OOC  │ │ 连贯性│ │追读力 ││
│  └───────┘ └───────┘ └───────┘ └───────┘ └───────┘ └───────┘│
├─────────────────────────────────────────────────────────────┤
│  Data Layer                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                     │
│  │state.json│ │ index.db │ │vectors.db│                     │
│  │ (状态)   │ │ (索引)   │ │ (向量)   │                     │
│  └──────────┘ └──────────┘ └──────────┘                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 快速开始

### 前置要求

| 依赖 | 版本要求 | 说明 |
|------|---------|------|
| Python | >= 3.10 | 数据处理脚本运行环境 |
| Claude Code | 最新版 | Anthropic 官方 CLI 工具 |
| Git | 任意版本 | 版本控制和章节备份 |

### 1. 安装

```bash
# 进入你的小说项目目录
cd your-novel-project

# 克隆插件到 .claude 目录
git clone https://github.com/lingfengQAQ/webnovel-writer.git .claude

# 安装 Python 依赖
pip install -r .claude/scripts/requirements.txt
```

可选（推荐）：设置 `data_modules` 模块路径，便于在项目根目录直接执行 `python -m data_modules.*`。

```powershell
# Windows PowerShell
$env:PYTHONPATH = ".claude/scripts"
```

```bash
# macOS / Linux
export PYTHONPATH=".claude/scripts"
```

**Python 依赖说明**：

| 包名 | 用途 |
|------|------|
| aiohttp | 异步 HTTP 客户端，用于 Embedding/Reranker API 调用 |
| filelock | 文件锁，防止 state.json 并发写入冲突 |
| pydantic | Schema 校验和数据验证 |
| pytest | 单元测试（可选） |
| pytest-cov | 覆盖率统计（可选） |

### 2. 初始化项目

```bash
# 在 Claude Code 中执行
/webnovel-init
```

系统会引导你完成：
- Deep 初始化信息采集（完整建模）
- 选择题材类型
- 设计金手指/核心卖点
- 生成项目结构和设定模板

### 3. 规划大纲

```bash
# 规划第1卷大纲
/webnovel-plan 1
```

### 4. 开始创作

```bash
# 创作第1章
/webnovel-write 1
```

### 5. 质量审查（可选）

```bash
# 审查第1-5章
/webnovel-review 1-5
```

---

## 命令详解

### /webnovel-init - 项目初始化

初始化项目结构、题材模板、世界观设定。

**初始化模式**：

当前默认执行 **Deep 模式**（完整初始化流程，约 30-45 分钟）。

**产出文件**：
- `.webnovel/state.json` - 项目状态
- `设定集/` - 世界观、力量体系、角色卡
- `大纲/总纲.md` - 故事框架

---

### /webnovel-plan [卷号] - 大纲规划

制定详细的卷大纲，规划爽点分布和节奏。

```bash
/webnovel-plan 1        # 规划第1卷
/webnovel-plan 2-3      # 规划第2-3卷
```

**产出**：
- `大纲/第N卷-详细大纲.md`
- 每章目标、爽点设计、Strand 类型
- 新增实体预告

---

### /webnovel-write [章号] - 章节创作

采用双 Agent 架构的自动化章节创作。

```bash
/webnovel-write 1       # 创作第1章
/webnovel-write 45      # 创作第45章
```

**创作流程 (v5.4.1)**：

```
Step 1: Context Agent 搜集上下文 → 创作任务书（含追读力策略）
        ↓
Step 1.5: 章节设计（开头/钩子/爽点/微兑现规划）
        ↓
Step 2A: 生成粗稿（3000-5000字）
        ↓
Step 2B: 风格适配器（网文化改写）
        ↓
Step 3: 默认 4 Agent 审查（关键章扩展到 6）
        ↓
Step 4: 网文化润色
        ↓
Step 5: Data Agent 提取实体/更新索引/记录追读力元数据
        ↓
Step 6: Git 自动提交备份
```

**写作模式**：
- **标准模式**: 完整执行 Step 1-6
- **快速模式** (`--fast`): 跳过 Step 2B
- **极简模式** (`--minimal`): 跳过 Step 2B + 仅 3 个核心审查（无追读力数据）

**产出**：
- `正文/第N章-标题.md`
- `.webnovel/summaries/ch{NNNN}.md` - 章节摘要（独立存储）

---

### /webnovel-review [范围] - 质量审查

对已完成章节进行多维度深度扫描。

```bash
/webnovel-review 1-5    # 审查第1-5章
/webnovel-review 45     # 审查单章
```

**审查维度**：
- 爽点密度与质量
- 设定一致性
- 节奏 Strand 分布
- 人物 OOC 检测
- 场景连贯性

---

### /webnovel-query [关键词] - 信息查询

查询角色、境界、伏笔、系统状态等运行时信息。

```bash
/webnovel-query 萧炎         # 查询角色信息
/webnovel-query 伏笔         # 查看待回收伏笔
/webnovel-query 紧急         # 查看紧急伏笔
```

---

### /webnovel-resume - 任务恢复

在任务中断时检测中断点并提供安全恢复选项。

```bash
/webnovel-resume
```

**恢复选项**：
- 从断点继续
- 回滚到上一个安全点
- 重新开始当前步骤

---

## 双 Agent 架构

### Context Agent（创作任务书工程师）

**职责**：为写作准备精准的创作任务书（人话版）

**工作流程**：
1. 读取本章大纲，分析需要什么信息
2. 从 `state.json` 获取主角状态快照
3. 从 `state.json → chapter_meta` 读取上章钩子/模式
4. 调用 `index.db` 查询相关实体和别名
5. 调用 RAG 语义检索相关历史场景
6. 搜索设定集获取相关设定
7. 评估伏笔紧急度
8. 推断角色动机/情绪
9. 组装**创作任务书**

**输出结构（7个板块）**：
1. **本章核心任务**（冲突一句话、必须完成、绝对不能）
2. **接住上章**（上章钩子、读者期待、开头必须）
3. **出场角色**（状态、动机、情绪底色、说话风格、红线）
4. **场景与力量约束**（地点、可用能力、禁用能力）
5. **风格指导**（本章类型、参考样本、最近模式、本章建议）
6. **连续性与伏笔**（时间/位置/情绪连贯；必须处理/可选伏笔）
7. **追读力策略**（钩子类型/强度、微兑现建议、差异化提示；有债务时附带说明）

---

### Data Agent（数据链工程师）

**职责**：从正文中语义化提取实体并同步状态

**工作流程**：
1. **实体提取**：识别角色/地点/物品/招式/势力
2. **实体消歧**：
   - 高置信度 (>0.8)：自动采用
   - 中置信度 (0.5-0.8)：采用但记录 warning
   - 低置信度 (<0.5)：标记待人工确认
3. **写入存储**：更新 `index.db` + `state.json`
4. **场景切片**：按地点/时间/视角切分场景
5. **向量嵌入**：调用 RAG 存入向量库
6. **记录章节元数据**：钩子/模式/结束状态写入 `chapter_meta`
7. **生成章节摘要**：写入 `.webnovel/summaries/ch{NNNN}.md`

**输出格式**：
```json
{
  "entities_extracted": [...],
  "state_changes": [...],
  "scenes": [...],
  "warnings": [...],
  "stats": {
    "new_entities": 3,
    "updated_entities": 2,
    "scenes_created": 4
  }
}
```

---

## 六维并行审查

| Checker | 检查内容 | 关键指标 |
|---------|---------|---------|
| **High-point Checker** | 爽点密度与质量 | 6种执行模式、30/40/30结构 |
| **Consistency Checker** | 战力/地点/时间线 | 设定即物理定律 |
| **Pacing Checker** | Strand 比例分布 | Quest/Fire/Constellation |
| **OOC Checker** | 人物言行是否符合人设 | 角色卡片对照 |
| **Continuity Checker** | 场景转换流畅度 | 伏笔回收情况 |
| **Reader-pull Checker** | 追读力检查 | 钩子强度、模式重复、读者期待 |

### 爽点八大执行模式 (v5.3)

| 模式 | 模式标识 | 典型触发 |
|------|---------|---------|
| 装逼打脸 | Flex & Counter | 嘲讽 → 反转 → 震惊 |
| 扮猪吃虎 | Underdog Reveal | 示弱 → 暴露 → 碾压 |
| 越级反杀 | Underdog Victory | 差距 → 策略 → 逆转 |
| 打脸权威 | Authority Challenge | 权威 → 挑战 → 成功 |
| 反派翻车 | Villain Downfall | 得意 → 反杀 → 落幕 |
| 甜蜜超预期 | Sweet Surprise | 期待 → 超预期 → 升华 |
| **迪化误解** | Misunderstanding Elevation | 随意行为 → 配角脑补 → 读者优越感 |
| **身份掉马** | Identity Reveal | 伪装 → 揭露 → 周围震惊 |

### 钩子五大类型 (v5.3)

| 类型 | 驱动力 | 示例 |
|------|--------|------|
| 危机钩 | 危险逼近，读者担心 | "门外传来脚步声..." |
| 悬念钩 | 信息缺口，读者好奇 | "他看到信上的名字，脸色骤变" |
| 情绪钩 | 强情绪触发 | 愤怒/心疼/心动 |
| 选择钩 | 两难抉择 | "救师父还是救爱人？" |
| 渴望钩 | 好事将至，读者期待 | "明天就是突破的日子" |

### 微兑现七大类型 (v5.3)

| 类型 | 说明 |
|------|------|
| 信息兑现 | 揭示新信息/线索/真相 |
| 关系兑现 | 关系推进/确认/变化 |
| 能力兑现 | 能力提升/新技能展示 |
| 资源兑现 | 获得物品/资源/财富 |
| 认可兑现 | 获得认可/面子/地位 |
| 情绪兑现 | 情绪释放/共鸣 |
| 线索兑现 | 伏笔回收/推进 |

### 爽点密度基准

- **每章**：≥ 1 cool-point (任何单一模式)
- **每5章**：≥ 1 combo cool-point (2种以上模式叠加)
- **每10章**：≥ 1 milestone victory (改变主角地位的阶段性胜利)

---

## RAG 检索系统

混合检索系统，支持语义搜索历史场景：

### 架构

```
查询 → [向量检索] + [BM25关键词] → RRF融合 → Rerank排序 → Top-K结果
```

### 配置

| 组件 | 默认提供商 | 默认模型 |
|-----|----------|---------|
| Embedding | ModelScope (魔搭) | Qwen/Qwen3-Embedding-8B |
| Reranker | Jina AI | jina-reranker-v3 |

### 环境变量

```bash
# .env 文件

# Embedding 配置 (默认使用魔搭)
EMBED_API_TYPE=openai          # openai 兼容接口
EMBED_BASE_URL=https://api-inference.modelscope.cn/v1
EMBED_MODEL=Qwen/Qwen3-Embedding-8B
EMBED_API_KEY=your-modelscope-token

# Reranker 配置
RERANK_API_TYPE=openai         # openai (兼容 Jina/Cohere)
RERANK_BASE_URL=https://api.jina.ai/v1
RERANK_MODEL=jina-reranker-v3
RERANK_API_KEY=jina_xxx
```

### 使用方式

- **Context Agent** 自动调用 RAG 检索相关历史场景
- **Data Agent** 自动将章节场景向量化存入数据库
- 支持失败重试（指数退避，最多3次）

---

## 题材模板

系统内置 **35+** 种热门网文题材模板，支持复合题材组合：

### 玄幻修仙类
| 题材 | 说明 |
|------|------|
| 修仙 | 境界体系、宗门体系、秘境夺宝 |
| 系统流 | 面板设计、任务系统、奖励机制 |
| 高武 | 武道境界、战斗设计、世家冲突 |
| 西幻 | 种族体系、魔法等级、神明信仰 |
| 无限流 | 副本设计、队友配置、能力体系 |
| 末世 | 资源法则、异能体系、基地建设 |
| 科幻 | 科技树、飞船/机甲分类、外星文明 |

### 都市现代类
| 题材 | 说明 |
|------|------|
| 都市异能 | 隐藏实力、家族势力、权贵互动 |
| 都市日常 | 职场体系、晋升路径、生活流 |
| 都市脑洞 | 规则入侵、异象探索、系统降临 |
| 现实题材 | 社会问题、人物成长、现实主义 |

### 言情类
| 题材 | 说明 |
|------|------|
| 古言 | 宫廷/江湖、身份反转、虐恋情深 |
| 宫斗宅斗 | 后宫等级、斗争手段、规则禁忌 |
| 青春甜宠 | 甜度节奏、互动类型、冲突设计 |
| 豪门总裁 | 豪门等级、契约设计、身份反转 |
| 职场婚恋 | 职场博弈、晋升逆袭、行业精英 |
| 民国言情 | 豪门恩怨、乱世佳人、谍影情深 |
| 幻想言情 | 仙侠言情、种族禁恋、宿命反转 |
| 现言脑洞 | 规则恋爱、契约情缘、重生复仇 |
| 女频悬疑 | 情感悬疑、家庭谜案、关系反转 |
| 种田 | 势力经营/家长里短、内政建设 |
| 年代 | 六七十/八九十年代、时代元素 |

### 特殊题材
| 题材 | 说明 |
|------|------|
| 规则怪谈 | 规则推理、恐怖氛围、反杀怪谈 |
| 悬疑脑洞 | 规则推理、密室逃脱、信息博弈 |
| 悬疑灵异 | 灵异探险、都市传说、驱魔除灵 |
| 历史古代 | 争霸权谋、仕途升迁、科技种田 |
| 历史脑洞 | 历史规则化、穿越改命、因果博弈 |
| 游戏体育 | 电竞竞技、传统体育、棋牌竞技 |
| 抗战谍战 | 地下潜伏、情报战、特工行动 |

### 复合题材支持 (v5.4.2)

支持"题材A+题材B"组合（最多2个），例如：
- `都市脑洞+规则怪谈`
- `修仙+系统流`

**复合规则**：1主1辅（约7:3），主线保持主题材逻辑，副题材只提供规则/钩子/爽点。

---

## 配置说明

### 核心配置 (`config.py`)

```python
# API 设置
embed_concurrency = 64          # 嵌入并发数
cold_start_timeout = 300        # 冷启动超时(秒)
normal_timeout = 180            # 正常超时(秒)
api_max_retries = 3             # 最大重试次数
api_retry_delay = 1.0           # 重试延迟(秒)

# 节奏红线
strand_quest_max_consecutive = 5   # Quest 最大连续章数
strand_fire_max_gap = 10           # Fire 最大断档章数

# 爽点密度
pacing_words_per_point_excellent = 1000  # 优秀阈值
pacing_words_per_point_good = 1500       # 良好阈值
pacing_words_per_point_acceptable = 2000 # 及格阈值

# 实体置信度
extraction_confidence_high = 0.8   # 高置信度阈值（自动采用）
extraction_confidence_medium = 0.5 # 中置信度阈值（待确认）

# 上下文窗口
context_recent_summaries_window = 3   # 最近摘要数量
context_max_appearing_characters = 10 # 最大出场角色数
context_max_urgent_foreshadowing = 5  # 最大紧急伏笔数
```

---

## 项目结构

```
your-novel-project/
├── .claude/                    # 插件目录
│   ├── agents/                 # 8 个专职 Agent
│   │   ├── context-agent.md    # 创作任务书工程师
│   │   ├── data-agent.md       # 数据链工程师
│   │   ├── high-point-checker.md
│   │   ├── consistency-checker.md
│   │   ├── pacing-checker.md
│   │   ├── ooc-checker.md
│   │   ├── continuity-checker.md
│   │   └── reader-pull-checker.md  # 追读力检查（v5.2新增）
│   ├── skills/                 # 7 个核心 Skill
│   │   ├── webnovel-init/
│   │   ├── webnovel-plan/
│   │   ├── webnovel-write/
│   │   ├── webnovel-review/
│   │   ├── webnovel-query/
│   │   ├── webnovel-resume/
│   │   └── webnovel-learn/     # 模式学习（v5.4新增）
│   ├── scripts/                # Python 脚本
│   │   ├── data_modules/
│   │   │   ├── index_manager.py    # SQLite 索引管理 (v5.3)
│   │   │   ├── rag_adapter.py      # RAG 检索层（v5.4父子索引）
│   │   │   ├── context_manager.py  # Token预算管理（v5.4新增）
│   │   │   ├── api_client.py       # API 客户端
│   │   │   └── config.py           # 配置管理
│   │   ├── ...
│   │   └── 注：旧的 context_pack_builder.py 已废弃，统一使用 context_manager.py
│   ├── templates/              # 题材模板
│   │   └── genres/
│   │       ├── 修仙.md
│   │       ├── 系统流.md
│   │       ├── 替身文.md
│   │       ├── 多子多福.md
│   │       ├── 黑暗题材.md
│   │       └── ...
│   └── references/             # 写作指南
│       ├── strand-weave.md
│       ├── cool-points-guide.md
│       ├── reading-power-taxonomy.md  # 追读力分类标准 (v5.3)
│       ├── genre-profiles.md          # 题材配置档案 (v5.3)
│       └── ...
├── .webnovel/                  # 运行时数据
│   ├── state.json              # 权威状态 (含 chapter_meta)
│   ├── index.db                # SQLite 索引
│   ├── vectors.db              # RAG 向量库
│   └── summaries/              # 章节摘要（v5.2新增）
│       ├── ch0001.md
│       └── ...
├── 正文/                       # 章节文件
│   ├── 第1章-标题.md
│   └── ...
├── 大纲/                       # 卷纲/章纲
│   ├── 总纲.md
│   ├── 第1卷-详细大纲.md
│   └── ...
└── 设定集/                     # 世界观/角色/力量体系
    ├── 世界观.md
    ├── 力量体系.md
    └── 角色/
        └── ...
```

---

## 故障恢复

### 索引重建

当 `index.db` 损坏或与实际数据不一致时：

先确保当前 shell 能找到 `data_modules`（二选一）：
- 设置环境变量：`PYTHONPATH=.claude/scripts`
- 或先执行：`cd .claude/scripts`

```bash
# 重新处理单章
python -m data_modules.index_manager process-chapter --chapter 1 --project-root "."

# 批量重新处理
for i in $(seq 1 50); do
  python -m data_modules.index_manager process-chapter --chapter $i --project-root "."
done

# 查看索引统计
python -m data_modules.index_manager stats --project-root "."
```

### 追读力数据查询 (v5.3 引入)

```bash
# 查看债务汇总
python -m data_modules.index_manager get-debt-summary --project-root "."

# 查看最近章节追读力元数据
python -m data_modules.index_manager get-recent-reading-power --limit 10 --project-root "."

# 查看爽点模式使用统计
python -m data_modules.index_manager get-pattern-usage-stats --last-n 20 --project-root "."

# 查看钩子类型使用统计
python -m data_modules.index_manager get-hook-type-stats --last-n 20 --project-root "."

# 查看待偿还Override
python -m data_modules.index_manager get-pending-overrides --project-root "."

# 计算利息（开启追踪或需要时调用）
python -m data_modules.index_manager accrue-interest --current-chapter 100 --project-root "."
```

### 审查趋势查询 (v5.4 引入)

```bash
# 查看最近审查记录
python -m data_modules.index_manager get-recent-review-metrics --limit 5 --project-root "."

# 查看审查趋势统计（均值/短板分析）
python -m data_modules.index_manager get-review-trend-stats --last-n 5 --project-root "."
```

### 健康报告（status_reporter）

```bash
# 全量健康报告
python .claude/scripts/status_reporter.py --focus all --project-root "."

# 仅看伏笔紧急度
python .claude/scripts/status_reporter.py --focus urgency --project-root "."

# 仅看爽点节奏
python .claude/scripts/status_reporter.py --focus pacing --project-root "."
```

说明：
- 伏笔分析优先使用 `plot_threads.foreshadowing` 的真实章节字段（如 `planted_chapter` / `target_chapter`）。
- 爽点节奏优先使用 `chapter_reading_power.coolpoint_patterns`，其次回退 `chapter_meta`。
- 若章节数据缺失，报告会标记“数据不足”，不会再用固定假设值估算。

### Claude Code 调用责任（重要）

- 本项目脚本默认由 Claude Code 的 Skill/Agent 在流程节点自动触发，不以人工手动调用为主。
- 详细“谁调用、何时调用、调用什么”见：`.claude/references/claude-code-call-matrix.md`。

### 向量重建

当 `vectors.db` 损坏或嵌入模型更换时：

```bash
# 重新索引单章
python -m data_modules.rag_adapter index-chapter --chapter 1 --project-root "."

# 查看向量统计
python -m data_modules.rag_adapter stats --project-root "."
```

### Git 回滚

每章自动创建 Git 标签，支持按章回滚：

```bash
# 查看章节标签
git tag --list "ch*"

# 回滚到第45章
git checkout ch0045
```

---

## 版本历史

### v5.4.2 (当前)
- **创意约束系统**：三轴混搭 + 反套路触发器 + 镜像对抗 + 约束继承
- **题材模板扩展**：从10+扩展到35+种题材模板
- **复合题材支持**：支持"题材A+题材B"组合（1主1辅）
- **反套路库**：修仙/玄幻反套路库（20条限制 + 15种非套路爽点）
- **规则怪谈反套路库**：20条限制 + 20种非套路爽点
- **创意银行**：idea_bank.json 存储生成的创意包
- **人物设定扩展**：女主卡、主角组、反派设计模板
- **世界构建扩展**：货币体系、境界链模板、社会阶层、资源分配
- **webnovel-init 升级**：Phase 6.5 创意约束生成
- **webnovel-plan 升级**：Phase 2.5 加载创意约束 + Phase 7 约束继承检查

### v5.4.1
- **Checker分层**：审查Agent输出结构化报告
- **Context精简**：创作任务书优化

### v5.4
- **审查指标追踪**：review_metrics 表记录每次审查的评分/维度/问题数
- **审查趋势统计**：get-review-trend-stats 查询近期审查均值和短板
- **故事骨架采样**：context_manager 每 N 章采样历史摘要，构建长篇感知
- **上下文工程升级**：基于 Context Engineering Guide 优化
- **invalid_facts 表**：追踪无效事实，支持 pending/confirmed 状态
- **父子向量索引**：parent_chunk_id 支持摘要-场景层级检索
- **Token 预算管理**：ContextManager 实现 40%/35%/25% 优先级分配
- **webnovel-learn skill**：从会话提取成功模式写入 project_memory.json
- **CLI 统一输出**：CLIResponse 标准化 JSON 输出格式
- **Pydantic Schema**：DataAgentOutput 等结构化验证
- **不向前兼容**：vectors.db 表结构变更时自动 DROP+CREATE

### v5.3
- **追读力分类标准**：钩子5类型、爽点8模式、微兑现7类型
- **约束分层机制**：Hard Invariants (4条) + Soft Guidance (可Override)
- **Override Contract**：违反软建议需记录理由和偿还计划
- **追读力债务**：债务追踪、利息计算、逾期管理
- **题材Profile**：8种内置题材配置（偏好钩子/爽点/微兑现要求）
- **SQLite新表**：override_contracts、chase_debt、debt_events、chapter_reading_power
- **Context Agent**：输出精简为7个板块（含追读力策略，债务状态按需输出）
- **CLI新命令**：get-debt-summary、get-recent-reading-power、accrue-interest 等

### v5.2
- 创作任务书：Context Agent 输出人话版 8 章节格式（替代 JSON）
- 追读力检查：新增 reader-pull-checker（第 6 个审查 Agent）
- 章节设计：Step 1.5 选择开头/钩子/爽点模式，避免重复
- 风格适配器：Step 2A/2B 拆分，先写剧情后网文化
- 摘要分离：章节摘要存入 `.webnovel/summaries/ch{NNNN}.md`
- chapter_meta：记录钩子/模式/结束状态到 state.json
- 轻量模式：支持 `--fast` / `--minimal` 加速写作
- 输出模板：7 个标准模板文件（state/index schema、设定集、大纲）

### v5.1
- SQLite 存储：entities/aliases/state_changes 迁移到 index.db
- state.json 精简至 < 5KB
- API 重试机制（指数退避）
- 6 种爽点执行模式

### v5.0
- 双 Agent 架构 (Context + Data)
- 纯正文写作，无需 XML 标签
- 5 维并行审查

---

## License

GPL v3 - 详见 [LICENSE](LICENSE)

---

## 致谢

本项目使用 **Claude Code + Gemini CLI + Codex** 配合 Vibe Coding 方式开发。

灵感来源：[Linux.do 帖子](https://linux.do/t/topic/1397944/49)

---

## 贡献

欢迎提交 Issue 和 PR！

```bash
# Fork 项目后
git checkout -b feature/your-feature
git commit -m "feat: add your feature"
git push origin feature/your-feature
```
