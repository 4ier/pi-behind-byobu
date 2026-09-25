# Releasing

Two commands, or one button. Neither can forget the changelog.

```bash
# locally
npm run release -- patch          # or minor / major / 1.2.3
git push --follow-tags
gh release create v1.2.3 --title v1.2.3 --notes-file release-notes.md

# or in the browser: Actions -> Release -> Run workflow (version = patch)
```

The `Release` workflow does exactly the same thing on a runner, plus a final
step that proves the tagged revision is installable:

```bash
npx github:4ier/pi-behind-byobu#v1.2.3 --version
```

## The contract

1. **Write the notes first.** Everything under `## [Unreleased]` in
   `CHANGELOG.md` becomes the release notes. `scripts/release.mjs` refuses to run
   while that section is empty, so a release cannot ship without notes.
2. **Never hand-edit the version or tag.** `scripts/release.mjs` rewrites
   `package.json` and `CHANGELOG.md`, commits `release: vX.Y.Z`, and creates the
   annotated tag. Hand-editing is how versions and tags drift apart.
3. **Never move or delete a published tag.** Wrong release? Cut the next patch.
4. **Pushing stays explicit.** The script never pushes; `git push --follow-tags`
   does. That is what keeps a local dry run actually dry.
5. **Run the gate before pushing.** `npm run check` is byte-for-byte what CI
   runs: syntax, the full suite (including the real-tmux integration test), and a
   smoke test that packs the tarball and runs the CLI from inside it.

## What is automated

| Step | Where |
|---|---|
| Syntax, tests, packaged-artifact smoke test | `npm run check` (used by CI on every push, PR and tag) |
| Version + changelog + commit + tag | `scripts/release.mjs`, or the Release workflow |
| GitHub release with changelog notes | Release workflow |
| "Is the released tag actually installable?" | Release workflow (runs `npx github:...#vX`) |
| npm publish | `Publish to npm` workflow, on release |

## Two GitHub behaviours worth knowing

- **Pushes made with `GITHUB_TOKEN` do not trigger other workflows.** The Release
  workflow therefore runs the full gate itself before tagging, rather than
  assuming CI will run on its commit.
- **The npm job is inert without a secret.** It skips with an explanation instead
  of failing, so `npx github:` remains the supported install path.

## Optional: publishing to npm

The package is npm-ready (`name`, `bin`, `files`), and `publish.yml` will publish
it once you add a repository secret:

1. Create an npm **automation** token (npmjs.com -> Access Tokens) with publish
   rights for the `pi-behind-byobu` name.
2. Add it as the `NPM_TOKEN` secret: `gh secret set NPM_TOKEN`.
3. The next release publishes automatically.

Until then, installing from git or `npx github:4ier/pi-behind-byobu` is the
supported path, and it is what the release workflow verifies.

## If something goes wrong

| Symptom | Do |
|---|---|
| The gate fails | Fix the code; nothing has been tagged yet |
| The tag exists but the release does not | `gh release create vX.Y.Z --notes-file release-notes.md` |
| A release shipped broken | Cut the next patch; do not move the tag |
| `npx ...#vX` fails in the verify step | Check the tag exists (`git ls-remote --tags origin`), then re-run the job |
