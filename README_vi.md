# Webnovel Writer

[![License](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)](https://www.python.org/)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-Compatible-purple.svg)](https://claude.ai/claude-code)

<a href="https://trendshift.io/repositories/22487" target="_blank"><img src="https://trendshift.io/api/badge/repositories/22487" alt="lingfengQAQ%2Fwebnovel-writer | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>

### 🌐 Ngôn ngữ / Language / 语言

- **[🇻🇳 Tiếng Việt](README_vi.md)** — Hướng dẫn cài đặt và sử dụng **(trang này)**
- **[🇬🇧 English](README_en.md)** — Installation and usage guide in English
- **[🇨🇳 中文](README.md)** — 安装与使用指南

## Giới Thiệu Dự Án

`Webnovel Writer` là hệ thống sáng tác tiểu thuyết mạng dựa trên Claude Code, với mục tiêu giảm thiểu "lãng quên" và "ảo giác" trong AI, hỗ trợ sáng tác dài hạn cho các bộ truyện nhiều tập.

Chi tiết tài liệu được phân tách trong `docs/`:

- Kiến trúc & Mô-đun: `docs/architecture.md`
- Hướng dẫn lệnh: `docs/commands.md`
- RAG & Cấu hình: `docs/rag-and-config.md`
- Thể loại: `docs/genres.md`
- Vận hành & Khôi phục: `docs/operations.md`
- Mục lục: `docs/README.md`

## Bắt Đầu Nhanh

### 1) Cài đặt Plugin (qua Marketplace chính thức)

```bash
claude plugin marketplace add lingfengQAQ/webnovel-writer --scope user
claude plugin install webnovel-writer@webnovel-writer-marketplace --scope user
```

> Chỉ ảnh hưởng dự án hiện tại: thay `--scope user` bằng `--scope project`.

### 2) Cài đặt Phụ thuộc Python

```bash
python -m pip install -r https://raw.githubusercontent.com/lingfengQAQ/webnovel-writer/HEAD/requirements.txt
```

### 3) Khởi tạo Dự Án Tiểu Thuyết

```bash
/webnovel-init
```

### 4) Cấu hình Môi trường RAG (Bắt buộc)

Tạo `.env` trong thư mục dự án:

```bash
cp .env.example .env
```

Cấu hình tối thiểu:

```bash
EMBED_BASE_URL=https://api-inference.modelscope.cn/v1
EMBED_MODEL=Qwen/Qwen3-Embedding-8B
EMBED_API_KEY=your_embed_api_key

RERANK_BASE_URL=https://api.jina.ai/v1
RERANK_MODEL=jina-reranker-v3
RERANK_API_KEY=your_rerank_api_key
```

### 5) Bắt đầu Sáng tác

```bash
/webnovel-plan 1
/webnovel-write 1
/webnovel-review 1-5
```

### 6) Bảng Điều Khiển Trực Quan (Tùy chọn)

```bash
/webnovel-dashboard
```

### 7) Thiết lập Mô hình Agent (Tùy chọn)

Tất cả Agent mặc định kế thừa mô hình Claude Code đang dùng (`model: inherit`).
Để đặt mô hình riêng cho Agent, chỉnh frontmatter trong `webnovel-writer/agents/*.md`.

## Bảng Điều Khiển — Đa Ngôn Ngữ

Bảng điều khiển hỗ trợ 3 ngôn ngữ: **Tiếng Việt**, **Tiếng Anh**, và **Tiếng Trung**.
Nút chuyển ngôn ngữ nằm ở sidebar — nhấn để chuyển đổi giữa các ngôn ngữ.

## GitHub Actions — Plugin Release

1. Đồng bộ thông tin phiên bản:
   ```bash
   python -X utf8 webnovel-writer/scripts/sync_plugin_version.py --version 5.5.4 --release-notes "Mô tả bản này"
   ```
2. Commit & push thay đổi.
3. Mở Actions → chọn `Plugin Release`.
4. Nhập `version` và `release_notes`.

## Mã Nguồn Mở

Dự án này sử dụng giấy phép `GPL v3`, xem `LICENSE`.

## Star Lịch Sử

[![Star History Chart](https://api.star-history.com/svg?repos=lingfengQAQ/webnovel-writer&type=Date)](https://star-history.com/#lingfengQAQ/webnovel-writer&Date)

## Lời Cảm Ơn

Dự án này được phát triển với **Claude Code + Gemini CLI + Codex** theo phương thức Vibe Coding.
Nguồn cảm hứng: [Linux.do帖子](https://linux.do/t/topic/1397944/49)

## Đóng Góp

Chào đón Issue và PR:

```bash
git checkout -b feature/ten-tinh-nang
git commit -m "feat: mo ta"
git push origin feature/ten-tinh-nang
```
