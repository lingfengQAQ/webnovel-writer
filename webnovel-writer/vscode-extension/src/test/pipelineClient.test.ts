import test from 'node:test';
import * as assert from 'node:assert/strict';
import { PipelineClient } from '../product/pipelineClient';

test('PipelineClient forwards command arguments and returns run payload', async () => {
    const calls: string[][] = [];
    const client = new PipelineClient('D:/workspace/book', async command => {
        calls.push(command);
        return {
            ok: true,
            run: {
                run_id: 'run-1',
                project_root: 'D:/workspace/book',
                created_at: '2026-03-30T00:00:00+00:00',
                updated_at: '2026-03-30T00:00:00+00:00',
                chapter_num: 1,
                status: 'active',
                published_path: '',
                outline: { chapter_num: 1, title: '风起', source_path: '大纲', content: '内容' },
                stages: {
                    plot: { stage: 'plot', current_revision_id: null, accepted_revision_id: null, published_revision_id: null, stale: false, stale_reason: '', failure_message: '', revisions: [] },
                    events: { stage: 'events', current_revision_id: null, accepted_revision_id: null, published_revision_id: null, stale: false, stale_reason: '', failure_message: '', revisions: [] },
                    scenes: { stage: 'scenes', current_revision_id: null, accepted_revision_id: null, published_revision_id: null, stale: false, stale_reason: '', failure_message: '', revisions: [] },
                    chapter: { stage: 'chapter', current_revision_id: null, accepted_revision_id: null, published_revision_id: null, stale: false, stale_reason: '', failure_message: '', revisions: [] },
                },
            },
        };
    });

    const run = await client.startRun(1);
    assert.equal(run.run_id, 'run-1');
    assert.deepEqual(calls[0], ['--project-root', 'D:/workspace/book', 'start-run', '--chapter', '1']);
});

test('PipelineClient forwards select revision arguments', async () => {
    const calls: string[][] = [];
    const client = new PipelineClient('D:/workspace/book', async command => {
        calls.push(command);
        return {
            ok: true,
            run: {
                run_id: 'run-1',
                project_root: 'D:/workspace/book',
                created_at: '2026-03-30T00:00:00+00:00',
                updated_at: '2026-03-30T00:00:00+00:00',
                chapter_num: 1,
                status: 'active',
                published_path: '',
                outline: { chapter_num: 1, title: '风起', source_path: '大纲', content: '内容' },
                stages: {
                    plot: { stage: 'plot', current_revision_id: 'plot-1', accepted_revision_id: null, published_revision_id: null, stale: false, stale_reason: '', failure_message: '', revisions: [] },
                    events: { stage: 'events', current_revision_id: null, accepted_revision_id: null, published_revision_id: null, stale: false, stale_reason: '', failure_message: '', revisions: [] },
                    scenes: { stage: 'scenes', current_revision_id: null, accepted_revision_id: null, published_revision_id: null, stale: false, stale_reason: '', failure_message: '', revisions: [] },
                    chapter: { stage: 'chapter', current_revision_id: null, accepted_revision_id: null, published_revision_id: null, stale: false, stale_reason: '', failure_message: '', revisions: [] },
                },
            },
        };
    });

    await client.selectRevision('run-1', 'plot', 'plot-rev-001');
    assert.deepEqual(calls[0], ['--project-root', 'D:/workspace/book', 'select-revision', '--run-id', 'run-1', '--stage', 'plot', '--revision-id', 'plot-rev-001']);
});
