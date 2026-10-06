# 鲸鱼娘桌宠

[产品主页](https://lingfengqaq.github.io/webnovel-writer/) · [安装教程](https://lingfengqaq.github.io/webnovel-writer/docs/install.html)

独立 DSH 插件，在窗口内陪你写作。可单独安装，也可与 DSH Scriptor 小说插件一起使用。

8.2.0 为同批兼容发行，桌宠功能没有新增变化。桌宠独立可选，不包含在 full 中；未使用桌宠的用户无需因主包升级而安装它。

## 安装

配套 DSH 0.2.0-rc.2。在 DSH 侧栏“插件 → 添加插件”输入 `@linfengqaqtat/dsh-scriptor-companion@8.2.0`，核对预览后安装，按提示启用或重启。

安装包携带全部运行素材，无需 Dola 网络连接、Python、FFmpeg 或额外模型配置。桌宠仍在 DSH 窗口内显示，不是 Windows 全局悬浮窗。旧 @linfengqaqtat/dsh-whale-companion 先撤销安装入口，不要与新包同时启用；详见 [安装与迁移](https://github.com/lingfengQAQ/webnovel-writer/blob/v8/docs/user/install.md)。

## 使用

- 默认出现在 DSH 窗口右下方；拖动角色可以调整位置。
- 单击角色互动，右键或角色旁的 `···` 打开菜单。键盘可聚焦角色，Shift+F10 打开菜单。
- 菜单可调大小、休息、预览动作、隐藏和重置位置。设置 → 通用 → 鲸鱼娘桌宠可恢复显示。
- 位置、大小、显示偏好保存在当前客户端，刷新后保留。
- 构思、写作、等待回应跟随当前主会话；成功结束播放一次完成动作。写作动作代表文本输出，不代表文件已保存。
- 两分钟空闲后休息，操作界面或新工作开始时唤醒。隐藏和后台暂停动画，系统减少动态效果时使用静态立绘。
- 动画加载失败会降级为静态立绘；重新显示可重试。

退出/卸载仅移除桌宠，作品和对话不受影响。CLI 卸载前关闭该 profile 的运行实例：

```sh
dsh plugin --profile writing remove @linfengqaqtat/dsh-scriptor-companion
```

## 开发

```sh
pnpm --filter @linfengqaqtat/dsh-scriptor-companion typecheck
pnpm --filter @linfengqaqtat/dsh-scriptor-companion test
pnpm --filter @linfengqaqtat/dsh-scriptor-companion build
pnpm --filter @linfengqaqtat/dsh-scriptor-companion pack-check
```

素材制作方式和来源见 MEDIA.md。此包独立版本管理，未自动加入小说 full 安装组合。
