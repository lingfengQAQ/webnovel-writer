# RAG 与配置说明

## RAG 检索流程

系统在写作时自动从历史章节中检索相关内容，辅助保持一致性。

```text
查询 → QueryRouter(auto) → vector / bm25 / hybrid / graph_hybrid
                     └→ RRF 融合 + Rerank → Top-K
```

- 默认模式为 `auto`：优先用向量检索，失败时自动回退到 BM25
- `graph_hybrid` 模式会叠加实体图谱关联

### 默认模型

| 组件 | 默认模型 |
|------|----------|
| Embedding | `Qwen/Qwen3-Embedding-8B`（ModelScope 托管） |
| Reranker | `jina-reranker-v3`（Jina AI 托管） |

## 环境变量加载顺序

系统按以下优先级加载配置（靠前的优先）：

1. **进程环境变量**（最高优先级）
2. **书项目根目录**下的 `.env`
3. **用户级全局**：`~/.claude/webnovel-writer/.env`

## `.env` 最小配置

初始化项目后会自动生成 `.env.example`，复制为 `.env` 后填写 API Key 即可：

```bash
cp .env.example .env
```

必填内容：

```bash
EMBED_BASE_URL=https://api-inference.modelscope.cn/v1
EMBED_MODEL=Qwen/Qwen3-Embedding-8B
EMBED_API_KEY=your_embed_api_key

RERANK_BASE_URL=https://api.jina.ai/v1
RERANK_MODEL=jina-reranker-v3
RERANK_API_KEY=your_rerank_api_key
```

## 注意事项

- 未配置 Embedding Key 时，语义检索会自动回退到 BM25（仍可正常使用，但效果弱于向量检索）。
- 推荐每本书单独配置 `${PROJECT_ROOT}/.env`，避免多项目之间串配置。
- Embedding 和 Rerank 的模型可以替换为任何兼容 OpenAI 格式的 API。
