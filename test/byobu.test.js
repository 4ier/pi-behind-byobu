import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  TMUX_CONFIG_FILENAME,
  detectByobu,
  resolveByobuConfigDir,
  resolveConfigPath,
} from "../src/byobu.js";

const HOME = "/home/tester";

test("BYOBU_CONFIG_DIR wins, matching Byobu's own resolution", () => {
  const resolved = resolveByobuConfigDir({
    env: { HOME, BYOBU_CONFIG_DIR: "/custom/byobu", XDG_CONFIG_HOME: "/xdg" },
    exists: () => true,
  });
  assert.deepEqual(resolved, { dir: "/custom/byobu", source: "BYOBU_CONFIG_DIR" });
});

test("a legacy ~/.byobu directory wins over XDG", () => {
  const resolved = resolveByobuConfigDir({
    env: { HOME, XDG_CONFIG_HOME: "/xdg" },
    exists: (target) => target === path.join(HOME, ".byobu"),
  });
  assert.deepEqual(resolved, { dir: path.join(HOME, ".byobu"), source: "~/.byobu" });
});

test("XDG_CONFIG_HOME is used when ~/.byobu does not exist", () => {
  const resolved = resolveByobuConfigDir({
    env: { HOME, XDG_CONFIG_HOME: "/xdg" },
    exists: () => false,
  });
  assert.deepEqual(resolved, { dir: "/xdg/byobu", source: "$XDG_CONFIG_HOME/byobu" });
});

test("~/.config/byobu is the final fallback", () => {
  const resolved = resolveByobuConfigDir({ env: { HOME }, exists: () => false });
  assert.deepEqual(resolved, { dir: path.join(HOME, ".config", "byobu"), source: "~/.config/byobu" });
});

test("detectByobu uses the environment first", () => {
  assert.equal(detectByobu({ env: { HOME, BYOBU_BACKEND: "tmux" }, exists: () => false }), true);
  assert.equal(detectByobu({ env: { HOME, BYOBU_PREFIX: "/usr" }, exists: () => false }), true);
  assert.equal(detectByobu({ env: { HOME }, exists: () => false }), false);
  assert.equal(
    detectByobu({ env: { HOME }, exists: (target) => target === path.join(HOME, ".config", "byobu") }),
    true,
  );
});

test("resolveConfigPath accepts an explicit file", () => {
  const resolved = resolveConfigPath("/tmp/scratch.conf", { env: { HOME }, exists: () => true, statSync: () => ({ isDirectory: () => false }) });
  assert.deepEqual(resolved, { configPath: "/tmp/scratch.conf", dir: "/tmp", source: "--config" });
});

test("resolveConfigPath appends .tmux.conf for a directory", () => {
  const resolved = resolveConfigPath("/tmp/byobu-dir", {
    env: { HOME },
    exists: () => true,
    statSync: () => ({ isDirectory: () => true }),
  });
  assert.deepEqual(resolved, {
    configPath: path.join("/tmp/byobu-dir", TMUX_CONFIG_FILENAME),
    dir: "/tmp/byobu-dir",
    source: "--config",
  });
});

test("resolveConfigPath auto-detects Byobu's config file", () => {
  const resolved = resolveConfigPath(undefined, { env: { HOME, BYOBU_CONFIG_DIR: "/custom" }, exists: () => true });
  assert.equal(resolved.configPath, path.join("/custom", TMUX_CONFIG_FILENAME));
  assert.equal(resolved.source, "BYOBU_CONFIG_DIR");
});
