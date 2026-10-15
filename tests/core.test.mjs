import test from "node:test";
import assert from "node:assert/strict";
import {
  validateBrief,
  makeDemoBoard,
  checkBoard,
  previewChange,
  applyChange,
  exportMarkdown,
  exportHtml,
  parseModelBoard,
} from "../docs/core.mjs";

const brief = {
  title: "校园一日",
  script: "小林推开图书馆的门。\n小林在湖边读书。\n小林向镜头挥手。",
  characters: ["小林"],
  locations: ["图书馆", "湖边"],
  duration: 30,
};
test("blank script is rejected before generation", () =>
  assert.throws(() => validateBrief({ ...brief, script: "  " }), /脚本/));
test("invalid duration is rejected", () =>
  assert.throws(() => validateBrief({ ...brief, duration: 0 }), /时长/));
test("rule demo preserves source and total duration", () => {
  const b = makeDemoBoard(brief);
  assert.equal(
    b.shots.reduce((a, s) => a + s.duration, 0),
    30,
  );
  assert.equal(b.mode, "demo");
  assert.equal(b.shots[0].source_text, "小林推开图书馆的门。");
  assert.equal(checkBoard(b).filter((i) => i.level === "error").length, 0);
});
test("unknown characters and locations are surfaced", () => {
  const b = makeDemoBoard(brief);
  b.shots[0].characters = ["陌生人"];
  b.shots[0].location = "火星";
  const codes = checkBoard(b).map((x) => x.code);
  assert.ok(codes.includes("unknown_character"));
  assert.ok(codes.includes("unknown_location"));
});
test("duration change is detected", () => {
  const b = makeDemoBoard(brief);
  b.shots[0].duration = 80;
  assert.ok(checkBoard(b).some((x) => x.code === "duration"));
});
test("change preview identifies affected shots without mutating original", () => {
  const b = makeDemoBoard(brief),
    before = JSON.stringify(b);
  const p = previewChange(b, { kind: "character", from: "小林", to: "小周" });
  assert.equal(p.length, 3);
  assert.equal(JSON.stringify(b), before);
});
test("apply change requires explicit confirmation", () =>
  assert.throws(
    () =>
      applyChange(
        makeDemoBoard(brief),
        { kind: "character", from: "小林", to: "小周" },
        false,
      ),
    /确认/,
  ));
test("confirmed change makes a new revision and keeps source evidence unchanged", () => {
  const b = makeDemoBoard(brief),
    n = applyChange(b, { kind: "character", from: "小林", to: "小周" }, true);
  assert.equal(b.characters[0], "小林");
  assert.equal(n.characters[0], "小周");
  assert.equal(n.revision, 2);
  assert.match(n.shots[0].action, /小周/);
  assert.equal(n.shots[0].source_text, b.shots[0].source_text);
});
test("duplicate destination and empty change are rejected", () => {
  const b = makeDemoBoard({ ...brief, characters: ["小林", "小周"] });
  assert.throws(
    () => previewChange(b, { kind: "character", from: "小林", to: "小周" }),
    /已存在/,
  );
  assert.throws(
    () => previewChange(b, { kind: "location", from: "湖边", to: "" }),
    /名称/,
  );
});
test("markdown export includes explicit provenance", () =>
  assert.match(exportMarkdown(makeDemoBoard(brief)), /规则演示/));
test("print HTML escapes untrusted script text", () => {
  const b = makeDemoBoard({ ...brief, script: "<img src=x onerror=alert(1)>" });
  const h = exportHtml(b);
  assert.ok(!h.includes("<img src=x"));
  assert.ok(h.includes("&lt;img"));
});
test("invalid model output never silently becomes a demo result", () => {
  assert.throws(() => parseModelBoard("not-json", brief), /JSON/);
  assert.throws(() => parseModelBoard('{"shots":[]}', brief), /分镜/);
});
test("model JSON is checked and labelled separately", () => {
  const b = makeDemoBoard(brief);
  const n = parseModelBoard(JSON.stringify(b), brief);
  assert.equal(n.mode, "live");
  b.shots[0].characters = ["幻觉角色"];
  assert.throws(() => parseModelBoard(JSON.stringify(b), brief), /分镜/);
});
test("demo never silently discards script paragraphs", () =>
  assert.throws(
    () =>
      makeDemoBoard({
        ...brief,
        script: Array(13).fill("小林读书。").join("\n"),
      }),
    /12/,
  ));
test("import checks missing metadata and invalid revisions", () => {
  const b = makeDemoBoard(brief);
  delete b.target_duration;
  b.revision = "wrong";
  assert.ok(checkBoard(b).some((x) => x.code === "metadata"));
});
