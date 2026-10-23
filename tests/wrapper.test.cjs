const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const openRouterPolicies = [
    { action: 'provider.use', resource: '*', effect: 'deny' },
    { action: 'provider.use', resource: 'openrouter', effect: 'allow' },
];
const openCodeConfig = {
    model: 'openrouter/anthropic/claude-haiku-5.5',
    policies: openRouterPolicies,
};

function fixture(t, options = {}) {
    assert.ok(process.env.TMPDIR, 'TMPDIR must be set');
    const dir = fs.mkdtempSync(path.join(process.env.TMPDIR, 'sbx-wrapper-test-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const bin = path.join(dir, 'bin');
    let workspace = path.join(dir, 'Project Folder');
    fs.mkdirSync(bin);
    fs.mkdirSync(workspace);
    workspace = fs.realpathSync(workspace);
    const log = path.join(dir, 'calls.jsonl');
    const upgrades = path.join(dir, 'upgrades.jsonl');
    const version = path.join(dir, 'version');
    fs.writeFileSync(version, options.version || '1.10.0');
    fs.writeFileSync(path.join(bin, 'sbx'), `#!${process.execPath}
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALL_LOG, JSON.stringify(args) + '\\n');
if (args[0] === process.env.FAIL_COMMAND ||
    (args[0] === 'mcp' && args[2] === process.env.FAIL_MCP)) {
    console.error('mock sbx failure');
    process.exit(17);
}
if (args[0] === 'ls') process.stdout.write(process.env.INVENTORY);
if (args[0] === 'exec') {
    const result = spawnSync(args[2], args.slice(3), { stdio: 'inherit' });
    process.exit(result.status ?? 1);
}
if (args[0] === 'run') process.exit(Number(process.env.AGENT_STATUS || 0));
`, { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'copilot'), `#!${process.execPath}
const fs = require('node:fs');
const assert = require('node:assert/strict');
const args = process.argv.slice(2);
assert.deepEqual(args.slice(0, 2), ['config', '--global']);
if (args[2] === process.env.FAIL_CONFIG_KEY) {
    console.error('mock Copilot config failure');
    process.exit(21);
}
const file = process.env.COPILOT_SETTINGS_FILE;
const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
settings[args[2]] = args[3];
fs.writeFileSync(file, JSON.stringify(settings));
`, { mode: 0o755 });
    const copilotSettings = path.join(dir, 'copilot-settings.json');
    fs.writeFileSync(copilotSettings, JSON.stringify({
        model: 'old-model', autoTier: 'intelligence', theme: 'keep',
    }));
    fs.writeFileSync(path.join(bin, 'opencode'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === '--version') {
    console.log(fs.readFileSync(process.env.VERSION_FILE, 'utf8'));
} else {
    fs.appendFileSync(process.env.UPGRADE_LOG, JSON.stringify(args) + '\\n');
    if (process.env.FAIL_UPGRADE === '1') process.exit(19);
    if (args.includes('--major') && process.env.STUCK_V1 !== '1')
        fs.writeFileSync(process.env.VERSION_FILE, 'opencode v2.1.3');
}
`, { mode: 0o755 });
    const inventory = options.inventory
        ? options.inventory(workspace)
        : [{ name: 'Project-A', agent: 'opencode', workspaces: [workspace] }];
    const env = {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        CALL_LOG: log,
        UPGRADE_LOG: upgrades,
        VERSION_FILE: version,
        INVENTORY: JSON.stringify(inventory),
        FAIL_COMMAND: '',
        FAIL_MCP: '',
        FAIL_UPGRADE: '',
        STUCK_V1: '',
        AGENT_STATUS: '',
        FAIL_CONFIG_KEY: '',
        COPILOT_SETTINGS_FILE: copilotSettings,
        SBX_XCODE_MCP: 'xcode',
        SBX_EXA_MCP: 'exa',
        ...options.env,
    };
    const readLog = file => fs.existsSync(file)
        ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
        : [];
    return {
        dir, bin, workspace, env, copilotSettings,
        run(agent = 'opencode', args = [], input = '') {
            return spawnSync('/bin/bash', [path.join(root, 'sbx-wrapper'), agent, ...args], {
                cwd: workspace, env, input, encoding: 'utf8',
            });
        },
        calls: () => readLog(log),
        upgrades: () => readLog(upgrades),
    };
}

test('folder reuse, runtime MCPs, V1 update then major migration, agent arguments', t => {
    const f = fixture(t);
    const result = f.run('opencode', ['--', '--continue', 'argument with spaces']);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(f.calls().map(c => c[0]), ['ls', 'mcp', 'mcp', 'exec', 'run']);
    assert.deepEqual(f.calls()[1], ['mcp', 'load', 'xcode', '--sandbox', 'Project-A']);
    assert.deepEqual(f.calls()[2], ['mcp', 'load', 'exa', '--sandbox', 'Project-A']);
    assert.deepEqual(f.upgrades(), [['upgrade'], ['upgrade', '--major']]);
    assert.deepEqual(f.calls().at(-1),
        ['run', '--name', 'Project-A',
            '-e', 'OPENCODE_DISABLE_FREE_MODELS=1',
            '-e', `OPENCODE_CONFIG_CONTENT=${JSON.stringify(openCodeConfig)}`,
            '--', '--continue', 'argument with spaces']);
});

test('every OpenCode launch passes free-model disabling and an OpenRouter-only policy', t => {
    const f = fixture(t, { version: 'opencode v2.1.3' });
    for (const args of [[], ['Project-A']]) {
        const result = f.run('opencode', args);
        assert.equal(result.status, 0, result.stderr);
        const run = f.calls().at(-1);
        const separator = run.indexOf('--');
        const flags = run.slice(3, separator);
        assert.equal(flags.length, 4);
        assert.equal(flags[0], '-e');
        assert.equal(flags[1], 'OPENCODE_DISABLE_FREE_MODELS=1');
        assert.equal(flags[2], '-e');
        const prefix = 'OPENCODE_CONFIG_CONTENT=';
        assert.ok(flags[3].startsWith(prefix));
        const config = JSON.parse(flags[3].slice(prefix.length));
        assert.deepEqual(config, openCodeConfig);
        for (const provider of ['openrouter', 'opencode', 'anthropic', 'openai', 'github-copilot']) {
            const decision = config.policies.filter(p =>
                p.action === 'provider.use' && (p.resource === '*' || p.resource === provider)
            ).at(-1).effect;
            assert.equal(decision, provider === 'openrouter' ? 'allow' : 'deny');
        }
    }
});

test('V2 updates without repeating the major migration', t => {
    const f = fixture(t, { version: 'opencode v2.1.3' });
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(f.upgrades(), [['upgrade']]);
});

test('named lookup works from another folder and normalizes a display name', t => {
    const f = fixture(t, {
        inventory: () => [{ name: 'project-a', agent: 'opencode', workspaces: ['/elsewhere'] }],
    });
    assert.equal(f.run('opencode', ['Project A']).status, 0);
    assert.equal(f.calls().at(-1)[2], 'project-a');
    assert.ok(!f.calls().some(c => c[0] === 'create'));
});

test('prompt creates a normalized name with the physical workspace', t => {
    const f = fixture(t, { inventory: () => [] });
    const result = f.run('copilot', [], 'Project A\n');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(f.calls()[1], ['create', '--name', 'project-a', 'copilot', f.workspace]);
    assert.deepEqual(f.calls().at(-1), ['run', '--name', 'project-a', '--', '--no-remote']);
});

test('folder matching distinguishes agents and ignores mountless sandboxes', t => {
    const f = fixture(t, {
        inventory: workspace => [
            { name: 'other', agent: 'opencode', workspaces: [workspace] },
            { name: 'mountless', agent: 'copilot' },
            { name: 'Assistant', agent: 'copilot', workspaces: ['/other', workspace] },
        ],
    });
    assert.equal(f.run('copilot').status, 0);
    assert.deepEqual(f.calls().at(-1), ['run', '--name', 'Assistant', '--', '--no-remote']);
    assert.deepEqual(f.calls().filter(c => c[0] === 'exec'), [
        ['exec', 'Assistant', 'copilot', 'config', '--global', 'model', 'auto'],
        ['exec', 'Assistant', 'copilot', 'config', '--global', 'autoTier', 'balance'],
    ]);
    assert.deepEqual(JSON.parse(fs.readFileSync(f.copilotSettings, 'utf8')), {
        model: 'auto', autoTier: 'balance', theme: 'keep',
    });
});

for (const key of ['model', 'autoTier']) {
    test(`Copilot config failure aborts launch: ${key}`, t => {
        const f = fixture(t, {
            inventory: w => [{ name: 'cp', agent: 'copilot', workspaces: [w] }],
            env: { FAIL_CONFIG_KEY: key },
        });
        const result = f.run('copilot');
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /mock Copilot config failure/);
        assert.ok(!f.calls().some(c => c[0] === 'run'));
    });
}

for (const [title, options, agent, args, input, message] of [
    ['unknown explicit name', {}, 'opencode', ['missing'], '', /No sandbox named/],
    ['wrong agent', {}, 'copilot', ['Project-A'], '', /not copilot/],
    ['duplicate folder matches', {
        inventory: w => ['one', 'two'].map(name => ({ name, agent: 'opencode', workspaces: [w] })),
    }, 'opencode', [], '', /Multiple matches/],
    ['normalized name collision', {
        inventory: () => [{ name: 'project-a', agent: 'copilot' }],
    }, 'opencode', [], 'Project A\n', /already taken/],
    ['empty prompt', { inventory: () => [] }, 'opencode', [], '\n', /at least two/],
    ['reserved name', { inventory: () => [] }, 'opencode', [], 'default\n', /reserved/],
    ['one-character name', { inventory: () => [] }, 'opencode', [], 'A\n', /at least two/],
    ['prompt EOF', { inventory: () => [] }, 'opencode', [], '', /Could not read/],
    ['unseparated arguments', {}, 'opencode', ['Project-A', '--continue'], '', /Put --/],
    ['remote override', {}, 'copilot', ['--', '--remote'], '', /Remote sessions/],
    ['invalid JSON schema', { inventory: () => ({ sandboxes: [] }) },
        'opencode', [], '', /Unexpected/],
    ['invalid workspace type', {
        inventory: () => [{ name: 'bad', agent: 'opencode', workspaces: [{}] }],
    }, 'opencode', [], '', /Unexpected/],
    ['inventory error', { env: { FAIL_COMMAND: 'ls' } }, 'opencode', [], '', /mock sbx failure/],
    ['MCP error', { env: { FAIL_MCP: 'exa' } }, 'opencode', [], '', /mock sbx failure/],
    ['creation error', { inventory: () => [], env: { FAIL_COMMAND: 'create' } },
        'copilot', [], 'Project A\n', /mock sbx failure/],
    ['upgrade error', { env: { FAIL_UPGRADE: '1' } }, 'opencode', [], '', /launch aborted/],
    ['migration stays on V1', { env: { STUCK_V1: '1' } }, 'opencode', [], '', /did not install V2/],
    ['unparseable version', { version: 'unknown' }, 'opencode', [], '', /Cannot parse/],
]) {
    test(`fails safely: ${title}`, t => {
        const f = fixture(t, options);
        const result = f.run(agent, args, input);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, message);
        assert.ok(!f.calls().some(c => c[0] === 'run'));
    });
}

test('agent exit status propagates', t => {
    const f = fixture(t, { env: { AGENT_STATUS: '23' } });
    assert.equal(f.run().status, 23);
});

test('custom MCP registration names', t => {
    const f = fixture(t, { env: { SBX_XCODE_MCP: 'my-xcode', SBX_EXA_MCP: 'my-exa' } });
    assert.equal(f.run().status, 0);
    assert.equal(f.calls()[1][2], 'my-xcode');
    assert.equal(f.calls()[2][2], 'my-exa');
});

test('installer produces both directly executable commands, including paths with spaces', t => {
    const f = fixture(t, {
        inventory: w => [
            { name: 'oc', agent: 'opencode', workspaces: [w] },
            { name: 'cp', agent: 'copilot', workspaces: [w] },
        ],
    });
    const destination = path.join(f.dir, 'Installed Commands');
    const installed = spawnSync('/bin/bash', [path.join(root, 'install.sh'), destination], {
        encoding: 'utf8', env: f.env,
    });
    assert.equal(installed.status, 0, installed.stderr);
    for (const command of ['sbx-opencode', 'sbx-copilot']) {
        const result = spawnSync(path.join(destination, command), [], {
            cwd: f.workspace, env: f.env, encoding: 'utf8',
        });
        assert.equal(result.status, 0, result.stderr);
    }
});

for (const custom of [false, true]) {
    test(`uninstaller removes only wrapper commands (${custom ? 'custom' : 'default'} directory)`, t => {
        const f = fixture(t);
        const home = path.join(f.dir, 'Test Home');
        const destination = custom
            ? path.join(f.dir, 'Installed Commands')
            : path.join(home, '.local', 'bin');
        const env = { ...f.env, HOME: home };
        const installed = spawnSync('/bin/bash', [path.join(root, 'install.sh'), destination], {
            env, encoding: 'utf8',
        });
        assert.equal(installed.status, 0, installed.stderr);
        const unrelated = path.join(destination, 'other-command');
        fs.writeFileSync(unrelated, 'keep');
        for (let attempt = 0; attempt < 2; attempt++) {
            const result = spawnSync('/bin/bash', [
                path.join(root, 'uninstall.sh'), ...(custom ? [destination] : []),
            ], { env, encoding: 'utf8' });
            assert.equal(result.status, 0, result.stderr);
            assert.ok(!fs.existsSync(path.join(destination, 'sbx-opencode')));
            assert.ok(!fs.existsSync(path.join(destination, 'sbx-copilot')));
            assert.equal(fs.readFileSync(unrelated, 'utf8'), 'keep');
        }
    });
}

test('uninstaller accepts a missing directory without creating it', t => {
    const f = fixture(t);
    const destination = path.join(f.dir, 'missing');
    const result = spawnSync('/bin/bash', [path.join(root, 'uninstall.sh'), destination], {
        env: f.env, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!fs.existsSync(destination));
});

test('uninstaller rejects invalid arguments and does not recursively remove directories', t => {
    const f = fixture(t);
    const destination = path.join(f.dir, 'Installed Commands');
    const protectedDirectory = path.join(destination, 'sbx-opencode');
    fs.mkdirSync(protectedDirectory, { recursive: true });
    const file = path.join(protectedDirectory, 'keep');
    fs.writeFileSync(file, 'keep');
    for (const args of [[''], [destination, 'extra'], [destination]]) {
        const result = spawnSync('/bin/bash', [path.join(root, 'uninstall.sh'), ...args], {
            env: f.env, encoding: 'utf8',
        });
        assert.notEqual(result.status, 0);
        assert.ok(result.stderr.length > 0);
        assert.doesNotMatch(result.stdout, /Removed/);
        assert.equal(fs.readFileSync(file, 'utf8'), 'keep');
    }
});
