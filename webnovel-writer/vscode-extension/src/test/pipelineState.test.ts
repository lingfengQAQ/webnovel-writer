import test from 'node:test';
import * as assert from 'node:assert/strict';
import { buildStageActionState, PipelineRun } from '../product/types';

test('buildStageActionState requires accepted upstream stage', () => {
    const run: PipelineRun = {
        run_id: 'run-1',
        project_root: 'D:/workspace/book',
        created_at: '2026-03-30T00:00:00+00:00',
        updated_at: '2026-03-30T00:00:00+00:00',
        chapter_num: 1,
        status: 'active',
        published_path: '',
        outline: { chapter_num: 1, title: '风起', source_path: '大纲', content: '内容' },
        stages: {
            plot: { stage: 'plot', current_revision_id: 'plot-1', accepted_revision_id: 'plot-1', published_revision_id: null, stale: false, stale_reason: '', failure_message: '', revisions: [{ revision_id: 'plot-1', revision_number: 1, stage: 'plot', created_at: '2026-03-30T00:00:00+00:00', content_format: 'json', content_path: 'plot/rev-001.json', summary: 'plot' }] },
            events: { stage: 'events', current_revision_id: null, accepted_revision_id: null, published_revision_id: null, stale: false, stale_reason: '', failure_message: '', revisions: [] },
            scenes: { stage: 'scenes', current_revision_id: null, accepted_revision_id: null, published_revision_id: null, stale: false, stale_reason: '', failure_message: '', revisions: [] },
            chapter: { stage: 'chapter', current_revision_id: null, accepted_revision_id: null, published_revision_id: null, stale: false, stale_reason: '', failure_message: '', revisions: [] },
        },
    };

    const state = buildStageActionState(run);
    assert.equal(state.plot.canGenerate, true);
    assert.equal(state.events.canGenerate, true);
    assert.equal(state.scenes.canGenerate, false);
});
