// Success criteria at merge time: the PR body must hold a success-criteria table
// (criterion | met? | evidence) with at least one row, every row met, every row with evidence.
// The body comes from the pull_request event; markdown is parsed with mdast (GFM tables),
// so a table inside an HTML comment or a code block never counts.
import { readFileSync } from "node:fs";
import type { Root, Table, TableRow } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { toString } from "mdast-util-to-string";
import { gfm } from "micromark-extension-gfm";

const MET = new Set(["✅", "✔", "✔️", "✓", "☑", "☑️", "yes", "y", "pass", "passed", "met", "true", "done", "[x]"]);
const EMPTY = new Set(["", "-", "—", "–", "…", "...", "tbd", "todo", "?", "n/a", "na", "none"]);

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const cells = (row: TableRow) => row.children.map((c) => toString(c).trim());

function headerIndex(head: string[]) {
  const h = head.map((c) => norm(c).replace(/[?:*]/g, "").trim());
  const criterion = h.findIndex((c) => c === "criterion" || c === "criteria" || c === "success criterion");
  const met = h.findIndex((c) => c === "met");
  const evidence = h.findIndex((c) => c === "evidence" || c === "proof");
  return criterion >= 0 && met >= 0 && evidence >= 0 ? { criterion, met, evidence } : null;
}

export function check(body: string): string[] {
  const tree: Root = fromMarkdown(body, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const tables: { table: Table; cols: NonNullable<ReturnType<typeof headerIndex>> }[] = [];
  const walk = (node: { type: string; children?: unknown[] }) => {
    if (node.type === "table") {
      const t = node as Table;
      const cols = t.children[0] ? headerIndex(cells(t.children[0])) : null;
      if (cols) tables.push({ table: t, cols });
    }
    for (const c of (node.children ?? []) as { type: string }[]) walk(c);
  };
  walk(tree);
  if (!tables.length) {
    return ["No success-criteria table found. Add a table with the columns: Criterion | Met? | Evidence (see .github/pull_request_template.md)."];
  }
  const errors: string[] = [];
  let rows = 0;
  for (const { table, cols } of tables) {
    for (const row of table.children.slice(1)) {
      const c = cells(row);
      const name = c[cols.criterion] ?? "";
      if (!name && !c.some(Boolean)) continue; // a fully blank row
      rows++;
      const label = name ? `"${name.slice(0, 80)}"` : `row ${rows}`;
      if (!name) errors.push(`Row ${rows}: criterion is empty.`);
      if (!MET.has(norm(c[cols.met] ?? ""))) errors.push(`${label}: not marked met (Met? is "${c[cols.met] ?? ""}"; use ✅).`);
      if (EMPTY.has(norm(c[cols.evidence] ?? ""))) errors.push(`${label}: evidence is empty.`);
    }
  }
  if (!rows) errors.push("The success-criteria table has no rows.");
  return errors;
}

if (import.meta.main) {
  const path = process.argv[2] ?? process.env.GITHUB_EVENT_PATH;
  if (!path) throw new Error("usage: bun check.ts <event.json | body.md>");
  const raw = readFileSync(path, "utf8");
  const body = path.endsWith(".json") ? ((JSON.parse(raw).pull_request?.body as string | null) ?? "") : raw;
  const errors = check(body);
  if (errors.length) {
    for (const e of errors) console.log(`::error title=Success criteria::${e}`);
    console.log(`\nFAIL: ${errors.length} problem(s) in the PR's success-criteria table.`);
    process.exit(1);
  }
  console.log("PASS: success-criteria table complete, every row met with evidence.");
}
