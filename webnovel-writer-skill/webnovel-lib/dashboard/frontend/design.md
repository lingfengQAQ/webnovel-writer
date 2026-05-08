# PIXEL WRITER HUB 设计规范

> Dashboard 前端设计规范，所有页面必须遵守。
> 原型预览：`docs/architecture/dashboard-prototype.html`

## 视觉风格：复古像素 / 8-bit 游戏

像 RPG 状态面板遇上写作仪表盘。有趣、nerd、像素级精确。

## 色板

| 变量 | 色值 | 用途 |
|------|------|------|
| `--bg-main` | `#fff7e8` | 页面背景（带 14px 网格线） |
| `--bg-panel` | `#fffdf6` | 表格/面板内背景 |
| `--bg-card` | `#fffaf0` | 卡片背景 |
| `--bg-card-2` | `#fff3d5` | 表头、次级卡片 |
| `--text-main` | `#2a220f` | 主文字 |
| `--text-sub` | `#5d5035` | 次要文字 |
| `--text-mute` | `#8f7f5c` | 标签、占位 |
| `--accent-blue` | `#26a8ff` | 主强调（数值、active 态） |
| `--accent-purple` | `#7f5af0` | 次强调（Strand、badge） |
| `--accent-green` | `#2ec27e` | 成功（审查通过、已回收） |
| `--accent-amber` | `#f5a524` | 警告（紧急伏笔、中等分数） |
| `--accent-red` | `#d7263d` | 危险（blocking、超期） |
| `--accent-cyan` | `#00b8d4` | 信息（badge） |
| `--border-main` | `#2a220f` | 主边框 |
| `--border-soft` | `#8f7f5c` | 次级边框 |

### ECharts 系列色序

```
['#26a8ff', '#f5a524', '#7f5af0', '#2ec27e', '#d7263d', '#00b8d4', '#ff5c8a']
```

### Strand 专用色

| Strand | 色值 | CSS 类 |
|--------|------|--------|
| Quest | `#26a8ff` | `.strand-quest` |
| Fire | `#ff5c8a` | `.strand-fire` |
| Constellation | `#7f5af0` | `.strand-constellation` |

### 伏笔状态色

| 状态 | 色值 | Badge |
|------|------|-------|
| 超期 (overdue) | `#d7263d` | `.badge-red` |
| 紧急 (urgent) | `#f5a524` | `.badge-amber` |
| 活跃 (active) | `#26a8ff` | `.badge-blue` |
| 已回收 (resolved) | `#2ec27e` | `.badge-green` |

## 字体

- **标题/Logo**：`Press Start 2P`，11px，字间距 0.08em
- **正文/数据**：`Noto Sans SC`，14px，font-weight 500-700
- **数字**：tabular-nums（等宽数字）
- **图例/小标签**：`Noto Sans SC` 13px，font-weight 600

## 边框与阴影

- 卡片：`3px solid #2a220f`，阴影 `6px 6px 0 #2a220f`
- 次级容器：`2px solid #8f7f5c`，阴影 `3px 3px 0 #8f7f5c`
- 无圆角（0px）——像素风不用圆角
- 所有边框硬直线

## 组件规范

**Badge**：`2px solid #2a220f`，padding `3px 8px`，配色见 `.badge-*` 类。

**表格**：`.table-wrap` 包裹，表头 `--bg-card-2` 底色，行 hover `#fff4d8`，支持分页。

**进度条**：`12px` 高，`2px` 硬边框，填充渐变 `#26a8ff → #7f5af0`。

**按钮/导航**：`2px solid` 边框，hover 时微移 `-1px, -1px`。active 态蓝底。

**统计卡**：`.stat-card` 内含 `.stat-label`（mute 色 13px）、`.stat-value`（accent-blue 28px）、`.stat-sub`（sub 色 13px）。

**翻页器 (Pager)**：`← 前 N` / `页码信息` / `下一页 →` / `跳到最新 →`，按钮用 `.page-btn` 样式。

**筛选按钮组**：`.filter-group` flex 排列，`.filter-btn` 2px 边框，active 态蓝底蓝边。

## ECharts 像素风主题

注册为 `pixel` 主题，所有图表统一使用 `echarts.init(el, 'pixel')`。

### 主题配置要点

```js
{
  color: ['#26a8ff','#f5a524','#7f5af0','#2ec27e','#d7263d','#00b8d4','#ff5c8a'],
  backgroundColor: 'transparent',
  tooltip: {
    backgroundColor: '#fffaf0',
    borderColor: '#2a220f',
    borderWidth: 2,
    extraCssText: 'border-radius:0;box-shadow:3px 3px 0 #2a220f;'
  },
  // 坐标轴
  axisLine:  { lineStyle: { color: '#8f7f5c', width: 2 } },
  axisLabel: { color: '#8f7f5c', fontSize: 12 },
  splitLine: { lineStyle: { color: '#e8dcc4', type: 'dashed' } }
}
```

### 图表通用规则

| 规则 | 说明 |
|------|------|
| 无圆角 | tooltip、bar、节点均不用 borderRadius |
| 硬描边 | 所有 item `borderColor: '#2a220f', borderWidth: 2` |
| 方形符号 | 折线图数据点 `symbol: 'rect', symbolSize: 8` |
| 线宽 3px | 折线图 `lineStyle.width: 3`，不用 smooth |
| bar 无圆角 | 柱状图默认方形 |
| 面积填充 | 用 20% 透明度线性渐变到透明 |
| markLine | 均值线/当前章节线用 `type: 'dashed'` 或 `solid`，颜色匹配语义 |

## 各页图表规格

### 总览页 (OverviewPage)

| 图表 | 类型 | 数据 | 交互 |
|------|------|------|------|
| 审查得分趋势 | 折线图 (line) | 每章 overall_score | 翻页（每页 50 章）+ 均值 markLine |
| 字数分布 | 柱状图 (bar) | 按卷汇总字数 | 标签显示万字 |
| Strand 整体分布 | 环形图 (pie) | quest/fire/constellation 计数 | 百分比标签 |
| 紧急伏笔 Top 5 | 表格 | 内容、状态、埋设章、目标章、紧急度 | — |

### 角色图鉴页 (CharactersPage)

| 图表 | 类型 | 数据 | 交互 |
|------|------|------|------|
| 关系图谱 | graph (力导向) | entities + relationships | **章节时间轴滑块** + 播放/暂停 |

**关系图时间轴规格：**
- 滑块 (`<input type="range">`) 控制当前章节，范围 1 ~ 最新章
- 节点按 `first_appearance <= 当前章` 过滤显示
- 边按 `chapter <= 当前章` 过滤，标签支持随章节演化（如"初识"→"宿敌"）
- 播放按钮：每 120ms 步进 5 章，自动推进
- 右侧 badge 实时显示当前章节号 + 可见节点数
- 节点：方形 (`symbol: 'rect'`)，主角加大 + 金色 (`#f5a524`)
- 边：直线 + 标签，`curveness: 0.1`
- 类别色：角色 `#26a8ff`、势力 `#7f5af0`、地点 `#2ec27e`

### 节奏雷达页 (PacingPage)

| 图表 | 类型 | 数据 | 交互 |
|------|------|------|------|
| 钩子强度走势 | 面积折线图 (line+areaStyle) | 每章 hook_strength | 翻页（每页 50 章） |
| Strand 分布 | 堆叠柱状图 (bar, stack) | 逐章 strand 分配 | 翻页 |
| 字数分布 | 箱线图 (boxplot) | 按卷分组 | — |

### 伏笔追踪页 (ForeshadowingPage)

| 图表 | 类型 | 数据 | 交互 |
|------|------|------|------|
| 伏笔时间线 | 自定义 bar (custom series) | 埋设章→目标章 | 当前章蓝线 (`z:10` 置顶)，按状态着色 |

**甘特图规格：**
- Y 轴：伏笔名称（反转，紧急在上）
- X 轴：章节范围，`axisLabel: '第N章'`
- Bar 颜色：overdue `#d7263d`、urgent `#f5a524`、active `#26a8ff`、resolved `#2ec27e`
- 当前章节竖线：`markLine` + `z: 10`（确保在 bar 上层），`label.position: 'end'`
- 默认只显示 活跃+紧急，已回收折叠
- 横轴范围自动适配（不铺满 1-最大章）

### 系统状态页 (SystemPage)

纯统计卡 + 表格，无图表。

## 布局

- 侧边栏 240px（金色渐变 `#ffe8b8 → #ffe19f`），`3px` 右边框
- 主区域可滚动，padding 22px
- 统计卡网格 `repeat(auto-fill, minmax(220px, 1fr))`
- 图表卡片全宽，高度 320px（默认）/ 420px（关系图等 `.tall`）/ 380px（甘特 `.gantt`）

## 导航

| 图标 | 标签 | 路由 |
|------|------|------|
| 📊 | 总览 | `/` |
| 👤 | 角色图鉴 | `/characters` |
| 📈 | 节奏雷达 | `/pacing` |
| 🔖 | 伏笔追踪 | `/foreshadowing` |
| 📁 | 文档浏览 | `/files` |
| ⚙️ | 系统状态 | `/system` |

## 大数据量适配

- 所有时序图表默认显示最近 50 章窗口，支持翻页 + "跳到最新"
- 字数按卷分组，不一次性铺开所有章节
- 甘特图默认只显示活跃+紧急，已回收可展开
- 关系图时间轴播放时步进 5 章/120ms，不逐章渲染

## 图标

使用 [Pixelarticons](https://pixelarticons.com/)（`pixelarticons` npm 包）。

- 24×24 网格，无抗锯齿，纯像素风
- SVG `fill="currentColor"`，颜色继承父元素，天然适配色板
- React 组件导入，tree-shakeable
- 尺寸用 24px 的整数倍（24/48）保持像素对齐

### 导航图标映射

| 页面 | 图标名 | 组件 |
|------|--------|------|
| 总览 | `chart-bar` | `<ChartBar />` |
| 角色图鉴 | `users` | `<Users />` |
| 节奏雷达 | `trending-up` | `<TrendingUp />` |
| 伏笔追踪 | `bookmark` | `<Bookmark />` |
| 文档浏览 | `folder` | `<Folder />` |
| 系统状态 | `sliders` | `<Sliders />` |

### 其他常用图标

| 用途 | 图标名 |
|------|--------|
| 播放/暂停 | `play` / `pause` |
| 翻页 | `chevron-left` / `chevron-right` |
| 跳到最新 | `chevrons-right` |
| 刷新/诊断 | `reload` |
| 连接状态 | `wifi` / `wifi-off` |
| 搜索/筛选 | `search` / `filter` |

## 不做的事

- 不用圆角
- 不用渐变背景（进度条除外）
- 不用 soft shadow
- 不用 glassmorphism / neumorphism
- 不用 emoji 做图标——用 Pixelarticons
- 不用 3D 图表（原 react-force-graph-3d 替换为 ECharts 2D graph）
