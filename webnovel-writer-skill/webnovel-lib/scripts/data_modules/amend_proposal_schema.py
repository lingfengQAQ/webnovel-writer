#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from __future__ import annotations

from pydantic import BaseModel, Field


class AmendProposal(BaseModel):
    proposal_id: str
    chapter: int = Field(ge=1)
    target_level: str
    field: str
    base_value: str = ""
    proposed_value: str = ""
    reason_tag: str
