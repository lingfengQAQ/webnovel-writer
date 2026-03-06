# Step 1.5 Contract Template

## 目标

把 `extract_chapter_context.py` 的上下文与 guidance 收束成“可执行合同”，直接驱动 Step 2A。

## 必填输出结构（Scene-Sequel 最小闭环）

- 目标（20字内）
- 阻力（20字内）
- 代价（20字内）
- 本章变化（30字内，优先可量化：关系/资源/风险/地位/能力）
- 未闭合问题（30字内，后段或章末）
- 核心冲突一句话
- 开头类型（冲突/悬疑/动作/对话/氛围）
- 情绪节奏（低→高/高→低/低→高→低/平稳）
- 信息密度（low/medium/high）
- 是否过渡章（true/false，必须按大纲判定，不按字数判定）
- 追读力设计（钩子类型/强度、微兑现清单、爽点模式）

过渡章判定规则（强制）：
- 依据章纲/卷纲中的章节功能标签与目标（铺垫/转场/承接/回收等）。
- 若大纲未显式标注，由“本章核心目标是否以推进主冲突为主”判定。
- 禁止使用字数阈值判定过渡章。

## 差异化检查

- 钩子类型优先避免与最近 3 章重复。
- 开头类型优先避免与最近 3 章重复。
- 爽点模式优先避免与最近 5 章重复。

若必须重复，必须记录 Override 理由，并至少变更以下一项：
- 对象
- 代价
- 结果

## 题材快速调用（仅命中时）

命中题材：`esports` / `livestream` / `cosmic-horror`

执行：
1. 从 `writing/genre-hook-payoff-library.md` 选 1 条期待锚点（优先章末，也可后段）。
2. 选 1-2 条微兑现，优先与本章核心冲突同方向。

## 读取优先级

1. 必读：`writing_guidance.guidance_items`
2. 条件必读：`rag_assist`（`invoked=true` 且 `hits` 非空）
3. 选读：`reader_signal`、`genre_profile.reference_hints`
