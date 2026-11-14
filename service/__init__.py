# -*- coding: utf-8 -*-
"""webnovel-writer service layer.

把上游 `webnovel-writer/` 的 Python 数据链包装成可配置 API 的 Web 服务。

设计约束：
- 不修改上游目录；上游作为引擎原地复用。
- 本层只做三件事：LLM 编排、Web API、配置。
"""

__version__ = "0.1.0"
