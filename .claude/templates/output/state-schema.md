# state.json 结构说明 (v5.4)

> 该文件为运行态精简状态，避免体量膨胀。实体等大数据存于 index.db。
>
> **v5.4**：结构沿用 v5.2。

```json
{
  "project_info": {
    "title": "",
    "genre": "",
    "target_words": 0
  },
  "progress": {
    "current_chapter": 0,
    "total_words": 0,
    "last_updated": ""
  },
  "protagonist_state": {
    "name": "",
    "power": {"realm": "", "layer": 0, "bottleneck": ""},
    "location": {"current": "", "last_chapter": 0},
    "golden_finger": {"name": "", "level": 0, "cooldown": 0}
  },
  "strand_tracker": {
    "last_quest_chapter": 0,
    "last_fire_chapter": 0,
    "last_constellation_chapter": 0,
    "current_dominant": "quest",
    "chapters_since_switch": 0,
    "history": []
  },
  "plot_threads": {
    "foreshadowing": []
  },
  "disambiguation_warnings": [],
  "disambiguation_pending": [],
  "chapter_meta": {
    "0001": {
      "hook": {"type": "危机钩", "content": "...", "strength": "strong"},
      "pattern": {
        "opening": "冲突开场",
        "hook": "危机钩",
        "emotion_rhythm": "低→高",
        "info_density": "medium"
      },
      "ending": {"time": "夜晚", "location": "宗门大殿", "emotion": "紧张"}
    }
  }
}
```
