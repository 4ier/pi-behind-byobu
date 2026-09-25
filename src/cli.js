/** Command line entry point: argument parsing, context wiring, exit codes. */

import fs from "node:fs";

import { resolveConfigPath } from "./byobu.js";
import { doctor, install, refresh, uninstall } from "./commands.js";
import { UsageError } from "./errors.js";
import { createTmux } from "./tmux.js";
import { createUi } from "./ui.js";

const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

export const USAGE = `pi-behind-byobu <command> [options]

Byobu names tmux windows after the running command, so every Pi session shows
up as "node". Pi already publishes its session name as the terminal title
(OSC 0); this tool makes Byobu's window list use that title instead.

Commands
  install      Write the managed block into Byobu's tmux config, apply it to
               the running server, and rename Pi windows that are already open
  refresh      Re-apply the rule to the running server and rename stale windows
  doctor       Report whether the rule is installed, current and in effect
  uninstall    Remove the managed block and restore stock window naming

Options
  --config <path>        tmux config file Byobu sources (default: auto-detect)
  --tmux-socket <name>   Talk to a specific tmux socket (tmux -L <name>)
  --title-prefix <text>  Prefix Pi writes into the terminal title (default: π)
  --max-length <n>       Truncate window names to n characters, 0 disables it
                         (default: 24)
  --strip-prefix         Drop the "π - " prefix from window names
  --dry-run              Show what would change without writing anything
  --no-refresh           Do not rename windows that are already running
  --debug                Print every tmux command the tool runs (stderr)
  --quiet                Only report problems
  -h, --help             Show this help
  -V, --version          Show the version

Examples
  pi-behind-byobu install
  pi-behind-byobu install --max-length 0 --strip-prefix
  pi-behind-byobu doctor
  pi-behind-byobu uninstall
`;

const COMMANDS = { install, refresh, doctor, uninstall };

const FLAGS = {
  "config": "value",
  "tmux-socket": "value",
  "title-prefix": "value",
  "max-length": "value",
  "strip-prefix": "boolean",
  "dry-run": "boolean",
  "no-refresh": "boolean",
  "quiet": "boolean",
  "debug": "boolean",
};

const COMMAND_FLAGS = {
  install: ["config", "tmux-socket", "title-prefix", "max-length", "strip-prefix", "dry-run", "no-refresh", "debug", "quiet"],
  refresh: ["config", "tmux-socket", "title-prefix", "max-length", "strip-prefix", "debug", "quiet"],
  doctor: ["config", "tmux-socket", "title-prefix", "max-length", "strip-prefix", "debug", "quiet"],
  uninstall: ["config", "tmux-socket", "title-prefix", "max-length", "strip-prefix", "dry-run", "quiet"],
};

/**
 * @param {string[]} argv
 * @returns {{command: string, options: object, help: boolean, version: boolean}}
 */
export function parseArgs(argv) {
  const options = {
    config: undefined,
    tmuxSocket: undefined,
    dryRun: false,
    quiet: false,
    debug: false,
    noRefresh: false,
    formatOptions: {},
  };
  const seen = new Set();
  let command = null;
  let help = false;
  let version = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "-h" || arg === "--help") {
      help = true;
      continue;
    }
    if (arg === "-V" || arg === "--version") {
      version = true;
      continue;
    }

    if (arg.startsWith("--")) {
      const equals = arg.indexOf("=");
      const name = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
      const inline = equals === -1 ? null : arg.slice(equals + 1);

      const kind = FLAGS[name];
      if (!kind) throw new UsageError(`unknown option --${name}`);
      if (command !== null && !COMMAND_FLAGS[command].includes(name)) {
        throw new UsageError(`--${name} is not supported by "${command}"`);
      }

      const takeValue = () => {
        if (inline !== null) return inline;
        i += 1;
        if (i >= argv.length) throw new UsageError(`--${name} requires a value`);
        return argv[i];
      };

      switch (name) {
        case "config":
          options.config = takeValue();
          break;
        case "tmux-socket":
          options.tmuxSocket = takeValue();
          break;
        case "title-prefix":
          options.formatOptions.titlePrefix = takeValue();
          break;
        case "max-length": {
          const raw = takeValue();
          const parsed = Number(raw);
          if (!Number.isInteger(parsed) || parsed < 0) {
            throw new UsageError(`--max-length must be an integer >= 0 (got ${JSON.stringify(raw)})`);
          }
          options.formatOptions.maxLength = parsed;
          break;
        }
        case "strip-prefix":
          if (inline !== null) throw new UsageError("--strip-prefix does not take a value");
          options.formatOptions.stripPrefix = true;
          break;
        case "dry-run":
          options.dryRun = true;
          break;
        case "no-refresh":
          options.noRefresh = true;
          break;
        case "quiet":
          options.quiet = true;
          break;
        case "debug":
          options.debug = true;
          break;
        default:
          throw new UsageError(`unhandled option --${name}`);
      }
      seen.add(name);
      continue;
    }

    if (arg.startsWith("-") && arg !== "-") {
      throw new UsageError(`unknown option ${arg}`);
    }

    if (command === null) command = arg;
    else throw new UsageError(`unexpected argument "${arg}"`);
  }

  if (command !== null && !COMMANDS[command]) {
    throw new UsageError(`unknown command "${command}"`);
  }
  if (command !== null && !help) {
    const allowed = new Set(COMMAND_FLAGS[command]);
    for (const name of seen) {
      if (!allowed.has(name)) throw new UsageError(`--${name} is not supported by "${command}"`);
    }
  }

  return { command, options, help, version };
}

/**
 * Debug trace: every tmux invocation with its result, on stderr so it never
 * mixes with the machine-readable output of a command.
 *
 * @param {{args: string[], result: {code: number|null, stdout: string, stderr: string}}} entry
 */
export function traceTmux({ args, result }) {
  const lines = [`[debug] tmux ${args.join(" ")}`, `[debug]   exit ${result.code}`];
  if (result.stdout.trim() !== "") lines.push(`[debug]   stdout ${JSON.stringify(result.stdout)}`);
  if (result.stderr.trim() !== "") lines.push(`[debug]   stderr ${JSON.stringify(result.stderr)}`);
  process.stderr.write(`${lines.join("\n")}\n`);
}

/**
 * @param {string[]} argv
 * @param {{env?: NodeJS.ProcessEnv, write?: (text: string) => void}} [io]
 * @returns {Promise<number>} process exit code
 */
export async function run(argv, { env = process.env, write = (text) => process.stdout.write(text) } = {}) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n\n${USAGE}`);
      return error.exitCode;
    }
    throw error;
  }

  if (parsed.version) {
    write(`${pkg.version}\n`);
    return 0;
  }
  if (parsed.help) {
    write(USAGE);
    return 0;
  }
  if (parsed.command === null) {
    process.stderr.write(argv.length === 0 ? "" : "a command is required\n\n");
    process.stderr.write(USAGE);
    return 2;
  }

  const ui = createUi({ quiet: parsed.options.quiet, write });
  const paths = resolveConfigPath(parsed.options.config, { env });
  const tmux = createTmux({
    socket: parsed.options.tmuxSocket ?? null,
    env,
    debug: parsed.options.debug ? traceTmux : null,
  });

  try {
    return await COMMANDS[parsed.command]({
      options: parsed.options,
      paths,
      env,
      tmux,
      ui,
    });
  } catch (error) {
    ui.fail(error.message ?? String(error));
    return typeof error.exitCode === "number" ? error.exitCode : 1;
  }
}
