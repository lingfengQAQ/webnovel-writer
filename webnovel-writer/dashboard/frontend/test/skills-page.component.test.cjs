const assert = require('node:assert/strict')
const path = require('node:path')

const { JSDOM } = require('jsdom')
const mock = require('mock-require')

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

for (const key of Object.getOwnPropertyNames(dom.window)) {
    if (!(key in global)) {
        global[key] = dom.window[key]
    }
}

const apiMock = {
    listSkills: async () => ({ items: [], total: 0 }),
    createSkill: async () => ({ status: 'ok' }),
    toggleSkill: async () => ({ status: 'ok', enabled: false }),
    deleteSkill: async () => ({ status: 'ok', deleted: true }),
}

const apiModulePath = path.resolve(__dirname, '../src/api/skills.js')
mock(apiModulePath, apiMock)

const React = require('react')
const { render, screen, fireEvent, waitFor, cleanup, within } = require('@testing-library/react')
const SkillsPage = require(path.resolve(__dirname, '../src/pages/SkillsPage.jsx')).default

const BASE_SKILL = {
    id: 'outline.splitter',
    name: 'Outline Splitter',
    description: 'Split master outline into scenes.',
    enabled: true,
    scope: 'workspace',
    updated_at: '2026-03-25T14:00:00Z',
}

function resetApiMock() {
    apiMock.listSkills = async () => ({ items: [], total: 0 })
    apiMock.createSkill = async () => ({ status: 'ok' })
    apiMock.toggleSkill = async () => ({ status: 'ok', enabled: false })
    apiMock.deleteSkill = async () => ({ status: 'ok', deleted: true })
}

async function runTest(name, fn) {
    resetApiMock()
    cleanup()
    window.confirm = () => true

    try {
        await fn()
        console.log(`PASS ${name}`)
    } catch (error) {
        console.error(`FAIL ${name}`)
        console.error(error)
        throw error
    }
}

async function testListRender() {
    let listCount = 0
    apiMock.listSkills = async () => {
        listCount += 1
        return { items: [BASE_SKILL], total: 1 }
    }

    render(React.createElement(SkillsPage))

    await screen.findByText('outline.splitter')
    assert.equal(listCount, 1)
    assert.ok(screen.getByText('1/1 已启用'))
}

async function testCreateSkill() {
    const newSkill = {
        ...BASE_SKILL,
        id: 'new.skill',
        name: 'New Skill',
    }
    let listCount = 0
    let createPayload = null
    apiMock.listSkills = async () => {
        listCount += 1
        return listCount === 1 ? { items: [], total: 0 } : { items: [newSkill], total: 1 }
    }
    apiMock.createSkill = async payload => {
        createPayload = payload
        return { status: 'ok' }
    }

    render(React.createElement(SkillsPage))
    await screen.findByText('暂无技能，先创建一个。')

    fireEvent.change(screen.getByPlaceholderText('outline.splitter'), {
        target: { value: 'new.skill' },
    })
    fireEvent.change(screen.getByPlaceholderText('Outline Splitter'), {
        target: { value: 'New Skill' },
    })
    fireEvent.click(screen.getByRole('button', { name: '新增' }))

    await waitFor(() => {
        assert.deepEqual(createPayload, {
            id: 'new.skill',
            name: 'New Skill',
            description: '',
            enabled: true,
        })
    })
    await screen.findByText('已新增技能: new.skill')
    await screen.findByText('new.skill')
}

async function testToggleSkill() {
    let togglePayload = null
    apiMock.listSkills = async () => ({ items: [BASE_SKILL], total: 1 })
    apiMock.toggleSkill = async payload => {
        togglePayload = payload
        return { status: 'ok', enabled: false }
    }

    render(React.createElement(SkillsPage))
    await screen.findByText('outline.splitter')

    fireEvent.click(screen.getByRole('button', { name: '禁用' }))

    await waitFor(() => {
        assert.deepEqual(togglePayload, {
            skillId: 'outline.splitter',
            enabled: false,
            reason: 'toggle-by-ui',
        })
    })
    await screen.findByText('已禁用技能: outline.splitter')
    const row = screen.getByText('outline.splitter').closest('tr')
    assert.ok(within(row).getByText('disabled'))
}

async function testDeleteSkill() {
    let deletePayload = null
    apiMock.listSkills = async () => ({ items: [BASE_SKILL], total: 1 })
    apiMock.deleteSkill = async payload => {
        deletePayload = payload
        return { status: 'ok', deleted: true }
    }

    render(React.createElement(SkillsPage))
    await screen.findByText('outline.splitter')

    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => {
        assert.deepEqual(deletePayload, {
            skillId: 'outline.splitter',
            hardDelete: true,
        })
    })
    await screen.findByText('已删除技能: outline.splitter')
    assert.equal(screen.queryByText('outline.splitter'), null)
}

async function testVisibleErrorFeedback() {
    apiMock.listSkills = async () => {
        throw {
            message: 'Workspace access denied.',
            errorCode: 'workspace_mismatch',
        }
    }

    render(React.createElement(SkillsPage))

    const alert = await screen.findByRole('alert')
    assert.match(alert.textContent, /workspace_mismatch/)
    assert.match(alert.textContent, /Workspace access denied\./)
}

async function main() {
    await runTest('list render', testListRender)
    await runTest('create skill', testCreateSkill)
    await runTest('toggle skill', testToggleSkill)
    await runTest('delete skill', testDeleteSkill)
    await runTest('error feedback', testVisibleErrorFeedback)
    console.log('PASS skills-page component suite')
}

main().catch(() => {
    process.exitCode = 1
})
