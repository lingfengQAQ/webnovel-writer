# Fix genre source validation and story-system fallback

## Goal

Prevent English profile keys such as `rules-mystery` from becoming project genre truth, and make story-system fail explicitly instead of falling back to the first route row (`玄幻退婚流`) when a genre cannot be routed.

## What I already know

* The user confirmed the desired behavior: normalize the source, forbid English genre values, and explicitly error instead of using `玄幻退婚流` as a fallback.
* `rules-mystery` originates from the legacy genre profile layer (`references/genre-profiles.md`) and profile-key mapping, not from the story-system CSV route table.
* `init_project.py` currently writes the CLI `genre` argument directly into `.webnovel/state.json`.
* `story_system_engine._route()` currently falls back to `route_rows[0]` when no route matches, which can silently select `玄幻退婚流`.

## Requirements

* Initialization must reject genre values containing ASCII letters, such as `rules-mystery`, with an actionable error that points users to Chinese names such as `规则怪谈`.
* Story-system routing must not use the first CSV row as a default route when no match exists.
* If story-system cannot route the provided query/genre, it must raise an explicit error and avoid generating `.story-system` contracts.
* Valid Chinese genres such as `规则怪谈` must continue to route normally.
* Existing profile-key behavior may remain as internal read-only compatibility, but it must not be accepted as project genre input.

## Acceptance Criteria

* [ ] `init_project(..., genre="rules-mystery")` fails before writing state.
* [ ] `StorySystemEngine(...).build(query="rules-mystery", genre="rules-mystery", ...)` raises an explicit routing error.
* [ ] `StorySystemEngine(...).build(query="规则怪谈", genre="规则怪谈", ...)` routes to canonical genre `悬疑`.
* [ ] No test expects unmatched routes to fall back to `玄幻退婚流`.
* [ ] Targeted tests pass.

## Definition of Done

* Tests added or updated for init validation and story-system routing failure.
* Targeted pytest suite passes.
* Existing unrelated working-tree changes are preserved.

## Technical Approach

* Add a narrow genre-input validator near initialization write boundaries.
* Replace story-system's `default_seed_fallback` branch with an explicit failure path.
* Keep canonical Chinese genre routing through existing `resolve_genre()` / route row matching.

## Out of Scope

* Reworking reference retrieval ranking.
* Migrating existing projects that already have English genre values.
* Renaming legacy profile IDs in `genre-profiles.md`.
* Changing chapter-level dynamic context selection beyond route failure behavior.

## Technical Notes

* Likely files:
  * `webnovel-writer/scripts/init_project.py`
  * `webnovel-writer/scripts/data_modules/story_system_engine.py`
  * `webnovel-writer/scripts/data_modules/tests/test_story_system_engine.py`
  * `webnovel-writer/scripts/data_modules/tests/test_init_project_pruning.py` or a nearby init test module
* Existing dirty files were present before this task; do not revert unrelated changes.
