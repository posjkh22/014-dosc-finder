import path from "node:path";

export const DEFAULT_EXCLUDES =
  ".git, node_modules, .next, dist, build, release, $RECYCLE.BIN, System Volume Information";
export const LEGACY = new Set([
  ".doc",
  ".xls",
  ".ppt",
  ".hwp",
  ".hwpx",
  ".xlsb",
]);
export const BINARY = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".ico",
  ".tif",
  ".tiff",
  ".exe",
  ".dll",
  ".msi",
  ".bin",
  ".zip",
  ".7z",
  ".rar",
  ".gz",
  ".tar",
  ".mp3",
  ".mp4",
  ".mov",
  ".avi",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".db",
  ".sqlite",
  ".sqlite3",
  ".psd",
  ".ai",
  ".iso",
  ".class",
  ".pyc",
  ".pdb",
]);
export function fileType(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if ([".xlsx", ".xlsm"].includes(ext)) return "excel";
  if ([".pptx", ".pptm", ".ppsx"].includes(ext)) return "powerpoint";
  if ([".docx", ".docm"].includes(ext)) return "word";
  if (LEGACY.has(ext)) return "legacy";
  if (BINARY.has(ext)) return "binary";
  return "text";
}

export function normalizeOptions(input = {}) {
  if (typeof input.root !== "string" || !input.root.trim())
    throw new Error("검색할 폴더를 선택하거나 경로를 입력해 주세요.");
  if (typeof input.query !== "string" || !input.query.trim())
    throw new Error("검색어를 입력해 주세요.");
  if (input.query.length > 500)
    throw new Error("검색어는 500자까지 입력할 수 있습니다.");
  const bounded = (value, fallback, min, max) => {
    const number = value === undefined ? fallback : Number(value);
    if (!Number.isFinite(number) || number < min || number > max)
      throw new Error(`설정값은 ${min}~${max} 범위여야 합니다.`);
    return Math.floor(number);
  };
  const result = {
    root: path.resolve(input.root.trim()),
    query: input.query,
    recursive: input.recursive !== false,
    caseSensitive: !!input.caseSensitive,
    regex: !!input.regex,
    wholeWord: !!input.wholeWord,
    hidden: !!input.hidden,
    extensions:
      typeof input.extensions === "string"
        ? input.extensions.slice(0, 1000)
        : "",
    excludes:
      typeof input.excludes === "string"
        ? input.excludes.slice(0, 2000)
        : DEFAULT_EXCLUDES,
    maxSizeMB: bounded(input.maxSizeMB, 50, 1, 500),
    concurrency: bounded(input.concurrency, 3, 1, 4),
    timeoutMs: bounded(input.timeoutMs, 30000, 100, 120000),
    maxResults: bounded(input.maxResults, 10000, 1, 50000),
    maxMatchesPerFile: bounded(input.maxMatchesPerFile, 200, 1, 1000),
    encoding: ["auto", "utf8", "cp949", "utf16le"].includes(input.encoding)
      ? input.encoding
      : "auto",
  };
  if (result.regex) {
    try {
      new RegExp(result.query, "u");
    } catch (error) {
      throw new Error(`정규식이 올바르지 않습니다: ${error.message}`);
    }
  }
  return result;
}

export function patterns(value) {
  return value
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pattern) => {
      const escaped = pattern
        .replaceAll("\\", "/")
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replaceAll("*", ".*")
        .replaceAll("?", ".");
      return new RegExp(`^${escaped}$`, "i");
    });
}

export function extensionPatterns(value) {
  return patterns(
    value
      .split(/[,;\n]/)
      .map((s) => {
        const token = s.trim();
        if (!token || token.includes("*") || token.includes("?")) return token;
        return `*${token.startsWith(".") ? token : `.${token}`}`;
      })
      .join(","),
  );
}
