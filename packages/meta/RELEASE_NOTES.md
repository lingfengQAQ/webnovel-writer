# 包命名变更说明

## v0.1.0-preview.3 重要变更

为了更清晰的包管理和更方便的安装，我们统一了包命名：

### 旧命名（已废弃）
- `@linfengqaqtat/dsh-scriptor` - 主插件
- `@webnovel/embedding-provider` - 可选嵌入提供方

### 新命名
- `@linfengqaqtat/dsh-scriptor` - 主插件（不变）
- `@linfengqaqtat/dsh-scriptor-embedding` - 可选嵌入提供方（改名）
- `@linfengqaqtat/dsh-scriptor-full` - 完整版（新增）

### 安装方式

**基础安装**（推荐大多数用户）：
```bash
pnpm add D:/path/to/linfengqaqtat-dsh-scriptor-0.1.0-preview.3.tgz
```

**完整安装**（一个命令安装所有功能）：
```bash
pnpm add D:/path/to/linfengqaqtat-dsh-scriptor-full-0.1.0-preview.3.tgz
```

**按需安装**：
```bash
# 先装主插件
pnpm add D:/path/to/linfengqaqtat-dsh-scriptor-0.1.0-preview.3.tgz

# 需要语义检索再装
pnpm add D:/path/to/linfengqaqtat-dsh-scriptor-embedding-0.0.8.tgz
```

### 何时使用完整版

如果你需要：
- ✅ 基于语义相似度的资料检索
- ✅ 向量数据库功能  
- ✅ 更智能的上下文推荐

选择完整版可以一次性获得所有功能。

如果你只需要：
- ✅ 基础的关键词检索（已足够大多数场景）
- ✅ 快速轻量安装
- ✅ 节省磁盘空间

只装主插件就够了。

### 迁移指南

如果你已经安装了旧的 `@webnovel/embedding-provider`：

1. 卸载旧包：
   ```bash
   pnpm remove @webnovel/embedding-provider
   ```

2. 安装新包（可选）：
   ```bash
   pnpm add D:/path/to/linfengqaqtat-dsh-scriptor-embedding-0.0.8.tgz
   ```

或者直接安装完整版：
```bash
pnpm add D:/path/to/linfengqaqtat-dsh-scriptor-full-0.1.0-preview.3.tgz
```

### 为什么改名

1. **统一 scope**：所有包都在 `@linfengqaqtat` 下，更容易识别是同一项目
2. **清晰的命名**：`dsh-scriptor-embedding` 明确表明是主插件的扩展
3. **便捷安装**：新增 `dsh-scriptor-full` 让用户可以一个命令安装所有功能
