const assert = require('node:assert/strict')
const path = require('node:path')

const { JSDOM } = require('jsdom')

require('@babel/register')({
    extensions: ['.js', '.jsx'],
    ignore: [/node_modules/],
    presets: [
        ['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }],
        ['@babel/preset-react', { runtime: 'automatic' }],
    ],
})

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
})

global.window = dom.window
global.document = dom.window.document
global.navigator = dom.window.navigator
global.HTMLElement = dom.window.HTMLElement
global.Node = dom.window.Node
global.localStorage = dom.window.localStorage
global.AbortController = dom.window.AbortController

for (const key of Object.getOwnPropertyNames(dom.window)) {
    if (!(key in global)) {
        global[key] = dom.window[key]
    }
}

const React = require('react')
const { render, screen, fireEvent, waitFor, cleanup } = require('@testing-library/react')
const ResplitDialog = require(path.resolve(__dirname, '../src/components/ResplitDialog.jsx')).default

function createResponse(payload, { ok = true, status = 200, statusText = 'OK' } = {}) {
    return {
        ok,
        status,
        statusText,
        text: async () => JSON.stringify(payload),
    }
}

async function runTest(name, fn) {
    cleanup()
    try {
        await fn()
        console.log(`PASS ${name}`)
    } catch (error) {
        console.error(`FAIL ${name}`)
        console.error(error)
        throw error
    }
}

async function testPreviewVisualization() {
    const fetchCalls = []
    global.fetch = async (url, options) => {
        fetchCalls.push([url, options])
        return createResponse({
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
        })
    }

    render(
        React.createElement(ResplitDialog, {
            isOpen: true,
            workspace: { workspace_id: 'ws-t10', project_root: 'D:/tmp/ws-t10' },
            selectionStart: 2,
            selectionEnd: 20,
        }),
    )

    await screen.findByText('小选区：回退整段')
    assert.ok(screen.getByText('回退区间: [0, 88)'))
    assert.ok(screen.getByText(/第一段剧情推进。/))
    assert.equal(fetchCalls.length, 1)
    assert.equal(fetchCalls[0][0], '/api/outlines/resplit/preview')
}

async function testApplyFlow() {
    const fetchCalls = []
    const queue = [
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
    ]

    global.fetch = async (url, options) => {
        fetchCalls.push([url, options])
        const next = queue.shift()
        if (!next) {
            throw new Error('unexpected fetch invocation')
        }
        return next
    }

    let appliedPayload = null
    render(
        React.createElement(ResplitDialog, {
            isOpen: true,
            workspace: { workspace_id: 'ws-t10', project_root: 'D:/tmp/ws-t10' },
            selectionStart: 0,
            selectionEnd: 136,
            onApplied: payload => {
                appliedPayload = payload
            },
        }),
    )

    await screen.findByText('大选区：回退全覆盖片段')
    fireEvent.click(screen.getByRole('button', { name: '应用重拆' }))

    await waitFor(() => {
        assert.equal(fetchCalls.length, 2)
    })
    assert.ok(appliedPayload)
    assert.equal(appliedPayload.record.id, 'resplit-123')
    assert.ok(await screen.findByText('已完成重拆落盘: resplit-123'))

    const applyCall = fetchCalls[1]
    assert.equal(applyCall[0], '/api/outlines/resplit/apply')
    const body = JSON.parse(applyCall[1].body)
    assert.equal(body.rollback_plan.rollback_strategy, 'larger_selection')
}

async function main() {
    await runTest('preview visualization', testPreviewVisualization)
    await runTest('apply flow', testApplyFlow)
    console.log('PASS resplit-dialog component suite')
}

main().catch(() => {
    process.exitCode = 1
})
