# sbxw

One Bash script for running OpenCode or Copilot in Docker Sandboxes.
Requires macOS Bash, `jq`, and the standalone Docker Sandboxes CLI
(`sbx`, tested with v0.51.0, authenticated and running). The `xcode` and `exa`
MCP servers must already be registered with `sbx mcp add`.

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
sbxw opencode assistant --attach ~/docs  # also attach ~/docs for this launch
sbxw attach assistant ~/shared --ro      # attach a folder to an existing sandbox
sbxw detach assistant ~/shared           # detach it again
sbxw folders assistant                   # list the primary and attached folders
sbxw --help                      # full help
```

### `sbxw ls`

Lists every sandbox with its agent and attached folder. Use **Up/Down** (or
`k`/`j`) to move, **Enter** to open the highlighted sandbox, and **q** or
**Esc** to cancel. When output is not a terminal (for example, piped to a
file), it prints the list and exits without launching anything.

### `sbxw opencode NAME` and `sbxw copilot NAME`

- If a sandbox named `NAME` exists, it opens as it is, and the sandbox must
  belong to the same agent. If the current folder is not attached to it, you
  are asked whether to attach it: `n` (default) skips it, `o` attaches it for
  this session only, and `a` attaches it until you detach it. The prompt
  appears only in an interactive terminal.
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

### Attaching folders

Folders can be attached to a sandbox after it was created. They are mounted
with `sbx mount`, so the agent sees them at the same path as on your Mac.

- **Read-write by default.** Add `--ro` for read-only. Writes to a read-only
  folder fail inside the sandbox.
- **Always or once.** `attach` keeps a folder until you run `detach`. With
  `opencode` or `copilot`, `--attach PATH --once` keeps it only for that
  session: it is detached when the agent exits, including after an error.
- **Launch options.** `--attach PATH` (repeatable) attaches before the agent
  starts. `--ro` and `--once` apply to every `--attach` folder in the same
  command.
- **Existing folders.** Attaching a folder that is already attached does not
  change it. Detach it first to change its mode or lifetime.
- **Primary folder.** The folder a sandbox was created with cannot be attached
  again or detached. `sbxw folders NAME` shows it.
- **Stopped sandboxes.** `attach`, `detach`, and `folders` start a stopped
  sandbox first, because `sbx mount` works only on a running sandbox.
- **Record.** Attached folders are listed in `/etc/sbxw/attachments.json`
  inside the sandbox. Only root can change it, and the wrapper writes it as
  root. Removing the sandbox removes the record.
- **Leftovers.** If a `--once` folder was not detached (for example, after a
  crash), the next launch detaches it before the agent starts. Do not run two
  sessions on the same sandbox at once if one of them uses `--once`: the first
  session to exit detaches the other's folder.
- **Support.** `sbx mount` and `sbx umount` are not in Docker's public
  documentation. They were tested with `sbx` v0.50.1 on macOS. Check
  `sbx mount --help` after upgrading `sbx`.
- **Limit.** `sbxw ls` shows only the primary folder. Use `sbxw folders NAME`
  to see attached folders, because listing them requires starting the sandbox.

## Settings

Settings come from `~/.config/sbxw/config`, or from the file named by
`SBXW_CONFIG`. Environment variables override the file. Each line is
`KEY=value`. Blank lines and lines starting with `#` are ignored. Unknown keys
and malformed lines stop the launch before any sandbox is touched. An empty
value uses the default.

```bash
# ~/.config/sbxw/config
SBXW_OPENCODE_MODEL=openrouter/anthropic/claude-haiku-5.5
SBXW_OPENCODE_PROVIDERS=openrouter
SBXW_MCP_SERVERS=xcode exa
SBXW_COPILOT_MODEL=auto
SBXW_COPILOT_TIER=balance
```

| Setting | Default | Meaning |
| --- | --- | --- |
| `SBXW_OPENCODE_MODEL` | `openrouter/anthropic/claude-haiku-5.5` | Default model for new OpenCode sessions. |
| `SBXW_OPENCODE_PROVIDERS` | `openrouter` | Providers OpenCode may use, space separated. Other providers are denied. |
| `SBXW_MCP_SERVERS` | `xcode exa` | MCP servers loaded on every launch, space separated. Each must be registered with `sbx mcp add`. |
| `SBXW_COPILOT_MODEL` | `auto` | Default Copilot model. |
| `SBXW_COPILOT_TIER` | `balance` | Copilot Auto tier: `efficiency`, `balance`, or `intelligence`. |

`SBX_XCODE_MCP` and `SBX_EXA_MCP` still set the default server names when
`SBXW_MCP_SERVERS` is not set.

## Launch behavior

- Every launch loads each server in `SBXW_MCP_SERVERS` with `sbx mcp load`,
  reads the folder record and starts the sandbox if needed, detaches leftover
  `--once` folders, attaches any `--attach` folders, then starts the agent
  (`sbx run --name` for OpenCode, `sbx exec -it` for Copilot). Errors stop the
  launch rather than skipping MCP servers, updates, or folder changes.
- OpenCode runs `opencode upgrade` on every launch. If still on V1, it then
  runs `opencode upgrade --major` and verifies V2 before starting the agent.
  Updating needs network access allowed by your sandbox policies. If the
  update fails but OpenCode is already on V2, the launch continues with a
  warning, so an offline launch still works. A failed migration from V1 stops
  the launch.
  **V2 changes plugin and server APIs**; the wrapper does not rewrite your
  configuration or port plugins. Back up custom V1 configuration beforehand.
- OpenCode launches with `OPENCODE_DISABLE_FREE_MODELS=1` to hide its free
  models. It also receives inline V2 `provider.use` policies that deny all
  providers except those in `SBXW_OPENCODE_PROVIDERS` (default `openrouter`).
  Anthropic and OpenAI models offered **through OpenRouter** remain available.
  Configure your OpenRouter credential with `sbx secret set openrouter`. These
  are launch-time settings, not edits to your config files. Higher-authority system or Console policies still take
  precedence. Use a fresh OpenCode server session for the settings to apply.
- OpenCode's default for new sessions is **Claude Haiku 5.5 via OpenRouter**
  (`openrouter/anthropic/claude-haiku-5.5`). A resumed session's existing
  model selection takes precedence.
- Before launching Copilot, the wrapper runs `copilot update` in the sandbox,
  like the OpenCode upgrade. If the update fails, the launch continues with the
  installed version. The launch stops if the installed Copilot does not list
  `--sync-session`, because sync cannot be turned off without it.
- Before launching Copilot, the wrapper sets `model` and `autoTier` in the
  sandbox's `~/.copilot/settings.json` (or `$COPILOT_HOME/settings.json`) with
  `python3` inside the sandbox. This saves **Auto Balance** as the default for
  new conversations while preserving unrelated settings. A missing file is
  created. A file that cannot be parsed (for example, one with comments) aborts
  the launch and is left unchanged. Repository settings, explicit agent
  arguments, and resumed session selections may override the defaults. These
  saved settings remain after uninstalling.
- Copilot runs as `copilot --yolo --sync-session=off` through `sbx exec -it` in
  the primary folder. `--sync-session=off` disables read-only account history
  sync for this run. The sbx Copilot launcher rejects `--sync-session` when it
  is passed through `sbx run`, so `exec` is used instead. Copilot 1.0.103
  removed `--remote` and `--no-remote`, and the wrapper rejects them. Explicit
  `--connect`, `--host-environment`, `--host-ahp`, and sync overrides are also
  rejected. Incoming connections are a separate control: use `/remote off` in a
  session and manage registered environments in `/environments`.
- No registry, background process, host credentials, or Docker settings are
  maintained by this wrapper.

Different MCP registration names:

```bash
SBXW_MCP_SERVERS="my-xcode my-exa" sbxw opencode assistant
```

## Tests

```bash
node --test tests/wrapper.test.cjs
```

Tests use a mocked `sbx`, run the in-sandbox update steps against fake OpenCode
and Copilot binaries, and exercise installation and uninstallation. The interactive
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
- [Copilot configuration directory and settings](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference)
- [Haiku 5.5 on OpenRouter](https://openrouter.ai/anthropic/claude-haiku-5.5)
