import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ResplitDialog from './ResplitDialog.jsx'

function createResponse(payload, { ok = true, status = 200, statusText = 'OK' } = {}) {
    return {
        ok,
        status,
        statusText,
        text: async () => JSON.stringify(payload),
    }
}

beforeEach(() => {
    vi.restoreAllMocks()
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('ResplitDialog', () => {
    it('shows smaller-selection rollback strategy from preview', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
            createResponse({
                status: 'ok',
                rollback_plan: {
                    rollback_strategy: 'smaller_selection',
                    rollback_start: 0,
                    rollback_end: 88,
                    notes: '新选区更小，回退整段后重拆。',
                },
                segments: [
                    {
                        id: 'seg-1',
                        title: 'Scene 1',
                        content: '第一段剧情推进。',
                        order_index: 0,
                    },
                ],
            }),
        )

        render(
            <ResplitDialog
                isOpen
                workspace={{ workspace_id: 'ws-t10', project_root: 'D:/tmp/ws-t10' }}
                selectionStart={2}
                selectionEnd={20}
            />,
        )

        expect(await screen.findByText('小选区：回退整段')).toBeInTheDocument()
        expect(screen.getByText('回退区间: [0, 88)')).toBeInTheDocument()
        expect(screen.getByText('第一段剧情推进。')).toBeInTheDocument()
    })

    it('applies resplit with rollback_plan from preview', async () => {
        const onApplied = vi.fn()
        const fetchMock = vi.spyOn(globalThis, 'fetch')
        fetchMock
            .mockResolvedValueOnce(
                createResponse({
                    status: 'ok',
                    rollback_plan: {
                        rollback_strategy: 'larger_selection',
                        rollback_start: 0,
                        rollback_end: 136,
                        notes: '新选区更大，回退覆盖片段并按更大区间重拆。',
                    },
                    segments: [
                        {
                            id: 'seg-2',
                            title: 'Scene 2',
                            content: '第二段冲突升级。',
                            order_index: 1,
                        },
                    ],
                }),
            )
            .mockResolvedValueOnce(
                createResponse({
                    status: 'ok',
                    record: {
                        id: 'resplit-123',
                        source_start: 0,
                        source_end: 136,
                        created_at: '2026-03-25T12:00:00Z',
                        segments: [],
                        anchors: [],
                    },
                }),
            )

        render(
            <ResplitDialog
                isOpen
                workspace={{ workspace_id: 'ws-t10', project_root: 'D:/tmp/ws-t10' }}
                selectionStart={0}
                selectionEnd={136}
                onApplied={onApplied}
            />,
        )

        expect(await screen.findByText('大选区：回退全覆盖片段')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: '应用重拆' }))

        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledTimes(2)
        })
        expect(onApplied).toHaveBeenCalledTimes(1)
        expect(await screen.findByText('已完成重拆落盘: resplit-123')).toBeInTheDocument()
    })
})

