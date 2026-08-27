#!/usr/bin/env node
// Emits `docs/DICTIONARY.md` from `docs/dictionary.yml`. The YAML is source; the markdown is
// what a person reads. Editing the markdown is a wasted edit — `check:dictionary` regenerates
// and compares, the same freshness posture `gen:decisions` takes with its index.
//
// `render` lives in check-dictionary.mjs so the dependency runs one way: this file needs the
// checker, the checker never needs this one.

import { readFileSync, writeFileSync } from "node:fs";
import { DICT, OUT, loadDictionary, render } from "./check-dictionary.mjs";

const { entries, errors } = loadDictionary();
if (errors.length) {
  console.error(`✗ ${DICT} — ${errors.length} problem${errors.length === 1 ? "" : "s"}:\n`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
const text = render(entries);
let before = "";
try { before = readFileSync(OUT, "utf8"); } catch {}
writeFileSync(OUT, text);
console.log(`✓ ${OUT} — ${entries.length} terms${before === text ? " (unchanged)" : " regenerated"}`);
