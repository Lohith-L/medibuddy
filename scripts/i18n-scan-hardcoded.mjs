#!/usr/bin/env node
/**
 * Lists user-visible English text that is NOT translated:
 *   - JSX text nodes (<p>Hello</p>)
 *   - string literals in visible JSX attributes (placeholder, title, aria-label, alt, label)
 *   - string / template literals passed to toast(), toast.success/error/info/warning
 *
 * Usage: node scripts/i18n-scan-hardcoded.mjs [files or dirs...]   (default: src/pages src/components)
 * Exit code 1 when something is found (useful in CI).
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const VISIBLE_ATTRS = new Set(["placeholder", "title", "aria-label", "alt", "label"]);
// Things that look like text but aren't UI copy.
const IGNORE = [
  /^[\s\d\W]*$/, // numbers, punctuation, emoji only
  /^[\w.+-]+@[\w-]+\.[\w.]+$/, // example email addresses
  // Brand names and units (optionally followed by an emoji)
  /^(MedBuddy|MediBuddy|MEDDIBUDDY|Twitter|LinkedIn|Instagram|Google|MEDDI|BUDDY|Med|Buddy|SOS|AQI|OTP|108|104|km|kg|mg|ml|°C|%|\+91)[\s\W]*$/u,
];

function* walk(target) {
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    for (const f of fs.readdirSync(target)) yield* walk(path.join(target, f));
  } else if (/\.tsx$/.test(target) && !/components[\\/]ui[\\/]/.test(target)) {
    yield target;
  }
}

function isIgnored(text) {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t || !/[A-Za-z]{2,}/.test(t)) return true;
  return IGNORE.some((re) => re.test(t));
}

/** A string literal that ends up as rendered JSX text (through ?:, ||, ??, parentheses). */
function inJsxChildExpression(node) {
  let cur = node.parent;
  while (cur && (ts.isConditionalExpression(cur) || ts.isParenthesizedExpression(cur) ||
    (ts.isBinaryExpression(cur) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(cur.operatorToken.kind)))) {
    // Only the result branches of ?: count, not the condition.
    if (ts.isConditionalExpression(cur) && cur.condition === node) return false;
    node = cur;
    cur = cur.parent;
  }
  return !!cur && ts.isJsxExpression(cur) && !!cur.parent && (ts.isJsxElement(cur.parent) || ts.isJsxFragment(cur.parent));
}

function scanFile(file) {
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits = [];
  const add = (node, kind, text) => {
    if (isIgnored(text)) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
    hits.push({ line: line + 1, kind, text: text.replace(/\s+/g, " ").trim().slice(0, 100) });
  };

  const visit = (node) => {
    if (ts.isJsxText(node)) {
      add(node, "jsx", node.getText());
    } else if (ts.isJsxAttribute(node) && node.initializer && VISIBLE_ATTRS.has(node.name.getText())) {
      const init = node.initializer;
      if (ts.isStringLiteral(init)) add(init, `attr:${node.name.getText()}`, init.text);
      // placeholder={cond ? "A" : "B"} and similar
      else if (ts.isJsxExpression(init) && init.expression) {
        const walkAttr = (e) => {
          if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) add(e, `attr:${node.name.getText()}`, e.text);
          else if (ts.isConditionalExpression(e)) { walkAttr(e.whenTrue); walkAttr(e.whenFalse); }
          else if (ts.isParenthesizedExpression(e)) walkAttr(e.expression);
          else if (ts.isBinaryExpression(e) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(e.operatorToken.kind)) walkAttr(e.right);
        };
        walkAttr(init.expression);
      }
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression.getText();
      if (/^toast(\.(success|error|info|warning|message))?$/.test(callee)) {
        const arg = node.arguments[0];
        if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) add(arg, "toast", arg.text);
        else if (arg && ts.isTemplateExpression(arg)) add(arg, "toast", arg.getText());
      }
    } else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && inJsxChildExpression(node)) {
      // {"literal"} or {cond ? "A" : "B"} or {x || "fallback"} rendered as JSX children
      add(node, "jsx-expr", node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

const targets = process.argv.slice(2).length ? process.argv.slice(2) : ["src/pages", "src/components"];
let total = 0;
for (const target of targets) {
  for (const file of walk(target)) {
    const hits = scanFile(file);
    if (!hits.length) continue;
    total += hits.length;
    console.log(`\n${file} (${hits.length})`);
    for (const h of hits) console.log(`  ${String(h.line).padStart(4)}  [${h.kind}] ${h.text}`);
  }
}
console.log(`\n${total} untranslated string(s) found.`);
process.exit(total ? 1 : 0);
