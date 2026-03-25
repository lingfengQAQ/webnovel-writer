import test from 'node:test'
import assert from 'node:assert/strict'

const originalFetch = globalThis.fetch

function installFailingFetch() {
    globalThis.fetch = async () => {
        throw new Error('network down')
    }
}

function restoreFetch() {
    globalThis.fetch = originalFetch
}

test('outlines api supports split preview/apply/history in mock fallback', async () => {
    installFailingFetch()
    const module = await import('./outlines.js')

    try {
        const bundleBefore = await module.fetchOutlineBundle()
        assert.equal(bundleBefore.isMock, true)
        assert.ok(bundleBefore.total_outline.length > 0)

        const preview = await module.previewOutlineSplit({
            selectionStart: 0,
            selectionEnd: 22,
            selectionText: '林昭在星门废墟发现残缺星图。\n\n白莲宗派人追查星图去向。',
        })
        assert.equal(preview.isMock, true)
        assert.ok(preview.segments.length >= 1)

        const applyA = await module.applyOutlineSplit({
            selectionStart: 0,
            selectionEnd: 22,
            selectionText: '林昭在星门废墟发现残缺星图。\n\n白莲宗派人追查星图去向。',
            idempotencyKey: 'same-key',
        })
        const applyB = await module.applyOutlineSplit({
            selectionStart: 0,
            selectionEnd: 22,
            selectionText: '林昭在星门废墟发现残缺星图。\n\n白莲宗派人追查星图去向。',
            idempotencyKey: 'same-key',
        })
        assert.equal(applyA.isMock, true)
        assert.equal(applyB.isMock, true)
        assert.equal(applyA.record?.id, applyB.record?.id)

        const history = await module.fetchOutlineSplitHistory({ limit: 100, offset: 0 })
        assert.equal(history.isMock, true)
        assert.ok(history.total >= 1)

        const bundleAfter = await module.fetchOutlineBundle()
        assert.equal(bundleAfter.isMock, true)
        assert.ok(bundleAfter.detailed_outline.includes('### [0000]'))
    } finally {
        restoreFetch()
    }
})
