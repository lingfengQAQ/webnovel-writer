# 包命名变更说明

## v0.1.0-preview.3 重要变更

为了更清晰的包管理，公开分发包的命名已统一：

### 旧命名（已废弃）
- `@linfengqaqtat/dsh-scriptor` - 主插件
- `@webnovel/embedding-provider` - 可选嵌入提供方

### 新命名
- `@linfengqaqtat/dsh-scriptor` - 主插件（不变）
- `webnovel-embedding-provider` - 可选嵌入提供方（改名，脱离内部 `@webnovel/*` scope）

### 安装方式

**基础安装**（推荐大多数用户）：
```bash
dsh plugin --profile scriptor add D:/path/to/linfengqaqtat-dsh-scriptor-0.1.0-preview.3.tgz
```

**按需安装嵌入提供方**：
```bash
# 先装主插件
dsh plugin --profile scriptor add D:/path/to/linfengqaqtat-dsh-scriptor-0.1.0-preview.3.tgz

# 需要语义检索再装
dsh plugin --profile scriptor add D:/path/to/webnovel-embedding-provider-0.0.8.tgz
```

### 完整版 meta 包（暂缓）

`@linfengqaqtat/dsh-scriptor-full` 规划为一条命令装齐全部功能的 meta 包。
由于主包与嵌入包均未发布到 npm，meta 包的依赖在安装时会被 pnpm 解析到
registry 并返回 404，本预览版不提供该 tarball；待包发布到 npm 后恢复。

### 迁移指南

如果你已经安装了旧的 `@webnovel/embedding-provider`：

1. 卸载旧包：
   ```bash
   pnpm remove @webnovel/embedding-provider
   ```

2. 安装新包（可选）：
   ```bash
   dsh plugin --profile scriptor add D:/path/to/webnovel-embedding-provider-0.0.8.tgz
   ```

### 为什么改名

1. **脱离内部 scope**：公开分发包不占用内部 `@webnovel/*` 命名空间
2. **清晰的命名**：`webnovel-embedding-provider` 直接表明它是写作工作台的嵌入提供方
3. **安装路径统一**：安装文档与 smoke 验收都以 `dsh plugin add <tarball>` 为准
