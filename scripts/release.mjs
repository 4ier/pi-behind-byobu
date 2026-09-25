#!/usr/bin/env node
/**
 * Cut a release, the same way locally and in CI:
 *
 *   npm run release -- patch            # or minor / major / 1.2.3
 *   npm run release -- patch --dry-run  # show the plan, change nothing
 *
 * It refuses to run unless `## [Unreleased]` in CHANGELOG.md already has notes,
 * so a release can never ship without a changelog entry. It then
 *   - rewrites the changelog (Unreleased -> the new version, with today's date)
 *   - updates the compare links and package.json
 *   - commits "release: vX.Y.Z" and creates an annotated tag
 *   - writes the release notes for `gh release create --notes-file`
 *
 * Pushing stays explicit: `git push --follow-tags`.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const pkgPath = path.join(root, "package.json");
const changelogPath = path.join(root, "CHANGELOG.md");
const REPO = "https://github.com/4ier/pi-behind-byobu";

function die(message) {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

function git(args, { quiet = false } = {}) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: quiet ? "pipe" : "inherit",
  });
}

// ---------------------------------------------------------------- arguments

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((arg) => arg.startsWith("--")));
const bare = argv.filter((arg) => !arg.startsWith("--"));

const notesFlag = argv.findIndex((arg) => arg === "--notes-file");
if (notesFlag !== -1 && argv[notesFlag + 1] === undefined) die("--notes-file needs a path");

const spec = bare[0] ?? "patch";
const dryRun = flags.has("--dry-run");
const skipGit = flags.has("--no-git") || dryRun;
const notesPath = notesFlag === -1 ? path.join(root, "release-notes.md") : path.resolve(argv[notesFlag + 1]);

// ----------------------------------------------------------------- version

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const current = pkg.version;
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
if (!match) die(`package.json version "${current}" is not x.y.z`);
const [major, minor, patch] = match.slice(1).map(Number);

function nextVersion(specification) {
  if (/^\d+\.\d+\.\d+$/.test(specification)) return specification;
  switch (specification) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      return die(`unknown version "${specification}" (use patch, minor, major or x.y.z)`);
  }
}

const version = nextVersion(spec);
if (version === current) die(`version is already ${version}`);
const [nMajor, nMinor, nPatch] = version.split(".").map(Number);
if (nMajor < major || (nMajor === major && nMinor < minor) || (nMajor === major && nMinor === minor && nPatch < patch)) {
  die(`version ${version} is lower than the current ${current}`);
}

// ------------------------------------------------------------------- guards

if (!skipGit) {
  const dirty = git(["status", "--porcelain"], { quiet: true }).trim();
  if (dirty !== "") die("working tree is not clean; commit or stash first");
  if (git(["tag", "--list", `v${version}`], { quiet: true }).trim() !== "") {
    die(`tag v${version} already exists`);
  }
}

const changelog = fs.readFileSync(changelogPath, "utf8");
const unreleased = /## \[Unreleased\]\n([\s\S]*?)(?=\n## \[)/.exec(changelog);
if (!unreleased) die("CHANGELOG.md has no `## [Unreleased]` section");
const notes = unreleased[1].trim();
if (notes === "") {
  die("`## [Unreleased]` is empty: describe the change there before releasing");
}

// -------------------------------------------------------------------- edits

const date = new Date().toISOString().slice(0, 10);
const nextChangelog = changelog
  .replace(
    /## \[Unreleased\]\n[\s\S]*?(?=\n## \[)/,
    `## [Unreleased]\n\n## [${version}] - ${date}\n\n${notes}\n`,
  )
  .replace(
    /\[Unreleased\]: \S+\n/,
    `[Unreleased]: ${REPO}/compare/v${version}...HEAD\n[${version}]: ${REPO}/compare/v${current}...v${version}\n`,
  );
const nextPkg = `${JSON.stringify({ ...pkg, version }, null, 2)}\n`;

if (dryRun) {
  process.stdout.write(`release ${current} -> ${version} (dry run)\n`);
  process.stdout.write(`  changelog  ${path.relative(root, changelogPath)}: [Unreleased] -> [${version}] - ${date}\n`);
  process.stdout.write(`  package    ${path.relative(root, pkgPath)}: ${current} -> ${version}\n`);
  process.stdout.write(`  notes      ${notesPath}\n`);
  process.stdout.write(`  git        commit "release: v${version}" and tag v${version}\n`);
  process.stdout.write(`\n${notes}\n`);
  process.exit(0);
}

fs.writeFileSync(pkgPath, nextPkg);
fs.writeFileSync(changelogPath, nextChangelog);
fs.writeFileSync(notesPath, `${notes}\n`);

if (!skipGit) {
  git(["add", "package.json", "CHANGELOG.md"]);
  git(["commit", "-m", `release: v${version}`]);
  git(["tag", "-a", `v${version}`, "-m", `v${version}`]);
}

process.stdout.write(`released ${version}\n`);
process.stdout.write(`  notes: ${notesPath}\n`);
if (!skipGit) {
  process.stdout.write(`\nnext:\n  git push --follow-tags\n  gh release create v${version} --title "v${version}" --notes-file ${path.relative(root, notesPath) || notesPath}\n`);
}
