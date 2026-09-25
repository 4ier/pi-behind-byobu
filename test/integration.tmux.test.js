/**
 * End-to-end test against a throwaway tmux server (`tmux -L <socket>`), so it
 * never touches the developer's own sessions.
 *
 * It reproduces the reported problem exactly: a Pi process publishes its
 * session name as the terminal title, while Byobu's stock rule names the window
 * after the running command. Then it proves the fix, including that later Pi
 * renames keep propagating.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { STOCK_FORMAT, waitFor } from "./helpers.js";

const BIN = fileURLToPath(new URL("../bin/pi-behind-byobu.js", import.meta.url));
const FIXTURE = fileURLToPath(new URL("./fixtures/emit-title.js", import.meta.url));
const SOCKET = `pi-behind-byobu-it-${process.pid}`;
const PI_TITLE = "π - integration-session";
const RENAMED_TITLE = "π - renamed-session";

function run(bin, args, options = {}) {
  return new Promise((resolve) => {
    execFile(bin, args, { encoding: "utf8", ...options }, (error, stdout, stderr) => {
      resolve({
        code: error ? Number(error.code) || 1 : 0,
        stdout: stdout ?? "",
        stderr: stderr ?? "",
      });
    });
  });
}

const tmux = (args, options) => run("tmux", ["-L", SOCKET, ...args], options);

async function tmuxIsAvailable() {
  return (await run("tmux", ["-V"])).code === 0;
}

const hasTmux = await tmuxIsAvailable();

test(
  "Pi windows are named after the session title, end to end",
  { skip: hasTmux ? false : "tmux is not installed" },
  async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-behind-byobu-it-"));
    const configPath = path.join(dir, ".tmux.conf");

    t.after(async () => {
      await tmux(["kill-server"]);
      await fs.rm(dir, { recursive: true, force: true });
    });

    const display = async (format) =>
      (await tmux(["display-message", "-p", "-t", "it:1", format])).stdout.trim();

    // A Byobu-shaped server: automatic-rename on, tmux's stock format.
    assert.equal((await tmux(["new-session", "-d", "-s", "it", "-x", "140", "-y", "40"])).code, 0);
    await tmux(["set-option", "-g", "automatic-rename", "on"]);
    await tmux(["set-option", "-g", "automatic-rename-format", STOCK_FORMAT]);
    await tmux(["new-window", "-t", "it:1", `${process.execPath} ${FIXTURE} '${PI_TITLE}'`]);

    await waitFor(async () => (await display("#{pane_title}")) === PI_TITLE, {
      what: "the fixture to publish its Pi title",
    });
    assert.notEqual(
      await display("#{window_name}"),
      PI_TITLE,
      "precondition: the window is named after the process, not the Pi session",
    );

    // Install against this socket only.
    const installed = await run(process.execPath, [
      BIN,
      "install",
      "--config",
      configPath,
      "--tmux-socket",
      SOCKET,
    ], { env: { ...process.env, TMUX: "", TMUX_PANE: "", NO_COLOR: "1" } });

    assert.equal(installed.code, 0, `${installed.stdout}\n${installed.stderr}`);
    const renamed = /Renamed (\d+) running window\(s\)/.exec(installed.stdout);
    assert.ok(
      renamed && renamed[1] === "1",
      [
        "install reported no rename of the already-running Pi window",
        `stdout: ${JSON.stringify(installed.stdout)}`,
        `stderr: ${JSON.stringify(installed.stderr)}`,
        `window_name: ${JSON.stringify(await display("#{window_name}"))}`,
        `pane_title:  ${JSON.stringify(await display("#{pane_title}"))}`,
        `command:     ${JSON.stringify(await display("#{pane_current_command}"))}`,
        `in_mode:     ${JSON.stringify(await display("#{pane_in_mode}"))}`,
        `active:      ${JSON.stringify(await display("#{pane_active}"))}`,
      ].join("\n"),
    );
    assert.ok((await fs.readFile(configPath, "utf8")).includes("set -g automatic-rename-format"));

    await waitFor(async () => (await display("#{window_name}")) === PI_TITLE, {
      what: "the already-running window to be renamed",
    });

    // Pi's /rename publishes a new title; the window name must follow.
    await tmux(["send-keys", "-t", "it:1", RENAMED_TITLE, "Enter"]);
    await waitFor(async () => (await display("#{window_name}")) === RENAMED_TITLE, {
      what: "a later title change to propagate",
    });

    // Renaming must not have opted the window out of automatic-rename.
    const option = await tmux(["show-options", "-wqv", "-t", "it:1", "automatic-rename"]);
    assert.equal(option.stdout.trim(), "on");

    // doctor agrees, and exits 0.
    const doctor = await run(process.execPath, [
      BIN,
      "doctor",
      "--config",
      configPath,
      "--tmux-socket",
      SOCKET,
    ], { env: { ...process.env, TMUX: "", TMUX_PANE: "", HOME: dir, NO_COLOR: "1" } });

    assert.equal(doctor.code, 0, doctor.stdout);
    assert.ok(doctor.stdout.includes("rename format matches"));
    assert.ok(doctor.stdout.includes("0 failure(s)"));
  },
);

test(
  "uninstall restores tmux's stock naming",
  { skip: hasTmux ? false : "tmux is not installed" },
  async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-behind-byobu-it-"));
    const configPath = path.join(dir, ".tmux.conf");
    const env = { ...process.env, TMUX: "", TMUX_PANE: "", NO_COLOR: "1" };

    t.after(async () => {
      await tmux(["kill-server"]);
      await fs.rm(dir, { recursive: true, force: true });
    });

    await tmux(["new-session", "-d", "-s", "it", "-x", "140", "-y", "40"]);

    const installed = await run(process.execPath, [BIN, "install", "--config", configPath, "--tmux-socket", SOCKET], { env });
    assert.equal(installed.code, 0, installed.stderr);

    const removed = await run(process.execPath, [BIN, "uninstall", "--config", configPath, "--tmux-socket", SOCKET], { env });
    assert.equal(removed.code, 0, removed.stderr);
    assert.equal(await fs.readFile(configPath, "utf8"), "");

    const format = await tmux(["show-options", "-gqv", "automatic-rename-format"]);
    assert.equal(format.stdout.trim(), STOCK_FORMAT);
  },
);
