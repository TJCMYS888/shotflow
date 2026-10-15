import {
  sampleBrief,
  validateBrief,
  makeDemoBoard,
  checkBoard,
  previewChange,
  applyChange,
  exportMarkdown,
  exportHtml,
  parseModelBoard,
  modelMessages,
  escapeHtml as e,
} from "./core.mjs";
const $ = (id) => document.getElementById(id),
  key = "shotflow.v1";
let board = null,
  history = [],
  controller = null,
  editing = null,
  pending = null;
function notice(message, error = false) {
  $("notice").hidden = false;
  $("notice").textContent = message;
  $("notice").className = "notice" + (error ? " error" : "");
}
function safely(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (err) {
      notice(err.message, true);
    }
  };
}
function loadBrief(b) {
  for (const f of ["title", "script", "duration"]) $(f).value = b[f];
  $("characters").value = b.characters.join("、");
  $("locations").value = b.locations.join("、");
}
function readBrief() {
  return validateBrief({
    title: $("title").value.trim(),
    script: $("script").value.trim(),
    duration: Number($("duration").value),
    characters: $("characters")
      .value.split(/[、,，\n]/)
      .map((x) => x.trim())
      .filter(Boolean),
    locations: $("locations")
      .value.split(/[、,，\n]/)
      .map((x) => x.trim())
      .filter(Boolean),
  });
}
function persist() {
  try {
    localStorage.setItem(key, JSON.stringify({ board, history }));
  } catch {
    notice("浏览器存储不可用或已满，请导出JSON备份", true);
  }
}
function canRestoreDraft(b) {
  return (
    b &&
    typeof b.title === "string" &&
    Array.isArray(b.shots) &&
    b.shots.every(
      (s) => s && Number.isFinite(s.duration) && Array.isArray(s.characters),
    ) &&
    !checkBoard(b).some(
      (x) =>
        x.level === "error" && ["schema", "metadata", "id"].includes(x.code),
    )
  );
}
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function renderHistory() {
  $("history").innerHTML =
    '<option value="">选择保存版本…</option>' +
    history
      .map(
        (v, i) =>
          `<option value="${i}">${e(v.title)} · v${v.revision} · ${e(new Date(v.saved_at).toLocaleTimeString())}</option>`,
      )
      .join("");
}
function renderChecks() {
  if (!board) return;
  const issues = checkBoard(board),
    errors = issues.filter((x) => x.level === "error");
  $("checks").innerHTML =
    `<div class="checks ${errors.length ? "has-errors" : ""}"><strong>${issues.length ? `${errors.length}项错误 · ${issues.length - errors.length}项待复核` : "规则检查通过"}</strong>${issues.length ? `<ul>${issues.map((x) => `<li>${e(x.shot_id)} ${e(x.message)}</li>`).join("")}</ul>` : " · 角色、地点、时长及来源引用符合当前规则；创作质量请人工复核。"}</div>`;
}
function renderFrom() {
  if (board)
    $("change-from").innerHTML = board[
      $("change-kind").value === "character" ? "characters" : "locations"
    ]
      .map((x) => `<option>${e(x)}</option>`)
      .join("");
  pending = null;
  $("change-preview").textContent = "";
  $("apply-change").hidden = true;
}
function render() {
  $("empty").hidden = !!board;
  $("change-panel").hidden = !board;
  for (const id of ["save", "export-md", "export-html", "export-json"])
    $(id).disabled = !board;
  renderHistory();
  if (!board) {
    $("shots").textContent = "";
    return;
  }
  $("board-title").textContent = board.title;
  $("board-meta").textContent =
    `${board.shots.length}个镜头 · ${board.shots.reduce((n, s) => n + s.duration, 0)}秒 · 当前v${board.revision} · ${board.mode === "demo" ? "规则演示" : "模型生成"}`;
  $("shots").innerHTML = board.shots
    .map(
      (s) =>
        `<article class="shot-card"><div class="shot-visual"><span>${e(s.id)} / TEXT BOARD</span><strong>${e(s.location)}</strong><small>文字分镜示意 · ${s.duration}s</small></div><div class="shot-content"><div class="shot-header"><h3>${e(s.framing)} · ${e(s.movement)}</h3><button data-edit="${e(s.id)}">编辑镜头</button></div><p class="shot-tags">${e(s.characters.join("、") || "空镜")} / ${s.duration}秒</p><p>${e(s.action)}</p>${s.dialogue ? `<p>对白：${e(s.dialogue)}</p>` : ""}<details><summary>来源依据与绘图提示</summary><p>原文：${e(s.source_text)}</p><p>${e(s.image_prompt)}</p></details></div></article>`,
    )
    .join("");
  renderChecks();
  renderFrom();
  persist();
}
$("sample").onclick = () => {
  loadBrief(sampleBrief);
  notice("已填入校园宣传片样例，可直接生成或先修改简报。");
};
$("brief-form").onsubmit = safely(async (event) => {
  event.preventDefault();
  const brief = readBrief(),
    mode = $("mode").value;
  $("brief-fields").disabled = true;
  $("generate").textContent = "正在生成…";
  controller = new AbortController();
  $("cancel").hidden = mode !== "live";
  try {
    if (mode === "demo") board = makeDemoBoard(brief);
    else {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: modelMessages(brief) }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error ?? "模型服务请求失败");
      board = parseModelBoard(data.content, brief);
      board.model = data.model;
      board.usage = data.usage;
    }
    pending = null;
    render();
    notice(
      mode === "demo"
        ? "已生成规则演示草案。请编辑镜头并检查拍摄可行性。"
        : "模型草案已通过结构检查，请人工复核内容。",
    );
  } catch (err) {
    notice(
      err.name === "AbortError"
        ? "已取消等待，现有分镜保持不变。"
        : err.message,
      true,
    );
  } finally {
    controller = null;
    $("brief-fields").disabled = false;
    $("generate").innerHTML = "生成分镜草案 <span>→</span>";
    $("cancel").hidden = true;
  }
});
$("cancel").onclick = () => controller?.abort();
$("save").onclick = () => {
  if (!board) return;
  history.unshift({
    ...structuredClone(board),
    saved_at: new Date().toISOString(),
  });
  history = history.slice(0, 20);
  persist();
  renderHistory();
  notice(`已保存v${board.revision}。历史版本不会被后续修改覆盖。`);
};
$("history").onchange = safely(() => {
  if ($("history").value === "") return;
  board = structuredClone(history[Number($("history").value)]);
  render();
  notice("已恢复所选版本，可继续编辑或导出。");
});
$("shots").onclick = (event) => {
  const button = event.target.closest("[data-edit]");
  if (!button) return;
  editing = button.dataset.edit;
  const s = board.shots.find((x) => x.id === editing),
    f = $("edit-form");
  $("edit-title").textContent = `编辑 ${s.id}`;
  f.elements.location.innerHTML = board.locations
    .map((x) => `<option>${e(x)}</option>`)
    .join("");
  for (const name of [
    "duration",
    "location",
    "characters",
    "framing",
    "movement",
    "action",
    "dialogue",
    "image_prompt",
  ])
    f.elements[name].value =
      name === "characters" ? s.characters.join("、") : s[name];
  $("edit-dialog").showModal();
};
$("close-edit").onclick = () => $("edit-dialog").close();
$("edit-form").onsubmit = safely((event) => {
  event.preventDefault();
  const f = event.target,
    next = structuredClone(board),
    s = next.shots.find((x) => x.id === editing);
  for (const name of [
    "duration",
    "location",
    "framing",
    "movement",
    "action",
    "dialogue",
    "image_prompt",
  ])
    s[name] =
      name === "duration"
        ? Number(f.elements[name].value)
        : f.elements[name].value.trim();
  s.characters = f.elements.characters.value
    .split(/[、,，]/)
    .map((x) => x.trim())
    .filter(Boolean);
  next.revision++;
  board = next;
  $("edit-dialog").close();
  render();
  notice("镜头已更新。规则检查会显示仍需处理的问题。");
});
$("change-kind").onchange = renderFrom;
for (const id of ["change-from", "change-to"])
  $(id).oninput = () => {
    pending = null;
    $("apply-change").hidden = true;
    $("change-preview").textContent = "";
  };
$("preview-change").onclick = safely(() => {
  const c = {
      kind: $("change-kind").value,
      from: $("change-from").value,
      to: $("change-to").value.trim(),
    },
    changes = previewChange(board, c);
  pending = c;
  $("change-preview").innerHTML =
    `<p class="micro">影响${changes.length}个镜头，原始脚本依据保留。此检查匹配字段及名称文字，语义影响需人工复核。</p>` +
    changes
      .map(
        (x) =>
          `<div class="impact"><strong>${e(x.id)}</strong><br>修改前：${e(x.before)}<br>修改后：${e(x.after)}</div>`,
      )
      .join("");
  $("apply-change").hidden = false;
});
$("apply-change").onclick = safely(() => {
  if (!pending) throw Error("请重新预览变更");
  board = applyChange(board, pending, true);
  render();
  notice("已应用变更并生成新版本，请检查所有受影响镜头。");
});
$("export-md").onclick = () =>
  download(
    "shotflow-board.md",
    exportMarkdown(board),
    "text/markdown;charset=utf-8",
  );
$("export-html").onclick = () =>
  download("shotflow-print.html", exportHtml(board), "text/html;charset=utf-8");
$("export-json").onclick = () =>
  download(
    "shotflow-board.json",
    JSON.stringify(board, null, 2),
    "application/json",
  );
$("import").onchange = safely(async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 300000) throw Error("JSON文件超过300KB");
    const b = JSON.parse(await file.text());
    if (
      !b ||
      typeof b.title !== "string" ||
      !["demo", "live"].includes(b.mode) ||
      typeof b.source_script !== "string"
    )
      throw Error("不是有效的ShotFlow分镜文件");
    const issues = checkBoard(b);
    if (issues.some((x) => x.level === "error"))
      throw Error(
        "导入分镜未通过校验：" + issues.map((x) => x.message).join("；"),
      );
    board = b;
    render();
    notice("分镜已导入。");
  } finally {
    event.target.value = "";
  }
});
loadBrief(sampleBrief);
try {
  const saved = JSON.parse(localStorage.getItem(key) || "null");
  if (saved) {
    history = Array.isArray(saved.history)
      ? saved.history.filter(canRestoreDraft).slice(0, 20)
      : [];
    if (canRestoreDraft(saved.board)) board = saved.board;
  }
} catch {
  notice("旧的本地记录无法读取，已保留样例简报。", true);
}
render();
$("mode").onchange = () => {
  $("mode-badge").textContent =
    $("mode").value === "demo" ? "规则演示 · 无需密钥" : "真实模型 · 本地服务";
};
fetch("/api/status")
  .then((r) => (r.ok ? r.json() : Promise.reject()))
  .then((s) => {
    $("service").textContent = s.configured
      ? `本地模型服务就绪：${s.model}`
      : "真实模式需配置AI_API_KEY、AI_MODEL及AI_BASE_URL。";
  })
  .catch(() => {
    $("service").textContent =
      "当前为静态演示站。运行python server.py可连接真实模型。";
  });
