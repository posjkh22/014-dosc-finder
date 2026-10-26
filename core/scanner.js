import fs from "node:fs/promises";
import path from "node:path";
import { extensionPatterns, patterns, fileType } from "./options.js";

export async function* scanFiles(options, onSkip, signal) {
  const filters = extensionPatterns(options.extensions);
  const excluded = patterns(options.excludes);
  const queue = [options.root];
  while (queue.length && !signal?.aborted) {
    const directory = queue.pop();
    let handle;
    try {
      handle = await fs.opendir(directory);
    } catch (error) {
      onSkip(directory, "error", `폴더 읽기 실패: ${error.message}`);
      continue;
    }
    for await (const entry of handle) {
      if (signal?.aborted) break;
      const fullPath = path.join(directory, entry.name);
      const relative = path
        .relative(options.root, fullPath)
        .replaceAll("\\", "/");
      if (!options.hidden && entry.name.startsWith(".")) continue;
      if (entry.isSymbolicLink()) {
        onSkip(fullPath, "skip", "심볼릭 링크·정션은 따라가지 않습니다.");
        continue;
      }
      if (excluded.some((p) => p.test(entry.name) || p.test(relative)))
        continue;
      if (entry.isDirectory()) {
        if (options.recursive) queue.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name.startsWith("~$")) continue;
      if (filters.length && !filters.some((p) => p.test(entry.name))) continue;
      const type = fileType(fullPath);
      if (type === "binary") continue;
      if (type === "legacy") {
        onSkip(
          fullPath,
          "skip",
          "지원하지 않는 형식입니다. .docx / .xlsx / .pptx 또는 PDF로 변환해 주세요.",
        );
        continue;
      }
      let stat;
      try {
        // Recheck links and real paths after enumeration (also handles junctions).
        stat = await fs.lstat(fullPath);
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        const canonical = await fs.realpath(fullPath);
        const rel = path.relative(options.root, canonical);
        if (
          rel.startsWith(`..${path.sep}`) ||
          rel === ".." ||
          path.isAbsolute(rel)
        ) {
          onSkip(fullPath, "skip", "선택한 폴더 밖의 경로입니다.");
          continue;
        }
      } catch (error) {
        onSkip(fullPath, "error", error.message);
        continue;
      }
      if (stat.size > options.maxSizeMB * 1024 * 1024) {
        onSkip(fullPath, "skip", `최대 파일 크기 ${options.maxSizeMB} MB 초과`);
        continue;
      }
      yield {
        filePath: fullPath,
        fileName: entry.name,
        relativePath: relative,
        type,
        size: stat.size,
        modified: stat.mtimeMs,
      };
    }
  }
}
