# sbx-wrapper

Two commands, one Bash script. Requires macOS Bash, `jq`, and the standalone
Docker Sandboxes CLI (`sbx` 0.48+, authenticated and running).
The `xcode` and `exa` MCP servers must already be registered with `sbx mcp add`.

## Install

```bash
bash install.sh
```

Installs both commands in `~/.local/bin`. Add that directory to your shell's
`PATH` if necessary. To choose a different directory:

```bash
bash install.sh /your/bin
```

No package dependencies are installed. Re-run the installer after changing
the script. You can also run without installing:
`bash sbx-wrapper opencode` or `bash sbx-wrapper copilot`.

## Uninstall

```bash
bash uninstall.sh
```

Removes only `sbx-opencode` and `sbx-copilot` from `~/.local/bin`.
For a custom installation directory, use `bash uninstall.sh /your/bin`.
Safe to run again if the commands are already absent. Leaves the directory,
shell `PATH`, Docker sandboxes, MCP registrations, and configuration unchanged.

## Use

```bash
cd /path/to/project
sbx-opencode                # reuse this folder's OpenCode sandbox, or prompt/create
sbx-copilot                 # same, for Copilot

sbx-opencode "Project A"     # open existing project-a from any folder
sbx-copilot Assistant       # existing names/capitalization are preserved
sbx-opencode -- --continue  # pass arguments to the agent, not sbx
sbx-copilot Assistant -- --resume
```

- Folder lookup uses the physical current directory and the agent type against
  `sbx ls --json`'s `workspaces` array. It does not search parent folders.
  OpenCode and Copilot can have separate sandboxes for the same folder.
- If none exists, enter a name at the prompt. `"Project A"` becomes `project-a`;
  Docker names cannot contain spaces. Names are globally unique across agents.
  Existing names are matched exactly first, then by normalized lowercase name.
- An explicitly supplied name must already exist: a typo never creates a
  sandbox bound to an unrelated current directory. Ambiguous matches and
  wrong-agent matches fail with an explanation.
- Every launch loads `xcode` and `exa` with `sbx mcp load`, then attaches using
  `sbx run --name`. Docker starts stopped sandboxes as needed.
- OpenCode runs `opencode upgrade` every launch. If still on V1, it then runs
  `opencode upgrade --major` and verifies V2+ before starting the agent.
  Updating requires network access allowed by your sandbox policies.
  **V2 changes plugin and server APIs**; the wrapper does not rewrite your
  configuration or port plugins. Back up custom V1 configuration beforehand.
- OpenCode launches with `OPENCODE_DISABLE_FREE_MODELS=1` to hide OpenCode's
  free models. It also receives inline V2 `provider.use` policies that deny
  all providers, then allow only `openrouter`. Direct Anthropic, OpenAI,
  Copilot, and OpenCode providers disappear from the model selector even if
  credentials are available. Anthropic/OpenAI models offered **through
  OpenRouter** remain available, including OpenRouter's own free models.
  Configure your OpenRouter credential with `sbx secret set openrouter`.
  These are launch-time settings, not edits to your config files; unrelated
  settings such as MCP configuration remain intact. Higher-authority system
  or Console policies still take precedence. Use a fresh OpenCode server
  session for the launch settings to take effect, not an already-running
  server started with different settings.
- OpenCode's default for new sessions is **Claude Haiku 5.5 via OpenRouter**
  (`openrouter/anthropic/claude-haiku-5.5`), included in the inline config.
  A resumed session's existing model selection takes precedence.
- Before launching Copilot, the wrapper runs `copilot config --global model auto`
  and `copilot config --global autoTier balance` inside the sandbox.
  This saves **Auto Balance** as the default for new conversations while
  preserving unrelated settings. Requires a Copilot version supporting these
  configuration commands; failures abort the launch. Repository settings,
  explicit agent arguments, and resumed session selections may override defaults.
  These saved sandbox settings remain after uninstalling the host wrappers.
- Copilot receives `--sync-session=off` to disable read-only account history
  sync for this run. The old `--remote` and `--no-remote` flags were removed
  in Copilot 1.0.103; the wrapper rejects them with an explanation.
  Explicit `--connect`, `--host-environment`, and `--host-ahp` options and
  sync overrides are also rejected. Incoming connections are a separate
  control: use `/remote off` in a session and manage registered incoming
  environments in `/environments`. The wrapper does not unregister existing
  environments or guarantee that incoming access is disabled.
  Requires a Copilot version supporting `--sync-session=off`.
- Errors stop the launch instead of silently skipping MCPs or updates.
  A sandbox created before a setup failure remains available for retry.
- No registry, background process, host credentials, or Docker settings are
  maintained by this wrapper.

Different MCP registration names:

```bash
SBX_XCODE_MCP=my-xcode SBX_EXA_MCP=my-exa sbx-opencode
```

## Tests

```bash
node --test tests/wrapper.test.cjs
```

Tests use a mocked `sbx`, execute the actual in-sandbox update script against
a fake OpenCode binary, and exercise installation and uninstallation.
Node is only a test dependency.
Live Docker/MCP connectivity must be checked separately with your local daemon.

## References

- [Docker Sandbox usage and named reattachment](https://docs.docker.com/ai/sandboxes/usage/)
- [Docker structured output (0.48+)](https://docs.docker.com/ai/sandboxes/workflows/automation/)
- [Docker MCP support](https://docs.docker.com/ai/sandboxes/mcp/)
- [OpenCode upgrade and --major](https://dev.opencode.ai/docs/cli/#upgrade)
- [OpenCode V2 migration considerations](https://opencode.ai/v2/docs/migrate-v1)
- [OpenCode free-model environment switch](https://opencode.ai/v2/docs/models#free-models)
- [OpenCode V2 provider policies](https://opencode.ai/v2/docs/policies)
- [Copilot remote flag removal (1.0.103)](https://github.com/github/copilot-cli/blob/main/changelog.md)
- [Copilot configuration commands](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#using-copilot-config)
- [Copilot Auto tier settings](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference)
- [Haiku 5.5 on OpenRouter](https://openrouter.ai/anthropic/claude-haiku-5.5)
