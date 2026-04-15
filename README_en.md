# Webnovel Writer

[![License](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)](https://www.python.org/)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-Compatible-purple.svg)](https://claude.ai/claude-code)

<a href="https://trendshift.io/repositories/22487" target="_blank"><img src="https://trendshift.io/api/badge/repositories/22487" alt="lingfengQAQ%2Fwebnovel-writer | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>

## Project Overview

`Webnovel Writer` is a web novel creation system built on Claude Code. Its goal is to reduce AI "forgetting" and "hallucination" in long-form creative writing, supporting long-cycle serialized storytelling.

Detailed documentation is split across `docs/`:

- Architecture & Modules: `docs/architecture.md`
- Command Reference: `docs/commands.md`
- RAG & Configuration: `docs/rag-and-config.md`
- Genre Templates: `docs/genres.md`
- Operations & Recovery: `docs/operations.md`
- Doc Navigation: `docs/README.md`

## Quick Start

### 1) Install the Plugin (Official Marketplace)

```bash
claude plugin marketplace add lingfengQAQ/webnovel-writer --scope user
claude plugin install webnovel-writer@webnovel-writer-marketplace --scope user
```

> For project-scoped only: replace `--scope user` with `--scope project`.

### 2) Install Python Dependencies

```bash
python -m pip install -r https://raw.githubusercontent.com/lingfengQAQ/webnovel-writer/HEAD/requirements.txt
```

### 3) Initialize a Novel Project

```bash
/webnovel-init
```

### 4) Configure RAG Environment (Required)

Create `.env` in the project root:

```bash
cp .env.example .env
```

Minimum configuration:

```bash
EMBED_BASE_URL=https://api-inference.modelscope.cn/v1
EMBED_MODEL=Qwen/Qwen3-Embedding-8B
EMBED_API_KEY=your_embed_api_key

RERANK_BASE_URL=https://api.jina.ai/v1
RERANK_MODEL=jina-reranker-v3
RERANK_API_KEY=your_rerank_api_key
```

### 5) Start Writing

```bash
/webnovel-plan 1
/webnovel-write 1
/webnovel-review 1-5
```

### 6) Launch the Visual Dashboard (Optional)

```bash
/webnovel-dashboard
```

### 7) Agent Model Setup (Optional)

All built-in agents default to `model: inherit` (inherits from the Claude session model). To override, edit `webnovel-writer/agents/*.md` frontmatter with `sonnet`, `opus`, or `haiku`.

## Dashboard — Multi-Language Support

The dashboard supports **3 languages**: Vietnamese, English, and Chinese.
A language switcher is located in the sidebar — click to switch between languages instantly.

## GitHub Actions — Plugin Release

1. Sync version info locally:
   ```bash
   python -X utf8 webnovel-writer/scripts/sync_plugin_version.py --version 5.5.4 --release-notes "Release notes here"
   ```
2. Commit and push version changes.
3. Open Actions → select `Plugin Release`.
4. Enter `version` and `release_notes`.

## License

This project is licensed under `GPL v3` — see `LICENSE`.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=lingfengQAQ/webnovel-writer&type=Date)](https://star-history.com/#lingfengQAQ/webnovel-writer&Date)

## Acknowledgments

Built with **Claude Code + Gemini CLI + Codex** via Vibe Coding.
Inspiration: [Linux.do Thread](https://linux.do/t/topic/1397944/49)

## Contributing

Issues and PRs are welcome:

```bash
git checkout -b feature/your-feature
git commit -m "feat: add your feature"
git push origin feature/your-feature
```
