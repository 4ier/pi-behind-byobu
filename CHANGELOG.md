# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/4ier/pi-behind-byobu/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/4ier/pi-behind-byobu/releases/tag/v0.1.0
