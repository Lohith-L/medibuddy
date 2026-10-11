#!/usr/bin/env node
/**
 * Translation completeness check.
 *
 *  1. Keys used in code with a literal t("key") / tOr("key") / translate(x, "key")
 *     that don't exist in English.
 *  2. Per language: keys missing compared with English, extra keys, and
 *     {placeholder} mismatches.
 *
 * Usage: node scripts/i18n-check.mjs        (exit code 1 when anything is wrong)
 */
import fs from "node:fs";
import path from "node:path";

const LOCALES = path.join("src", "i18n", "locales");
const LANGS = ["en", "hi", "te", "ta", "kn", "mr", "bn", "gu"];

/** Reads all `"key": "value"` entries from a language folder. */
function loadLanguage(lang) {
  const dir = path.join(LOCALES, lang);
  const entries = new Map();
  if (!fs.existsSync(dir)) return entries;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".ts") || file === "index.ts") continue;
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    const re = /^\s*"((?:[^"\\]|\\.)+)":\s*"((?:[^"\\]|\\.)*)",?\s*$/gm;
    let m;
    while ((m = re.exec(src))) entries.set(JSON.parse(`"${m[1]}"`), JSON.parse(`"${m[2]}"`));
  }
  return entries;
}

function* walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) {
      if (!p.includes(path.join("i18n", "locales"))) yield* walk(p);
    } else if (/\.(tsx?|mjs)$/.test(f)) yield p;
  }
}

const dicts = Object.fromEntries(LANGS.map((l) => [l, loadLanguage(l)]));
const en = dicts.en;
let problems = 0;

// 1. keys used in code
const used = new Map();
const keyRe = /\b(?:t|tOr)\(\s*"([A-Za-z0-9_.-]+)"|translate\([^,()]+,\s*['"]([A-Za-z0-9_.-]+)['"]/g;
for (const file of walk("src")) {
  const src = fs.readFileSync(file, "utf8");
  let m;
  while ((m = keyRe.exec(src))) {
    const key = m[1] ?? m[2];
    if (!used.has(key)) used.set(key, file);
  }
}
const unknown = [...used].filter(([k]) => !en.has(k));
console.log(`English keys: ${en.size} · literal keys used in code: ${used.size}`);
if (unknown.length) {
  problems += unknown.length;
  console.log(`\n✗ ${unknown.length} key(s) used in code but missing in English:`);
  for (const [k, f] of unknown) console.log(`   ${k}   (${f})`);
}

// 2. per-language comparison
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
console.log("\nPer language:");
for (const lang of LANGS.slice(1)) {
  const d = dicts[lang];
  const missing = [...en.keys()].filter((k) => !d.has(k));
  const extra = [...d.keys()].filter((k) => !en.has(k));
  const badVars = [...en.keys()].filter((k) => d.has(k) && placeholders(d.get(k)) !== placeholders(en.get(k)));
  const ok = !missing.length && !extra.length && !badVars.length;
  console.log(`  ${lang}: ${d.size} keys · missing ${missing.length} · extra ${extra.length} · placeholder mismatches ${badVars.length}${ok ? "  ✓" : ""}`);
  if (process.argv.includes("--verbose") || process.argv.includes("-v")) {
    if (missing.length) console.log(`     missing: ${missing.join(", ")}`);
    if (extra.length) console.log(`     extra: ${extra.join(", ")}`);
    if (badVars.length) console.log(`     placeholders: ${badVars.join(", ")}`);
  }
  problems += missing.length + extra.length + badVars.length;
}

console.log(problems ? `\n${problems} problem(s). Run with -v for the key lists.` : "\nAll translations complete ✓");
process.exit(problems ? 1 : 0);
