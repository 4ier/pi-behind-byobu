/**
 * Command implementations.
 *
 * Each command takes a context built by the CLI:
 *   { options, paths, env, tmux, ui }
 * and returns a process exit code.
 */

import path from "node:path";

import {
  BLOCK_BEGIN,
  hasBlock,
  readBlock,
  removeBlock,
  renderBlock,
  upsertBlock,
} from "./block.js";
import { detectByobu } from "./byobu.js";
import { ToolError } from "./errors.js";
import {
  DEFAULT_TITLE_PREFIX,
  STOCK_AUTOMATIC_RENAME_FORMAT,
  buildAutomaticRenameFormat,
  preferredWindowName,
} from "./format.js";
import { backupOnce, exists, readFileIfExists, writeFileAtomic } from "./fsx.js";
import { versionAtLeast } from "./tmux.js";

/** Format modifiers used here have existed since tmux 3.0. */
export const MIN_TMUX = { major: 3, minor: 0 };

/**
 * Windows whose active pane carries a Pi title but whose window name does not
 * match it. tmux only re-evaluates `automatic-rename-format` when a pane title
 * changes, so windows that were already running before the install keep their
 * old name until something triggers a rename.
 *
 * @returns {Promise<Array<{paneId: string, windowId: string, title: string, current: string, preferred: string}>>}
 */
export async function findStaleWindows(ctx, formatOptions = ctx.options.formatOptions) {
  const panes = await ctx.tmux.listPanes();
  const seen = new Set();
  const stale = [];

  for (const pane of panes) {
    if (pane.active !== "1") continue;
    if (pane.inMode !== "0") continue; // copy mode renders as [tmux]; leave it alone
    if (seen.has(pane.windowId)) continue;

    const preferred = preferredWindowName(pane.title, formatOptions);
    if (preferred === null) continue;

    seen.add(pane.windowId);
    if (preferred !== pane.windowName) {
      stale.push({
        paneId: pane.paneId,
        windowId: pane.windowId,
        title: pane.title,
        current: pane.windowName,
        preferred,
      });
    }
  }

  return stale;
}

async function findStaleWindowsOrReport(ctx, record) {
  try {
    return await findStaleWindows(ctx);
  } catch (error) {
    record(
      "fail",
      "Could not list tmux panes",
      error.message,
      "check that the tmux on PATH is the one serving this session",
    );
    return null;
  }
}

async function canGoLive(ctx) {
  if (!ctx.env.TMUX && !ctx.options.tmuxSocket) return false;
  return ctx.tmux.isServerRunning();
}

/**
 * Apply the rule to the running server and, unless `--no-refresh`, rename the
 * Pi windows that are already open.
 *
 * @returns {Promise<{skipped: boolean, refreshed: number | null, windows: object[]}>}
 */
async function applyLive(ctx, format) {
  if (!(await canGoLive(ctx))) return { skipped: true, refreshed: 0, windows: [] };

  await ctx.tmux.setGlobalOption("automatic-rename", "on");
  await ctx.tmux.setGlobalOption("automatic-rename-format", format);

  if (ctx.options.noRefresh) return { skipped: false, refreshed: null, windows: [] };

  const stale = await findStaleWindows(ctx);
  for (const window of stale) {
    await ctx.tmux.renameWindow(window.paneId, window.preferred);
    // A manual name disables automatic-rename for that window, so re-enable it;
    // otherwise later Pi renames would stop propagating.
    await ctx.tmux.setWindowOption(window.paneId, "automatic-rename", "on");
  }

  return { skipped: false, refreshed: stale.length, windows: stale };
}

function reportLive(ctx, live) {
  const { ui } = ctx;
  if (live.skipped) {
    ui.out("Not attached to a running tmux server; the config applies the next time Byobu starts.");
    return;
  }
  ui.out("Applied to the running tmux server.");
  if (live.refreshed === null) {
    ui.out("Skipped already-running windows (--no-refresh).");
    return;
  }
  if (live.refreshed === 0) {
    ui.out("No running window needed renaming.");
    return;
  }
  ui.out(`Renamed ${live.refreshed} running window(s):`);
  for (const window of live.windows) {
    ui.out(`  ${window.paneId}  ${window.current} -> ${window.preferred}`);
  }
}

export async function install(ctx) {
  const { ui, options, paths } = ctx;
  const format = buildAutomaticRenameFormat(options.formatOptions);
  const block = renderBlock(format);

  const existing = await readFileIfExists(paths.configPath);
  const hadBlock = existing !== null && hasBlock(existing);
  const { content, changed } = upsertBlock(existing ?? "", block, paths.configPath);

  if (options.dryRun) {
    ui.heading("install (dry run)");
    ui.detail("config", paths.configPath);
    ui.detail("file", existing === null ? "does not exist yet" : "exists");
    ui.detail("change", !changed ? "none" : hadBlock ? "update managed block" : "add managed block");
    ui.blank();
    ui.out(block);
    ui.blank();
    ui.out("Nothing was written. Re-run without --dry-run to apply.");
    return 0;
  }

  if (changed) {
    if (existing !== null && !hadBlock) {
      const backup = await backupOnce(paths.configPath);
      if (backup) ui.out(`Backed up the previous config to ${backup}`);
    }
    await writeFileAtomic(paths.configPath, content);
    ui.out(`${existing === null ? "Created" : "Updated"} ${paths.configPath}`);
  } else {
    ui.out(`${paths.configPath} already up to date`);
  }

  reportLive(ctx, await applyLive(ctx, format));
  return 0;
}

export async function refresh(ctx) {
  const { ui, options } = ctx;
  if (!(await canGoLive(ctx))) {
    throw new ToolError(
      "not attached to a running tmux server; start Byobu (or pass --tmux-socket) and retry",
    );
  }

  const live = await applyLive(ctx, buildAutomaticRenameFormat(options.formatOptions));
  if (live.refreshed === null) ui.out("Skipped window refresh (--no-refresh).");
  else reportLive(ctx, live);
  return 0;
}

export async function uninstall(ctx) {
  const { ui, options, paths } = ctx;
  const existing = await readFileIfExists(paths.configPath);
  const installed = existing !== null && hasBlock(existing);

  if (existing === null) {
    ui.out(`Nothing to do: ${paths.configPath} does not exist.`);
  } else if (!installed) {
    ui.out("Nothing to do: no managed block in the config.");
  } else {
    const { content, changed } = removeBlock(existing, paths.configPath);
    if (options.dryRun) {
      ui.heading("uninstall (dry run)");
      ui.detail("config", paths.configPath);
      ui.detail("change", changed ? "remove managed block" : "none");
      ui.blank();
      ui.out("Nothing was written. Re-run without --dry-run to apply.");
      return 0;
    }
    if (changed) {
      await backupOnce(paths.configPath);
      await writeFileAtomic(paths.configPath, content);
      ui.out(`Removed the managed block from ${paths.configPath}`);
    } else {
      ui.out("Nothing to do: the managed block is already absent.");
    }
  }

  if (options.dryRun) return 0;
  // Only touch the running server when there was actually something installed.
  if (installed && (await canGoLive(ctx))) {
    await ctx.tmux.setGlobalOption("automatic-rename", "on");
    await ctx.tmux.setGlobalOption("automatic-rename-format", STOCK_AUTOMATIC_RENAME_FORMAT);
    ui.out("Restored tmux's stock window naming on the running server.");
    ui.note("Windows renamed by this tool keep their name until their title changes again.");
  }
  return 0;
}

export async function doctor(ctx) {
  const { ui, options, paths, env } = ctx;
  const checks = [];
  const record = (level, title, detail, fix) =>
    checks.push({ level, title, detail, fix });

  const expected = buildAutomaticRenameFormat(options.formatOptions);

  ui.heading("pi-behind-byobu doctor");
  ui.detail("config", paths.configPath);
  ui.detail("found via", paths.source === "--config" ? "--config" : paths.source);
  ui.detail("title", `${options.formatOptions.titlePrefix ?? DEFAULT_TITLE_PREFIX} - ...`);
  if (options.tmuxSocket) ui.detail("socket", options.tmuxSocket);

  if (!detectByobu({ env })) {
    record(
      "warn",
      "Byobu does not look installed",
      "no BYOBU_* environment variable and no Byobu config directory was found",
      "install Byobu, or point --config at the tmux config file your setup reads",
    );
  }

  if (!(await exists(paths.dir))) {
    record("fail", "Byobu config directory does not exist", paths.dir, "pi-behind-byobu install");
  }

  const content = await readFileIfExists(paths.configPath);
  if (content === null) {
    record("fail", "Byobu tmux config file not found", paths.configPath, "pi-behind-byobu install");
  } else if (!hasBlock(content)) {
    record(
      "fail",
      "Managed block is not installed",
      `no "${BLOCK_BEGIN}" section in the config file`,
      "pi-behind-byobu install",
    );
  } else if (readBlock(content, paths.configPath) !== renderBlock(expected)) {
    record(
      "warn",
      "Managed block is out of date",
      "the block was written with different options or by another version",
      "pi-behind-byobu install",
    );
  } else {
    record("ok", "Managed block installed and current", paths.configPath);
  }

  const version = await ctx.tmux.version();
  if (!version) {
    record(
      "warn",
      "tmux was not found on PATH",
      "the config is written but nothing can be verified or applied",
      "install tmux (>= 3.0)",
    );
  } else if (!versionAtLeast(version, MIN_TMUX.major, MIN_TMUX.minor)) {
    record(
      "fail",
      `tmux ${version.raw} is too old`,
      "the format modifiers used here need tmux >= 3.0",
      "upgrade tmux",
    );
  } else {
    record("ok", `tmux ${version.raw}`);
  }

  const attached = Boolean(env.TMUX) || Boolean(options.tmuxSocket);
  if (!attached) {
    record(
      "warn",
      "Not attached to a tmux server",
      "live checks were skipped; the config takes effect the next time Byobu starts",
      "re-run doctor from inside Byobu",
    );
  } else if (!(await ctx.tmux.isServerRunning())) {
    record("warn", "No running tmux server answered", "live checks were skipped");
  } else {
    const automaticRename = await ctx.tmux.getOption("automatic-rename", { window: true });
    if (automaticRename === "on") {
      record("ok", "Running server: automatic-rename is on");
    } else {
      record(
        "fail",
        "Running server: automatic-rename is off",
        `automatic-rename is currently ${automaticRename ?? "unset"}`,
        "pi-behind-byobu install",
      );
    }

    const liveFormat = await ctx.tmux.getOption("automatic-rename-format", { window: true });
    if (liveFormat === expected) {
      record("ok", "Running server: rename format matches");
    } else {
      record(
        "fail",
        "Running server: rename format differs from the config",
        `live:      ${liveFormat ?? "(tmux default)"}\nexpected:  ${expected}`,
        "pi-behind-byobu install   # re-applies to the running server",
      );
    }

    const stale = await findStaleWindowsOrReport(ctx, record);
    if (stale !== null && stale.length > 0) {
      record(
        "warn",
        `${stale.length} Pi window(s) still show a stale name`,
        stale.map((w) => `${w.paneId}  ${w.current} -> ${w.preferred}`).join("\n"),
        "pi-behind-byobu refresh",
      );
    } else if (stale !== null) {
      record("ok", "No stale Pi window names");
    }

    if (env.TMUX_PANE) {
      try {
        const mine = (await ctx.tmux.listPanes()).find((pane) => pane.paneId === env.TMUX_PANE);
        if (mine) {
          ui.detail("this pane", `${mine.paneId} title=[${mine.title}] name=[${mine.windowName}]`);
        }
      } catch {
        // Already reported above; the header detail is optional.
      }
    }
  }

  if (env.HOME) {
    const homeConf = path.join(env.HOME, ".tmux.conf");
    const homeContent = await readFileIfExists(homeConf);
    if (homeContent && /^\s*(set|setw|set-window-option)\b.*automatic-rename/m.test(homeContent)) {
      record(
        "warn",
        "~/.tmux.conf sets automatic-rename, but Byobu never reads that file",
        homeConf,
        `move the setting into ${paths.configPath}`,
      );
    }
  }

  let failures = 0;
  let warnings = 0;
  for (const check of checks) {
    if (check.level === "fail") failures += 1;
    if (check.level === "warn") warnings += 1;

    if (check.level === "fail") ui.fail(check.title);
    else if (check.level === "warn") ui.warn(check.title);
    else ui.ok(check.title);

    if (check.detail) for (const line of String(check.detail).split("\n")) ui.note(line);
    if (check.fix) ui.note(`fix: ${check.fix}`);
  }

  const passed = checks.length - failures - warnings;
  ui.blank();
  ui.out(`${passed} ok, ${warnings} warning(s), ${failures} failure(s)`);
  return failures > 0 ? 1 : 0;
}
