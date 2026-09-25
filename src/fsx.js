/** Small filesystem helpers; writes are atomic so a crash cannot truncate a config. */

import fs from "node:fs/promises";
import path from "node:path";

import { ToolError } from "./errors.js";

/**
 * @param {string} file
 * @returns {Promise<string | null>} null when the file does not exist
 */
export async function readFileIfExists(file) {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new ToolError(`cannot read ${file}: ${error.message}`, { cause: error });
  }
}

/** @returns {Promise<boolean>} */
export async function exists(file) {
  try {
    await fs.stat(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write via a temporary file in the same directory plus rename, preserving the
 * mode of an existing file.
 *
 * @param {string} file
 * @param {string} content
 */
export async function writeFileAtomic(file, content) {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });

  let mode;
  try {
    mode = (await fs.stat(file)).mode & 0o777;
  } catch {
    mode = undefined;
  }

  const temp = path.join(dir, `.${path.basename(file)}.pi-behind-byobu.tmp`);
  try {
    await fs.writeFile(temp, content, mode === undefined ? {} : { mode });
    if (mode !== undefined) await fs.chmod(temp, mode);
    await fs.rename(temp, file);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw new ToolError(`cannot write ${file}: ${error.message}`, { cause: error });
  }
}

/**
 * Copy a file once, refusing to clobber an earlier backup.
 *
 * @returns {Promise<string | null>} the backup path, or null when it already existed
 */
export async function backupOnce(file, suffix = ".pi-behind-byobu.bak") {
  const backup = `${file}${suffix}`;
  if (await exists(backup)) return null;
  try {
    await fs.copyFile(file, backup);
    return backup;
  } catch (error) {
    throw new ToolError(`cannot back up ${file}: ${error.message}`, { cause: error });
  }
}
