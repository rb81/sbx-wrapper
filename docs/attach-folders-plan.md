# Plan: attach folders to an existing sandbox

Status: implemented in `sbxw` and covered by `tests/wrapper.test.cjs`. Live
`sbx` behavior was checked on a Mac with throwaway test scripts, which have
since been removed; the findings below are kept. Deviations from this plan are
listed under "Implementation notes".

## Bottom line

`sbx` has a live mount command, `sbx mount SANDBOX MOUNT_SPEC`, with a matching
`sbx umount SANDBOX HOST`. Adding and removing folders on an existing sandbox
does not need recreation. The public docs don't describe these commands, so
the behavior must be confirmed on a real Mac before implementation.

## What was checked, and how

| Source | What it showed |
| --- | --- |
| `docs.docker.com` usage and reference pages (via the docs repo source) | Folders are set at create time. Docs say existing sandboxes "retain their mounts until recreated". No page documents `sbx mount` or `sbx umount`. |
| `data/sbx_cli/sbx.yaml` in `docker/docs` (root command list) | Lists no `mount` or `umount` command. |
| `sbx-releases` GitHub release notes, v0.45.0 to v0.50.1 | Mention "dynamic mounts" restored after restart, `sbx umount` removing saved mounts from stopped sandboxes, and "mounting, unmounting, and restoring saved mounts". |
| `sbx` v0.50.1 Linux binary (downloaded to `/tmp/opencode/sbxbin/`) | Contains `mountCmd`, `umountCmd`, and the help text quoted below. |

Limits: the Linux binary is amd64, and this machine is arm64 with no emulation,
so I could not run `sbx --help`. The conclusions rest on the embedded help
text and the release notes, not on running the command.

## Findings

From the embedded help text of `sbx mount` and `sbx umount` (v0.50.1):

- **`sbx mount SANDBOX MOUNT_SPEC`** bind-mounts a host path "inside the running
  sandbox". `MOUNT_SPEC` is `HOST[:CTR_TARGET[:ro|rw]]`. `CTR_TARGET` defaults to
  the host path, and `:ro` makes it read-only. It is idempotent.
- **Saved mounts persist.** "Mounts are restored after stop/start." If a saved
  mount cannot be restored, startup fails.
- **`sbx umount SANDBOX HOST[:CTR_TARGET]`** removes a mount. For a stopped
  sandbox it removes the saved mount so it is not restored. It works even if the
  host path was deleted. It needs the same `CTR_TARGET` used at mount time.
- **Governance applies.** Mount policy is enforced before the daemon call.
- **Cloud sandboxes cannot mount host directories.** `sbx --cloud` rejects them.

From the release notes:

- v0.45.0: dynamic mounts are restored after a sandbox restart. `sbx umount`
  can remove a saved mount while the sandbox is stopped.
- v0.46.0: `sbx umount` can remove a saved mount from a stopped sandbox, even
  after the host directory was deleted.
- v0.47.0: dynamic mounts created through symlink paths can be removed without
  reappearing after a restart.

Create-time and other behavior:

- `sbx run NAME /other/path` on an existing sandbox is not a documented way to
  add a folder. The binary has the error text "Sandbox %q already exists for a
  different workspace", which suggests it is refused. This is not tested.
- `sbx kit add` recreates the container, but its help says "Workspace data is
  unaffected: bind-mounted sandboxes keep their host-side mount." This is a
  fallback path only.
- Host folders always persist. A mount never copies data, and the agent writes
  directly to the host folder.

## Mac test results (run 133507, sbx v0.50.1)

- `sbx create --name N shell PRIMARY` works and the primary folder is mounted
  read-write inside the sandbox. It survives stop and start.
- **`sbx mount` fails on a stopped sandbox.** Error: `409 Conflict: sandbox
  "N" is not running`. The `:ro` form fails the same way. The earlier
  assumption that it works while stopped is wrong.
- **`sbx run -d --name N PATH` does not attach a folder.** It treats PATH as a
  kit reference and fails with "artifact: spec.yaml (or spec.yml) is required".
- Nothing has yet tested `sbx mount` on a running sandbox, which is the next
  step.

## Mac test results, running sandbox (run 133928, sbx v0.50.1)

- **`sbx mount` works on a running sandbox.** It is visible inside the sandbox
  immediately. A default mount and a custom target (`HOST:/mnt/x`) both work.
  `:ro` blocks writes. Repeating the same mount succeeds (idempotent).
- **Persistence across stop and start works** for mounts that were still
  attached when the sandbox stopped. `extra-b` (`:ro`) and `extra-c` (custom
  target) were restored, with the same access modes.
- **`sbx umount` on a running sandbox revokes access** and the folder is gone
  from inside the sandbox. It is not restored after a restart.
  Caveat: the mount point still appeared in `/proc/self/mountinfo` after
  `umount`, until the restart. The folder itself was not accessible.
- **`sbx ls --json` `workspaces` lists only the primary folder**, even while
  extra mounts are active. The wrapper cannot rely on that field to show
  attached folders. Another source of truth is needed.
- Stopped-sandbox attach is still rejected (409), so one-time attachments must
  be done after the sandbox is running.

## Unverified (must check on a Mac)

0. Does `sbx mount` work on a running sandbox? (Required next. The stopped case
   is ruled out above.)
1. Does `sbx mount` start a stopped sandbox? (Ruled out: it returns 409 instead.)
2. Does a folder mounted with `sbx mount` survive `sbx stop` and `sbx run --name`?
3. Does `sbx ls --json` list dynamic mounts in its `workspaces` array? The
   wrapper's `ls` view and folder list depend on this.
4. Does `sbx umount` on a running sandbox take effect immediately? Does the
   agent lose access to the folder?
5. What happens to saved mounts after `sbx rm`? (Expected: gone.)
6. Are `:ro` mounts enforced (writes return EROFS)?
7. Does `sbx run NAME /other/path` on an existing sandbox refuse, or does it
   silently ignore the path? (Expected: refuse.)

Commands for the Mac check:

```bash
brew trust docker/tap && brew install docker/tap/sbx
sbx version
sbx mount --help
sbx umount --help
sbx create --name mount-test shell /tmp/mount-a
sbx mount mount-test /tmp/mount-b:/workspace/b:ro
sbx exec mount-test ls /workspace/b
sbx ls --format json
sbx stop mount-test
sbx exec mount-test ls /workspace/b   # starts the stopped sandbox first
sbx umount mount-test /tmp/mount-b
sbx rm --force mount-test
```

The commands use the `shell` agent so no login is needed. `--force` on `rm`
only affects this throwaway sandbox.

## Design (revised)

### Commands

- `sbxw attach NAME PATH [--ro] [--once]` runs `sbx mount`. Folders attach
  read-write by default; `--ro` makes them read-only.
- `sbxw detach NAME PATH` runs `sbx umount`.
- `sbxw folders NAME` lists folders with their mode (rw, ro, once).
- `sbxw opencode|copilot NAME --attach PATH [--ro] [--once]` attaches before
  launch, for an existing or newly created sandbox.

Paths resolve through `realpath` and must be directories. Attaching an
already-mounted folder is a no-op (`sbx mount` is idempotent). The primary
workspace cannot be detached, since it is fixed at creation.

### Launch-time prompt

When an existing sandbox is opened from a folder it does not have, ask:

```
Attach /path/to/folder to NAME? [n]o / [o]nce / [a]lways
```

Non-interactive runs never prompt. They use `--attach` or nothing.

### Persistence

- **Always** (default): `sbx mount` without a later `umount`. Restored on every
  start, as the release notes describe.
- **Once**: mounted before `sbx run`, unmounted after the agent exits. Host files
  are unaffected either way.

### One-time mechanics

`launch_sandbox` currently ends with `exec sbx run`, so the wrapper cannot run
cleanup after the agent exits. Change it to a normal call with a `trap` that
runs `sbx umount` for each one-time folder. Also handle interrupts and failure.

If the wrapper crashes, a one-time mount stays saved and is restored on the next
start. The next launch must detect and remove stale one-time entries. This is
the main risk of this design.

### Tracking attached folders (decided: inside the sandbox)

The wrapper records attached folders in a file inside the sandbox, not on the
host. This keeps the README's "no registry" rule. `sbx ls --json` cannot be used
for this, because it omits extra mounts.

- File: `/etc/sbxw/attachments.json`, written with
  `sbx exec -u root NAME ...`. It lists each folder's path, mode (`rw` or `ro`),
  and lifetime (`always` or `once`). The mount point is always the same as the
  host path, so no separate target is stored.
- `sbx mount` is the source of truth for what is mounted. The file records the
  intent (mode and lifetime), so `sbxw` can show it and clean up one-time
  entries after a crash.
- Each launch reads the file, compares it with `sbx` state, and removes stale
  `once` entries. Cleanup must not touch `always` entries.
- Untested: whether a file under `/etc/sbxw/` survives `sbx stop`, `sbx run`,
  and an OpenCode or Copilot upgrade. Include this in the next test script.
- Removing the sandbox removes the file. That is correct, since the mounts go
  with it.

### Default mode

Attachments are read-write by default. `--ro` mounts read-only (`:ro`).

### Output

- `sbxw ls` should show mode alongside each folder.
- Update the README "Commands" and "What persists" sections. Host folders always
  persist. Container files are lost on `sbx rm`.

### Fallbacks, if the Mac check fails

- If mounts do not survive stop/start, fall back to recreation: stop,
  `sbx template save`, `sbx rm`, `sbx create -t` with the new folder list.
  Expect slow starts and possible loss of state outside the template.
- If `sbx ls --json` does not list dynamic mounts, track attached folders in the
  sandbox (see tracking above), and show them in `sbxw ls` from that source.

## Implementation phases

1. **Phase 0, verify on a Mac.** Run the commands above. Record results in this
   file. Stop if mounts do not survive restart.
2. **Phase 1, always-on folders.** Implement `attach`, `detach`, `folders`, and
   `--attach`. Extend the test mock so `sbx mount`, `sbx umount`, and
   `workspaces` in `sbx ls --json` are modeled. Cover duplicate, missing,
   primary, and `:ro` cases.
3. **Phase 2, one-time folders.** Change `exec sbx run` to a normal call with
   cleanup. Add `--once`, the launch prompt, and stale-entry cleanup. Test
   normal exit, interrupt, and `sbx` failure.
4. **Phase 3, docs.** Update the usage text, README, and this plan.

## Risks

- `sbx mount` is not in the public docs, so it may change or be removed. Treat
  the wrapper's use of it as depending on a version range, and check
  `sbx mount --help` at startup if that is practical.
- A crash can leave a one-time mount saved. Cleanup on the next launch covers
  this, but it needs a test.
- The working tree already has uncommitted changes to `README.md`, `sbxw`, and
  `tests/wrapper.test.cjs`. Commit or stash them before starting.
- The downloaded `sbx` tarball (about 100 MB) is in `/tmp/opencode/sbxbin/`.
  It can be deleted when no longer needed.

## Mac test results, record file (run 134531, sbx v0.50.1, shell agent)

- `sbx exec -u root` can create `/etc/sbxw` and write `attachments.json`. The
  file is root-owned, mode 644.
- The default user cannot write to `/etc/sbxw` (permission denied, exit 2).
  Only the wrapper, acting as root, can change the record.
- The record is readable by the default user and survives `sbx stop` and
  `sbx exec` restart.
- The `rw` mount made while running is restored after the restart, and writes
  through it work.
- `sbx ls --json` again lists only the primary folder.
- Not tested: an OpenCode or Copilot upgrade, which needs a real agent. The
  `shell` agent was used here.

## Decisions made

1. Attachment record lives inside the sandbox at `/etc/sbxw/attachments.json`.
2. Folders attach read-write by default. `--ro` is optional.

## Decisions still open

1. Is depending on the undocumented `sbx mount` and `sbx umount` commands
   acceptable, given they may change? The Mac tests show they work in v0.50.1.

## Implementation notes

What was built, and where it differs from the design above:

- Commands: `attach`, `detach`, `folders`, and launch options `--attach`,
  `--ro`, `--once`. The launch prompt offers no, once, or always for the
  current folder when an existing sandbox is opened from a folder it does not
  have. The prompt appears only in an interactive terminal.
- `sbxw attach` does not accept `--once`. A one-time folder only makes sense
  for the session that attaches it, so `--once` is available only on launch.
- `--ro` and `--once` apply to every `--attach` folder in the same command.
- `sbxw ls` still shows only the primary folder. Showing attached folders there
  would start every sandbox to read its record. `sbxw folders NAME` shows them.
- Launches now read the record and start the sandbox before the agent starts.
  Tests that counted launch calls were updated to match.
- Concurrent sessions on one sandbox are not isolated. If one session with
  `--once` exits, it detaches that folder even if another session still uses
  it. This is documented in the README.
- The record is written with `sbx exec -u root`. Any change to the record goes
  through a temp file and `mv`.
