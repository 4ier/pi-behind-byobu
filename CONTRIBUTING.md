# Contributing

Thanks for taking a look. This project is small on purpose: one problem, solved
well, with the behaviour pinned down by tests.

## Development

Requirements: Node.js 20+ and tmux 3.0+ (the integration test starts its own
throwaway server, so your own sessions are never touched).

```bash
git clone https://github.com/4ier/pi-behind-byobu
cd pi-behind-byobu
npm test                 # unit + integration tests, no dependencies to install
node bin/pi-behind-byobu.js --help
```

There is no build step and no runtime dependency. `package.json` has no
`dependencies` field and that is intentional - please keep it that way.

## Trying it safely

The tool edits a tmux config file and can rename windows, so develop against a
scratch server instead of your own:

```bash
tmux -L scratch new-session -d -s scratch
node bin/pi-behind-byobu.js install --config /tmp/scratch.conf --tmux-socket scratch
tmux -L scratch kill-server
```

`--tmux-socket` exists for exactly this, and for Byobu setups that use a custom
`socketdir`.

## Layout

| Path | Purpose |
|---|---|
| `src/format.js` | Builds the `automatic-rename-format` expression and its JS mirror used when renaming running windows |
| `src/block.js` | The managed block inside the config file: insert, refresh, remove, malformed detection |
| `src/byobu.js` | Where Byobu actually keeps its config (mirrors Byobu's own resolution) |
| `src/tmux.js` | tmux CLI wrapper, injectable for tests |
| `src/commands.js` | `install`, `refresh`, `doctor`, `uninstall` |
| `src/cli.js` | Argument parsing, context wiring, exit codes |
| `test/` | `node:test` suites; `test/fixtures/` holds helpers used *inside* tmux panes |

## Guidelines

- **Verify tmux behaviour before coding around it.** Every claim in the README
  (which keys tmux forwards, when `automatic-rename-format` is re-evaluated, what
  `rename-window` does to `automatic-rename`) was checked against a real server.
  Add a note to the comment explaining *why* a workaround exists, not just what
  it does.
- **Never touch configuration you do not own.** Only the managed block is ours.
  Anything a user wrote in the same file must survive install, refresh and
  uninstall byte for byte.
- **A test for every behaviour change.** Prefer a table-driven unit test; add an
  integration assertion when the behaviour depends on tmux itself.
- **Exit codes matter.** `0` success, `1` environment/tool failure, `2` usage
  error. `doctor` returns `1` when a check fails so it can gate a script.

## Reporting bugs

Please include:

- the output of `pi-behind-byobu doctor`,
- `tmux -V` and `byobu --version`,
- your OS, and whether Byobu's config lives in `~/.byobu` or `~/.config/byobu`.

For "the window name did not change", `tmux list-windows -a -F '#{window_index} name=[#{window_name}] title=[#{pane_title}]'`
is the fastest way to show what tmux currently thinks.

## Pull requests

Keep them focused, update `CHANGELOG.md` under `## [Unreleased]`, and make sure
`npm test` passes. Explain the tmux behaviour you validated if the change depends
on it.
