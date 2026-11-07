import React, { useId } from 'react'
import { Checkbox, SegmentedControl } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ClientHost } from './host'
import { preferencesFor, usePreferences } from './preferences'
import type { WebnovelPreferences } from '../preferences'

export const SCRIPTOR_BUNDLES = ['@linfengqaqtat/dsh-scriptor-full', '@linfengqaqtat/dsh-scriptor'] as const

export function ScriptorBundleConfig({ host }: { host: ClientHost }) {
  const state = usePreferences(host), store = preferencesFor(host), id = useId()
  const disabled = !state.writable || state.busy
  const checkbox = (key: keyof Pick<WebnovelPreferences, 'showVisualTab' | 'showLayoutSwap' | 'showIndexGuideCard' | 'defaultGraphShowUnknown' | 'defaultGraphShowPlans' | 'autoIndexOnCommit'>, label: string) =>
    <Checkbox checked={state.value[key]} disabled={disabled} label={label} onChange={value => { void store.set(key, value) }} />
  return <div className="webnovel nw-preferences">
    <h2 className="nw-preferences-title">Scriptor 偏好</h2>
    {!state.writable ? <p className="nw-preferences-note" role="status">当前环境配置只读，无法修改偏好。</p> : null}
    <section className="nw-preference-group" data-webnovel-pref-group="visibility" tabIndex={-1} aria-label="入口与可见性">
      <h3 className="nw-preference-title">入口与可见性</h3>
      {checkbox('showVisualTab', '可视化 · 对话区标签')}
      {checkbox('showLayoutSwap', '工作台 · 布局互换按钮')}
      {checkbox('showIndexGuideCard', '检索索引 · 引导页卡片')}
      <p className="nw-preferences-note">关闭引导卡后，仍可从书房打开检索索引。隐藏互换按钮时会还原默认分栏。</p>
    </section>
    <section className="nw-preference-group" data-webnovel-pref-group="views" tabIndex={-1} aria-label="视图默认值">
      <h3 className="nw-preference-title">视图默认值</h3>
      <SegmentedControl id={id + '-mode'} label="可视化 · 默认子视图" value={state.value.defaultVisualMode} disabled={disabled}
        options={[{ value: 'workflow', label: '进度 · 当前活动' }, { value: 'graph', label: '关系 · 人物聚焦' }, { value: 'chapters', label: '进度 · 章节列表' }]}
        onChange={value => { void store.set('defaultVisualMode', value) }} />
      <SegmentedControl id={id + '-perspective'} label="人物关系 · 默认视角" value={state.value.defaultGraphPerspective} disabled={disabled}
        options={[{ value: 'author', label: '作者视角' }, { value: 'reader', label: '仅已披露' }]}
        onChange={value => { void store.set('defaultGraphPerspective', value) }} />
      {checkbox('defaultGraphShowUnknown', '人物关系 · 显示时间未标注')}
      {checkbox('defaultGraphShowPlans', '人物关系 · 包括计划')}
      <p className="nw-preferences-note">视图里的临时切换不会改变这些默认值。</p>
    </section>
    <section className="nw-preference-group" data-webnovel-pref-group="retrieval" tabIndex={-1} aria-label="检索">
      <h3 className="nw-preference-title">检索</h3>
      {checkbox('autoIndexOnCommit', '检索 · 提交后自动更新')}
      <p className="nw-preferences-note">适用于本配置下的全部作品，包含终端和其他编辑器的 Git 提交。后台更新不影响正文提交。</p>
    </section>
    {state.notice ? <p className="nw-preferences-note" role="status">{state.notice}</p> : null}
  </div>
}

export function installBundleConfig(host: ClientHost): void {
  host.slots.inject('plugins.bundle.config', () => {
    const offs = SCRIPTOR_BUNDLES.map(key => host.slots.register({ name: 'plugins.bundle.config', key }, () => <ScriptorBundleConfig host={host} />))
    return () => { for (const off of offs.reverse()) off() }
  })
}
