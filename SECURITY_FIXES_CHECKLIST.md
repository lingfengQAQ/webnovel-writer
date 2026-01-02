# 安全修复执行清单

**创建日期**: 2026-01-02
**项目**: webnovel-writer
**修复范围**: 5个安全漏洞（1 CRITICAL + 2 MEDIUM + 2 LOW）

---

## 📋 修复总览

### 已完成准备工作 ✅

- [x] 安全审计完成（2026-01-02）
- [x] 创建 `security_utils.py` 工具库
- [x] 生成 P0 补丁（路径遍历）
- [x] 生成 P1 补丁（命令注入）
- [x] 生成 P1 补丁（文件权限）
- [x] 保存完整审计报告

### 待执行修复

- [ ] 应用 P0 补丁（今天）
- [ ] 应用 P1 补丁（本周）
- [ ] 回归测试（本周）
- [ ] P2/P3 修复（待计划）

---

## 🔴 优先级 P0 - 立即修复（今天完成）

### 漏洞1：路径遍历 (CWE-22)

**文件**: `extract_entities.py`
**CVSS**: 7.5 (HIGH)
**影响**: 攻击者可在系统任意位置写入文件

#### 修复步骤

**Step 1: 准备工具库**

```bash
# 确认 security_utils.py 已存在
ls -l .claude/skills/webnovel-writer/scripts/security_utils.py

# 运行自检测试
cd .claude/skills/webnovel-writer/scripts
python security_utils.py
```

**预期输出**：
```
🔍 运行安全工具函数自检...
  ✅ sanitize_filename: 所有测试通过
  ✅ sanitize_commit_message: 所有测试通过
  ✅ validate_integer_input: 所有测试通过

✅ 所有安全工具函数测试通过！
```

**Step 2: 备份原文件**

```bash
cp extract_entities.py extract_entities.py.backup_20260102
```

**Step 3: 应用补丁**

**方法A：手动应用（推荐）**

打开 `extract_entities.py`，执行以下修改：

1. **添加导入**（在文件顶部，line 11之后）：
```python
# ============================================================================
# 安全修复：导入安全工具函数（P0 CRITICAL）
# ============================================================================
from security_utils import sanitize_filename, create_secure_directory
```

2. **修复角色实体（line 320-322）**：
```python
# 原代码：
target_dir = Path(project_root) / f"设定集/角色库/{category_dir}"
target_dir.mkdir(parents=True, exist_ok=True)
target_file = target_dir / f"{entity_name}.md"

# 修复为：
target_dir = Path(project_root) / f"设定集/角色库/{category_dir}"
create_secure_directory(str(target_dir))  # 安全目录创建
safe_entity_name = sanitize_filename(entity_name)  # 清理文件名
target_file = target_dir / f"{safe_entity_name}.md"
```

3. **修复物品实体（line 356-358）**：
```python
# 原代码：
target_dir = Path(project_root) / "设定集/物品库"
target_dir.mkdir(parents=True, exist_ok=True)
target_file = target_dir / f"{entity_name}.md"

# 修复为：
target_dir = Path(project_root) / "设定集/物品库"
create_secure_directory(str(target_dir))
safe_entity_name = sanitize_filename(entity_name)
target_file = target_dir / f"{safe_entity_name}.md"
```

**方法B：使用patch命令（Linux/macOS）**

```bash
cd .claude/skills/webnovel-writer/scripts
patch -p0 < SECURITY_FIX_P0_extract_entities.patch
```

**Step 4: 验证修复**

**测试用例1：正常输入**
```bash
echo "[NEW_ENTITY: 角色, 李雪, 女主角]" > test_normal.md
python extract_entities.py test_normal.md --auto
ls 设定集/角色库/主角/李雪.md  # 应成功创建
```

**测试用例2：路径遍历攻击**
```bash
echo "[NEW_ENTITY: 角色, ../../../tmp/malicious, 攻击测试]" > test_attack.md
python extract_entities.py test_attack.md --auto
ls 设定集/角色库/主角/malicious.md  # 应成功创建在正确位置
ls /tmp/malicious.md  # 应不存在（攻击失败）
```

**测试用例3：特殊字符**
```bash
echo "[NEW_ENTITY: 角色, test///file...name, 特殊字符测试]" > test_special.md
python extract_entities.py test_special.md --auto
ls 设定集/角色库/主角/test_file_name.md  # 特殊字符被清理
```

**Step 5: 回归测试**

```bash
# 运行既有测试套件（如有）
python -m pytest tests/

# 手动测试核心功能
python extract_entities.py "正文/第0001章.md" --auto
python extract_entities.py "正文/第0002章.md" --auto
```

#### 完成标志

- [x] security_utils.py 自检通过
- [ ] 补丁应用成功（无语法错误）
- [ ] 正常输入测试通过
- [ ] 路径遍历攻击测试失败（修复有效）
- [ ] 特殊字符测试通过
- [ ] 回归测试通过

---

## 🟠 优先级 P1 - 本周修复

### 漏洞2：Git命令注入 (CWE-77)

**文件**: `backup_manager.py`
**CVSS**: 5.3 (MEDIUM)
**影响**: 攻击者可伪造Git作者信息或修改提交

#### 修复步骤

**Step 1: 备份原文件**

```bash
cp backup_manager.py backup_manager.py.backup_20260102
```

**Step 2: 应用补丁**

**手动应用**：

1. **添加导入**（文件顶部）：
```python
from security_utils import sanitize_commit_message
```

2. **修复提交消息**（line 169-170）：
```python
# 原代码：
commit_message = f"Chapter {chapter_num}"
if chapter_title:
    commit_message += f": {chapter_title}"

# 修复为：
commit_message = f"Chapter {chapter_num}"
if chapter_title:
    safe_chapter_title = sanitize_commit_message(chapter_title)
    commit_message += f": {safe_chapter_title}"
```

**Step 3: 验证修复**

**测试用例1：正常标题**
```bash
python backup_manager.py --backup 1 --chapter-title "废柴少年"
git log -1  # 应显示 "Chapter 1: 废柴少年"
```

**测试用例2：换行符注入**
```bash
python backup_manager.py --backup 2 --chapter-title "Chapter\n--author='Attacker'"
git log -1  # 应显示 "Chapter 2: Chapter author Attacker"（--author被移除）
git log -1 --format='%an'  # 应显示原作者（不是Attacker）
```

**测试用例3：--amend注入**
```bash
python backup_manager.py --backup 3 --chapter-title "--amend Malicious"
git log -1  # 应显示 "Chapter 3: amend Malicious"（--amend被移除）
git log --oneline -2  # 应有2个提交（未被amend修改）
```

#### 完成标志

- [ ] 补丁应用成功
- [ ] 正常标题测试通过
- [ ] 换行符注入测试失败（修复有效）
- [ ] --amend注入测试失败（修复有效）
- [ ] Git历史完整性验证通过

---

### 漏洞3：文件权限配置缺失 (CWE-732)

**文件**: 5个脚本（`archive_manager.py`, `structured_index.py`, `update_state.py`, `workflow_manager.py`）
**CVSS**: 4.3 (MEDIUM)
**影响**: 多用户环境下敏感数据可被同组用户读取

#### 修复步骤

**Step 1: 备份所有文件**

```bash
cp archive_manager.py archive_manager.py.backup_20260102
cp structured_index.py structured_index.py.backup_20260102
cp update_state.py update_state.py.backup_20260102
cp workflow_manager.py workflow_manager.py.backup_20260102
```

**Step 2: 应用补丁**

**对于每个文件，执行以下修改**：

**2.1 archive_manager.py**

1. 添加导入：
```python
from security_utils import create_secure_directory
```

2. 修复line 63：
```python
# 原代码：
self.archive_dir.mkdir(parents=True, exist_ok=True)

# 修复为：
create_secure_directory(str(self.archive_dir))
```

**2.2 structured_index.py**

1. 添加导入：
```python
from security_utils import create_secure_directory
```

2. 修复line 64：
```python
# 原代码：
self.db_path.parent.mkdir(parents=True, exist_ok=True)

# 修复为：
create_secure_directory(str(self.db_path.parent))
```

**2.3 update_state.py**

1. 添加导入：
```python
from security_utils import create_secure_directory
```

2. 修复line 122：
```python
# 原代码：
backup_dir.mkdir(exist_ok=True)

# 修复为：
create_secure_directory(str(backup_dir))
```

**2.4 workflow_manager.py**

1. 添加导入：
```python
from security_utils import create_secure_directory
```

2. 修复line 365：
```python
# 原代码：
os.makedirs(os.path.dirname(WORKFLOW_STATE_FILE), exist_ok=True)

# 修复为：
create_secure_directory(os.path.dirname(WORKFLOW_STATE_FILE))
```

**Step 3: 验证修复**

**测试用例1：权限验证（Unix/Linux/macOS）**
```bash
# 删除旧目录
rm -rf .webnovel/

# 重新创建目录（通过运行任一脚本）
python update_state.py --help

# 检查权限
ls -la .webnovel/
# 预期输出: drwx------ (700权限)

stat -c '%a' .webnovel/
# 预期输出: 700
```

**测试用例2：权限验证（Windows）**
```powershell
# 删除旧目录
Remove-Item -Recurse -Force .webnovel

# 重新创建目录
python update_state.py --help

# 检查权限
icacls .webnovel
# 预期: 仅当前用户有完全控制权限
```

**测试用例3：多用户访问测试（Unix）**
```bash
# 用户A创建目录
python update_state.py --help

# 切换到用户B
su - userB

# 尝试读取state.json
cat /path/to/.webnovel/state.json
# 预期: Permission denied
```

#### 完成标志

- [ ] 所有4个文件补丁应用成功
- [ ] Unix/Linux权限为700（drwx------）
- [ ] Windows权限仅限所有者
- [ ] 多用户访问测试失败（权限生效）

---

## 🟡 优先级 P2 - 低优先级

### 漏洞4：弱输入验证 (CWE-20)

**文件**: `update_state.py`
**CVSS**: 3.1 (LOW)
**影响**: 可能插入无效数据类型到state.json

#### 修复步骤

**Step 1: 替换弱验证代码**

定位 `update_state.py:488-494`，修改为：

```python
# 原代码：
try:
    value = int(value)
except ValueError:
    pass  # 静默失败

# 修复为：
from security_utils import validate_integer_input

try:
    value = validate_integer_input(value, field_name)
except ValueError as e:
    print(f"❌ 验证失败: {e}")
    return False
```

**Step 2: 测试验证**

```bash
# 正常输入
python update_state.py --progress 5 10000
# 预期: 成功

# 无效输入
python update_state.py --progress abc 10000
# 预期: ❌ 错误：chapter_num 必须是整数，收到: abc
```

#### 完成标志

- [ ] 代码修改完成
- [ ] 正常输入测试通过
- [ ] 无效输入被明确拒绝（不再静默跳过）

---

## 🟢 优先级 P3 - 可选修复

### 漏洞5：缺少文件锁定 (CWE-366)

**文件**: `workflow_manager.py`
**CVSS**: 2.4 (LOW)
**影响**: 并发执行可能损坏workflow_state.json

#### 修复步骤

**Step 1: 添加文件锁定函数**

在 `security_utils.py` 添加：

```python
import fcntl  # Unix
# 或 import msvcrt  # Windows

def atomic_json_write(file_path: str, data: dict):
    """原子性JSON写入（带文件锁）"""
    with open(file_path, 'w', encoding='utf-8') as f:
        if os.name != 'nt':  # Unix
            fcntl.flock(f.fileno(), fcntl.LOCK_EX)
        else:  # Windows
            msvcrt.locking(f.fileno(), msvcrt.LK_LOCK, 1)

        json.dump(data, f, ensure_ascii=False, indent=2)

        if os.name != 'nt':
            fcntl.flock(f.fileno(), fcntl.LOCK_UN)
        else:
            msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
```

**Step 2: 替换写入调用**

在 `workflow_manager.py:363-367`：

```python
# 原代码：
def save_state(state):
    os.makedirs(os.path.dirname(WORKFLOW_STATE_FILE), exist_ok=True)
    with open(WORKFLOW_STATE_FILE, 'w', encoding='utf-8') as f:
        json.dump(state, f, ensure_ascii=False, indent=2)

# 修复为：
from security_utils import atomic_json_write

def save_state(state):
    create_secure_directory(os.path.dirname(WORKFLOW_STATE_FILE))
    atomic_json_write(WORKFLOW_STATE_FILE, state)
```

**Step 3: 并发测试**

```bash
# 终端1
python webnovel-write.py &
PID1=$!

# 终端2（立即执行）
python webnovel-review.py &
PID2=$!

# 等待完成
wait $PID1 $PID2

# 验证文件完整性
python -c "import json; json.load(open('.webnovel/workflow_state.json'))"
# 预期: 无JSON解析错误
```

#### 完成标志

- [ ] 文件锁定函数添加
- [ ] workflow_manager.py 修改完成
- [ ] 并发测试通过（无文件损坏）

---

## 📊 整体修复进度追踪

### P0 - 立即修复（今天）

| 漏洞 | 文件 | 补丁 | 应用 | 测试 | 完成 |
|-----|------|-----|------|------|------|
| 路径遍历 | extract_entities.py | ✅ | ⬜ | ⬜ | ⬜ |

**预计时间**: 30分钟

### P1 - 本周修复

| 漏洞 | 文件 | 补丁 | 应用 | 测试 | 完成 |
|-----|------|-----|------|------|------|
| 命令注入 | backup_manager.py | ✅ | ⬜ | ⬜ | ⬜ |
| 文件权限 | 5个脚本 | ✅ | ⬜ | ⬜ | ⬜ |

**预计时间**: 1小时

### P2-P3 - 低优先级

| 漏洞 | 文件 | 补丁 | 应用 | 测试 | 完成 |
|-----|------|-----|------|------|------|
| 弱验证 | update_state.py | ⬜ | ⬜ | ⬜ | ⬜ |
| 文件锁定 | workflow_manager.py | ⬜ | ⬜ | ⬜ | ⬜ |

**预计时间**: 1-2小时（可选）

---

## ✅ 验收标准

### P0 修复验收

- [ ] 所有路径遍历攻击测试失败（修复有效）
- [ ] 正常文件创建功能正常
- [ ] 特殊字符被正确清理
- [ ] security_utils.py 自检通过

### P1 修复验收

- [ ] Git命令注入攻击失败（修复有效）
- [ ] 所有目录权限为700（Unix）或仅所有者（Windows）
- [ ] 多用户访问测试失败（权限生效）

### 完整验收

- [ ] 所有5个漏洞修复完成
- [ ] 100%回归测试通过
- [ ] 无新引入的Bug
- [ ] 文档更新（CHANGELOG.md）

---

## 📝 修复后清理

### 文件清理

```bash
# 删除备份文件（确认修复成功后）
rm .claude/skills/webnovel-writer/scripts/*.backup_20260102

# 可选：删除补丁文件（已应用后）
# rm SECURITY_FIX_*.patch
```

### Git提交

```bash
git add .claude/skills/webnovel-writer/scripts/
git commit -m "security: 修复5个安全漏洞

- P0: 修复路径遍历漏洞 (CWE-22, CVSS 7.5)
- P1: 修复Git命令注入 (CWE-77, CVSS 5.3)
- P1: 修复文件权限配置缺失 (CWE-732, CVSS 4.3)

审计报告: SECURITY_AUDIT_REPORT_20260102.md

🚀 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## 🔖 附录

### 补丁文件位置

```
.claude/skills/webnovel-writer/scripts/
├── security_utils.py                        # 安全工具库
├── SECURITY_FIX_P0_extract_entities.patch  # P0补丁
├── SECURITY_FIX_P1_backup_manager.patch    # P1补丁
└── SECURITY_FIX_P1_file_permissions.patch  # P1补丁（5脚本）
```

### 相关文档

- **审计报告**: `SECURITY_AUDIT_REPORT_20260102.md`
- **修复清单**: `SECURITY_FIXES_CHECKLIST.md`（本文件）

### 紧急联系

如果修复过程中遇到问题：
1. 恢复备份文件（`*.backup_20260102`）
2. 查看完整审计报告的"安全测试"章节
3. 运行 `python security_utils.py` 验证工具库
4. 查看补丁文件中的详细说明

---

**📋 修复清单结束**
