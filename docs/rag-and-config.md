# RAG 与配置说明

## RAG 检索架构

```text
查询 → QueryRouter(auto) → vector / bm25 / hybrid / graph_hybrid
                     └→ RRF 融合 + Rerank → Top-K
```

默认模型：

- Embedding：`Qwen/Qwen3-Embedding-8B`
- Reranker：`jina-reranker-v3`

## 环境变量加载顺序

1. 进程环境变量（最高优先级）
2. 书项目根目录下的 `.env`
3. 用户级全局：`~/.codex/webnovel-writer/.env`

## `.env` 最小配置

```bash
EMBED_BASE_URL=https://api-inference.modelscope.cn/v1
EMBED_MODEL=Qwen/Qwen3-Embedding-8B
EMBED_API_KEY=your_embed_api_key

RERANK_BASE_URL=https://api.jina.ai/v1
RERANK_MODEL=jina-reranker-v3
RERANK_API_KEY=your_rerank_api_key
```

说明：

- 未配置 Embedding Key 时，语义检索会回退到 BM25。
- 推荐每本书单独配置 `${PROJECT_ROOT}/.env`，避免多项目串配置。
- 历史 `.claude` 下的环境变量文件请手动迁移到 `~/.codex/webnovel-writer/.env`。
