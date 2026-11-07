/** Scriptor's Host-side preferences: the `webnovel` settings namespace shown as three groups on the Plugins page. */
export const WEBNOVEL_SETTINGS_NAMESPACE = 'webnovel' as const

export const VISUAL_MODES = ['workflow', 'graph', 'chapters'] as const
export type VisualMode = (typeof VISUAL_MODES)[number]

export const GRAPH_PERSPECTIVES = ['author', 'reader'] as const
export type GraphPerspective = (typeof GRAPH_PERSPECTIVES)[number]

export interface WebnovelPreferences {
  /** 检索 · 提交后自动更新定稿索引（全局一处保存）。 */
  readonly autoIndexOnCommit: boolean
  /** 工作台入口 · 对话区「可视化」标签。 */
  readonly showVisualTab: boolean
  /** 工作台入口 · 两栏互换把手。 */
  readonly showLayoutSwap: boolean
  /** 工作台入口 · 右侧栏引导页的「检索索引」卡片。 */
  readonly showIndexGuideCard: boolean
  /** 默认视图 · 可视化打开时的子视图。 */
  readonly defaultVisualMode: VisualMode
  /** 默认视图 · 人物关系的默认视角。 */
  readonly defaultGraphPerspective: GraphPerspective
  /** 默认视图 · 人物关系默认显示时间未标注的关系。 */
  readonly defaultGraphShowUnknown: boolean
  /** 默认视图 · 人物关系默认包括计划中的关系。 */
  readonly defaultGraphShowPlans: boolean
}

export type WebnovelPreferencesInput = Partial<WebnovelPreferences>

export const DEFAULT_WEBNOVEL_PREFERENCES: WebnovelPreferences = {
  autoIndexOnCommit: false,
  showVisualTab: true,
  showLayoutSwap: true,
  showIndexGuideCard: true,
  defaultVisualMode: 'workflow',
  defaultGraphPerspective: 'author',
  defaultGraphShowUnknown: true,
  defaultGraphShowPlans: false,
}

export const WEBNOVEL_PREFERENCE_KEYS = Object.keys(DEFAULT_WEBNOVEL_PREFERENCES) as readonly (keyof WebnovelPreferences)[]
const BOOLEAN_KEYS = ['autoIndexOnCommit', 'showVisualTab', 'showLayoutSwap', 'showIndexGuideCard', 'defaultGraphShowUnknown', 'defaultGraphShowPlans'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isVisualMode(value: unknown): value is VisualMode {
  return typeof value === 'string' && (VISUAL_MODES as readonly string[]).includes(value)
}

export function isGraphPerspective(value: unknown): value is GraphPerspective {
  return typeof value === 'string' && (GRAPH_PERSPECTIVES as readonly string[]).includes(value)
}

/** Whether the user's own settings already decided auto indexing; only then the legacy per-book flag stops migrating. */
export function hasExplicitAutoIndex(raw: unknown): boolean {
  return isRecord(raw) && typeof raw.autoIndexOnCommit === 'boolean'
}

/** Read any settings object as complete preferences, falling back per field. */
export function normalizeWebnovelPreferences(raw: unknown): WebnovelPreferences {
  const source = isRecord(raw) ? raw : {}
  const bool = (key: (typeof BOOLEAN_KEYS)[number]) => typeof source[key] === 'boolean' ? source[key] as boolean : DEFAULT_WEBNOVEL_PREFERENCES[key]
  return {
    autoIndexOnCommit: bool('autoIndexOnCommit'),
    showVisualTab: bool('showVisualTab'),
    showLayoutSwap: bool('showLayoutSwap'),
    showIndexGuideCard: bool('showIndexGuideCard'),
    defaultVisualMode: isVisualMode(source.defaultVisualMode) ? source.defaultVisualMode : DEFAULT_WEBNOVEL_PREFERENCES.defaultVisualMode,
    defaultGraphPerspective: isGraphPerspective(source.defaultGraphPerspective) ? source.defaultGraphPerspective : DEFAULT_WEBNOVEL_PREFERENCES.defaultGraphPerspective,
    defaultGraphShowUnknown: bool('defaultGraphShowUnknown'),
    defaultGraphShowPlans: bool('defaultGraphShowPlans'),
  }
}

/** Reject malformed values before the Host accepts them. */
export function validateWebnovelPreferences(raw: unknown): WebnovelPreferencesInput {
  if (raw === undefined) return {}
  if (!isRecord(raw)) throw new Error('Scriptor 偏好设置须为对象')
  for (const key of BOOLEAN_KEYS) {
    if (raw[key] !== undefined && typeof raw[key] !== 'boolean') throw new Error(`偏好字段 ${key} 须为布尔值`)
  }
  if (raw.defaultVisualMode !== undefined && !isVisualMode(raw.defaultVisualMode)) throw new Error('默认可视化子视图无效')
  if (raw.defaultGraphPerspective !== undefined && !isGraphPerspective(raw.defaultGraphPerspective)) throw new Error('人物关系默认视角无效')
  return raw as WebnovelPreferencesInput
}
