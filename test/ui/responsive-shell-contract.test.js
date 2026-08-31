import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

function ruleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`, "su"));
  assert.ok(match?.groups?.body, `Expected a CSS rule for ${selector}`);
  return match.groups.body;
}

function blockBody(sourceText, startPattern) {
  const start = sourceText.search(startPattern);
  assert.notEqual(start, -1, `Expected block matching ${startPattern}`);
  const openingBrace = sourceText.indexOf("{", start);
  assert.notEqual(openingBrace, -1, `Expected block opening brace for ${startPattern}`);

  let depth = 1;
  for (let index = openingBrace + 1; index < sourceText.length; index += 1) {
    if (sourceText[index] === "{") depth += 1;
    if (sourceText[index] === "}") depth -= 1;
    if (depth === 0) return sourceText.slice(openingBrace + 1, index);
  }

  assert.fail(`Expected block closing brace for ${startPattern}`);
}

test("dashboard modules use a full-width stacked layout", async () => {
  const [app, css] = await Promise.all([
    source("src/ui/App.tsx"),
    source("src/ui/styles.css"),
  ]);
  const baseCss = css.slice(0, css.indexOf("@media"));

  assert.match(app, /<div className="dashboard-grid">[\s\S]*<ModelTable[\s\S]*<RoleAssignments[\s\S]*<RouteTester[\s\S]*<ConfigPanel/u);
  assert.doesNotMatch(app, /className="dashboard-side"/u);
  assert.match(ruleBody(baseCss, ".content"), /width:\s*100%/u);
  assert.doesNotMatch(ruleBody(baseCss, ".content"), /1510px/u);
  assert.match(ruleBody(baseCss, ".dashboard-grid"), /grid-template-columns:\s*minmax\(0,\s*1fr\)/u);
  assert.doesNotMatch(ruleBody(baseCss, ".dashboard-grid"), /1\.7fr|355px/u);
});

test("desktop sidebar collapse is labelled, stateful, and persisted", async () => {
  const [shell, css] = await Promise.all([
    source("src/ui/components/AppShell.tsx"),
    source("src/ui/styles.css"),
  ]);
  const baseCss = css.slice(0, css.indexOf("@media"));

  assert.match(shell, /\[[^\]]*[Ss]idebar[Cc]ollapsed[^\]]*\]\s*=\s*useState/u);
  assert.match(shell, /(?:window\.)?localStorage\.getItem\(sidebarPreferenceKey\)/u);
  assert.match(shell, /(?:window\.)?localStorage\.setItem\(sidebarPreferenceKey,\s*String\(sidebarCollapsed\)\)/u);
  assert.match(shell, /Collapse (?:sidebar|navigation)/u);
  assert.match(shell, /Expand (?:sidebar|navigation)/u);
  assert.match(shell, /aria-(?:expanded|pressed)=\{[^}]*[Ss]idebar[Cc]ollapsed[^}]*\}/u);
  assert.match(shell, /aria-label=\{[^}]*[Ss]idebar[Cc]ollapsed[^}]*(?:Expand|Collapse) (?:sidebar|navigation)[^}]*\}/u);
  assert.match(shell, /app-shell--sidebar-collapsed/u);

  const expandedWidth = Number(ruleBody(baseCss, ".app-shell").match(/--sidebar-width:\s*(\d+)px/u)?.[1]);
  const collapsedWidth = Number(ruleBody(baseCss, ".app-shell--sidebar-collapsed").match(/--sidebar-width:\s*(\d+)px/u)?.[1]);
  assert.ok(Number.isFinite(expandedWidth) && Number.isFinite(collapsedWidth));
  assert.ok(collapsedWidth < expandedWidth, "Collapsed sidebar width must be smaller than expanded width");

  const collapsedLabel = ruleBody(baseCss, ".app-shell--sidebar-collapsed .nav-link__label");
  assert.match(collapsedLabel, /position:\s*absolute/u);
  assert.doesNotMatch(collapsedLabel, /display:\s*none/u);
});

test("mobile uses a complete hamburger-controlled drawer instead of horizontal navigation", async () => {
  const [shell, css] = await Promise.all([
    source("src/ui/components/AppShell.tsx"),
    source("src/ui/styles.css"),
  ]);
  const baseCss = css.slice(0, css.indexOf("@media"));
  const mobileCss = blockBody(css, /@media\s*\(max-width:\s*820px\)/u);

  assert.doesNotMatch(shell, /className="mobile-nav"/u);
  assert.doesNotMatch(css, /\.mobile-nav(?:\s|:|\{)/u);
  assert.match(shell, /\[[^\]]*(?:[Mm]obile|[Dd]rawer)[^\]]*[Oo]pen[^\]]*\]\s*=\s*useState/u);
  assert.match(shell, /aria-expanded=\{[^}]*(?:[Mm]obile|[Dd]rawer)[^}]*[Oo]pen[^}]*\}/u);
  assert.match(shell, /aria-controls="mobile-navigation-drawer"/u);
  assert.match(shell, /(?:Open|Show) navigation/u);
  assert.match(shell, /(?:Close|Hide) navigation/u);
  assert.match(shell, /<dialog[\s\S]*id="mobile-navigation-drawer"/u);
  assert.match(shell, /aria-label="Mobile(?: control panel)? navigation"/u);
  assert.match(shell, /href:\s*"#routing-settings"[^\n]*label:\s*"Settings"/u);
  assert.match(shell, /href:\s*"#methodology"[^\n]*label:\s*"Methodology"/u);
  assert.match(shell, /mobile-drawer__nav[\s\S]*navigation\.map/u);
  assert.match(shell, /mobile-drawer__secondary[\s\S]*secondaryNavigation\.map/u);
  assert.match(shell, /onNavigate=\{closeDrawer\}/u);

  assert.match(ruleBody(baseCss, ".mobile-menu-button"), /display:\s*none/u);
  assert.match(ruleBody(baseCss, ".mobile-drawer"), /position:\s*fixed/u);
  assert.match(ruleBody(baseCss, ".mobile-drawer"), /inset:\s*0/u);
  assert.match(ruleBody(baseCss, ".mobile-drawer:not([open])"), /display:\s*none/u);
  assert.match(ruleBody(mobileCss, ".sidebar"), /display:\s*none/u);
  assert.match(ruleBody(mobileCss, ".mobile-menu-button"), /display:\s*(?!none)[^;]+/u);
});
