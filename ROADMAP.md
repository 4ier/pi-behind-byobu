# Roadmap

The goal of this repository is narrow and long-lived: **make Pi first-class
inside Byobu.** Not a plugin platform, not a tmux framework - the small set of
things that are wrong or missing when Pi runs in a Byobu window.

## Shipped

### 0.1.0 - Window names follow Pi's title

Byobu names windows after the running command, so every Pi session is `node`.
Pi already publishes `<π> - <session> - <cwd>` as the terminal title (OSC 0);
this release makes tmux use that title for Pi panes only, fixes windows that are
already open, and ships a `doctor` that can tell "not installed", "stale" and
"not in effect" apart.

## Next

### Window state, not just the name

The window list should answer "which one needs me?" without switching windows:

```text
2:⠋ π - api-refactor   3:π - docs   4:π? π - migration
  ^ working              idle         ^ waiting for input
```

This is the first feature that cannot be done with configuration alone: tmux has
no idea what Pi is doing internally. It needs a small Pi extension that follows
the agent lifecycle and writes per-pane state, which a Byobu status module and a
window-list format then render. Design constraints worth keeping:

- Pi is the source of truth; the extension must never fail a run if the status
  path is broken.
- One writer per pane, even when subagents share a pane's environment.
- No polling: the state file changes on real lifecycle events only.
- Graceful when Pi is not installed or the extension is missing (the window name
  feature must keep working).

### Attention routing

When a Pi session finishes, or blocks on a question, the window should flag it
and there should be a keybinding to jump to the pane that needs you - the Byobu
equivalent of a tab badge.

### Extended keys diagnosis in `doctor`

Pi needs `extended-keys on` with `extended-keys-format csi-u` (tmux 3.5+) for
`Shift+Enter` and `Ctrl+Enter` to stay distinguishable, and Byobu reads a
different config file than most people expect. That is the same class of problem
this tool already solves for window names, so `doctor` should check it too:
live server options, the tmux version that supports the format, whether the
setting lives in the file Byobu reads, and whether the terminal on the outside
(Kitty, Ghostty, iTerm2, WezTerm) can even report those keys.

## Explicitly out of scope

- Running Pi on Windows or WSL (no Byobu there).
- Owning the whole tmux configuration, or generating `~/.tmux.conf`.
- Forking, patching or vendoring Pi.
- A GUI. The window list is the UI.
