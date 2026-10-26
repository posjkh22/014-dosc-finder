const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  clipboard,
  Menu,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");
const { randomUUID } = require("node:crypto");

const profileArg = process.argv.find((value) =>
  value.startsWith("--user-data-dir="),
);
if (profileArg) {
  const profilePath = path.resolve(profileArg.slice("--user-data-dir=".length));
  require("node:fs").mkdirSync(profilePath, { recursive: true });
  app.setPath("userData", profilePath);
}

let window, active, currentRoot;
let results = new Map();
const uiPath = path.join(__dirname, "../ui/index.html");
const rendererURL = pathToFileURL(uiPath).href;
const dangerous = new Set([
  ".exe",
  ".com",
  ".bat",
  ".cmd",
  ".ps1",
  ".vbs",
  ".vbe",
  ".js",
  ".jse",
  ".mjs",
  ".cjs",
  ".py",
  ".pyw",
  ".rb",
  ".pl",
  ".php",
  ".psm1",
  ".sct",
  ".wsc",
  ".wsf",
  ".wsh",
  ".hta",
  ".scr",
  ".msi",
  ".msp",
  ".reg",
  ".lnk",
  ".url",
  ".sh",
]);

function trusted(event) {
  if (
    event.sender !== window?.webContents ||
    event.senderFrame?.url !== rendererURL
  )
    throw new Error("허용되지 않은 요청입니다.");
}
function handle(channel, callback) {
  ipcMain.handle(channel, async (event, ...args) => {
    trusted(event);
    return callback(...args);
  });
}
function send(payload, searchId) {
  if (window && !window.isDestroyed())
    window.webContents.send("search:event", { ...payload, searchId });
}
async function registered(filePath) {
  if (typeof filePath !== "string" || !results.has(filePath))
    throw new Error("현재 검색 결과에 있는 파일만 사용할 수 있습니다.");
  const real = await fs.realpath(filePath);
  const rel = path.relative(currentRoot, real);
  if (
    rel === ".." ||
    rel.startsWith(`..${path.sep}`) ||
    path.isAbsolute(rel) ||
    real !== filePath
  )
    throw new Error("파일 경로가 변경되었습니다. 다시 검색해 주세요.");
  if (!(await fs.stat(real)).isFile())
    throw new Error("파일이 없거나 경로가 변경되었습니다.");
  return real;
}
function locationLabel(location) {
  if (location.type === "line") return `${location.line}행`;
  if (location.type === "page") return `${location.page}페이지`;
  if (location.type === "cell") return `${location.sheet}!${location.address}`;
  if (location.type === "slide")
    return `${location.slide}번 슬라이드${location.section ? ` · ${location.section}` : ""}`;
  return `${location.section} · 문단 ${location.paragraph}`;
}
function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
function setupIPC() {
  handle("folder:choose", async () => {
    const result = await dialog.showOpenDialog(window, {
      title: "검색할 폴더 선택",
      properties: ["openDirectory"],
      defaultPath: currentRoot || app.getPath("documents"),
    });
    return result.canceled ? null : result.filePaths[0];
  });
  handle("search:start", async (input) => {
    if (active) throw new Error("진행 중인 검색을 먼저 중지해 주세요.");
    const { normalizeOptions } = await import("../core/options.js");
    const options = normalizeOptions(input);
    currentRoot = await fs.realpath(options.root).catch(() => {
      throw new Error("폴더가 없거나 접근할 수 없습니다.");
    });
    if (!(await fs.stat(currentRoot)).isDirectory())
      throw new Error("폴더 경로를 입력해 주세요.");
    results = new Map();
    const id = randomUUID();
    const controller = new AbortController();
    active = { id, controller };
    setImmediate(async () => {
      try {
        const { runSearch } = await import("../core/search-engine.js");
        await runSearch(
          { ...options, root: currentRoot },
          {
            signal: controller.signal,
            onEvent: (event) => {
              if (active?.id !== id) return;
              if (event.type === "result")
                results.set(event.result.filePath, event.result);
              send(event, id);
            },
          },
        );
      } catch (error) {
        send({ type: "fatal", message: error.message }, id);
      } finally {
        if (active?.id === id) active = null;
      }
    });
    return { id, root: currentRoot };
  });
  handle("search:cancel", () => {
    active?.controller.abort();
    return true;
  });
  handle("file:copy", async (filePath) => {
    clipboard.writeText(await registered(filePath));
    return true;
  });
  handle("file:reveal", async (filePath) => {
    shell.showItemInFolder(await registered(filePath));
    return true;
  });
  handle("file:open", async (filePath) => {
    const resolved = await registered(filePath);
    // On Windows .js and shell scripts can execute when opened by association.
    // Open these as text, with an argument array and without a command shell.
    if (dangerous.has(path.extname(resolved).toLowerCase())) {
      if (process.platform === "win32") {
        const { spawn } = require("node:child_process");
        await new Promise((resolve, reject) => {
          const child = spawn("notepad.exe", [resolved], {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
          });
          child.once("error", reject);
          child.once("spawn", () => {
            child.unref();
            resolve();
          });
        });
        return true;
      }
      throw new Error("실행 가능한 스크립트는 탐색기에서 확인해 주세요.");
    }
    const error = await shell.openPath(resolved);
    if (error) throw new Error(error);
    return true;
  });
  handle("results:export", async () => {
    if (!results.size) throw new Error("내보낼 검색 결과가 없습니다.");
    const snapshot = [...results.values()];
    const destination = await dialog.showSaveDialog(window, {
      title: "검색 결과 저장",
      defaultPath: `검색결과-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (destination.canceled) return null;
    const rows = [["파일명", "파일 경로", "형식", "위치", "일치 수", "내용"]];
    for (const file of snapshot)
      for (const match of file.matches)
        rows.push([
          file.fileName,
          file.filePath,
          file.type,
          locationLabel(match.location),
          match.count,
          match.snippets.map((s) => s.text).join(" … "),
        ]);
    await fs.writeFile(
      destination.filePath,
      "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n"),
      "utf8",
    );
    return destination.filePath;
  });
}
function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1040,
    minHeight: 720,
    backgroundColor: "#f6f7f9",
    title: "Docs Finder",
    icon: path.join(__dirname, "../assets/icon.png"),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  window.loadFile(uiPath);
  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.on("closed", () => {
    active?.controller.abort();
    window = null;
  });
  if (process.argv.includes("--dev"))
    window.webContents.openDevTools({ mode: "detach" });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "파일",
        submenu: [
          {
            label: "폴더 선택",
            accelerator: "CmdOrCtrl+O",
            click: () =>
              window?.webContents.send("search:event", {
                type: "choose-folder",
              }),
          },
          { type: "separator" },
          { role: "quit", label: "종료" },
        ],
      },
      {
        label: "편집",
        submenu: [
          { role: "undo", label: "실행 취소" },
          { role: "redo", label: "다시 실행" },
          { type: "separator" },
          { role: "cut", label: "잘라내기" },
          { role: "copy", label: "복사" },
          { role: "paste", label: "붙여넣기" },
          { role: "selectAll", label: "모두 선택" },
        ],
      },
      {
        label: "보기",
        submenu: [
          { role: "resetZoom", label: "기본 크기" },
          { role: "zoomIn", label: "확대" },
          { role: "zoomOut", label: "축소" },
          { role: "togglefullscreen", label: "전체 화면" },
        ],
      },
    ]),
  );
}
app.whenReady().then(() => {
  setupIPC();
  createWindow();
  app.on("activate", () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});
app.on("before-quit", () => active?.controller.abort());
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
