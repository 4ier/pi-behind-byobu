import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { USAGE, parseArgs } from "../src/cli.js";
import { UsageError } from "../src/errors.js";
import { makeTempDir } from "./helpers.js";

const BIN = fileURLToPath(new URL("../bin/pi-behind-byobu.js", import.meta.url));
const pkg = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8"));

/** Environment that can never reach the developer's real tmux server. */
const SCRUBBED_ENV = {
  ...process.env,
  TMUX: "",
  TMUX_PANE: "",
  BYOBU_CONFIG_DIR: "",
  NO_COLOR: "1",
};

function cli(args, { env = {}, cwd } = {}) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [BIN, ...args],
      { env: { ...SCRUBBED_ENV, ...env }, cwd, encoding: "utf8" },
      (error, stdout, stderr) => {
        resolve({ code: error ? Number(error.code) || 1 : 0, stdout, stderr });
      },
    );
  });
}

test("parseArgs reads defaults", () => {
  const parsed = parseArgs(["install"]);
  assert.equal(parsed.command, "install");
  assert.deepEqual(parsed.options.formatOptions, {});
  assert.equal(parsed.options.dryRun, false);
  assert.equal(parsed.options.noRefresh, false);
  assert.equal(parsed.options.quiet, false);
  assert.equal(parsed.options.config, undefined);
});

test("parseArgs accepts inline and separate values", () => {
  const parsed = parseArgs([
    "install",
    "--max-length=8",
    "--title-prefix",
    "PI",
    "--strip-prefix",
    "--dry-run",
    "--no-refresh",
    "--tmux-socket",
    "byobu",
    "--config",
    "/tmp/x/.tmux.conf",
  ]);

  assert.deepEqual(parsed.options.formatOptions, {
    maxLength: 8,
    titlePrefix: "PI",
    stripPrefix: true,
  });
  assert.equal(parsed.options.dryRun, true);
  assert.equal(parsed.options.noRefresh, true);
  assert.equal(parsed.options.tmuxSocket, "byobu");
  assert.equal(parsed.options.config, "/tmp/x/.tmux.conf");
});

test("parseArgs rejects unknown options and commands", () => {
  assert.throws(() => parseArgs(["install", "--nope"]), UsageError);
  assert.throws(() => parseArgs(["frobnicate"]), UsageError);
  assert.throws(() => parseArgs(["install", "--max-length", "abc"]), UsageError);
  assert.throws(() => parseArgs(["install", "--config"]), UsageError);
  assert.throws(() => parseArgs(["install", "extra"]), UsageError);
  assert.throws(() => parseArgs(["doctor", "--dry-run"]), UsageError);
  assert.throws(() => parseArgs(["-x"]), UsageError);
});

test("parseArgs handles --help and --version", () => {
  assert.equal(parseArgs(["--help"]).help, true);
  assert.equal(parseArgs(["-h"]).help, true);
  assert.equal(parseArgs(["--version"]).version, true);
  assert.equal(parseArgs(["-V"]).version, true);
});

test("--help exits 0 and documents every command", async () => {
  const { code, stdout } = await cli(["--help"]);
  assert.equal(code, 0);
  for (const command of ["install", "refresh", "doctor", "uninstall"]) {
    assert.ok(stdout.includes(command), `help must mention ${command}`);
  }
  assert.equal(stdout, USAGE);
});

test("--version prints the package version", async () => {
  const { code, stdout } = await cli(["--version"]);
  assert.equal(code, 0);
  assert.equal(stdout.trim(), pkg.version);
});

test("no arguments prints usage and exits 2", async () => {
  const { code, stderr } = await cli([]);
  assert.equal(code, 2);
  assert.ok(stderr.includes("pi-behind-byobu <command>"));
});

test("an unknown command exits 2", async () => {
  const { code, stderr } = await cli(["frobnicate"]);
  assert.equal(code, 2);
  assert.ok(stderr.includes('unknown command "frobnicate"'));
});

test("an unsupported flag for a command exits 2", async () => {
  const { code, stderr } = await cli(["doctor", "--dry-run"]);
  assert.equal(code, 2);
  assert.ok(stderr.includes('--dry-run is not supported by "doctor"'));
});

test("install --dry-run prints the block and writes nothing", async (t) => {
  const dir = await makeTempDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const configPath = path.join(dir, "nested", ".tmux.conf");

  const { code, stdout } = await cli(["install", "--dry-run", "--config", configPath]);
  assert.equal(code, 0);
  assert.ok(stdout.includes("# >>> pi-behind-byobu >>>"));
  assert.ok(stdout.includes("automatic-rename-format"));
  await assert.rejects(fs.readFile(configPath), { code: "ENOENT" });
});

test("install creates the config and doctor accepts it", async (t) => {
  const dir = await makeTempDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const configPath = path.join(dir, "nested", ".tmux.conf");

  const install = await cli(["install", "--config", configPath]);
  assert.equal(install.code, 0, install.stderr);
  assert.ok((await fs.readFile(configPath, "utf8")).includes("# >>> pi-behind-byobu >>>"));

  const doctor = await cli(["doctor", "--config", configPath], { env: { HOME: dir } });
  assert.equal(doctor.code, 0, doctor.stdout + doctor.stderr);

  const uninstall = await cli(["uninstall", "--config", configPath]);
  assert.equal(uninstall.code, 0, uninstall.stderr);
  assert.equal(await fs.readFile(configPath, "utf8"), "");
});
