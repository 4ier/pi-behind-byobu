# Agent notes

This repository is small on purpose. `CONTRIBUTING.md` covers building and
testing; this file is the part that is easy to get wrong or to forget. It applies
to humans and to coding agents equally.

## Finish the whole loop yourself

A change is not done when the diff looks right. The loop is:

```
edit -> npm run check -> commit -> push -> wait for green CI -> release if user-visible
```

Do not hand the mechanical steps back to the maintainer (pushing, tagging,
bumping versions, updating the changelog). Ask only about decisions: changing
default behaviour, touching a live session or config on someone's machine,
dropping support for something.

## Hard rules

- **Zero runtime dependencies.** `dependencies` stays absent; tests use
  `node:test`. Do not add a dependency to save a few lines.
- **Never move or re-publish a tag.** A broken release is fixed by the next
  patch (`npm run release -- patch`), never by rewriting history.
- **Never hand-edit the version or the tag.** Use `scripts/release.mjs` (or the
  Release workflow); it also refuses to release when `## [Unreleased]` is empty,
  which is deliberate.
- **Only touch configuration this project owns.** The managed block in the tmux
  config is ours; everything else in that file must survive an install, refresh
  or uninstall byte for byte.
- **Do not claim tmux behaviour without checking it.** The README, the comments
  and the tests make concrete claims about when tmux re-evaluates
  `automatic-rename-format`, what `rename-window` does to `automatic-rename`,
  which characters survive a `-F` round trip, and so on. Verify each against a
  real server (`tmux -L scratch ...`) and say which tmux version you verified.
- **Tests must never touch the developer's own sessions.** Create a throwaway
  server with `tmux -L <unique>` and pass `--tmux-socket` to the CLI.

## Release

| | |
|---|---|
| Gate | `npm run check` |
| Cut a release | `npm run release -- patch` then `git push --follow-tags`, or the **Release** workflow |
| Details | [`RELEASING.md`](RELEASING.md) |

## When adding a feature

- Configuration-only when configuration will do. Say so in the code comment when
  it will not (the roadmap explains the difference between window names, which
  are tmux configuration, and Pi's lifecycle state, which needs an extension).
- A behaviour change needs a test; something that depends on tmux itself needs an
  integration assertion too.
- Update `CHANGELOG.md` under `## [Unreleased]` in the same change. If a change
  is user-visible, the changelog entry is the release note.
- Document the *why* in a comment: the tmux quirks in this project are not
  guessable from the code.
