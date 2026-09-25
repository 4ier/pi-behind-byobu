# pi-behind-byobu

[![CI](https://github.com/4ier/pi-behind-byobu/actions/workflows/ci.yml/badge.svg)](https://github.com/4ier/pi-behind-byobu/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/4ier/pi-behind-byobu)](https://github.com/4ier/pi-behind-byobu/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

Make **[Pi](https://github.com/earendil-works/pi-coding-agent)**'s session title drive **Byobu/tmux** window names.

```text
before    1:zsh  2:node        3:node      4:node            ← which session is which?
after     1:zsh  2:π - api     3:π - docs  4:π - migration        (default)
          1:zsh  2:api         3:docs      4:migration            (--strip-prefix)
```

The name tracks Pi itself: Pi publishes the session name in its terminal title,
so naming a session — `/name`, or an extension that names sessions for you —
makes the window list say what each session is *about*, and it updates while you
work:

```bash
pi install npm:@fyeeme/pi-session-name   # auto-name sessions from the conversation
export PI_SESSION_NAME_MODE=auto          # re-evaluate the name every turn
```

## The problem

Running Pi inside Byobu, every Pi window is called `node`:

```text
4:node*     ← a Pi session, doing... something?
```

Pi already knows what it is. It publishes `<π> - <session> - <cwd>` as the terminal title (OSC 0), which is why the tab bar looks right in Kitty or iTerm2. Byobu throws that away: it renames windows after the running command, and Pi runs on Node.

## Why it happens

Worth understanding, because it explains every workaround you may have tried.

1. **Pi writes the title, not the window name.** `setTitle()` emits `ESC ] 0 ; π - my-project BEL`. In a plain terminal that *is* the title. Under tmux it only sets the **pane title** — tmux keeps window names for itself, since one window can hold many panes.
2. **tmux ignores the title for renaming by default.** Byobu leaves `allow-rename off`, so OSC 0 never becomes a window name. Turning it on does not help either: Byobu forces `automatic-rename on` with tmux's stock `automatic-rename-format` (`#{pane_current_command}`), which overwrites the app's name with `node`.
3. **The pane title is right all along.** `tmux display-message -p '#{pane_title}'` already shows `π - my-project`. It just is not used for the window list.

So the fix is not "make Pi rename the window". It is "let tmux learn the pane title for Pi panes only".

## Install

```bash
# straight from the repository
npx github:4ier/pi-behind-byobu install

# or clone and run it
git clone https://github.com/4ier/pi-behind-byobu
node pi-behind-byobu/bin/pi-behind-byobu.js install
```

Then check it:

```bash
pi-behind-byobu doctor
```

```text
pi-behind-byobu doctor
  config      ~/.config/byobu/.tmux.conf
  found via   BYOBU_CONFIG_DIR
  options     title-prefix="π" max-length=24
  this pane   %9 title=[π - pi-behind-byobu] name=[π - pi-behind-byobu]
  ok    Managed block installed and current
  ok    tmux tmux 3.6b
  ok    Running server: automatic-rename is on
  ok    Running server: rename format matches
  ok    No stale Pi window names

5 ok, 0 warning(s), 0 failure(s)
```

`install` is safe to re-run: it edits only the block it owns, backs the config up once, and never touches anything else in the file.

## Commands

| Command | What it does |
|---|---|
| `install` | Write the managed block into Byobu's tmux config, apply it to the running server, and rename Pi windows that are already open |
| `refresh` | Re-apply the rule to the running server and rename stale windows (reuses the options `install` recorded; use after tweaking options, or in a new server) |
| `doctor` | Report whether the rule is installed, current, and actually in effect; reuses the options `install` recorded; exits non-zero on failure |
| `uninstall` | Remove the managed block and restore tmux's stock window naming |

## Options

| Option | Default | Description |
|---|---|---|
| `--config <path>` | auto-detect | tmux config file Byobu sources (a directory gets `.tmux.conf` appended) |
| `--tmux-socket <name>` | current server | Talk to a specific tmux socket (`tmux -L <name>`) |
| `--title-prefix <text>` | `π` | Prefix Pi writes into the terminal title |
| `--max-length <n>` | `24` | Truncate window names to `n` characters, `0` disables truncation |
| `--strip-prefix` | off | Show `my-project` instead of `π - my-project` |
| `--dry-run` | off | Print what would change, write nothing |
| `--no-refresh` | off | Apply to the running server without renaming open windows |
| `--quiet` | off | Only report problems |

```bash
# short, un-prefixed names because the window list is narrow
pi-behind-byobu install --strip-prefix --max-length 18

# Pi installed under a custom name (piConfigName): its titles start with "PI"
pi-behind-byobu install --title-prefix PI
```

## What it changes

One block in the tmux config file Byobu reads:

```tmux
# >>> pi-behind-byobu >>>
set -g automatic-rename on
set -g automatic-rename-format '#{?#{m:*π -*,#{pane_title}},#{=24:#{pane_title}},#{?pane_in_mode,[tmux],#{pane_current_command}}#{?pane_dead,[dead],}}'
# <<< pi-behind-byobu <<<
```

Reading the format inside out:

| Part | Meaning |
|---|---|
| `#{m:*π -*,#{pane_title}}` | fnmatch test: does the pane title contain `π -`? (spinner frames from Pi extensions still match) |
| `#{=24:#{pane_title}}` | if yes, use the pane title, truncated to 24 characters |
| `#{?pane_in_mode,[tmux],#{pane_current_command}}#{?pane_dead,[dead],}` | if no, tmux's stock behaviour, unchanged |

The prefix guard is why plain shells keep their names: a shell's title is usually the hostname, so it fails the test and falls through to `zsh`, `vim`, and so on.

**Which file?** Byobu reads `$BYOBU_CONFIG_DIR/.tmux.conf`, which is `$XDG_CONFIG_HOME/byobu` by default and `~/.byobu` only if that legacy directory already exists. Byobu **never** reads `~/.tmux.conf`, so settings placed there have no effect. `doctor` warns when it finds `automatic-rename` in `~/.tmux.conf` for exactly this reason.

## Why `install` renames open windows

tmux re-evaluates `automatic-rename-format` only when a pane's title changes. A Pi session that started before the install will not publish a new title until you switch models, `/rename`, or restart it — so the window keeps the stale name.

`install` (and `refresh`) close that gap by renaming those windows directly. There is a trap here: `rename-window` sets a manual name and tmux then disables `automatic-rename` **for that window**, so future Pi renames would stop propagating. The tool therefore re-enables `automatic-rename` right after each rename, which keeps `/rename` working live.

## Requirements

- **Byobu** (tmux backend) or plain tmux 3.0+
- **Node.js 20+** to run the CLI
- macOS or Linux. Windows and WSL are not supported (no Byobu)

The format modifiers used here (fnmatch `m:`, truncation `=:`, substitution `s/`) exist since tmux 3.0. `doctor` fails loudly on anything older instead of writing a format the server cannot parse.

## Troubleshooting

**The window list still shows `node`.**
Run `pi-behind-byobu doctor`. It compares the running server against the config, so it distinguishes "the file was never written", "the file is stale", and "the server was not reloaded".

**One window stopped following my Pi session.**
That window was renamed by hand (`tmux rename-window`), which is tmux's way of opting a window out of automatic renaming. Run `pi-behind-byobu refresh` to rename it again and re-enable automatic naming.

**The names are too long.**
`--max-length 18`, or `--strip-prefix`, then `refresh`.

**I want it gone.**
`pi-behind-byobu uninstall`. Your backup is at `<config>.pi-behind-byobu.bak`.

**Other terminals / plain tmux without Byobu.**
Nothing Byobu-specific is required — point `--config` at the file your tmux reads (`~/.tmux.conf` for stock tmux) and the same rule applies. `doctor` simply reports Byobu as "not detected" and carries on.

## Design notes

- **Zero dependencies**, no build step; the source is the artifact.
- **Config-only by design.** No Pi extension, no patched Pi, nothing to keep in sync when Pi updates. The tool relies on the title Pi has published since forever.
- **Everything is verified against a real tmux server.** Besides unit tests, `test/integration.tmux.test.js` starts a throwaway `tmux -L` server, runs a fake Pi that publishes a title, and asserts the window name changes — twice, to prove that later renames still propagate.
- **Idempotent.** A managed block, one backup, and a hash-free "is it current?" comparison (`doctor` warns when the block differs from what the current version would write).

## Roadmap

See [ROADMAP.md](ROADMAP.md). Short version: the window-name problem is the first one; showing *what each Pi session is doing* (working / waiting for input / done) in the Byobu window list is next.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports about a specific Byobu/tmux combination are especially welcome — include the output of `pi-behind-byobu doctor`.

## License

[MIT](LICENSE)
