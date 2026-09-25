/** Shared test helpers: temp dirs, a fake tmux runner, and polling. */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createTmux } from "../src/tmux.js";
import { createUi } from "../src/ui.js";

export const STOCK_FORMAT =
  "#{?pane_in_mode,[tmux],#{pane_current_command}}#{?pane_dead,[dead],}";

export async function makeTempDir(prefix = "pi-behind-byobu-test-") {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function ok(stdout = "") {
  return { code: 0, stdout, stderr: "", missing: false };
}

function err(stderr) {
  return { code: 1, stdout: "", stderr, missing: false };
}

/**
 * In-memory tmux stand-in. Records every argv it is asked to run so tests can
 * assert the exact command sequence.
 *
 * @param {{options?: Record<string, string>, panes?: object[], version?: string, running?: boolean}} [config]
 */
export function createFakeTmux({
  options = {},
  panes = [],
  version = "tmux 3.6b",
  running = true,
} = {}) {
  const calls = [];
  const state = { ...options };

  const run = async (args) => {
    calls.push(args);
    const command = args[0];

    if (command === "-V") return version === null ? err("nope") : ok(`${version}\n`);
    if (command === "list-sessions") return running ? ok("it\n") : err("no server running");

    if (command === "show-options") {
      const name = args[args.length - 1];
      return state[name] === undefined ? err(`unknown option: ${name}`) : ok(`${state[name]}\n`);
    }

    if (command === "set-option") {
      const name = args[args.length - 2];
      state[name] = args[args.length - 1];
      return ok();
    }

    if (command === "rename-window") return ok();

    if (command === "list-panes") {
      const lines = panes.map((pane) =>
        [
          pane.paneId,
          pane.active ?? "1",
          pane.inMode ?? "0",
          pane.windowId ?? pane.paneId,
          pane.title,
        ].join("|"),
      );
      return ok(lines.length === 0 ? "" : `${lines.join("\n")}\n`);
    }

    if (command === "list-windows") {
      const lines = panes
        .map((pane) => `${pane.windowId ?? pane.paneId}|${pane.windowName}`)
        .filter((line, index, all) => all.indexOf(line) === index);
      return ok(lines.length === 0 ? "" : `${lines.join("\n")}\n`);
    }

    return err(`unexpected tmux command: ${args.join(" ")}`);
  };

  return { run, calls, state };
}

/**
 * Build the context the command implementations expect.
 */
export function createContext({
  options = {},
  configPath,
  dir,
  env = {},
  fake = {},
  quiet = false,
} = {}) {
  const output = [];
  const fakeTmux = createFakeTmux(fake);

  return {
    output,
    calls: fakeTmux.calls,
    state: fakeTmux.state,
    ctx: {
      options: {
        config: undefined,
        tmuxSocket: undefined,
        dryRun: false,
        quiet,
        noRefresh: false,
        formatOptions: {},
        ...options,
      },
      paths: {
        configPath,
        dir: dir ?? path.dirname(configPath),
        source: "--config",
      },
      env: { ...process.env, TMUX: "/tmp/tmux-test/default,1,0", TMUX_PANE: "%1", ...env },
      tmux: createTmux({ env, run: fakeTmux.run }),
      ui: createUi({ quiet, tty: false, write: (text) => output.push(text) }),
    },
  };
}

/** @returns {Promise<void>} */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll until `predicate` returns a truthy value.
 *
 * @template T
 * @param {() => Promise<T> | T} predicate
 * @returns {Promise<T>}
 */
export async function waitFor(predicate, { timeoutMs = 10_000, intervalMs = 100, what = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await predicate();
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
}
