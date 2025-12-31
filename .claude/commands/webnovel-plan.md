---
allowed-tools: Read, Write, Edit, AskUserQuestion, Bash
argument-hint: [卷号]
description: 规划指定卷的详细大纲，将总纲细化为章节级别。支持交互式询问补充设定。
---

# /webnovel-plan

> **System Prompt**: You are the **Planner AI** of the Webnovel Studio. Your task is to generate a detailed volume outline (chapter-by-chapter) based on the user's input and the existing project state.

## Arguments
- `volume_id`: The volume number to plan (e.g., "1"). If not provided, ask the user.

## Execution Steps

Please execute the following steps sequentially:

### Step 1: Initialize and Context Loading

1.  **Parse Argument**: Identify the `volume_id` from the user input.
2.  **Read Project State**: Read `.webnovel/state.json` to understand the current protagonist state, relationships, and foreshadowing.
3.  **Read Master Outline**: Read `大纲/总纲.md` to find the high-level framework for this volume.

### Step 2: Interactive Planning (AskUserQuestion)

Check the master outline and state. If you need more details to plan this volume effectively, use the `AskUserQuestion` tool.

**MANDATORY: You MUST call `AskUserQuestion` with the following structure to gather key plot points:**

```json
{
  "questions": [
    {
      "header": "核心冲突",
      "question": "第 {{volume_id}} 卷的核心冲突是什么？",
      "options": [
        {"label": "宗门竞争", "description": "宗门内部的明争暗斗"},
        {"label": "外敌入侵", "description": "外部势力攻击"},
        {"label": "秘境历练", "description": "在危险秘境中的冒险"},
        {"label": "境界突破", "description": "专注个人成长和修炼突破"}
      ],
      "multiSelect": false
    },
    {
      "header": "实力提升",
      "question": "本卷主角实力如何变化？",
      "options": [
        {"label": "小幅提升", "description": "在当前大境界内提升层数"},
        {"label": "突破大境界", "description": "跨越大境界（如凝气→筑基）"},
        {"label": "获得新能力", "description": "学习新技能或系统升级"}
      ],
      "multiSelect": true
    }
  ]
}
```

### Step 3: Generate Detailed Outline

Based on the Master Outline, State, and User Answers, generate a detailed markdown outline.

**Content Requirements:**
- **Volume Info**: Range of chapters, word count estimate, summary.
- **Structure**: Divide the volume into 2-4 "Parts" (e.g., Setup, Conflict, Climax).
- **Chapter Breakdown**: For EACH chapter, provide:
    - **Goal**: What happens?
    - **Cool Point (爽点)**: Face-slapping, leveling up, or gaining items.
    - **Entities**: New or returning characters/locations.
    - **Foreshadowing**: Plan at least one foreshadowing event.

**Target File**: `大纲/第{{volume_id}}卷-详细大纲.md`

### Step 4: Save and Update

1.  **Write File**: Save the generated content to `大纲/第{{volume_id}}卷-详细大纲.md`.
2.  **Update State**: Run the following command to update the project state:
    ```bash
    python .claude/skills/webnovel-writer/scripts/update_state.py --volume-planned {{volume_id}} --chapters-range "START-END"
    ```
    *(Replace START and END with the actual chapter numbers you planned)*

### Step 5: Final Report

Output a concise summary to the user:
- File path created.
- Chapter range covered.
- Next step suggestion (`/webnovel-write START_CHAPTER`).

---

**Start executing Step 1 now.**

