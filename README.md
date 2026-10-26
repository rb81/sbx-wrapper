# sbxw

One Bash script for running OpenCode or Copilot in Docker Sandboxes.
Requires macOS Bash, `jq`, and the standalone Docker Sandboxes CLI
(`sbx` 0.48+, authenticated and running).
The `xcode` and `exa` MCP servers must already be registered with `sbx mcp add`.

## Install

```bash
bash install.sh
```

Installs `sbxw` in `~/.local/bin` and removes the old `sbx-opencode` and
`sbx-copilot` commands from that directory. Add the directory to your shell's
`PATH` if necessary. To choose a different directory:

```bash
bash install.sh /your/bin
```

No package dependencies are installed. Re-run the installer after changing
the script. You can also run without installing: `bash sbxw --help`.

## Uninstall

```bash
bash uninstall.sh
```

Removes `sbxw` (and any leftover `sbx-opencode` or `sbx-copilot`) from
`~/.local/bin`. For a custom directory, use `bash uninstall.sh /your/bin`.
Safe to run again. Leaves the directory, shell `PATH`, Docker sandboxes, MCP
registrations, and configuration unchanged.

## Commands

```bash
sbxw ls                          # pick a sandbox from a menu and open it
sbxw opencode assistant          # open or create "assistant" (OpenCode)
sbxw copilot assistant           # open or create "assistant" (Copilot)
sbxw opencode                    # prompt for a name, suggesting this folder's name
sbxw opencode scratch --no-folder  # create "scratch" with no folder attached
sbxw copilot assistant -- --resume # pass arguments to the agent after --
sbxw --help                      # full help
```

### `sbxw ls`

Lists every sandbox with its agent and attached folder. Use **Up/Down** (or
`k`/`j`) to move, **Enter** to open the highlighted sandbox, and **q** or
**Esc** to cancel. When output is not a terminal (for example, piped to a
file), it prints the list and exits without launching anything.

### `sbxw opencode NAME` and `sbxw copilot NAME`

- If a sandbox named `NAME` exists, it opens as it is. The current folder is
  ignored, and the sandbox must belong to the same agent.
- If it does not exist, it is created for the current folder, then opened.
  `--no-folder` creates it without a host folder instead.
- Names are normalized: `"Project A"` becomes `project-a`. Existing names
  match exactly first, then by normalized lowercase name. Names are unique
  across agents, and must be at least two letters or numbers. `default` is
  reserved.
- With no `NAME`, you are prompted. The suggested name is the current folder's
  name, and Enter accepts it. A name that already exists is rejected and you
  are asked again. To reopen an existing sandbox, give its name on the
  command line.
- Only one name is allowed. Arguments after `--` go to the agent unchanged.

### `--no-folder`

Creates a sandbox with no host folder (`sbx create --name NAME AGENT`). The
agent starts in the template's working directory, and files there are deleted
when the sandbox is removed. Use `sbx cp` to move files in or out. It has no
effect on a sandbox that already exists.

### Agent arguments

Everything after `--` is passed to the agent. For example, `-- --continue`
continues the last OpenCode session, and `-- --resume` resumes the last
Copilot conversation. The wrapper does not interpret these arguments.

## Launch behavior

- Every launch loads `xcode` and `exa` with `sbx mcp load`, then attaches with
  `sbx run --name`. Docker starts stopped sandboxes as needed. Errors stop the
  launch rather than skipping MCP servers or updates.
- OpenCode runs `opencode upgrade` on every launch. If still on V1, it then
  runs `opencode upgrade --major` and verifies V2 before starting the agent.
  Updating needs network access allowed by your sandbox policies.
  **V2 changes plugin and server APIs**; the wrapper does not rewrite your
  configuration or port plugins. Back up custom V1 configuration beforehand.
- OpenCode launches with `OPENCODE_DISABLE_FREE_MODELS=1` to hide its free
  models. It also receives inline V2 `provider.use` policies that deny all
  providers except `openrouter`. Anthropic and OpenAI models offered **through
  OpenRouter** remain available. Configure your OpenRouter credential with
  `sbx secret set openrouter`. These are launch-time settings, not edits to your
  config files. Higher-authority system or Console policies still take
  precedence. Use a fresh OpenCode server session for the settings to apply.
- OpenCode's default for new sessions is **Claude Haiku 5.5 via OpenRouter**
  (`openrouter/anthropic/claude-haiku-5.5`). A resumed session's existing
  model selection takes precedence.
- Before launching Copilot, the wrapper runs `copilot config --global model auto`
  and `copilot config --global autoTier balance` in the sandbox. This saves
  **Auto Balance** as the default for new conversations while preserving
  unrelated settings. Failures abort the launch. Repository settings, explicit
  agent arguments, and resumed session selections may override the defaults.
  These saved settings remain after uninstalling.
- Copilot receives `--sync-session=off` to disable read-only account history
  sync for this run. The `--remote` and `--no-remote` flags were removed in
  Copilot 1.0.103, and the wrapper rejects them. Explicit `--connect`,
  `--host-environment`, `--host-ahp`, and sync overrides are also rejected.
  Incoming connections are a separate control: use `/remote off` in a session
  and manage registered environments in `/environments`.
- No registry, background process, host credentials, or Docker settings are
  maintained by this wrapper.

Different MCP registration names:

```bash
SBX_XCODE_MCP=my-xcode SBX_EXA_MCP=my-exa sbxw opencode assistant
```

## Tests

```bash
node --test tests/wrapper.test.cjs
```

Tests use a mocked `sbx`, execute the in-sandbox update script against a fake
OpenCode binary, and exercise installation and uninstallation. The interactive
`ls` menu needs a real terminal, so it is checked manually. Node is only a test
dependency. Live Docker and MCP connectivity must be checked separately with
your local daemon.

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
