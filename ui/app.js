const $ = (id) => document.getElementById(id);
const api = window.docsFinder;
const DEFAULT_EXCLUDES =
  ".git, node_modules, .next, dist, build, release, $RECYCLE.BIN, System Volume Information";
const labels = {
  pdf: "PDF",
  excel: "Excel",
  powerpoint: "PowerPoint",
  word: "Word",
  text: "텍스트",
};
const symbols = {
  pdf: "PDF",
  excel: "X",
  powerpoint: "P",
  word: "W",
  text: "</>",
};
const state = {
  running: false,
  started: false,
  id: null,
  results: [],
  selected: null,
  filter: "all",
  limit: 100,
  issues: [],
  issueCount: 0,
  stats: {},
  root: "",
  query: "",
  status: "",
};
let scheduled = false,
  toastTimer;

function node(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content != null) element.textContent = content;
  return element;
}
function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}
function fileIcon(type) {
  return node("span", `file-icon ${type}`, symbols[type]);
}
function readStorage(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Optional convenience only. */
  }
}
function toast(message, error = false) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").className = `toast${error ? " error" : ""}`;
  $("toast").hidden = false;
  toastTimer = setTimeout(
    () => {
      $("toast").hidden = true;
    },
    error ? 6000 : 2500,
  );
}
function showError(message) {
  $("form-error").textContent = message;
  $("form-error").hidden = !message;
}
async function action(callback, success) {
  try {
    const result = await callback();
    if (result && success) toast(success);
    return result;
  } catch (error) {
    toast(
      error.message.replace(
        /^Error invoking remote method '[^']+': Error: /,
        "",
      ),
      true,
    );
  }
}
function locationLabel(location) {
  if (location.type === "line") return `${location.line}행`;
  if (location.type === "page") return `${location.page}페이지`;
  if (location.type === "cell") return `${location.sheet}!${location.address}`;
  if (location.type === "slide")
    return `${location.slide}번 슬라이드${location.section ? ` · ${location.section}` : ""}`;
  return `${location.section} · 문단 ${location.paragraph}`;
}
function highlighted(snippet, className = "snippet") {
  const element = node("p", className);
  if (snippet.prefix) element.append("… ");
  let cursor = 0;
  for (const range of snippet.ranges) {
    element.append(
      document.createTextNode(snippet.text.slice(cursor, range.start)),
    );
    element.append(
      node("mark", "", snippet.text.slice(range.start, range.end)),
    );
    cursor = range.end;
  }
  element.append(document.createTextNode(snippet.text.slice(cursor)));
  if (snippet.suffix) element.append(" …");
  return element;
}
function saveRecent(key, value, limit) {
  let values = readStorage(key, []);
  if (!Array.isArray(values)) values = [];
  writeStorage(
    key,
    [
      value,
      ...values.filter((v) => typeof v === "string" && v !== value),
    ].slice(0, limit),
  );
  renderRecents();
}
function renderRecents() {
  const stored = readStorage("docs-folders", []);
  const folders = Array.isArray(stored)
    ? stored.filter((s) => typeof s === "string").slice(0, 6)
    : [];
  $("recent-count").textContent = folders.length;
  $("recent-folders").replaceChildren();
  if (!folders.length)
    $("recent-folders").append(
      node("p", "recent-placeholder", "검색한 폴더가 여기에\n표시됩니다."),
    );
  for (const folder of folders) {
    const button = node("button", "recent-folder");
    button.title = folder;
    button.disabled = state.running;
    button.append(
      icon("folder"),
      node("span", "", folder.split(/[\\/]/).filter(Boolean).at(-1) || folder),
    );
    button.addEventListener("click", () => {
      $("root").value = folder;
      savePreferences();
      $("query").focus();
    });
    $("recent-folders").append(button);
  }
  const rawQueries = readStorage("docs-queries", []);
  const queries = Array.isArray(rawQueries)
    ? rawQueries.filter((s) => typeof s === "string").slice(0, 5)
    : [];
  $("search-history").hidden = !queries.length;
  $("clear-history").hidden = queries.length < 2;
  $("clear-history").disabled = state.running;
  $("history-chips").replaceChildren();
  for (const [index, query] of queries.entries()) {
    const chip = node("div", "history-chip");
    const button = node("button", "history-query", query);
    button.type = "button";
    button.title = query;
    button.disabled = state.running;
    button.addEventListener("click", () => {
      $("query").value = query;
      $("query").focus();
    });
    const remove = node("button", "history-remove");
    remove.type = "button";
    remove.title = `검색 기록 삭제: ${query}`;
    remove.setAttribute("aria-label", `검색 기록 삭제: ${query}`);
    remove.disabled = state.running;
    remove.append(icon("close"));
    remove.addEventListener("click", () => {
      writeStorage(
        "docs-queries",
        queries.filter((value) => value !== query),
      );
      renderRecents();
      const buttons = $("history-chips").querySelectorAll(".history-remove");
      (buttons[Math.min(index, buttons.length - 1)] ?? $("query")).focus();
    });
    chip.append(button, remove);
    $("history-chips").append(chip);
  }
}
function getOptions() {
  return {
    root: $("root").value.trim(),
    query: $("query").value,
    recursive: $("recursive").checked,
    caseSensitive: $("case-sensitive").checked,
    wholeWord: $("whole-word").checked,
    regex: $("regex").checked,
    hidden: $("hidden-files").checked,
    extensions: $("extensions").value,
    excludes: $("excludes").value,
    maxSizeMB: Number($("max-size").value),
    encoding: $("encoding").value,
  };
}
function savePreferences() {
  const { query, ...preferences } = getOptions();
  writeStorage("docs-preferences", preferences);
}
function loadPreferences() {
  $("excludes").value = DEFAULT_EXCLUDES;
  const preferences = readStorage("docs-preferences", {});
  if (!preferences || typeof preferences !== "object") return;
  const fields = {
    root: "root",
    extensions: "extensions",
    excludes: "excludes",
    maxSizeMB: "max-size",
    encoding: "encoding",
  };
  for (const [key, id] of Object.entries(fields))
    if (
      typeof preferences[key] === "string" ||
      typeof preferences[key] === "number"
    )
      $(id).value = preferences[key];
  for (const [key, id] of Object.entries({
    recursive: "recursive",
    caseSensitive: "case-sensitive",
    wholeWord: "whole-word",
    regex: "regex",
    hidden: "hidden-files",
  }))
    if (typeof preferences[key] === "boolean") $(id).checked = preferences[key];
}
function setRunning(value) {
  state.running = value;
  for (const element of $("search-form").querySelectorAll("input,select"))
    element.disabled = value;
  $("choose-folder").disabled = value;
  $("clear-query").disabled = value;
  $("search-button").hidden = value;
  $("cancel-button").hidden = !value;
  $("cancel-button").disabled = false;
  $("search-progress").hidden = !value;
  $("search-state").classList.toggle("running", value);
  renderRecents();
}
async function chooseFolder() {
  if (state.running) return;
  const folder = await action(() => api.chooseFolder());
  if (folder) {
    $("root").value = folder;
    savePreferences();
    showError("");
    $("query").focus();
  }
}
async function startSearch(event) {
  event?.preventDefault();
  if (state.running) return;
  const options = getOptions();
  if (!options.root)
    return showError("검색할 폴더를 선택하거나 경로를 입력해 주세요.");
  if (!options.query.trim()) {
    $("query").focus();
    return showError("검색어를 입력해 주세요.");
  }
  showError("");
  state.id = null;
  state.query = options.query;
  setRunning(true);
  $("search-state").textContent = "검색 시작 중";
  savePreferences();
  try {
    const response = await api.startSearch(options);
    state.id = response.id;
    state.root = response.root;
    saveRecent("docs-folders", response.root, 6);
    saveRecent("docs-queries", options.query, 5);
  } catch (error) {
    setRunning(false);
    $("search-state").textContent = "검색 준비";
    showError(
      error.message.replace(
        /^Error invoking remote method '[^']+': Error: /,
        "",
      ),
    );
  }
}
async function cancelSearch() {
  if (!state.running) return;
  $("cancel-button").disabled = true;
  $("search-state").textContent = "중지 중";
  await action(() => api.cancelSearch());
}
function filtered() {
  const results = state.results.filter(
    (result) => state.filter === "all" || result.type === state.filter,
  );
  const sort = $("sort-results").value;
  if (sort === "name")
    results.sort((a, b) =>
      a.fileName.localeCompare(b.fileName, "ko", { numeric: true }),
    );
  if (sort === "count") results.sort((a, b) => b.matchCount - a.matchCount);
  if (sort === "modified") results.sort((a, b) => b.modified - a.modified);
  return results;
}
function scheduleRender() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    renderResults();
  });
}
function selectResult(file) {
  state.selected = file.filePath;
  for (const row of $("file-list").children) {
    const selected = row.dataset.path === file.filePath;
    row.classList.toggle("selected", selected);
    row.setAttribute("aria-selected", selected);
    row.tabIndex = selected ? 0 : -1;
  }
  renderPreview(file);
}
function renderResults() {
  $("result-count").textContent = state.results.length.toLocaleString();
  $("export-results").disabled = !state.results.length;
  for (const tab of document.querySelectorAll(".type-tabs button")) {
    tab.querySelector("span").textContent = (
      tab.dataset.type === "all"
        ? state.results.length
        : state.results.filter((file) => file.type === tab.dataset.type).length
    ).toLocaleString();
    tab.classList.toggle("selected", tab.dataset.type === state.filter);
    tab.setAttribute("aria-selected", tab.dataset.type === state.filter);
  }
  $("initial-empty").hidden = state.started;
  $("results-layout").hidden = !state.started;
  const results = filtered();
  const visible = results.slice(0, state.limit);
  $("list-caption").textContent =
    `일치하는 파일 ${results.length.toLocaleString()}개`;
  $("load-more").hidden = results.length <= state.limit;
  $("load-more").textContent =
    `결과 더 보기 (${Math.min(state.limit, results.length)} / ${results.length.toLocaleString()})`;
  $("list-empty").hidden = !!results.length;
  $("file-list").hidden = !results.length;
  if (!results.length) {
    $("list-empty-title").textContent = state.running
      ? "문서 내용을 살펴보고 있습니다"
      : "일치하는 내용이 없습니다";
    $("list-empty-description").textContent = state.running
      ? "발견한 결과는 이곳에 바로 표시됩니다."
      : state.stats.errors || state.stats.skipped
        ? "검색어나 필터를 변경하거나, 아래 처리 내역을 확인해 주세요."
        : "검색어나 파일 필터를 변경해 보세요.";
  }
  const fragment = document.createDocumentFragment();
  for (const file of visible) {
    const row = node("button", "file-row");
    row.type = "button";
    row.dataset.path = file.filePath;
    row.setAttribute("role", "option");
    row.setAttribute(
      "aria-label",
      `${file.fileName}, ${file.matchCount}개 일치`,
    );
    row.title = file.filePath;
    row.append(fileIcon(file.type));
    const body = node("div", "file-row-body");
    const title = node("div", "file-row-title");
    title.append(
      node("span", "file-name", file.fileName),
      node(
        "span",
        "match-count",
        `${file.matchCount}${file.truncated ? "+" : ""}개 일치`,
      ),
    );
    body.append(title, node("div", "file-path", file.relativePath));
    const first = file.matches[0];
    body.append(highlighted(first.snippets[0], "file-summary"));
    const location = node("div", "file-location");
    location.append(
      icon("doc"),
      node(
        "span",
        "",
        locationLabel(first.location) +
          (file.matches.length > 1 ? ` 외 ${file.matches.length - 1}곳` : ""),
      ),
    );
    body.append(location);
    row.append(body);
    row.addEventListener("click", () => selectResult(file));
    row.addEventListener("dblclick", () =>
      action(() => api.openFile(file.filePath)),
    );
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        action(() => api.openFile(file.filePath));
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const target =
          event.key === "ArrowDown"
            ? row.nextElementSibling
            : row.previousElementSibling;
        if (target) {
          const next = state.results.find(
            (f) => f.filePath === target.dataset.path,
          );
          selectResult(next);
          target.focus();
        }
      }
    });
    fragment.append(row);
  }
  const scrollTop = $("file-list").scrollTop;
  const focusedPath = $("file-list").contains(document.activeElement)
    ? document.activeElement.dataset.path
    : null;
  $("file-list").replaceChildren(fragment);
  $("file-list").scrollTop = scrollTop;
  const selection =
    results.find((file) => file.filePath === state.selected) ?? results[0];
  if (selection) selectResult(selection);
  else {
    state.selected = null;
    $("preview").dataset.filePath = "";
    const placeholder = node("div", "preview-placeholder");
    placeholder.append(
      icon("doc"),
      node(
        "p",
        "",
        state.running
          ? "일치하는 파일을 찾고 있습니다."
          : "표시할 검색 결과가 없습니다.",
      ),
    );
    $("preview").replaceChildren(placeholder);
  }
  if (focusedPath)
    [...$("file-list").children]
      .find((row) => row.dataset.path === focusedPath)
      ?.focus({ preventScroll: true });
}
function renderPreview(file) {
  if ($("preview").dataset.filePath === file.filePath) return;
  $("preview").dataset.filePath = file.filePath;
  const header = node("div", "preview-header");
  header.append(node("div", "preview-eyebrow", "MATCH PREVIEW"));
  const title = node("div", "preview-title");
  title.append(fileIcon(file.type), node("h3", "", file.fileName));
  header.append(title, node("p", "preview-path", file.filePath));
  const meta = node("div", "file-meta");
  meta.append(
    node("span", "", labels[file.type]),
    node(
      "span",
      "",
      file.size < 1024 * 1024
        ? `${(file.size / 1024).toFixed(1)} KB`
        : `${(file.size / 1024 / 1024).toFixed(1)} MB`,
    ),
    node("span", "", new Date(file.modified).toLocaleDateString("ko-KR")),
  );
  header.append(meta);
  const actions = node("div", "preview-actions");
  for (const [label, symbol, callback, primary, success] of [
    ["파일 열기", "open", () => api.openFile(file.filePath), true],
    ["폴더에서 보기", "folder", () => api.revealFile(file.filePath)],
    [
      "경로 복사",
      "copy",
      () => api.copyPath(file.filePath),
      false,
      "파일 경로를 복사했습니다.",
    ],
  ]) {
    const button = node(
      "button",
      `button ${primary ? "primary" : "secondary"}`,
    );
    button.type = "button";
    button.append(icon(symbol), document.createTextNode(label));
    button.addEventListener("click", () => action(callback, success));
    actions.append(button);
  }
  header.append(actions);
  const matches = node("div", "preview-matches");
  const heading = node("div", "matches-title");
  heading.append(
    node("span", "", "문서 안에서 찾은 내용"),
    node("strong", "", `${file.matchCount}${file.truncated ? "+" : ""}개 일치`),
  );
  matches.append(heading);
  if (file.truncated)
    matches.append(
      node(
        "p",
        "preview-note",
        "파일당 일치 수 상한에 도달해 이 파일의 추가 검색을 중단했습니다.",
      ),
    );
  for (const match of file.matches) {
    const block = node("div", "match-block");
    const location = node("div", "location-label");
    location.append(
      icon("doc"),
      node("span", "", locationLabel(match.location)),
    );
    block.append(location);
    for (const snippet of match.snippets) block.append(highlighted(snippet));
    matches.append(block);
  }
  if (file.type !== "text")
    matches.append(
      node(
        "p",
        "preview-note",
        "원본은 기본 연결 프로그램으로 열립니다. 표시된 페이지·셀·슬라이드로의 자동 이동은 지원하지 않습니다.",
      ),
    );
  $("preview").replaceChildren(header, matches);
  $("preview").scrollTop = 0;
}
function updateStats(stats) {
  state.stats = stats;
  const seconds = ((stats.elapsedMs ?? 0) / 1000).toFixed(1);
  $("progress-text").replaceChildren(
    node("span", "online-dot"),
    document.createTextNode(
      `${(stats.processed ?? 0).toLocaleString()}개 파일 처리 · ${(stats.matches ?? 0).toLocaleString()}개 일치 · ${stats.skipped ?? 0}개 건너뜀 · ${stats.errors ?? 0}개 오류 · ${seconds}초`,
    ),
  );
  $("progress-text").title = $("progress-text").textContent;
}
function renderIssues() {
  $("issue-count").textContent = state.issueCount.toLocaleString();
  $("issues-toggle").classList.toggle("has-issues", state.issueCount > 0);
  const fragment = document.createDocumentFragment();
  if (!state.issues.length)
    fragment.append(
      node("p", "no-issues", "건너뛰거나 읽지 못한 문서가 없습니다."),
    );
  for (const issue of state.issues) {
    const row = node("div", "issue-row");
    row.append(
      node(
        "span",
        `issue-tag ${issue.kind}`,
        issue.kind === "error"
          ? "오류"
          : issue.kind === "warning"
            ? "안내"
            : "건너뜀",
      ),
    );
    const content = node("div", "issue-content");
    content.append(
      node("span", "issue-message", issue.message),
      node("p", "", issue.filePath),
    );
    row.append(content);
    fragment.append(row);
  }
  $("issues-list").replaceChildren(fragment);
}
function onSearchEvent(event) {
  if (event.type === "choose-folder") {
    chooseFolder();
    return;
  }
  if (!state.running || (state.id && event.searchId !== state.id)) return;
  state.id = event.searchId;
  if (event.type === "start") {
    Object.assign(state, {
      started: true,
      results: [],
      selected: null,
      issues: [],
      issueCount: 0,
      filter: "all",
      limit: 100,
      root: event.root,
    });
    $("preview").dataset.filePath = "";
    $("issues-panel").hidden = true;
    $("issues-toggle").setAttribute("aria-expanded", "false");
    $("search-state").textContent = "문서 내용 검색 중";
    renderIssues();
    renderResults();
    updateStats(event.stats);
  }
  if (event.type === "result") {
    state.results.push(event.result);
    scheduleRender();
  }
  if (event.type === "progress") {
    updateStats(event.stats);
    if (event.currentFiles?.length)
      $("search-state").title = event.currentFiles.join("\n");
  }
  if (event.type === "issue") {
    state.issueCount++;
    if (state.issues.length < 500) state.issues.push(event);
    $("issue-count").textContent = state.issueCount.toLocaleString();
    $("issues-toggle").classList.add("has-issues");
    if (!$("issues-panel").hidden) renderIssues();
  }
  if (event.type === "done") {
    state.status = event.status;
    setRunning(false);
    $("search-state").textContent =
      event.status === "cancelled"
        ? "검색 중지됨"
        : event.status === "limit"
          ? "결과 상한 도달"
          : "검색 완료";
    $("search-state").title = "";
    updateStats(event.stats);
    renderResults();
    renderIssues();
    if (event.status === "limit")
      toast(
        "결과 파일 10,000개에 도달했습니다. 폴더나 파일 형식을 좁혀 검색해 주세요.",
      );
    if (!state.results.length && state.issueCount) {
      $("issues-panel").hidden = false;
      $("issues-toggle").setAttribute("aria-expanded", "true");
    }
  }
  if (event.type === "fatal") {
    setRunning(false);
    showError(event.message);
    $("search-state").textContent = "검색 실패";
    renderResults();
  }
}

$("search-form").addEventListener("submit", startSearch);
$("choose-folder").addEventListener("click", chooseFolder);
$("cancel-button").addEventListener("click", cancelSearch);
$("clear-query").addEventListener("click", () => {
  $("query").value = "";
  $("query").focus();
});
$("clear-history").addEventListener("click", () => {
  writeStorage("docs-queries", []);
  renderRecents();
  $("query").focus();
});
$("advanced-toggle").addEventListener("click", () => {
  const expanded = $("advanced-options").hidden;
  $("advanced-options").hidden = !expanded;
  $("advanced-toggle").setAttribute("aria-expanded", expanded);
});
$("issues-toggle").addEventListener("click", () => {
  const expanded = $("issues-panel").hidden;
  $("issues-panel").hidden = !expanded;
  $("issues-toggle").setAttribute("aria-expanded", expanded);
  if (expanded) renderIssues();
});
$("export-results").addEventListener("click", () =>
  action(() => api.exportResults(), "검색 결과를 CSV로 저장했습니다."),
);
$("load-more").addEventListener("click", () => {
  state.limit += 100;
  renderResults();
});
$("sort-results").addEventListener("change", renderResults);
for (const tab of document.querySelectorAll(".type-tabs button"))
  tab.addEventListener("click", () => {
    state.filter = tab.dataset.type;
    state.limit = 100;
    $("preview").dataset.filePath = "";
    renderResults();
  });
$("nav-search").addEventListener("click", () => $("query").focus());
document.querySelector(".brand").addEventListener("click", (event) => {
  event.preventDefault();
  $("query").focus();
});
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    startSearch();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
    event.preventDefault();
    $("query").focus();
    $("query").select();
  }
  if (event.key === "Escape" && state.running) cancelSearch();
});
$("search-form").addEventListener("change", savePreferences);
loadPreferences();
renderRecents();
renderIssues();
if (api) api.onSearchEvent(onSearchEvent);
else {
  showError(
    "Electron에서 실행해 주세요. 프로젝트 폴더에서 npm start를 사용합니다.",
  );
  $("search-button").disabled = true;
}
