export type PipelineStage = 'plot' | 'events' | 'scenes' | 'chapter';

export const STAGE_SEQUENCE: PipelineStage[] = ['plot', 'events', 'scenes', 'chapter'];

export interface PipelineRevision {
    revision_id: string;
    revision_number: number;
    stage: PipelineStage;
    created_at: string;
    content_format: string;
    content_path: string;
    summary: string;
    variation_key?: string;
    content?: unknown;
}

export interface PipelineStageRecord {
    stage: PipelineStage;
    current_revision_id: string | null;
    accepted_revision_id: string | null;
    published_revision_id: string | null;
    stale: boolean;
    stale_reason: string;
    failure_message: string;
    revisions: PipelineRevision[];
}

export interface OutlineTarget {
    chapter_num: number;
    title: string;
    source_path: string;
    content: string;
}

export interface PipelineRun {
    run_id: string;
    project_root: string;
    created_at: string;
    updated_at: string;
    chapter_num: number;
    status: string;
    published_path: string;
    outline: OutlineTarget;
    stages: Record<PipelineStage, PipelineStageRecord>;
}

export interface StageActionState {
    canGenerate: boolean;
    canAccept: boolean;
    stale: boolean;
    revisionCount: number;
    acceptedSummary: string;
    currentSummary: string;
}

export function getRevisionSummary(stageRecord: PipelineStageRecord, revisionId: string | null): string {
    if (!revisionId) {
        return '';
    }
    return stageRecord.revisions.find(item => item.revision_id === revisionId)?.summary ?? '';
}

export function buildStageActionState(run: PipelineRun): Record<PipelineStage, StageActionState> {
    return Object.fromEntries(STAGE_SEQUENCE.map((stage, index) => {
        const stageRecord = run.stages[stage];
        const prevStage = index === 0 ? undefined : STAGE_SEQUENCE[index - 1];
        const canGenerate = prevStage
            ? Boolean(run.stages[prevStage].accepted_revision_id)
            : true;
        const canAccept = Boolean(stageRecord.current_revision_id);
        return [stage, {
            canGenerate,
            canAccept,
            stale: stageRecord.stale,
            revisionCount: stageRecord.revisions.length,
            acceptedSummary: getRevisionSummary(stageRecord, stageRecord.accepted_revision_id),
            currentSummary: getRevisionSummary(stageRecord, stageRecord.current_revision_id),
        } satisfies StageActionState];
    })) as Record<PipelineStage, StageActionState>;
}
