import path from "node:path";
import fs from "node:fs";

export function resolveRepoPath(relativePath) {
  const cwd = process.cwd();
  const rootFromCwd = path.resolve(cwd, "AGENTS.md");
  const parentFromCwd = path.resolve(cwd, "..", "AGENTS.md");

  if (fs.existsSync(rootFromCwd)) {
    return path.resolve(cwd, relativePath);
  }

  if (fs.existsSync(parentFromCwd)) {
    return path.resolve(cwd, "..", relativePath);
  }

  return path.resolve(cwd, relativePath);
}
