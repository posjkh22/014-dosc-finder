import { parentPort } from "node:worker_threads";
import fs from "node:fs/promises";
import { extract } from "../extractors/index.js";
import { makeMatcher, snippets } from "../matcher.js";

parentPort.on("message", async ({ file, options }) => {
  const matches = [];
  const warnings = [];
  let matchCount = 0,
    truncated = false;
  try {
    const stat = await fs.lstat(file.filePath);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error("검색 중 파일 경로가 변경되었습니다.");
    if (stat.size > options.maxSizeMB * 1024 * 1024)
      throw new Error("검색 중 파일 크기가 제한을 초과했습니다.");
    const match = makeMatcher(options);
    for await (const chunk of extract(file, options)) {
      if (chunk.warning) {
        warnings.push(chunk.warning);
        continue;
      }
      const { text, ranges } = match(
        chunk.text,
        options.maxMatchesPerFile - matchCount,
      );
      if (ranges.length) {
        matchCount += ranges.length;
        matches.push({
          location: chunk.location,
          count: ranges.length,
          snippets: snippets(text, ranges),
        });
        if (matchCount >= options.maxMatchesPerFile) {
          truncated = true;
          break;
        }
      }
    }
    parentPort.postMessage({ matches, matchCount, truncated, warnings });
  } catch (error) {
    parentPort.postMessage({
      matches,
      matchCount,
      truncated,
      warnings,
      issue: { kind: error.skip ? "skip" : "error", message: error.message },
    });
  }
});
