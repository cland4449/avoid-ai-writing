"use strict";

const assert = require("assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CLI = path.join(__dirname, "avoid-ai-writing-gate.js");
const FLAGGED = "In today's fast-paced world, it is important to note that this is a testament to innovation.";

function run(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aaw-gate-"));
const flagged = path.join(tmp, "flagged.md");
fs.writeFileSync(flagged, FLAGGED, "utf8");

const strict = run(["--threshold", "0", flagged]);
assert.strictEqual(strict.status, 1, strict.stderr);
assert.match(strict.stdout, /^FAIL /m);

const permissive = run(["--threshold", "999", flagged]);
assert.strictEqual(permissive.status, 0, permissive.stderr);
assert.match(permissive.stdout, /^PASS /m);

const help = run(["--help"]);
assert.strictEqual(help.status, 0);
assert.match(help.stdout, /never uses the composite 0-100 score/);

const badThreshold = run(["--threshold", "1.5", flagged]);
assert.strictEqual(badThreshold.status, 2);
assert.match(badThreshold.stderr, /invalid --threshold/);

const noInput = run([]);
assert.strictEqual(noInput.status, 2);
assert.match(noInput.stderr, /provide at least one file or --glob/);

const gitRepo = path.join(tmp, "repo");
fs.mkdirSync(gitRepo);
spawnSync("git", ["init", "-q"], { cwd: gitRepo });
fs.mkdirSync(path.join(gitRepo, "docs"));
fs.writeFileSync(path.join(gitRepo, "docs", "draft.md"), FLAGGED, "utf8");
fs.writeFileSync(path.join(gitRepo, "ignore.js"), "const x = 1;\n", "utf8");
spawnSync("git", ["add", "."], { cwd: gitRepo });
const globbed = run(["--glob", "**/*.md", "--threshold", "0"], gitRepo);
assert.strictEqual(globbed.status, 1, globbed.stderr);
assert.match(globbed.stdout, /docs[\\/]draft\.md/);
assert.doesNotMatch(globbed.stdout, /ignore\.js/);

fs.rmSync(tmp, { recursive: true, force: true });
console.log("avoid-ai-writing gate cli: ok");
