import test from 'node:test'
import assert from 'node:assert/strict'

const originalFetch = globalThis.fetch
const originalNodeEnv = process.env.NODE_ENV
const originalWindow = globalThis.window

function installFailingFetch() {
    globalThis.fetch = async () => {
        throw new Error('network down')
    }
}

function restoreFetch() {
    globalThis.fetch = originalFetch
}

function installMockWindow() {
    globalThis.window = {
        location: {
            origin: 'http://localhost:5173',
            search: '',
        },
    }
}

function restoreWindow() {
    if (originalWindow === undefined) {
        delete globalThis.window
        return
    }
    globalThis.window = originalWindow
}

function setNodeEnv(value) {
    if (value === undefined) {
        delete process.env.NODE_ENV
        return
    }
    process.env.NODE_ENV = value
}

function restoreNodeEnv() {
    setNodeEnv(originalNodeEnv)
}

async function loadSettingsModule() {
    return import(`./settings.js?test_case=${Date.now()}_${Math.random().toString(16).slice(2)}`)
}

test('settings api falls back to mock payloads in non-production mode', async () => {
    setNodeEnv('development')
    installMockWindow()
    installFailingFetch()
    const module = await loadSettingsModule()

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
        restoreWindow()
        restoreNodeEnv()
    }
})

test('settings api throws in production mode when backend is unavailable', async () => {
    setNodeEnv('production')
    installMockWindow()
    installFailingFetch()
    const module = await loadSettingsModule()

    try {
        await assert.rejects(
            () => module.listSettingDictionary({ limit: 100, offset: 0 }),
            error => {
                assert.match(error.message, /network down/i)
                return true
            },
        )

        await assert.rejects(
            () => module.resolveDictionaryConflict({ id: 'conf-002', decision: 'confirm', attrs: {} }),
            error => {
                assert.match(error.message, /network down/i)
                return true
            },
        )
    } finally {
        restoreFetch()
        restoreWindow()
        restoreNodeEnv()
    }
})

test('resolveDictionaryConflict requires conflict_id', async () => {
    setNodeEnv('production')
    installMockWindow()
    const module = await loadSettingsModule()

    try {
        await assert.rejects(
            () => module.resolveDictionaryConflict({ decision: 'confirm', attrs: {} }),
            error => {
                assert.equal(error.errorCode, 'conflict_id_required')
                assert.match(error.message, /conflict id is required/i)
                return true
            },
        )
    } finally {
        restoreWindow()
        restoreNodeEnv()
    }
})
