import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { PipelineRun, PipelineStage } from './types';

interface CliPayload {
    ok: boolean;
    error?: string;
    run?: PipelineRun | null;
    runs?: Array<Record<string, unknown>>;
}

export interface CliRunner {
    (command: string[], cwd: string): Promise<CliPayload>;
}

function resolvePythonExecutable(): string {
    return process.env.WEBNOVEL_WRITER_PYTHON ?? process.env.PYTHON ?? 'python';
}

function resolvePipelineScriptPath(): string {
    return path.resolve(__dirname, '..', '..', '..', 'scripts', 'pipeline_cli.py');
}

export const defaultCliRunner: CliRunner = async (command, cwd) => {
    const python = resolvePythonExecutable();
    const scriptPath = resolvePipelineScriptPath();
    return new Promise((resolve, reject) => {
        const child = spawn(python, [scriptPath, ...command], {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', chunk => {
            stdout += String(chunk);
        });
        child.stderr.on('data', chunk => {
            stderr += String(chunk);
        });
        child.on('error', reject);
        child.on('close', code => {
            const text = stdout.trim() || stderr.trim();
            try {
                const payload = JSON.parse(text) as CliPayload;
                if (code === 0 && payload.ok) {
                    resolve(payload);
                    return;
                }
                reject(new Error(payload.error || stderr || `Pipeline CLI exited with ${code ?? 'unknown'}`));
            } catch {
                reject(new Error(stderr || stdout || `Pipeline CLI exited with ${code ?? 'unknown'}`));
            }
        });
    });
};

export class PipelineClient {
    constructor(private readonly projectRoot: string, private readonly runner: CliRunner = defaultCliRunner) {}

    async startRun(chapter: number): Promise<PipelineRun> {
        const payload = await this.invoke(['--project-root', this.projectRoot, 'start-run', '--chapter', String(chapter)]);
        return this.requireRun(payload);
    }

    async latestRun(): Promise<PipelineRun | null> {
        const payload = await this.invoke(['--project-root', this.projectRoot, 'latest-run']);
        return payload.run ?? null;
    }

    async getRun(runId: string): Promise<PipelineRun> {
        const payload = await this.invoke(['--project-root', this.projectRoot, 'get-run', '--run-id', runId]);
        return this.requireRun(payload);
    }

    async generate(runId: string, stage: PipelineStage): Promise<PipelineRun> {
        const payload = await this.invoke(['--project-root', this.projectRoot, 'generate', '--run-id', runId, '--stage', stage]);
        return this.requireRun(payload);
    }

    async accept(runId: string, stage: PipelineStage): Promise<PipelineRun> {
        const payload = await this.invoke(['--project-root', this.projectRoot, 'accept', '--run-id', runId, '--stage', stage]);
        return this.requireRun(payload);
    }

    async selectRevision(runId: string, stage: PipelineStage, revisionId: string): Promise<PipelineRun> {
        const payload = await this.invoke(['--project-root', this.projectRoot, 'select-revision', '--run-id', runId, '--stage', stage, '--revision-id', revisionId]);
        return this.requireRun(payload);
    }

    async acceptRevision(runId: string, stage: PipelineStage, revisionId: string): Promise<PipelineRun> {
        const payload = await this.invoke(['--project-root', this.projectRoot, 'accept-revision', '--run-id', runId, '--stage', stage, '--revision-id', revisionId]);
        return this.requireRun(payload);
    }

    async publish(runId: string): Promise<PipelineRun> {
        const payload = await this.invoke(['--project-root', this.projectRoot, 'publish', '--run-id', runId]);
        return this.requireRun(payload);
    }

    private async invoke(args: string[]): Promise<CliPayload> {
        return this.runner(args, this.projectRoot);
    }

    private requireRun(payload: CliPayload): PipelineRun {
        if (!payload.run) {
            throw new Error('Pipeline CLI returned no run payload.');
        }
        return payload.run;
    }
}
