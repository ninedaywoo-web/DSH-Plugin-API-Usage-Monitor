import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const failures = [];

const requireValue = (condition, message) => {
  if (!condition) failures.push(message);
};

requireValue(typeof manifest.name === "string" && manifest.name !== "", "package name is missing");
requireValue(typeof manifest.version === "string" && manifest.version !== "", "package version is missing");
requireValue(typeof manifest.description === "string" && manifest.description !== "", "package description is missing");
requireValue(typeof manifest.license === "string" && manifest.license !== "", "package license is missing");
requireValue(manifest.type === "module", "package must use ESM");
requireValue(manifest.main === "lib/index.js", "host entry must be lib/index.js");
requireValue(manifest.exports?.["./client"] === "./lib/client.js", "web client export is missing");
requireValue(manifest.dsh?.bundle?.patch === "./cordis.patch.yml", "DSH bundle patch is missing");
requireValue(manifest.dsh?.client?.platform === "web", "DSH web client declaration is missing");

for (const path of [
  "lib/index.js",
  "lib/client.js",
  "lib/supervisor.js",
  "lib/launch-platform.js",
  "assets/liangzi.png",
  "assets/liangshen.png",
  "cordis.patch.yml",
  "README.md",
  "README.en.md",
  "ASSET-NOTICE.md",
  "docs/images/overview.png",
  "docs/images/actions.png",
  "docs/images/status-card.png",
  "CHANGELOG.md",
  "LICENSE"
]) {
  requireValue(existsSync(join(root, path)), `required package file is missing: ${path}`);
}

for (const hook of ["preinstall", "install", "postinstall", "prepare"]) {
  requireValue(manifest.scripts?.[hook] === undefined, `forbidden install lifecycle script: ${hook}`);
}

const textExtensions = new Set([".js", ".json", ".yml", ".yaml", ".md"]);
const publishedRoots = ["lib", "assets"];
const textFiles = ["package.json", "cordis.patch.yml", "README.md", "CHANGELOG.md"];
const walk = (path) => {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (textExtensions.has(extname(entry.name))) textFiles.push(relative(root, full));
  }
};
for (const path of publishedRoots) {
  const full = join(root, path);
  if (existsSync(full) && statSync(full).isDirectory()) walk(full);
}

const localPathPattern = /(?:[A-Za-z]:[\\/](?:AI|Users)[\\/]|\/Users\/[^/]+\/)/;
for (const path of new Set(textFiles)) {
  const text = readFileSync(join(root, path), "utf8");
  requireValue(!localPathPattern.test(text), `local absolute path leaked into package: ${path}`);
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`preflight: ${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`preflight: ${manifest.name}@${manifest.version} is portable and package-complete\n`);
}
