const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'sbxw');
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
    const dir = fs.mkdtempSync(path.join(process.env.TMPDIR, 'sbxw-test-'));
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
    let rest = args.slice(1);
    let cwd = process.cwd();
    while (rest[0] && rest[0].startsWith('-')) {
        if (rest[0] === '-w') cwd = rest[1];
        rest = rest.slice(['-u', '-w'].includes(rest[0]) ? 2 : 1);
    }
    const commandArgs = rest.slice(2).map(a => a.split('/etc/sbxw').join(process.env.ETC_DIR));
    const result = spawnSync(rest[1], commandArgs, { stdio: 'inherit', cwd });
    process.exit(result.status ?? 1);
}
if (args[0] === 'run') {
    if (args.includes('--no-remote')) {
        console.error('error: --no-remote was removed');
        process.exit(1);
    }
    process.exit(Number(process.env.AGENT_STATUS || 0));
}
`, { mode: 0o755 });
    const etcDir = path.join(dir, 'etc-sbxw');
    const copilotHome = path.join(dir, 'copilot-home');
    const copilotSettings = path.join(copilotHome, 'settings.json');
    fs.mkdirSync(copilotHome);
    if (options.copilotSettings !== undefined) {
        fs.writeFileSync(copilotSettings, options.copilotSettings);
    } else {
        fs.writeFileSync(copilotSettings, JSON.stringify({
            model: 'old-model', autoTier: 'intelligence', theme: 'keep',
        }));
    }
    fs.writeFileSync(path.join(bin, 'copilot'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'update') process.exit(Number(process.env.UPDATE_STATUS || 0));
if (args[0] === '--help') {
    console.log(process.env.COPILOT_HELP);
    process.exit(0);
}
if (args[0] === '--version') {
    console.log('GitHub Copilot CLI 1.0.107.');
    process.exit(0);
}
fs.appendFileSync(process.env.AGENT_LOG, JSON.stringify({
    args, cwd: process.cwd(),
}) + '\\n');
process.exit(Number(process.env.AGENT_STATUS || 0));
`, { mode: 0o755 });
    const agentLog = path.join(dir, 'agent.jsonl');
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
    const configFile = path.join(dir, 'sbxw.conf');
    if (options.config !== undefined) fs.writeFileSync(configFile, options.config);
    const inherited = { ...process.env };
    for (const key of Object.keys(inherited)) {
        if (key.startsWith('SBXW_')) delete inherited[key];
    }
    const env = {
        ...inherited,
        SBXW_CONFIG: configFile,
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
        COPILOT_HOME: copilotHome,
        AGENT_LOG: agentLog,
        UPDATE_STATUS: '',
        COPILOT_HELP: 'Options:\n      --sync-session[=<on|off>]',
        ETC_DIR: etcDir,
        SBX_XCODE_MCP: 'xcode',
        SBX_EXA_MCP: 'exa',
        ...options.env,
    };
    const readLog = file => fs.existsSync(file)
        ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
        : [];
    const recordFile = path.join(etcDir, 'attachments.json');
    return {
        dir, bin, workspace, env, copilotSettings, recordFile,
        run(args = [], input = '') {
            return spawnSync('/bin/bash', [script, ...args], {
                cwd: workspace, env, input, encoding: 'utf8',
            });
        },
        calls: () => readLog(log),
        agentRuns: () => readLog(agentLog),
        upgrades: () => readLog(upgrades),
        record: () => fs.existsSync(recordFile)
            ? JSON.parse(fs.readFileSync(recordFile, 'utf8'))
            : null,
        seedRecord: value => {
            fs.mkdirSync(etcDir, { recursive: true });
            fs.writeFileSync(recordFile, JSON.stringify(value));
        },
    };
}

test('opening an existing sandbox reuses it, runs MCP loads and update, passes agent arguments', t => {
    const f = fixture(t);
    const result = f.run(['opencode', 'Project-A', '--', '--continue', 'argument with spaces']);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(f.calls().map(c => c[0]), ['ls', 'mcp', 'mcp', 'exec', 'exec', 'run']);
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
    for (const args of [['Project-A'], ['Project-A', '--', '--continue']]) {
        const result = f.run(['opencode', ...args]);
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
    const result = f.run(['opencode', 'Project-A']);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(f.upgrades(), [['upgrade']]);
});

test('an existing sandbox opens from any folder, ignoring the current folder', t => {
    const f = fixture(t, {
        inventory: () => [{ name: 'project-a', agent: 'opencode', workspaces: ['/elsewhere'] }],
    });
    assert.equal(f.run(['opencode', 'Project A']).status, 0);
    assert.equal(f.calls().at(-1)[2], 'project-a');
    assert.ok(!f.calls().some(c => c[0] === 'create'));
});

test('a new name is normalized and attached to the current folder', t => {
    const f = fixture(t, { inventory: () => [] });
    const result = f.run(['copilot', 'Project A']);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(f.calls()[1], ['create', '--name', 'project-a', 'copilot', f.workspace]);
    assert.deepEqual(f.calls().at(-1),
        ['exec', '-it', '-w', f.workspace, 'project-a', 'copilot', '--yolo', '--sync-session=off']);
    assert.deepEqual(f.agentRuns(), [{ args: ['--yolo', '--sync-session=off'], cwd: f.workspace }]);
});

test('copilot launch updates Copilot in the sandbox before starting it', t => {
    const f = fixture(t, { inventory: () => [{ name: 'upd', agent: 'copilot' }] });
    assert.equal(f.run(['copilot', 'upd']).status, 0);
    const update = f.calls().find(c => c[0] === 'exec' && c[2] === 'sh' && c[3] === '-c' && /copilot update/.test(c[4]));
    assert.ok(update, 'update call');
    assert.ok(f.calls().indexOf(update) < f.calls().findIndex(c => c[0] === 'exec' && c[2] === 'python3'));
    assert.equal(f.agentRuns().length, 1);
});

test('copilot launch continues when the update fails but the flag is present', t => {
    const f = fixture(t, {
        inventory: () => [{ name: 'upd', agent: 'copilot' }],
        env: { UPDATE_STATUS: '1' },
    });
    const result = f.run(['copilot', 'upd']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /update failed/);
    assert.equal(f.agentRuns().length, 1);
});

test('copilot launch aborts when the sandbox Copilot has no --sync-session option', t => {
    const f = fixture(t, {
        inventory: () => [{ name: 'old', agent: 'copilot' }],
        env: { COPILOT_HELP: 'Options:\n  --yolo' },
    });
    const result = f.run(['copilot', 'old']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /no --sync-session option; launch aborted/);
    assert.equal(f.agentRuns().length, 0);
});

test('copilot launch with --no-folder does not set a working directory', t => {
    const f = fixture(t, { inventory: () => [] });
    const result = f.run(['copilot', 'Loose', '--no-folder']);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(f.calls().at(-1),
        ['exec', '-it', 'loose', 'copilot', '--yolo', '--sync-session=off']);
});

test('--no-folder creates a sandbox without a host folder', t => {
    const f = fixture(t, { inventory: () => [] });
    const result = f.run(['opencode', 'scratch', '--no-folder']);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(f.calls()[1], ['create', '--name', 'scratch', 'opencode']);
});

test('--no-folder is accepted after the agent arguments separator only as an argument', t => {
    const f = fixture(t, { inventory: () => [{ name: 'scratch', agent: 'copilot' }] });
    const result = f.run(['copilot', 'scratch', '--', '--no-folder']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(f.calls().at(-1).at(-1), '--no-folder');
});

test('without a name, the prompt suggests the folder name and accepts Enter', t => {
    const f = fixture(t, { inventory: () => [] });
    const result = f.run(['opencode'], '\n');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /Sandbox name \[project-folder\]: /);
    assert.deepEqual(f.calls()[1], ['create', '--name', 'project-folder', 'opencode', f.workspace]);
});

test('without a name, a typed name is normalized', t => {
    const f = fixture(t, { inventory: () => [] });
    const result = f.run(['copilot'], 'Scratch Box\n');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(f.calls()[1], ['create', '--name', 'scratch-box', 'copilot', f.workspace]);
});

test('a duplicate name at the prompt is rejected and asked again', t => {
    const f = fixture(t, {
        inventory: () => [{ name: 'taken', agent: 'copilot' }],
    });
    const result = f.run(['opencode'], 'Taken\nFresh\n');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /Name 'taken' is already taken/);
    assert.deepEqual(f.calls()[1], ['create', '--name', 'fresh', 'opencode', f.workspace]);
});

test('--no-folder without a name prompts with no folder default', t => {
    const f = fixture(t, { inventory: () => [] });
    const result = f.run(['opencode', '--no-folder'], 'Scratch Box\n');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /Sandbox name: /);
    assert.deepEqual(f.calls()[1], ['create', '--name', 'scratch-box', 'opencode']);
});

test('copilot agent arguments pass after --', t => {
    const f = fixture(t, { inventory: () => [{ name: 'assistant', agent: 'copilot' }] });
    const result = f.run(['copilot', 'assistant', '--', '--resume']);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(f.agentRuns().at(-1).args, ['--yolo', '--sync-session=off', '--resume']);
});

test('copilot launch writes Copilot defaults to settings.json without calling copilot config', t => {
    const f = fixture(t, {
        inventory: w => [{ name: 'Assistant', agent: 'copilot', workspaces: [w] }],
    });
    assert.equal(f.run(['copilot', 'Assistant']).status, 0);
    assert.ok(!f.calls().some(c => c[0] === 'exec' && c[2] === 'copilot'));
    assert.equal(f.calls().filter(c => c[0] === 'exec' && c[2] === 'python3').length, 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(f.copilotSettings, 'utf8')), {
        model: 'auto', autoTier: 'balance', theme: 'keep',
    });
});

test('copilot launch creates settings.json when none exists', t => {
    const f = fixture(t, {
        inventory: w => [{ name: 'fresh', agent: 'copilot', workspaces: [w] }],
    });
    fs.rmSync(f.copilotSettings);
    assert.equal(f.run(['copilot', 'fresh']).status, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(f.copilotSettings, 'utf8')), {
        model: 'auto', autoTier: 'balance',
    });
});

test('copilot launch aborts without touching settings.json when it cannot be parsed', t => {
    const original = '{\n  // comment\n  "model": "keep"\n}\n';
    const f = fixture(t, {
        inventory: w => [{ name: 'cp', agent: 'copilot', workspaces: [w] }],
        copilotSettings: original,
    });
    const result = f.run(['copilot', 'cp']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /JSONDecodeError|Expecting/);
    assert.ok(!f.calls().some(c => c[0] === 'run'));
    assert.equal(fs.readFileSync(f.copilotSettings, 'utf8'), original);
});

for (const [title, options, args, input, message] of [
    ['sandbox of another agent', {}, ['copilot', 'Project-A'], '', /uses opencode, not copilot/],
    ['normalized name collision with another agent', {
        inventory: () => [{ name: 'project-a', agent: 'copilot' }],
    }, ['opencode', 'Project A'], '', /uses copilot, not opencode/],
    ['prompt name that is too short', { inventory: () => [] }, ['opencode'], 'A\n', /at least two/],
    ['prompt reserved name', { inventory: () => [] }, ['opencode'], 'default\n', /reserved/],
    ['prompt EOF', { inventory: () => [] }, ['opencode'], '', /Could not read/],
    ['prompt EOF after duplicate', {
        inventory: () => [{ name: 'project-a', agent: 'copilot' }],
    }, ['opencode'], 'Project A\n', /Could not read/],
    ['explicit name too short', { inventory: () => [] }, ['opencode', 'A'], '', /at least two/],
    ['unseparated agent argument', {}, ['opencode', 'Project-A', '--continue'], '', /Unknown option/],
    ['two names', {}, ['opencode', 'Project-A', 'Other'], '', /Only one sandbox name/],
    ['empty name', {}, ['opencode', ''], '', /cannot be empty/],
    ['unknown option', {}, ['opencode', '--bogus'], '', /Unknown option/],
    ['unknown command', {}, ['bogus'], '', /Unknown command/],
    ['ls with arguments', {}, ['ls', 'extra'], '', /takes no arguments/],
    ['removed remote flag', {}, ['copilot', 'Project-A', '--', '--remote'], '', /Copilot removed/],
    ['removed no-remote flag', {}, ['copilot', 'Project-A', '--', '--no-remote'], '', /Copilot removed/],
    ['remote connection', {}, ['copilot', 'Project-A', '--', '--connect=session'], '', /Remote connection/],
    ['remote hosting', {}, ['copilot', 'Project-A', '--', '--host-environment', 'test'], '', /Remote connection/],
    ['AHP hosting', {}, ['copilot', 'Project-A', '--', '--host-ahp'], '', /Remote connection/],
    ['sync override', {}, ['copilot', 'Project-A', '--', '--sync-session=on'], '', /Session sync/],
    ['bare sync override', {}, ['copilot', 'Project-A', '--', '--sync-session'], '', /Session sync/],
    ['invalid JSON schema', { inventory: () => ({ sandboxes: [] }) },
        ['opencode', 'Project-A'], '', /Unexpected/],
    ['invalid workspace type', {
        inventory: () => [{ name: 'bad', agent: 'opencode', workspaces: [{}] }],
    }, ['opencode', 'bad'], '', /Unexpected/],
    ['inventory error', { env: { FAIL_COMMAND: 'ls' } }, ['opencode', 'Project-A'], '', /mock sbx failure/],
    ['MCP error', { env: { FAIL_MCP: 'exa' } }, ['opencode', 'Project-A'], '', /mock sbx failure/],
    ['creation error', { inventory: () => [], env: { FAIL_COMMAND: 'create' } },
        ['copilot', 'Project A'], '', /mock sbx failure/],
    ['upgrade error', { env: { FAIL_UPGRADE: '1' } }, ['opencode', 'Project-A'], '', /launch aborted/],
    ['migration stays on V1', { env: { STUCK_V1: '1' } }, ['opencode', 'Project-A'], '', /did not install V2/],
    ['unparseable version', { version: 'unknown' }, ['opencode', 'Project-A'], '', /Cannot parse/],
]) {
    test(`fails safely: ${title}`, t => {
        const f = fixture(t, options);
        const result = f.run(args, input);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, message);
        assert.ok(!f.calls().some(c => c[0] === 'run'));
    });
}

test('no arguments prints usage and fails', t => {
    const f = fixture(t);
    const result = f.run([]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Usage: sbxw ls/);
});

for (const args of [['--help'], ['-h'], ['opencode', '--help'], ['ls', '--help']]) {
    test(`help is complete: ${args.join(' ')}`, t => {
        const f = fixture(t);
        const result = f.run(args);
        assert.equal(result.status, 0, result.stderr);
        for (const word of ['ls', 'opencode', 'copilot', '--no-folder', '--', '--resume', '--continue', 'SBX_XCODE_MCP']) {
            assert.match(result.stdout, new RegExp(word.replace(/[-]/g, '\\$&')));
        }
    });
}

test('ls without a terminal prints the sandbox list and launches nothing', t => {
    const f = fixture(t, {
        inventory: () => [
            { name: 'alpha', agent: 'opencode', workspaces: ['/one'] },
            { name: 'beta', agent: 'copilot' },
        ],
    });
    const result = f.run(['ls']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /alpha\s+opencode\s+\/one/);
    assert.match(result.stdout, /beta\s+copilot\s+\(no folder\)/);
    assert.ok(!f.calls().some(c => ['run', 'create', 'exec'].includes(c[0])));
});

test('ls with no sandboxes says how to create one', t => {
    const f = fixture(t, { inventory: () => [] });
    const result = f.run(['ls']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /No sandboxes yet/);
});

test('agent exit status propagates', t => {
    const f = fixture(t, { env: { AGENT_STATUS: '23' } });
    assert.equal(f.run(['opencode', 'Project-A']).status, 23);
});

test('custom MCP registration names', t => {
    const f = fixture(t, { env: { SBX_XCODE_MCP: 'my-xcode', SBX_EXA_MCP: 'my-exa' } });
    assert.equal(f.run(['opencode', 'Project-A']).status, 0);
    assert.equal(f.calls()[1][2], 'my-xcode');
    assert.equal(f.calls()[2][2], 'my-exa');
});

test('installer produces one executable sbxw and removes the old commands', t => {
    const f = fixture(t, {
        inventory: w => [{ name: 'oc', agent: 'opencode', workspaces: [w] }],
    });
    const destination = path.join(f.dir, 'Installed Commands');
    fs.mkdirSync(destination);
    fs.writeFileSync(path.join(destination, 'sbx-opencode'), 'old');
    fs.writeFileSync(path.join(destination, 'sbx-copilot'), 'old');
    const installed = spawnSync('/bin/bash', [path.join(root, 'install.sh'), destination], {
        encoding: 'utf8', env: f.env,
    });
    assert.equal(installed.status, 0, installed.stderr);
    assert.ok(!fs.existsSync(path.join(destination, 'sbx-opencode')));
    assert.ok(!fs.existsSync(path.join(destination, 'sbx-copilot')));
    const result = spawnSync(path.join(destination, 'sbxw'), ['opencode', 'oc'], {
        cwd: f.workspace, env: f.env, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
});

for (const custom of [false, true]) {
    test(`uninstaller removes only sbxw and old commands (${custom ? 'custom' : 'default'} directory)`, t => {
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
            assert.ok(!fs.existsSync(path.join(destination, 'sbxw')));
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
    const protectedDirectory = path.join(destination, 'sbxw');
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

function openCodeConfigArg(run) {
    return run.find(arg => arg.startsWith('OPENCODE_CONFIG_CONTENT='));
}

test('settings file customizes OpenCode model, providers, and MCP servers', t => {
    const f = fixture(t, {
        config: [
            '# personal settings',
            'SBXW_OPENCODE_MODEL="openrouter/openai/gpt-5"',
            'SBXW_OPENCODE_PROVIDERS=openrouter anthropic',
            'SBXW_MCP_SERVERS=xcode  docs',
            '',
        ].join('\n'),
    });
    const result = f.run(['opencode', 'Project-A']);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(f.calls()[1], ['mcp', 'load', 'xcode', '--sandbox', 'Project-A']);
    assert.deepEqual(f.calls()[2], ['mcp', 'load', 'docs', '--sandbox', 'Project-A']);
    const config = JSON.parse(openCodeConfigArg(f.calls().at(-1)).slice('OPENCODE_CONFIG_CONTENT='.length));
    assert.equal(config.model, 'openrouter/openai/gpt-5');
    assert.deepEqual(config.policies, [
        { action: 'provider.use', resource: '*', effect: 'deny' },
        { action: 'provider.use', resource: 'openrouter', effect: 'allow' },
        { action: 'provider.use', resource: 'anthropic', effect: 'allow' },
    ]);
});

test('environment variables override the settings file', t => {
    const f = fixture(t, {
        config: 'SBXW_OPENCODE_MODEL=openrouter/from-file\n',
        env: { SBXW_OPENCODE_MODEL: 'openrouter/from-env' },
    });
    assert.equal(f.run(['opencode', 'Project-A']).status, 0);
    const config = JSON.parse(openCodeConfigArg(f.calls().at(-1)).slice('OPENCODE_CONFIG_CONTENT='.length));
    assert.equal(config.model, 'openrouter/from-env');
});

test('settings file customizes Copilot model and tier', t => {
    const f = fixture(t, {
        inventory: w => [{ name: 'assistant', agent: 'copilot', workspaces: [w] }],
        config: 'SBXW_COPILOT_MODEL=claude-sonnet\nSBXW_COPILOT_TIER=intelligence\n',
    });
    assert.equal(f.run(['copilot', 'assistant']).status, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(f.copilotSettings, 'utf8')), {
        model: 'claude-sonnet', autoTier: 'intelligence', theme: 'keep',
    });
});

test('OpenCode update failure on V2 still launches with a warning', t => {
    const f = fixture(t, { version: 'opencode v2.1.3', env: { FAIL_UPGRADE: '1' } });
    const result = f.run(['opencode', 'Project-A']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /update failed; continuing with V2/);
    assert.ok(f.calls().some(c => c[0] === 'run'));
});

for (const [title, config, message] of [
    ['unknown setting', 'SBXW_BOGUS=1\n', /Unknown setting/],
    ['malformed line', 'hello world\n', /Invalid line/],
    ['invalid provider name', 'SBXW_OPENCODE_PROVIDERS=Bad*\n', /Invalid provider name/],
    ['invalid MCP server name', 'SBXW_MCP_SERVERS=xcode;rm\n', /Invalid MCP server name/],
    ['invalid model characters', 'SBXW_OPENCODE_MODEL=a b\n', /not allowed/],
    ['invalid Copilot tier', 'SBXW_COPILOT_TIER=fast\n', /efficiency, balance, or intelligence/],
]) {
    test(`fails safely before any sbx call: ${title}`, t => {
        const f = fixture(t, { config });
        const result = f.run(['opencode', 'Project-A']);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, message);
        assert.equal(f.calls().length, 0);
    });
}

test('an empty provider setting falls back to OpenRouter only', t => {
    const f = fixture(t, { config: 'SBXW_OPENCODE_PROVIDERS=   \n' });
    assert.equal(f.run(['opencode', 'Project-A']).status, 0);
    const config = JSON.parse(openCodeConfigArg(f.calls().at(-1)).slice('OPENCODE_CONFIG_CONTENT='.length));
    assert.deepEqual(config, openCodeConfig);
});

function folder(f, name) {
    const dirPath = path.join(f.dir, name);
    fs.mkdirSync(dirPath, { recursive: true });
    return fs.realpathSync(dirPath);
}

const mounts = f => f.calls().filter(c => c[0] === 'mount');
const umounts = f => f.calls().filter(c => c[0] === 'umount');

test('attach adds a read-write folder to a running sandbox and records it', t => {
    const f = fixture(t);
    const extra = folder(f, 'extra');
    const result = f.run(['attach', 'Project-A', extra]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(mounts(f), [['mount', 'Project-A', extra]]);
    assert.deepEqual(f.record().attachments, [{ path: extra, mode: 'rw', lifetime: 'always' }]);
});

test('attach --ro mounts read-only', t => {
    const f = fixture(t);
    const extra = folder(f, 'extra');
    assert.equal(f.run(['attach', 'Project-A', extra, '--ro']).status, 0);
    assert.deepEqual(mounts(f), [['mount', 'Project-A', `${extra}:${extra}:ro`]]);
    assert.equal(f.record().attachments[0].mode, 'ro');
});

test('attach of an already attached folder does not mount it again', t => {
    const f = fixture(t);
    const extra = folder(f, 'extra');
    assert.equal(f.run(['attach', 'Project-A', extra]).status, 0);
    const again = f.run(['attach', 'Project-A', extra]);
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stderr, /already attached/);
    assert.equal(mounts(f).length, 1);
});

test('attach of the primary folder mounts nothing', t => {
    const f = fixture(t);
    const result = f.run(['attach', 'Project-A', f.workspace]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /primary folder/);
    assert.equal(mounts(f).length, 0);
});

test('attach rejects --once, which belongs to launches', t => {
    const f = fixture(t);
    const result = f.run(['attach', 'Project-A', folder(f, 'extra'), '--once']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--once applies only/);
    assert.equal(f.calls().length, 0);
});

test('attach fails for an unknown sandbox and for a missing folder', t => {
    const f = fixture(t);
    const unknown = f.run(['attach', 'nope', folder(f, 'extra')]);
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /No sandbox named 'nope'/);
    const missing = f.run(['attach', 'Project-A', path.join(f.dir, 'missing')]);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /Not a folder/);
    assert.equal(mounts(f).length, 0);
});

test('a failed mount is reported and nothing is recorded', t => {
    const f = fixture(t, { env: { FAIL_COMMAND: 'mount' } });
    const result = f.run(['attach', 'Project-A', folder(f, 'extra')]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Could not attach/);
    assert.equal(f.record(), null);
});

test('detach removes a mount and its record entry', t => {
    const f = fixture(t);
    const extra = folder(f, 'extra');
    assert.equal(f.run(['attach', 'Project-A', extra]).status, 0);
    const result = f.run(['detach', 'Project-A', extra]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(umounts(f), [['umount', 'Project-A', extra]]);
    assert.deepEqual(f.record().attachments, []);
});

test('detach of a folder that is not attached fails', t => {
    const f = fixture(t);
    const result = f.run(['detach', 'Project-A', folder(f, 'extra')]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /is not attached/);
    assert.equal(umounts(f).length, 0);
});

test('detach refuses the primary folder', t => {
    const f = fixture(t);
    const result = f.run(['detach', 'Project-A', f.workspace]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /primary folder/);
});

test('a failed unmount keeps the record entry', t => {
    const f = fixture(t, { env: { FAIL_COMMAND: 'umount' } });
    const folderPath = folder(f, 'extra');
    f.seedRecord({ version: 1, attachments: [{ path: folderPath, mode: 'rw', lifetime: 'always' }] });
    const result = f.run(['detach', 'Project-A', folderPath]);
    assert.notEqual(result.status, 0);
    assert.equal(f.record().attachments.length, 1);
});

test('folders lists the primary folder and attached folders', t => {
    const f = fixture(t);
    const extra = folder(f, 'extra');
    f.seedRecord({
        version: 1,
        attachments: [{ path: extra, mode: 'ro', lifetime: 'always' }],
    });
    const result = f.run(['folders', 'Project-A']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`${f.workspace}\\s+rw\\s+primary`));
    assert.match(result.stdout, new RegExp(`${extra}\\s+ro\\s+always`));
});

test('folders reports an invalid record', t => {
    const f = fixture(t);
    f.seedRecord({ version: 2 });
    const result = f.run(['folders', 'Project-A']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not valid/);
});

test('launch attaches --attach folders before the agent starts, and records them', t => {
    const f = fixture(t, { version: 'opencode v2.1.3' });
    const extra = folder(f, 'extra');
    const result = f.run(['opencode', 'Project-A', '--attach', extra]);
    assert.equal(result.status, 0, result.stderr);
    const order = f.calls().map(c => c[0]);
    assert.ok(order.indexOf('mount') < order.indexOf('run'));
    assert.deepEqual(mounts(f), [['mount', 'Project-A', extra]]);
    assert.deepEqual(f.record().attachments, [{ path: extra, mode: 'rw', lifetime: 'always' }]);
});

test('launch --attach --ro --once detaches the folder when the agent exits', t => {
    const f = fixture(t, { version: 'opencode v2.1.3' });
    const extra = folder(f, 'extra');
    const result = f.run(['opencode', 'Project-A', '--attach', extra, '--ro', '--once']);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(mounts(f), [['mount', 'Project-A', `${extra}:${extra}:ro`]]);
    const order = f.calls().map(c => c[0]);
    assert.ok(order.indexOf('run') < order.lastIndexOf('umount'));
    assert.deepEqual(umounts(f), [['umount', 'Project-A', extra]]);
    assert.deepEqual(f.record().attachments, []);
});

test('a once folder is detached even when the agent exits with an error', t => {
    const f = fixture(t, { version: 'opencode v2.1.3', env: { AGENT_STATUS: '5' } });
    const extra = folder(f, 'extra');
    const result = f.run(['opencode', 'Project-A', '--attach', extra, '--once']);
    assert.equal(result.status, 5, result.stderr);
    assert.equal(umounts(f).length, 1);
    assert.deepEqual(f.record().attachments, []);
});

test('a once folder left over from an earlier session is detached at the next launch', t => {
    const f = fixture(t, { version: 'opencode v2.1.3' });
    const stale = folder(f, 'stale');
    f.seedRecord({ version: 1, attachments: [{ path: stale, mode: 'rw', lifetime: 'once' }] });
    const result = f.run(['opencode', 'Project-A']);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(umounts(f), [['umount', 'Project-A', stale]]);
    assert.deepEqual(f.record().attachments, []);
    const order = f.calls().map(c => c[0]);
    assert.ok(order.indexOf('umount') < order.indexOf('run'));
});

test('always folders are kept across launches', t => {
    const f = fixture(t, { version: 'opencode v2.1.3' });
    const kept = folder(f, 'kept');
    f.seedRecord({ version: 1, attachments: [{ path: kept, mode: 'rw', lifetime: 'always' }] });
    assert.equal(f.run(['opencode', 'Project-A']).status, 0);
    assert.equal(umounts(f).length, 0);
    assert.deepEqual(f.record().attachments, [{ path: kept, mode: 'rw', lifetime: 'always' }]);
});

test('a stale once folder that cannot be detached stops the launch', t => {
    const f = fixture(t, { version: 'opencode v2.1.3', env: { FAIL_COMMAND: 'umount' } });
    const stale = folder(f, 'stale');
    f.seedRecord({ version: 1, attachments: [{ path: stale, mode: 'rw', lifetime: 'once' }] });
    const result = f.run(['opencode', 'Project-A']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Could not detach/);
    assert.ok(!f.calls().some(c => c[0] === 'run'));
});

test('a failed mount at launch aborts before the agent starts', t => {
    const f = fixture(t, { version: 'opencode v2.1.3', env: { FAIL_COMMAND: 'mount' } });
    const result = f.run(['opencode', 'Project-A', '--attach', folder(f, 'extra')]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Could not attach/);
    assert.ok(!f.calls().some(c => c[0] === 'run'));
});

test('a folder already attached at launch is not mounted again', t => {
    const f = fixture(t, { version: 'opencode v2.1.3' });
    const extra = folder(f, 'extra');
    f.seedRecord({ version: 1, attachments: [{ path: extra, mode: 'rw', lifetime: 'always' }] });
    const result = f.run(['opencode', 'Project-A', '--attach', extra]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(mounts(f).length, 0);
});

test('the folder record is written as root', t => {
    const f = fixture(t, { version: 'opencode v2.1.3' });
    assert.equal(f.run(['attach', 'Project-A', folder(f, 'extra')]).status, 0);
    assert.ok(f.calls().some(c => c[0] === 'exec' && c[1] === '-u' && c[2] === 'root' && c[3] === 'Project-A'));
});

test('an invalid record in the sandbox stops the launch', t => {
    const f = fixture(t, { version: 'opencode v2.1.3' });
    f.seedRecord({ version: 1, attachments: 'nope' });
    const result = f.run(['opencode', 'Project-A']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not valid/);
    assert.ok(!f.calls().some(c => c[0] === 'run'));
});

for (const [title, args, message] of [
    ['--ro without --attach', ['opencode', 'Project-A', '--ro'], /apply to folders given with --attach/],
    ['--once without --attach', ['opencode', 'Project-A', '--once'], /apply to folders given with --attach/],
    ['--attach without a path', ['opencode', 'Project-A', '--attach'], /needs a folder path/],
    ['--attach with a colon', ['opencode', 'Project-A', '--attach', 'a:b'], /cannot contain ':'/],
    ['--attach for a missing folder', ['opencode', 'Project-A', '--attach', '/no/such/folder'], /Not a folder/],
    ['--attach on ls', ['ls', '--attach', '/tmp'], /ls takes no arguments/],
    ['attach without a path', ['attach', 'Project-A'], /at least one folder path/],
    ['detach without a name', ['detach'], /Usage: sbxw detach/],
    ['folders with two names', ['folders', 'A', 'B'], /takes one sandbox name/],
    ['agent arguments for attach', ['attach', 'Project-A', '/tmp', '--', 'x'], /Agent arguments apply only/],
]) {
    test(`fails safely before any sbx call: ${title}`, t => {
        const f = fixture(t);
        const result = f.run(args);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, message);
        assert.equal(f.calls().length, 0);
    });
}

test('help describes attach, detach, folders, and the launch options', t => {
    const f = fixture(t);
    const result = f.run(['--help']);
    assert.equal(result.status, 0, result.stderr);
    for (const word of ['attach', 'detach', 'folders', '--attach', '--ro', '--once', '/etc/sbxw/attachments.json']) {
        assert.ok(result.stdout.includes(word), `help should mention ${word}`);
    }
});
