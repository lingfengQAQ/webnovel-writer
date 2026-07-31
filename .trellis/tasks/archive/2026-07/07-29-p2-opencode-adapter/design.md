# 技术设计：OpenCode 宿主适配（F7）

> 定稿依据：`research/opencode-capability-checklist.md`（S0，16 条实测）。设计裁决全部由 kimi 代行（claude token 耗尽，作者授意 2026-07-30）；claude 恢复后按该清单复核本文每条→证据映射。

## 1. 总体形状

```
registry.json（+opencode tier1 条目）
   ↓ 数据驱动（改动面收敛在三处）
host-shells/generate.js ──→ dist/opencode/{skills/,agents/,plugins/}（drift check 覆盖）
installer/shells.js     ──→ .opencode/ 落位（哈希三态沿用，零新机制）
installer/detect.js     ──→ detect_bin=opencode 直接复用（A1 实测 shim 形态已吞吐）
```

核心 `src/`（状态机/存储/编排）零改动；改动面=registry + 生成器 + 安装器 + `adapters/opencode/support.md` + 测试。

## 2. registry 条目（S1，全部字段有 S0 证据）

```json
"opencode": {
  "tier": 1,
  "verified": "能力实测通过（2026-07-30，S0 清单全绿），真模型 smoke 推迟 beta",
  "agentCapable": true,
  "hasHooks": true,
  "detect_bin": "opencode",
  "install_dir": ".opencode",
  "smoke": "node scripts/smoke.mjs --host opencode",
  "smoke_status": "deferred-beta"
}
```

- `agentCapable: true` ← C1（`mode: subagent` schema 实测）+ C3（新鲜上下文实证）+ C4（并行派发实证）。
- `hasHooks: true` ← D4（plugin 自动发现 + chat.message 注入 + fail-open 均为本仓库生产 live evidence）。若 S3 实测翻车，诚实降级为 false（不算失败）。
- `detect_bin` ← A1：PATH 命中 `opencode`（Windows 三 shim `opencode`/`.cmd`/`.ps1` 均无扩展名过滤坑；`findOnPath` 的 stat 判定对无扩展名 shim 先命中 `''` ext 分支，天然兼容）。
- smoke 行与四宿主同口径（`deferred-beta`）。

## 3. 两审 agent 壳形态（S2，C1/C2 实测 schema）

`generateHostShells` 对 `host === 'opencode'` 走新渲染函数 `roleToOpenCodeMd`（与 codex 的 toml 分形同模式，单 host 单分支不泛化）：

```markdown
---
name: 事实审查
description: <roles 单源注入>
mode: subagent
permission:
  edit: deny
  bash: deny
  webfetch: deny
  task: deny
---
<body 渲染产物>
```

- `mode: subagent` ← C1（当前约定，只能被主 agent 经 task 派发；`--agent` 直跑被拒是实测坑，不阻断两审形态）。
- permission 只写**实测验证过的键**：`edit / bash / webfetch / task` 四 deny。`edit: deny` 已实测连带消除独立 write 工具；不额外写 `write`。
- **留白说明**：`read/glob/grep` 不写 allow/deny（默认 allow，两审可精读 ReviewInput 所需的只读工具）——这与角色提示词「不读文件」的语义边界一致：读文件兜底可用，写/执行/外联/再派发全封死。`skill` 键未实测（S0 复核备注标注），design 不用。
- SKILL 条件块：`agentCapable: true` → 独立 subagent 段渲染；`hasHooks: true` → 「SessionStart 已注入」段渲染（与 claude-code 同支路）。

## 4. 会话启动注入（S3，走 plugin 不走路径合并）

新增打包资产 `templates/opencode-session-hook.js`（静态 ESM 插件源），`generateHostShells` 在为 opencode 生成文件集时附加 `plugins/webnovel-session.js`（随生成器进 drift check，确定性同源）。插件形态（失败必 fail-open）：

```js
chat.message: async (input, output) => {
  // 每 session 只注一次（done Set 按 sessionID）
  // execFile('node', ['.webnovel/bin/webnovel-writer.js', 'session-context'], { cwd: directory })
  // 输出 prepend 到首个 text part（持久化进历史，与 Trellis session-start.js 同形）
  // 全钩 try/catch——脚本缺失/执行失败静默，不阻塞会话
}
```

installer 侧：`buildShellFiles` 现有「生成器输出平移进 install_dir」机制自动带上 `plugins/webnovel-session.js`（`.opencode/plugins/` 自动发现，E1 实测**无需任何 JSON 合并**——无 settings.json 类文件，这是 vs claude-code 的结构性简化）。哈希三态/manifest 沿用零改动。`update` 幂等：插件内容随包版本更新（哈希变化→written；用户手改→skipped 并列名）。

安装报告补一条人话提示（buildReport）：opencode 在 hosts 时追加「重启 opencode 后生效（skills/agents/plugins 为启动时加载）」——B1 实测加载时机。

## 5. 测试形状（S5）

- generate.test.js +1 用例：opencode SKILL 走 hasHooks/agentCapable 双真支路断言（SessionStart 注入段在、兼容模式段不在）；两审 agent md frontmatter 断言 `mode: subagent` + 四个 deny 键 + roles body 渲染（schema/category 占位符已替换）；`plugins/webnovel-session.js` 在文件集且含 `chat.message` 与 `session-context`。
- installer：install.test.js +1 用例（`hostsOverride: 'opencode'`）断言 `.opencode/skills/`、`.opencode/agents/事实审查.md` 含 permission、`.opencode/plugins/webnovel-session.js` 落位 + manifest 记录 + 重跑幂等（二次 install 无改动 written）；units.test.js detect 用例 PATH 放 `opencode.cmd` 命中（win32 shim 形态，A1）。
- pack-install-e2e.mjs：init 目标加 `opencode`（`--hosts=claude-code,codex,opencode`）+ 三个落位文件断言；双平台 CI 自动随既有 job 跑。
- drift check 纳管 opencode 壳（生成器产出即覆盖，无需专门断言）。

## 6. spec 回填（S6）

- `docs/architecture/multi-agent-adaptation-spec-2026-06-05.md`：registry 宿主清单示例 + §5.4/§5.9 平台条件块叙述同步含 opencode（版本行升 v3.12，日期 2026-07-30）。
- `adapters/opencode/support.md`（新增，tier1 必备）：逐能力「验证于 1.18.4 + 证据」+ smoke deferred-beta + 三 caveat（subagent 仅派发可直跑限制、加载需重启、plugin 翻车的 AGENTS.md 降级预案）。
- story-repo spec 不动（本任务不改书仓格式）。

## 7. 回滚

registry/生成器/安装器/模板全部增量：单 commit revert 即回 4 宿主状态；落位失败按 manifest 三态天然不清既有产物。plugin 路线翻车 → `hasHooks: false` + SKILL 引导手动 `session-context`（诚实收口，prd Notes 已备）。
