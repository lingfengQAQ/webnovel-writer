# DeepSeek 本地写作客户端

Writer Client 是独立于只读 Dashboard 的本地创作入口。它复用同一套 Story System、写作门禁、章节提交、投影和备份流程；模型不能直接写项目文件。

## 安装与启动

```bash
python -m pip install -r requirements.txt
python -X utf8 webnovel-writer/scripts/webnovel.py --project-root "<书项目根目录>" client
```

服务只监听 `127.0.0.1`，默认打开 `http://127.0.0.1:8765/writer`。进入“模型设置”填写 DeepSeek API Key；密钥保存在操作系统凭据库，不会写进小说项目。

## 推荐流程

1. 在“创建小说”生成并确认创意，或直接打开已有项目。
2. 在“大纲”生成卷纲与章纲，预览后确认写入。
3. 在“写作”生成正文，手工编辑并保存草稿。
4. 运行“深度审查”；存在阻断问题时先改稿并重新审查。
5. 点击“人工确认并定稿”，由 runtime 执行正文发布、事实提取、门禁、commit、projection 和备份。

客户端草稿、工作流和用量统计位于操作系统应用数据目录，不进入 Git。正式故事事实仍以 `.story-system/commits/` 中 accepted `CHAPTER_COMMIT` 为准。

## 缓存命中

客户端把固定写作协议、MASTER_SETTING、卷/章合同和风格约束组成稳定前缀，把当前章节、RAG 结果和用户要求放在末尾。前缀首次使用或超过两小时未使用时会自动预热。

创作工作台显示最近 20 次有效请求的缓存命中率中位数、累计 token 和估算费用，并以 60% 作为同卷预热后的目标线。DeepSeek 缓存属于 best-effort 服务，单次请求不保证命中。修改固定合同、风格文件或模型会产生新的 `prefix_id` 并重新预热。

## 安全与故障恢复

- Writer API 只接受本地 Host，并对 POST/PUT 校验 SameSite 会话和 CSRF Token。
- API 响应、日志和项目文件不返回或记录密钥与完整提示词。
- 草稿保存使用 revision 乐观锁，旧页面不能覆盖新版本。
- 审查后的正文一旦变化，定稿接口会要求重新审查。
- API 中断不会自动定稿；失败工作流可从客户端重试。

只需要浏览项目状态时，继续使用 `/webnovel-dashboard`；它仍然只有 GET 接口。
