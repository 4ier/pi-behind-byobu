# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Pi's `π - ` prefix is dropped by default.** Window names are now just the
  session name (`docs`, or `api - my-project`), because the window list is narrow
  and the session name is the part that says what a window is. `--strip-prefix`
  is still accepted, and `--keep-prefix` restores the old `π - docs` form.
  Existing installs are unaffected until `install` is run again: the options an
  install used are recorded in the managed block and `refresh`/`doctor` reuse
  them.

## [0.1.3] - 2026-09-25

### Changed

- Documentation: the headline example now shows both the default `π - <name>`
  form and the shorter `--strip-prefix` output, `doctor`'s sample output includes
  the options line it prints, and the README points at
  [`@fyeeme/pi-session-name`](https://www.npmjs.com/package/@fyeeme/pi-session-name)
  for sessions that name themselves as the task moves.

## [0.1.2] - 2026-09-25

### Added

- `npm run check`: one local gate (syntax, the full test suite, and a smoke test
  that packs the tarball and runs the CLI from inside it), the same command CI
  runs.
- `npm run release -- <patch|minor|major|x.y.z>`: rewrites the changelog and
  version, commits, tags, and writes the release notes. It refuses to run while
  `## [Unreleased]` is empty, so a release cannot ship without notes.
- `.github/workflows/release.yml`: a manual "Release" workflow that runs the
  same gate, cuts the tag, publishes the GitHub release, and verifies that the
  tagged revision is installable through `npx github:`.
- `.github/workflows/publish.yml`: publishes to npm on release once an
  `NPM_TOKEN` secret exists, and skips (not fails) without one.
- `RELEASING.md` and `AGENTS.md`: the release contract, written down for humans
  and agents.

## [0.1.1] - 2026-09-25

### Fixed

- `refresh` and `doctor` ignored which options `install` was run with, so a later
  `refresh` could silently undo `--strip-prefix`, and `doctor` reported a healthy
  setup as broken (a stale block plus stale window names) because it compared
  against defaults nobody asked for. `install` now records its normalized options
  in the managed block, `refresh` and `doctor` reuse them when the command line
  passes none, and `doctor` prints the options in effect.

## [0.1.0] - 2026-09-25

First release: window names follow Pi's terminal title.

### Added

- `install` writes a managed block into the tmux config file Byobu actually
  reads, applies it to the running server, and renames Pi windows that were
  already open. The config is backed up once, before the first change.
- `refresh` re-applies the rule and renames stale Pi windows.
- `doctor` reports whether the rule is installed, current and in effect. It
  distinguishes a missing block, a stale block, a server that disagrees with the
  config, stale window names, and a `~/.tmux.conf` that Byobu never reads.
- `uninstall` removes the managed block and restores tmux's stock window naming.
- Options: `--config`, `--tmux-socket`, `--title-prefix`, `--max-length`,
  `--strip-prefix`, `--dry-run`, `--no-refresh`, `--debug`, `--quiet`.
- `--debug` traces every tmux invocation and its result on stderr, which is what
  a bug report about an unfamiliar tmux build needs.
- Tests: unit tests for the format expression, the managed block, config path
  resolution, tmux output parsing and every command, plus an end-to-end test
  against a throwaway `tmux -L` server that proves a running Pi window is renamed
  and that later Pi renames keep propagating.

### Fixed

- Reading tmux's pane list no longer assumes a control character (0x1f) survives
  a `-F` round trip. tmux 3.4 (Ubuntu 24.04) escapes control characters in
  format output, returning the literal text `\037` and collapsing every record
  into one unreadable field, which made `install` report "nothing to rename" on
  an affected server. Listings now use a printable separator, keep free-text
  fields last, and fail loudly when output cannot be parsed instead of silently
  finding nothing to do.

[Unreleased]: https://github.com/4ier/pi-behind-byobu/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/4ier/pi-behind-byobu/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/4ier/pi-behind-byobu/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/4ier/pi-behind-byobu/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/4ier/pi-behind-byobu/releases/tag/v0.1.0
