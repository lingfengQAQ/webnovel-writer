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

test('settings api falls back to mock payloads when backend is unavailable', async () => {
    installFailingFetch()
    const module = await import('./settings.js')

    try {
        const tree = await module.fetchSettingsFileTree()
        assert.equal(tree.isMock, true)
        assert.ok(Array.isArray(tree.nodes))
        assert.ok(tree.nodes.length > 0)

        const firstExtract = await module.extractSettingDictionary({ incremental: true })
        const secondExtract = await module.extractSettingDictionary({ incremental: true })
        assert.equal(firstExtract.isMock, true)
        assert.equal(secondExtract.isMock, true)
        assert.ok(firstExtract.extracted >= 1)
        assert.equal(secondExtract.extracted, 0)

        const list = await module.listSettingDictionary({ limit: 100, offset: 0 })
        assert.equal(list.isMock, true)
        assert.ok(list.total >= 1)

        const resolved = await module.resolveDictionaryConflict({
            id: 'conf-002',
            decision: 'confirm',
            attrs: {},
        })
        assert.equal(resolved.isMock, true)
        assert.equal(resolved.conflict?.status, 'resolved')
    } finally {
        restoreFetch()
    }
})
