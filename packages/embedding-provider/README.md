# Webnovel 嵌入 API 提供方

当前版本 0.0.8，GPL-3.0-only。本版补齐公开分发元数据、原始许可证和第三方声明；下述模型行为与 0.0.7 保持一致。

0.0.7 将重排默认等待时间改为 30 秒，可在原生“设置 → 模型 → 检索辅助模型 → 重排序 API”的主要设置中按秒填写，范围 0.1–120 秒。检索执行按同一预算等待，已有显式值继续生效；超时回退原排序，可随时取消。

0.0.6 引入的场景识别和重排序保持独立可选，默认关闭。

场景识别选择 DSH 已配置的聊天模型，默认并发 2。后台每章识别并保存边界；普通向量重建、改名和切换模型复用旧结果，失败时明确回退段落分块。索引页可重新识别指定章或全书，页面内确认会显示作品和章号。

重排填写完整 API 地址、专用模型和凭据引用，默认对 40 个候选评分。接口采用 POST {model,query,documents,top_n} 与 results[{index,relevance_score}]，只在语义查询时调用，失败退回原排序；换重排模型不重建索引。

用于 DSH `0.1.5-rc.2` 的独立插件，提供可选 `embeddings` 服务和原生设置卡片。首次安装保持停用，不会自动请求外部 API。

在 **设置 → 模型 → 嵌入模型 → 混合检索 · 嵌入 API** 展开卡片后填写：

- 接口协议：OpenAI 兼容或 Gemini 原生。
- API 基础地址：例如服务的 `/v1` 根；Gemini 原生为 `/v1beta` 根。
- 向量模型及**向量维度**：启用前维度必填，须为正整数。
- API Key：通过 DSH 凭据服务保存，配置文件只保存引用名。
- 勾选启用语义检索并保存。

OpenAI 兼容请求默认发送 `dimensions`，Gemini 原生发送 `embedContentConfig.outputDimensionality`。固定维度 API 可在高级设置中关闭“将维度参数发送给 API”，但返回向量仍必须严格符合配置维度。模型、维数或嵌入指令改变后，下一次检索不得复用旧向量。

Gemini 原生每条文本单独构造请求，使用 `batchEmbedContents` 保持批次对齐，默认使用 `RETRIEVAL_DOCUMENT` / `RETRIEVAL_QUERY`，文档可带标题，关闭静默截断。需要使用指令前缀的模型可选择“仅使用指令前缀”，自行填写对应文档/查询指令。不会按模型名字猜测协议或角色规则。

启用后，写作工作台的后台索引会调用提供方发送已启用书仓的定稿切片；检索时仅发送查询文本。后台使用单次 `embedBatch` 请求并统一管理退避重试，已成功批次保存后可继续复用。超时、临时错误有界重试；批次数量、索引、维数或数值异常会明确失败，不过滤输入造成错配。不跟随 HTTP 重定向转交凭据，不回显远端响应正文。取消、设置变更及卸载会终止在途请求。

构建：`pnpm --filter webnovel-embedding-provider build`。本地分发包只包含 `lib/index.js`、`lib/client.js`、包描述、本说明、模型维度表、LICENSE 及第三方声明。安装到 profile 后，Cordis 条目使用 `name: 'webnovel-embedding-provider'`，无需把密钥写入条目配置。

协议依据：

- [OpenAI embeddings](https://developers.openai.com/api/reference/resources/embeddings/methods/create)
- [Gemini embeddings](https://ai.google.dev/api/embeddings)

本轮使用真实本地 HTTP 与真实 DSH 设置/凭据服务测试接口和生命周期；具体远端服务和真实语义质量由作者配置后验收。
## 模型与维度快捷填写

内置 [18 个常用模型的维度表](MODEL_DIMENSIONS.md)，来源为官方模型卡、接口文档和 MTEB 元数据。选择标准名称或明确别名后自动填写参考默认值并列出常用维度，可查看来源和核对日期；服务返回的元数据优先。未知模型或版本保持手动填写。

开源模型支持缩短输出不代表托管 API 支持相应参数：标准维度默认不传，选择其他维度时才发送，可在高级设置覆盖。此表只辅助填写，不改变协议、指令或已保存配置。

填写基础地址和 API Key 后点“获取模型列表”，可选择或手动输入模型；查询可临时使用未保存的密钥，不会自动保存配置。接口返回的维度信息优先于已知模型建议，维度仍可手动填写。

“检测默认维度”发送一条固定测试文本，可能产生少量费用；只读取默认向量宽度，不代表支持的全部维度。探测成功后关闭请求中的维度参数，实际响应仍严格按配置宽度校验。models.dev 当前没有专用维度契约，不能将其 limit.output 直接当成维度。

第三方许可与版权文本见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，使用说明见 [公开文档](https://github.com/lingfengQAQ/webnovel-writer/tree/v8/docs/user)。
