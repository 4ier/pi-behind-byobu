#!/usr/bin/env node
/**
 * The single local gate. Everything CI runs is runnable here, in one command:
 *
 *   npm run check
 *
 * 1. syntax check every source file
 * 2. run the test suite (unit + real-tmux integration)
 * 3. pack the tarball and execute the CLI from inside it, which is the only way
 *    to notice that the published artifact is missing a file or a shebang
 *
 * Exits non-zero on the first failure, so it works as a pre-push check.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateChangelog } from "./check-changelog.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

let failures = 0;

function step(name) {
  process.stdout.write(`\n▶ ${name}\n`);
}

function ok(detail) {
  process.stdout.write(`  ok   ${detail}\n`);
}

function fail(error) {
  failures += 1;
  process.stdout.write(`  FAIL ${error.message?.trim() || error}\n`);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.quiet ? "pipe" : "inherit",
    ...options,
  });
}

/** Every .js file we ship, plus tests and scripts. */
function sourceFiles() {
  const files = [];
  for (const dir of ["bin", "src", "scripts", "test", path.join("test", "fixtures")]) {
    const absolute = path.join(root, dir);
    if (!fs.existsSync(absolute)) continue;
    for (const entry of fs.readdirSync(absolute)) {
      if (entry.endsWith(".js")) files.push(path.join(dir, entry));
    }
  }
  return files.sort();
}

function testFiles() {
  const dir = path.join(root, "test");
  return fs
    .readdirSync(dir)
    .filter((entry) => entry.endsWith(".test.js"))
    .sort()
    .map((entry) => path.join("test", entry));
}

step("syntax");
for (const file of sourceFiles()) {
  try {
    run(process.execPath, ["--check", file]);
    ok(file);
  } catch (error) {
    fail(new Error(`${file}: ${error.message}`));
  }
}

step("tests");
try {
  run(process.execPath, ["--test", "--test-reporter=spec", ...testFiles()]);
  ok(`${testFiles().length} test file(s)`);
} catch {
  fail(new Error("test suite failed"));
}

step("changelog");
try {
  const problems = validateChangelog({
    text: fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8"),
    version: pkg.version,
    repo: "https://github.com/4ier/pi-behind-byobu",
  });
  if (problems.length > 0) {
    for (const problem of problems) process.stdout.write(`  - ${problem}\n`);
    throw new Error(`${problems.length} changelog problem(s)`);
  }
  ok(`${pkg.version}, unreleased section present, compare links intact`);
} catch (error) {
  fail(error);
}

step("packaged artifact");
const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-behind-byobu-check-"));
try {
  run("npm", ["pack", "--silent", "--pack-destination", workdir], { quiet: true });
  const tarball = fs.readdirSync(workdir).find((entry) => entry.endsWith(".tgz"));
  if (!tarball) throw new Error("npm pack produced no tarball");

  execFileSync("tar", ["xzf", path.join(workdir, tarball), "-C", workdir]);
  const bin = path.join(workdir, "package", "bin", "pi-behind-byobu.js");
  if (!fs.existsSync(bin)) throw new Error(`${tarball} does not contain bin/pi-behind-byobu.js`);

  const version = execFileSync(process.execPath, [bin, "--version"], { encoding: "utf8" }).trim();
  if (version !== pkg.version) throw new Error(`packed CLI reports ${version}, package.json says ${pkg.version}`);

  // The packed CLI must be able to do real work, not just print its version.
  const help = execFileSync(process.execPath, [bin, "--help"], { encoding: "utf8" });
  for (const command of ["install", "refresh", "doctor", "uninstall"]) {
    if (!help.includes(command)) throw new Error(`packed CLI help is missing ${command}`);
  }
  ok(`${tarball} -> ${pkg.name} ${version}`);
} catch (error) {
  fail(error);
} finally {
  fs.rmSync(workdir, { recursive: true, force: true });
}

process.stdout.write(
  failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`,
);
process.exitCode = failures === 0 ? 0 : 1;
