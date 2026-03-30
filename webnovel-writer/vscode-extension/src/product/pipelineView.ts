import * as vscode from 'vscode';
import { PipelineClient } from './pipelineClient';
import { buildStageActionState, PipelineRun, PipelineStage, STAGE_SEQUENCE } from './types';

const LAST_RUN_ID_KEY = 'webnovel.pipeline.lastRunId';

function currentWorkspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function stageLabel(stage: PipelineStage): string {
    switch (stage) {
        case 'plot': return 'Plot';
        case 'events': return 'Events';
        case 'scenes': return 'Scenes';
        case 'chapter': return 'Chapter';
    }
}

export class PipelineViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'webnovelPipeline';

    private view?: vscode.WebviewView;
    private run: PipelineRun | null = null;
    private busy = false;

    constructor(private readonly context: vscode.ExtensionContext) {}

    async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
        this.view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.onDidReceiveMessage(async message => {
            const action = String(message?.action || '');
            try {
                if (action === 'startRun') {
                    await this.startRun();
                } else if (action === 'refresh') {
                    await this.refresh();
                } else if (action === 'publish') {
                    await this.publish();
                } else if (action.startsWith('generate:')) {
                    await this.generateStage(action.split(':', 2)[1] as PipelineStage);
                } else if (action.startsWith('accept:')) {
                    await this.acceptStage(action.split(':', 2)[1] as PipelineStage);
                } else if (action.startsWith('selectRevision:')) {
                    const [, stage, revisionId] = action.split(':', 3);
                    await this.selectRevision(stage as PipelineStage, revisionId);
                } else if (action.startsWith('acceptRevision:')) {
                    const [, stage, revisionId] = action.split(':', 3);
                    await this.acceptRevision(stage as PipelineStage, revisionId);
                }
            } catch (error) {
                void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
            }
        });
        await this.refresh();
    }

    async refresh(): Promise<void> {
        const projectRoot = currentWorkspaceRoot();
        if (!projectRoot) {
            this.run = null;
            this.render();
            return;
        }

        this.busy = true;
        this.render();
        try {
            const client = new PipelineClient(projectRoot);
            const savedRunId = this.context.workspaceState.get<string>(LAST_RUN_ID_KEY);
            if (savedRunId) {
                try {
                    this.run = await client.getRun(savedRunId);
                    this.render();
                    return;
                } catch {
                    // fallback to latest run
                }
            }
            this.run = await client.latestRun();
            if (this.run) {
                await this.context.workspaceState.update(LAST_RUN_ID_KEY, this.run.run_id);
            }
        } finally {
            this.busy = false;
            this.render();
        }
    }

    async startRun(): Promise<void> {
        const projectRoot = currentWorkspaceRoot();
        if (!projectRoot) {
            throw new Error('Open a workspace folder first.');
        }
        const value = await vscode.window.showInputBox({
            prompt: 'Chapter number to start pipeline run',
            validateInput: input => /^\d+$/.test(input.trim()) ? undefined : 'Enter a positive integer chapter number.',
        });
        if (!value) {
            return;
        }
        const client = new PipelineClient(projectRoot);
        this.run = await client.startRun(Number.parseInt(value, 10));
        await this.context.workspaceState.update(LAST_RUN_ID_KEY, this.run.run_id);
        this.render();
    }

    async generateStage(stage: PipelineStage): Promise<void> {
        const client = this.currentClient();
        this.run = await client.generate(this.requireRun().run_id, stage);
        this.render();
    }

    async acceptStage(stage: PipelineStage): Promise<void> {
        const client = this.currentClient();
        this.run = await client.accept(this.requireRun().run_id, stage);
        this.render();
    }

    async publish(): Promise<void> {
        const client = this.currentClient();
        this.run = await client.publish(this.requireRun().run_id);
        this.render();
    }

    async selectRevision(stage: PipelineStage, revisionId: string): Promise<void> {
        const client = this.currentClient();
        this.run = await client.selectRevision(this.requireRun().run_id, stage, revisionId);
        this.render();
    }

    async acceptRevision(stage: PipelineStage, revisionId: string): Promise<void> {
        const client = this.currentClient();
        this.run = await client.acceptRevision(this.requireRun().run_id, stage, revisionId);
        this.render();
    }

    private currentClient(): PipelineClient {
        const projectRoot = currentWorkspaceRoot();
        if (!projectRoot) {
            throw new Error('Open a workspace folder first.');
        }
        return new PipelineClient(projectRoot);
    }

    private requireRun(): PipelineRun {
        if (!this.run) {
            throw new Error('Start or load a pipeline run first.');
        }
        return this.run;
    }

    private render(): void {
        if (!this.view) {
            return;
        }
        this.view.webview.html = this.renderHtml();
    }

    private renderHtml(): string {
        if (!currentWorkspaceRoot()) {
            return this.wrapHtml('<p>Open a workspace folder to use the writing pipeline.</p>');
        }
        if (this.busy) {
            return this.wrapHtml('<p>Loading pipeline state...</p>');
        }
        if (!this.run) {
            return this.wrapHtml(`
                <p>No pipeline run found for this workspace.</p>
                <button data-action="startRun">Start pipeline run</button>
                <button data-action="refresh">Refresh</button>
            `);
        }

        const actions = buildStageActionState(this.run);
        const stageHtml = STAGE_SEQUENCE.map(stage => {
            const stageRecord = this.run?.stages[stage];
            const state = actions[stage];
            const staleChip = state.stale ? `<span class="chip stale">STALE</span>` : '';
            const failureMessage = stageRecord?.failure_message ?? '';
            const revisionsHtml = (stageRecord?.revisions ?? []).slice().reverse().map(revision => {
                const isCurrent = revision.revision_id === stageRecord?.current_revision_id;
                const isAccepted = revision.revision_id === stageRecord?.accepted_revision_id;
                const currentChip = isCurrent ? '<span class="chip current">CURRENT</span>' : '';
                const acceptedChip = isAccepted ? '<span class="chip accepted">ACCEPTED</span>' : '';
                return `
                    <div class="revision-row">
                        <div class="revision-meta">r${revision.revision_number} · ${escapeHtml(revision.summary || 'revision')}</div>
                        <div class="revision-chips">${currentChip}${acceptedChip}</div>
                        <div class="revision-actions">
                            <button data-action="selectRevision:${stage}:${revision.revision_id}">Use</button>
                            <button data-action="acceptRevision:${stage}:${revision.revision_id}">Accept</button>
                        </div>
                    </div>
                `;
            }).join('');
            return `
                <section class="stage-card">
                    <div class="stage-header">
                        <strong>${stageLabel(stage)}</strong>
                        ${staleChip}
                    </div>
                    <div class="meta">Revisions: ${state.revisionCount}</div>
                    <div class="meta">Current: ${state.currentSummary || '—'}</div>
                    <div class="meta">Accepted: ${state.acceptedSummary || '—'}</div>
                    <div class="actions">
                        <button data-action="generate:${stage}" ${state.canGenerate ? '' : 'disabled'}>${state.revisionCount > 0 ? 'Regenerate' : 'Generate'}</button>
                        <button data-action="accept:${stage}" ${state.canAccept ? '' : 'disabled'}>Accept</button>
                    </div>
                    ${revisionsHtml ? `<div class="revision-list">${revisionsHtml}</div>` : ''}
                    ${failureMessage ? `<div class="error">${failureMessage}</div>` : ''}
                </section>
            `;
        }).join('');

        const published = this.run.published_path
            ? `<div class="published">Published: ${this.run.published_path}</div>`
            : '';

        return this.wrapHtml(`
            <div class="toolbar">
                <button data-action="startRun">New run</button>
                <button data-action="refresh">Refresh</button>
                <button data-action="publish" ${this.run.stages.chapter.accepted_revision_id ? '' : 'disabled'}>Publish chapter</button>
            </div>
            <h3>Chapter ${this.run.chapter_num}: ${this.run.outline.title}</h3>
            <p class="outline">${escapeHtml(this.run.outline.content.slice(0, 240))}</p>
            ${published}
            ${stageHtml}
        `);
    }

    private wrapHtml(body: string): string {
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <style>
                    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 8px; }
                    button { margin-right: 6px; margin-bottom: 6px; }
                    .toolbar { margin-bottom: 12px; }
                    .stage-card { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 8px; margin-bottom: 10px; }
                    .stage-header { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
                    .meta { opacity: 0.85; font-size: 12px; margin-bottom: 4px; }
                    .chip { font-size: 11px; padding: 2px 6px; border-radius: 999px; }
                    .stale { background: #8a5a00; color: white; }
                    .current { background: #005fb8; color: white; }
                    .accepted { background: #1f6f43; color: white; }
                    .published { margin-bottom: 10px; color: var(--vscode-terminal-ansiGreen); }
                    .outline { white-space: pre-wrap; opacity: 0.9; }
                    .error { color: var(--vscode-errorForeground); margin-top: 4px; }
                    .revision-list { margin-top: 8px; border-top: 1px solid var(--vscode-panel-border); padding-top: 8px; }
                    .revision-row { margin-bottom: 8px; padding: 6px; background: var(--vscode-editor-background); border-radius: 4px; }
                    .revision-meta { font-size: 12px; margin-bottom: 4px; }
                    .revision-chips { margin-bottom: 4px; display: flex; gap: 4px; flex-wrap: wrap; }
                    .revision-actions { display: flex; gap: 6px; flex-wrap: wrap; }
                </style>
            </head>
            <body>
                ${body}
                <script>
                    const vscode = acquireVsCodeApi();
                    document.querySelectorAll('[data-action]').forEach(button => {
                        button.addEventListener('click', () => {
                            vscode.postMessage({ action: button.getAttribute('data-action') });
                        });
                    });
                </script>
            </body>
            </html>`;
    }
}

function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}
