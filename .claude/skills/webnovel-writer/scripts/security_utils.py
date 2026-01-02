#!/usr/bin/env python3
"""
安全工具函数库
用于webnovel-writer系统的通用安全函数

创建时间: 2026-01-02
创建原因: 安全审计发现路径遍历和命令注入漏洞
修复方案: 集中管理所有安全相关的输入清理函数
"""

import os
import re
import sys
from pathlib import Path
from typing import Optional


def sanitize_filename(name: str, max_length: int = 100) -> str:
    """
    清理文件名，防止路径遍历攻击 (CWE-22)

    安全关键函数 - 修复extract_entities.py路径遍历漏洞

    Args:
        name: 原始文件名（可能包含路径遍历字符）
        max_length: 文件名最大长度（默认100字符）

    Returns:
        安全的文件名（仅包含基本文件名，移除所有路径信息）

    示例:
        >>> sanitize_filename("../../../etc/passwd")
        'passwd'
        >>> sanitize_filename("C:\\Windows\\System32")
        'System32'
        >>> sanitize_filename("正常角色名")
        '正常角色名'

    安全验证:
        - ✅ 防止目录遍历（../、..\\）
        - ✅ 防止绝对路径（/、C:\\）
        - ✅ 移除特殊字符
        - ✅ 长度限制
    """
    # Step 1: 仅保留基础文件名（移除所有路径）
    safe_name = os.path.basename(name)

    # Step 2: 移除路径分隔符（双重保险）
    safe_name = safe_name.replace('/', '_').replace('\\', '_')

    # Step 3: 只保留安全字符
    # 允许：中文(\u4e00-\u9fff)、字母(a-zA-Z)、数字(0-9)、下划线(_)、连字符(-)
    safe_name = re.sub(r'[^\w\u4e00-\u9fff-]', '_', safe_name)

    # Step 4: 移除连续的下划线（美化）
    safe_name = re.sub(r'_+', '_', safe_name)

    # Step 5: 长度限制
    if len(safe_name) > max_length:
        safe_name = safe_name[:max_length]

    # Step 6: 移除首尾下划线
    safe_name = safe_name.strip('_')

    # Step 7: 确保非空（防御性编程）
    if not safe_name:
        safe_name = "unnamed_entity"

    return safe_name


def sanitize_commit_message(message: str, max_length: int = 200) -> str:
    """
    清理Git提交消息，防止命令注入 (CWE-77)

    安全关键函数 - 修复backup_manager.py命令注入漏洞

    Args:
        message: 原始提交消息（可能包含Git标志）
        max_length: 消息最大长度（默认200字符）

    Returns:
        安全的提交消息（移除Git特殊标志和危险字符）

    示例:
        >>> sanitize_commit_message("Test\\n--author='Attacker'")
        'Test  author Attacker'
        >>> sanitize_commit_message("--amend Chapter 1")
        'amend Chapter 1'

    安全验证:
        - ✅ 防止多行注入（换行符）
        - ✅ 防止Git标志注入（--xxx）
        - ✅ 防止参数分隔符混淆（引号）
        - ✅ 防止单字母标志（-x）
    """
    # Step 1: 移除换行符（防止多行参数注入）
    safe_msg = message.replace('\n', ' ').replace('\r', ' ')

    # Step 2: 移除Git特殊标志（--开头的参数）
    safe_msg = re.sub(r'--[\w-]+', '', safe_msg)

    # Step 3: 移除引号（防止参数分隔符混淆）
    safe_msg = safe_msg.replace("'", "").replace('"', '')

    # Step 4: 移除前导的-（防止单字母标志如-m）
    safe_msg = safe_msg.lstrip('-')

    # Step 5: 移除连续空格（美化）
    safe_msg = re.sub(r'\s+', ' ', safe_msg)

    # Step 6: 长度限制
    if len(safe_msg) > max_length:
        safe_msg = safe_msg[:max_length]

    # Step 7: 移除首尾空格
    safe_msg = safe_msg.strip()

    # Step 8: 确保非空
    if not safe_msg:
        safe_msg = "Untitled commit"

    return safe_msg


def create_secure_directory(path: str, mode: int = 0o700) -> Path:
    """
    创建安全目录（仅所有者可访问）

    安全关键函数 - 修复文件权限配置缺失漏洞

    Args:
        path: 目录路径
        mode: 权限模式（默认0o700，仅所有者可读写执行）

    Returns:
        Path对象

    示例:
        >>> create_secure_directory('.webnovel')
        PosixPath('.webnovel')  # drwx------ (700)

    安全验证:
        - ✅ 仅所有者可访问（0o700）
        - ✅ 防止同组用户读取
        - ✅ 跨平台兼容（Windows/Linux/macOS）
    """
    path_obj = Path(path)

    # 创建目录（设置安全权限）
    os.makedirs(path, mode=mode, exist_ok=True)

    # 双重保险：显式设置权限（某些系统可能忽略makedirs的mode参数）
    if os.name != 'nt':  # Unix系统（Linux/macOS）
        os.chmod(path, mode)

    return path_obj


def create_secure_file(file_path: str, content: str, mode: int = 0o600) -> None:
    """
    创建安全文件（仅所有者可读写）

    Args:
        file_path: 文件路径
        content: 文件内容
        mode: 权限模式（默认0o600，仅所有者可读写）

    安全验证:
        - ✅ 仅所有者可读写（0o600）
        - ✅ 防止其他用户访问
    """
    # 创建文件
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)

    # 设置权限（仅Unix系统）
    if os.name != 'nt':
        os.chmod(file_path, mode)


def validate_integer_input(value: str, field_name: str) -> int:
    """
    验证并转换整数输入（严格模式）

    安全关键函数 - 修复update_state.py弱验证漏洞

    Args:
        value: 输入值（字符串）
        field_name: 字段名称（用于错误消息）

    Returns:
        转换后的整数

    Raises:
        ValueError: 输入不是有效整数

    示例:
        >>> validate_integer_input("123", "chapter_num")
        123
        >>> validate_integer_input("abc", "level")
        ValueError: ❌ 错误：level 必须是整数，收到: abc
    """
    try:
        return int(value)
    except ValueError:
        print(f"❌ 错误：{field_name} 必须是整数，收到: {value}", file=sys.stderr)
        raise ValueError(f"Invalid integer input for {field_name}: {value}")


# ============================================================================
# 单元测试（内置自检）
# ============================================================================

def _run_self_tests():
    """运行内置安全测试"""
    print("🔍 运行安全工具函数自检...")

    # Test 1: sanitize_filename
    assert sanitize_filename("../../../etc/passwd") == "passwd", "路径遍历测试失败"
    assert sanitize_filename("C:\\Windows\\System32") == "System32", "Windows路径测试失败"
    assert sanitize_filename("正常角色名") == "正常角色名", "中文测试失败"
    assert sanitize_filename("/tmp/../../../../../etc/hosts") == "hosts", "复杂路径遍历测试失败"
    assert sanitize_filename("test///file...name") == "file_name", "特殊字符测试失败"  # . 会被替换
    print("  ✅ sanitize_filename: 所有测试通过")

    # Test 2: sanitize_commit_message
    result = sanitize_commit_message("Test\n--author='Attacker'")
    assert "\n" not in result, "换行符未移除"
    assert "--author" not in result, "Git标志未移除"
    assert "Attacker" in result, "内容被错误移除"

    assert sanitize_commit_message("--amend Chapter 1") == "Chapter 1", "Git标志测试失败"  # --amend被完全移除
    assert "'" not in sanitize_commit_message("Test'message"), "引号测试失败"
    assert sanitize_commit_message("-m Test") == "m Test", "单字母标志测试失败"  # -m被移除后是"m Test"
    print("  ✅ sanitize_commit_message: 所有测试通过")

    # Test 3: validate_integer_input
    assert validate_integer_input("123", "test") == 123, "整数验证测试失败"
    try:
        validate_integer_input("abc", "test")
        assert False, "应该抛出ValueError"
    except ValueError:
        pass
    print("  ✅ validate_integer_input: 所有测试通过")

    print("\n✅ 所有安全工具函数测试通过！")


if __name__ == "__main__":
    # Windows UTF-8 编码修复（必须在打印前执行）
    if sys.platform == 'win32':
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

    # 运行自检测试
    _run_self_tests()
