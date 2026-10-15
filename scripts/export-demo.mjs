import { mkdir, writeFile } from "node:fs/promises";
import {
  sampleBrief,
  makeDemoBoard,
  applyChange,
  exportMarkdown,
  exportHtml,
} from "../docs/core.mjs";
const root = new URL("../examples/", import.meta.url);
await mkdir(root, { recursive: true });
const before = makeDemoBoard(sampleBrief),
  after = applyChange(
    before,
    { kind: "character", from: "小林", to: "小周" },
    true,
  );
await writeFile(
  new URL("sample-board.json", root),
  JSON.stringify(before, null, 2),
);
await writeFile(
  new URL("changed-board.json", root),
  JSON.stringify(after, null, 2),
);
await writeFile(new URL("sample-board.md", root), exportMarkdown(before));
await writeFile(new URL("sample-print.html", root), exportHtml(before));
console.log("Exported four rule-demo examples; no model calls.");
