import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { BLOCK_BEGIN, readBlock, renderBlock } from "../src/block.js";
import { doctor, findStaleWindows, install, refresh, uninstall } from "../src/commands.js";
import { ToolError } from "../src/errors.js";
import { buildAutomaticRenameFormat } from "../src/format.js";
import { createContext, makeTempDir, STOCK_FORMAT } from "./helpers.js";

const USER_CONFIG = `# my byobu tweaks
set -g status-interval 1
`;

const PI_PANE = {
  paneId: "%1",
  title: "π - pi-behind-byobu",
  windowId: "@1",
  windowName: "node",
};

async function withTempDir(t) {
  const dir = await makeTempDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return { dir, configPath: path.join(dir, ".tmux.conf") };
}

test("install writes the block, applies it live and renames stale windows", async (t) => {
  const { dir, configPath } = await withTempDir(t);
  await fs.writeFile(configPath, USER_CONFIG);

  const { ctx, output, calls, state } = createContext({
    configPath,
    dir,
    fake: { panes: [PI_PANE] },
  });

  assert.equal(await install(ctx), 0);

  const content = await fs.readFile(configPath, "utf8");
  assert.ok(content.startsWith(USER_CONFIG), "user configuration must be preserved");
  assert.equal(readBlock(content), renderBlock(buildAutomaticRenameFormat()));

  assert.equal(state["automatic-rename"], "on");
  assert.equal(state["automatic-rename-format"], buildAutomaticRenameFormat());

  assert.deepEqual(
    calls.filter((call) => call[0] === "rename-window"),
    [["rename-window", "-t", "%1", "π - pi-behind-byobu"]],
  );
  assert.ok(
    calls.some(
      (call) =>
        call[0] === "set-option" &&
        call[1] === "-w" &&
        call[3] === "%1" &&
        call[4] === "automatic-rename" &&
        call[5] === "on",
    ),
    "automatic-rename must be re-enabled after the manual rename",
  );

  assert.equal(
    await fs.readFile(`${configPath}.pi-behind-byobu.bak`, "utf8"),
    USER_CONFIG,
    "the pre-existing file must be backed up once",
  );
  assert.ok(output.join("").includes("Renamed 1 running window(s)"));
});

test("install is idempotent", async (t) => {
  const { dir, configPath } = await withTempDir(t);
  const { ctx, output } = createContext({ configPath, dir, fake: { panes: [] } });

  await install(ctx);
  const first = await fs.readFile(configPath, "utf8");

  output.length = 0;
  assert.equal(await install(ctx), 0);
  assert.equal(await fs.readFile(configPath, "utf8"), first);
  assert.ok(output.join("").includes("already up to date"));
});

test("install --dry-run touches nothing", async (t) => {
  const { dir, configPath } = await withTempDir(t);
  const { ctx, output, calls } = createContext({
    configPath,
    dir,
    options: { dryRun: true },
  });

  assert.equal(await install(ctx), 0);
  await assert.rejects(fs.readFile(configPath), { code: "ENOENT" });
  assert.deepEqual(calls, [], "no tmux command may run during a dry run");
  assert.ok(output.join("").includes(BLOCK_BEGIN));
});

test("install --no-refresh still applies the rule to the running server", async (t) => {
  const { dir, configPath } = await withTempDir(t);
  const { ctx, calls, state } = createContext({
    configPath,
    dir,
    options: { noRefresh: true },
    fake: { panes: [PI_PANE] },
  });

  await install(ctx);
  assert.equal(state["automatic-rename-format"], buildAutomaticRenameFormat());
  assert.deepEqual(calls.filter((call) => call[0] === "rename-window"), []);
});

test("install honours custom format options", async (t) => {
  const { dir, configPath } = await withTempDir(t);
  const formatOptions = { stripPrefix: true, maxLength: 12 };
  const { ctx, state } = createContext({
    configPath,
    dir,
    options: { formatOptions },
    fake: { panes: [] },
  });

  await install(ctx);
  const expected = buildAutomaticRenameFormat(formatOptions);
  assert.equal(state["automatic-rename-format"], expected);
  assert.ok((await fs.readFile(configPath, "utf8")).includes(expected));
});

test("install only writes configuration when no tmux server is reachable", async (t) => {
  const { dir, configPath } = await withTempDir(t);
  const { ctx, output, calls } = createContext({
    configPath,
    dir,
    env: { TMUX: "", TMUX_PANE: "" },
  });

  assert.equal(await install(ctx), 0);
  assert.ok((await fs.readFile(configPath, "utf8")).includes(BLOCK_BEGIN));
  assert.deepEqual(calls, []);
  assert.ok(output.join("").includes("next time Byobu starts"));
});

test("install writes the config even when the tmux server is not running", async (t) => {
  const { dir, configPath } = await withTempDir(t);
  const { ctx, calls } = createContext({
    configPath,
    dir,
    fake: { running: false },
  });

  assert.equal(await install(ctx), 0);
  assert.ok((await fs.readFile(configPath, "utf8")).includes(BLOCK_BEGIN));
  assert.deepEqual(calls.filter((call) => call[0] === "set-option"), []);
});

test("install keeps the original backup across installs", async (t) => {
  const { dir, configPath } = await withTempDir(t);
  await fs.writeFile(configPath, USER_CONFIG);
  const { ctx } = createContext({ configPath, dir, fake: { panes: [] } });

  await install(ctx);
  await install(ctx);
  assert.equal(await fs.readFile(`${configPath}.pi-behind-byobu.bak`, "utf8"), USER_CONFIG);
});

test("uninstall restores the file and tmux's stock naming", async (t) => {
  const { dir, configPath } = await withTempDir(t);
  await fs.writeFile(configPath, USER_CONFIG);

  const { ctx, state } = createContext({ configPath, dir, fake: { panes: [] } });
  await install(ctx);

  assert.equal(await uninstall(ctx), 0);
  assert.equal(await fs.readFile(configPath, "utf8"), USER_CONFIG);
  assert.equal(state["automatic-rename-format"], STOCK_FORMAT);
});

test("uninstall reports when there is nothing to remove", async (t) => {
  const { dir, configPath } = await withTempDir(t);
  const { ctx, output, calls } = createContext({ configPath, dir });

  assert.equal(await uninstall(ctx), 0);
  assert.ok(output.join("").includes("Nothing to do"));
  assert.deepEqual(calls, []);
});

test("refresh refuses to run without a server", async (t) => {
  const { dir, configPath } = await withTempDir(t);
  const { ctx } = createContext({ configPath, dir, env: { TMUX: "", TMUX_PANE: "" } });
  await assert.rejects(refresh(ctx), ToolError);
});

test("refresh re-applies the rule and renames stale windows", async (t) => {
  const { dir, configPath } = await withTempDir(t);
  const { ctx, calls } = createContext({
    configPath,
    dir,
    fake: { panes: [PI_PANE] },
  });

  assert.equal(await refresh(ctx), 0);
  assert.deepEqual(
    calls.filter((call) => call[0] === "rename-window"),
    [["rename-window", "-t", "%1", "π - pi-behind-byobu"]],
  );
});

test("findStaleWindows skips non-Pi panes, inactive panes and copy mode", async (t) => {
  const { dir, configPath } = await withTempDir(t);
  const { ctx } = createContext({
    configPath,
    dir,
    fake: {
      panes: [
        { paneId: "%1", title: "π - a", windowId: "@1", windowName: "node" },
        { paneId: "%2", title: "π - b", windowId: "@2", windowName: "node", active: "0" },
        { paneId: "%3", title: "π - c", windowId: "@3", windowName: "node", inMode: "1" },
        { paneId: "%4", title: "zsh", windowId: "@4", windowName: "zsh" },
        { paneId: "%5", title: "π - e", windowId: "@5", windowName: "π - e" },
      ],
    },
  });

  const stale = await findStaleWindows(ctx, {});
  assert.deepEqual(
    stale.map((window) => window.paneId),
    ["%1"],
  );
});

test("doctor passes on a healthy setup", async (t) => {
  const { dir, configPath } = await withTempDir(t);
  const { ctx, output } = createContext({
    configPath,
    dir,
    env: { HOME: dir },
    fake: { panes: [{ ...PI_PANE, windowName: "π - pi-behind-byobu" }] },
  });
  await install(ctx);
  output.length = 0;

  assert.equal(await doctor(ctx), 0);
  assert.ok(output.join("").includes("0 failure(s)"));
});

test("doctor fails when the block is missing", async (t) => {
  const { dir, configPath } = await withTempDir(t);
  await fs.writeFile(configPath, USER_CONFIG);
  const { ctx, output } = createContext({ configPath, dir, env: { HOME: dir } });

  assert.equal(await doctor(ctx), 1);
  assert.ok(output.join("").includes("Managed block is not installed"));
});

test("doctor fails when the running server disagrees with the config", async (t) => {
  const { dir, configPath } = await withTempDir(t);
  const { ctx, output, state } = createContext({
    configPath,
    dir,
    env: { HOME: dir },
    fake: { panes: [] },
  });
  await install(ctx);

  // Simulate a server that was started before the config existed (or was reloaded).
  state["automatic-rename"] = "off";
  state["automatic-rename-format"] = STOCK_FORMAT;
  output.length = 0;

  assert.equal(await doctor(ctx), 1);
  const text = output.join("");
  assert.ok(text.includes("automatic-rename is off"));
  assert.ok(text.includes("rename format differs"));
});

test("doctor fails on a tmux that predates the format modifiers", async (t) => {
  const { dir, configPath } = await withTempDir(t);
  const { ctx, output } = createContext({
    configPath,
    dir,
    env: { HOME: dir },
    fake: { version: "tmux 2.9a", panes: [] },
  });
  await install(ctx);
  output.length = 0;

  assert.equal(await doctor(ctx), 1);
  assert.ok(output.join("").includes("too old"));
});

test("doctor warns (without failing) when tmux is missing", async (t) => {
  const { dir, configPath } = await withTempDir(t);
  const { ctx, output } = createContext({
    configPath,
    dir,
    env: { HOME: dir },
    fake: { version: null, panes: [] },
  });
  await install(ctx);
  output.length = 0;

  assert.equal(await doctor(ctx), 0);
  assert.ok(output.join("").includes("tmux was not found"));
});

test("doctor warns about stale windows and points at refresh", async (t) => {
  const { dir, configPath } = await withTempDir(t);
  const { ctx, output } = createContext({
    configPath,
    dir,
    env: { HOME: dir },
    fake: { panes: [PI_PANE] },
  });
  await install(ctx);
  output.length = 0;

  assert.equal(await doctor(ctx), 0);
  const text = output.join("");
  assert.ok(text.includes("stale name"));
  assert.ok(text.includes("pi-behind-byobu refresh"));
});

test("doctor warns about ~/.tmux.conf, which Byobu never reads", async (t) => {
  const { dir, configPath } = await withTempDir(t);
  await fs.writeFile(path.join(dir, ".tmux.conf"), "set -g automatic-rename on\n");

  const { ctx, output } = createContext({
    configPath,
    dir,
    env: { HOME: dir },
    fake: { panes: [] },
  });
  await install(ctx);
  output.length = 0;

  await doctor(ctx);
  assert.ok(output.join("").includes("Byobu never reads that file"));
});

test("doctor flags a block written with different options", async (t) => {
  const { dir, configPath } = await withTempDir(t);
  const { ctx, output } = createContext({
    configPath,
    dir,
    env: { HOME: dir },
    fake: { panes: [] },
  });
  await install(ctx);

  // Same server, different expectations: the file is now out of date.
  ctx.options.formatOptions = { maxLength: 40 };
  output.length = 0;

  assert.equal(await doctor(ctx), 1);
  const text = output.join("");
  assert.ok(text.includes("out of date"));
  assert.ok(text.includes("rename format differs"));
});

test("doctor skips live checks when it is not attached to a server", async (t) => {
  const { dir, configPath } = await withTempDir(t);
  const { ctx, output } = createContext({
    configPath,
    dir,
    env: { HOME: dir, TMUX: "", TMUX_PANE: "" },
  });
  await install(ctx);
  output.length = 0;

  assert.equal(await doctor(ctx), 0);
  assert.ok(output.join("").includes("Not attached to a tmux server"));
});
