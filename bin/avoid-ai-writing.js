#!/usr/bin/env node
"use strict";

const fs = require("fs");
const AIDetector = require("../detector/patterns.js");

const USAGE = `Usage: avoid-ai-writing [options] [file]

Scores UTF-8 text from a file path or stdin and prints the complete
analyzeText() result as JSON to stdout. Read-only: nothing is modified.
Exits 0 after a successful analysis, 2 on usage or I/O errors.

Options:
  --context <general|technical>          Analysis context (default: general)
  --source-mode <plain|rendered-markdown>
                                         Plain text (default) or rendered
                                         Markdown, which excludes YAML
                                         frontmatter and HTML comments from
                                         the score
  -h, --help                             Show this help

Examples:
  avoid-ai-writing draft.md
  cat draft.md | avoid-ai-writing --context technical
  avoid-ai-writing --source-mode rendered-markdown post.md
`;

const CONTEXTS = ["general", "technical"];
const SOURCE_MODES = ["plain", "rendered-markdown"];

function fail(message) {
  process.stderr.write(`avoid-ai-writing: ${message}\n\n${USAGE}`);
  process.exit(2);
}

function parseArgs(argv) {
  let context = "general";
  let sourceMode = "plain";
  const files = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "-h" || arg === "--help") {
      process.stdout.write(USAGE);
      process.exit(0);
    }

    if (arg === "--context" || arg === "--source-mode") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("-")) {
        fail(`${arg} requires a value`);
      }
      i += 1;
      if (arg === "--context") {
        if (!CONTEXTS.includes(value)) fail(`invalid --context value: ${value}`);
        context = value;
      } else {
        if (!SOURCE_MODES.includes(value)) fail(`invalid --source-mode value: ${value}`);
        sourceMode = value;
      }
      continue;
    }

    if (arg.startsWith("-")) fail(`unknown option: ${arg}`);
    files.push(arg);
  }

  if (files.length > 1) fail("expected at most one file path");
  return { context, sourceMode, file: files[0] };
}

function readInput(file) {
  if (file !== undefined) {
    try {
      return fs.readFileSync(file, "utf8");
    } catch (error) {
      fail(`cannot read ${file}: ${error.message}`);
    }
  }

  try {
    return fs.readFileSync(0, "utf8");
  } catch (error) {
    fail(`cannot read stdin: ${error.message}`);
  }
}

const { context, sourceMode, file } = parseArgs(process.argv.slice(2));
const text = readInput(file);
const result = AIDetector.analyzeText(text, { contextMode: context, sourceMode });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
