import * as vscode from 'vscode';
import { discoverWorkspaceTree, TreeNode } from './discovery';
import { PipelineViewProvider } from './product/pipelineView';

class BrowserTreeProvider implements vscode.TreeDataProvider<TreeNode> {
    private readonly changeEmitter = new vscode.EventEmitter<TreeNode | undefined | void>();
    private cachedRoots: TreeNode[] | undefined;

    readonly onDidChangeTreeData = this.changeEmitter.event;

    async getChildren(element?: TreeNode): Promise<TreeNode[]> {
        if (element?.children) {
            return element.children;
        }

        if (element) {
            return [];
        }

        if (!this.cachedRoots) {
            this.cachedRoots = await this.loadRoots();
        }

        return this.cachedRoots;
    }

    getTreeItem(element: TreeNode): vscode.TreeItem {
        const collapsibleState = element.children && element.children.length > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None;

        const item = new vscode.TreeItem(element.label, collapsibleState);
        item.id = element.id;
        item.description = element.description;
        item.tooltip = element.relativePath ?? element.description ?? element.label;

        switch (element.kind) {
            case 'workspace':
                item.contextValue = 'workspace';
                item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
                item.iconPath = new vscode.ThemeIcon('root-folder');
                break;
            case 'group':
                item.contextValue = 'group';
                item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
                item.iconPath = new vscode.ThemeIcon('files');
                break;
            case 'folder':
                item.contextValue = 'folder';
                item.iconPath = new vscode.ThemeIcon('folder');
                break;
            case 'chapter':
                item.contextValue = 'chapter';
                item.iconPath = new vscode.ThemeIcon('book');
                break;
            case 'scene':
                item.contextValue = 'scene';
                item.iconPath = new vscode.ThemeIcon('symbol-event');
                break;
            case 'file':
                item.contextValue = 'file';
                item.iconPath = vscode.ThemeIcon.File;
                if (element.absolutePath) {
                    item.resourceUri = vscode.Uri.file(element.absolutePath);
                    item.command = {
                        command: 'vscode.open',
                        title: 'Open File',
                        arguments: [vscode.Uri.file(element.absolutePath)],
                    };
                }
                break;
            case 'message':
                item.contextValue = 'message';
                item.iconPath = new vscode.ThemeIcon('info');
                break;
        }

        return item;
    }

    async refresh(): Promise<void> {
        this.cachedRoots = await this.loadRoots();
        this.changeEmitter.fire();
    }

    private async loadRoots(): Promise<TreeNode[]> {
        const folders = vscode.workspace.workspaceFolders ?? [];
        if (folders.length === 0) {
            return [
                {
                    kind: 'message',
                    id: 'workspace:none',
                    label: 'Open a workspace folder to browse text content.',
                },
            ];
        }

        return Promise.all(
            folders.map(folder => discoverWorkspaceTree(folder.uri.fsPath, folder.name)),
        );
    }
}

export function activate(context: vscode.ExtensionContext): void {
    const provider = new BrowserTreeProvider();
    const pipelineProvider = new PipelineViewProvider(context);
    const view = vscode.window.createTreeView('webnovelTextBrowser', {
        treeDataProvider: provider,
        showCollapseAll: true,
    });

    context.subscriptions.push(view);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(PipelineViewProvider.viewType, pipelineProvider),
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('webnovelTextBrowser.refresh', async () => {
            await provider.refresh();
            void vscode.window.setStatusBarMessage('Webnovel Writer browser refreshed.', 2500);
        }),
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('webnovelPipeline.refresh', async () => {
            await pipelineProvider.refresh();
        }),
        vscode.commands.registerCommand('webnovelPipeline.startRun', async () => {
            await pipelineProvider.startRun();
        }),
    );
}

export function deactivate(): void {
    // No-op.
}
