# Security Policy

## Scope

`pi-behind-byobu` edits one tmux configuration file and runs `tmux` commands.
It does not handle credentials or network input. Relevant classes of issue:

- writing outside the intended config file, or destroying unrelated content
- a malicious `--title-prefix` (or other option) escaping the tmux format or the
  config file's quoting
- running unintended commands, for example through a `tmux` binary picked up
  from `PATH` in an unexpected location

Malformed blocks in the config file are refused with an error rather than
partially rewritten; please report any case where content outside the managed
block is modified.

## Supported versions

The latest release on the default branch. This is a small tool; fixes land on
`main` and are released as a patch version.

## Reporting

Open a [private security advisory](https://github.com/4ier/pi-behind-byobu/security/advisories/new)
or email the maintainer. Please include a reproduction: the command you ran, the
config file before and after, and the tmux/Byobu versions.
