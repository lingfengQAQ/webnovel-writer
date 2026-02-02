#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Config tests
"""

import os

from data_modules import config as config_module
from data_modules.config import DataModulesConfig, get_config, set_project_root


def test_config_paths_and_defaults(tmp_path):
    cfg = DataModulesConfig.from_project_root(tmp_path)
    assert cfg.project_root == tmp_path
    assert cfg.webnovel_dir.name == ".webnovel"
    assert cfg.state_file.name == "state.json"
    assert cfg.index_db.name == "index.db"
    assert cfg.rag_db.name == "rag.db"
    assert cfg.vector_db.name == "vectors.db"

    cfg.ensure_dirs()
    assert cfg.webnovel_dir.exists()


def test_get_config_and_set_project_root(tmp_path):
    set_project_root(tmp_path)
    cfg = get_config()
    assert cfg.project_root == tmp_path


def test_load_dotenv(monkeypatch, tmp_path):
    # prepare .env
    env_path = tmp_path / ".env"
    env_path.write_text("EMBED_BASE_URL=https://example.com\n", encoding="utf-8")

    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("EMBED_BASE_URL", raising=False)

    # call loader explicitly
    config_module._load_dotenv()
    assert os.environ.get("EMBED_BASE_URL") == "https://example.com"
