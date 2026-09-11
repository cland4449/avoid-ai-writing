"use strict";

const assert = require("assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CLI = path.join(__dirname, "avoid-ai-writing.js");
const AIDetector = require("../detector/patterns.js");

const SAMPLE =
  "In today's fast-paced world, it is important to note that this is a testament to innovation.";

function run(args, input) {
  return spawnSync(process.execPath, [CLI, ...args], { input, encoding: "utf8" });
}

// stdin: the complete analyzeText() result as JSON
const fromStdin = run([], SAMPLE);
assert.strictEqual(fromStdin.status, 0, fromStdin.stderr);
const stdinJson = JSON.parse(fromStdin.stdout);
assert.deepStrictEqual(stdinJson, JSON.parse(JSON.stringify(AIDetector.analyzeText(SAMPLE))));

// file input produces the same JSON as stdin for the same text
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aaw-cli-"));
const file = path.join(tmp, "sample.txt");
fs.writeFileSync(file, SAMPLE, "utf8");
const fromFile = run([file]);
assert.strictEqual(fromFile.status, 0, fromFile.stderr);
assert.deepStrictEqual(JSON.parse(fromFile.stdout), stdinJson);

// both options reach analyzeText() and are reflected in stats
const withOptions = run(["--context", "technical", "--source-mode", "rendered-markdown"], SAMPLE);
assert.strictEqual(withOptions.status, 0, withOptions.stderr);
const optionsJson = JSON.parse(withOptions.stdout);
assert.strictEqual(optionsJson.stats.contextMode, "technical");
assert.strictEqual(optionsJson.stats.sourceMode, "rendered-markdown");

// --help prints usage and exits 0
const help = run(["--help"]);
assert.strictEqual(help.status, 0);
assert.ok(help.stdout.includes("Usage: avoid-ai-writing"), "expected usage text on stdout");

// errors: exit 2 with nothing on stdout
const errorCases = [
  ["unknown option", ["--nope"]],
  ["missing value", ["--context"]],
  ["invalid context", ["--context", "nope"]],
  ["invalid source mode", ["--source-mode", "nope"]],
  ["multiple files", [file, file]],
  ["unreadable file", [path.join(tmp, "missing.txt")]],
];

for (const [label, args] of errorCases) {
  const res = run(args);
  assert.strictEqual(res.status, 2, `${label}: expected exit 2`);
  assert.strictEqual(res.stdout, "", `${label}: expected no stdout`);
  assert.ok(res.stderr.length > 0, `${label}: expected stderr output`);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log("avoid-ai-writing cli: ok");
