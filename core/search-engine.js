import fs from "node:fs/promises";
import { normalizeOptions } from "./options.js";
import { scanFiles } from "./scanner.js";
import { WorkerLane } from "./worker-pool.js";

export async function runSearch(input, { onEvent = () => {}, signal } = {}) {
  const options = normalizeOptions(input);
  options.root = await fs.realpath(options.root).catch(() => {
    throw new Error("폴더가 없거나 접근할 수 없습니다. 경로를 확인해 주세요.");
  });
  if (!(await fs.stat(options.root)).isDirectory())
    throw new Error("파일이 아닌 폴더 경로를 입력해 주세요.");
  const startedAt = Date.now();
  const limitController = new AbortController();
  const workSignal = signal
    ? AbortSignal.any([signal, limitController.signal])
    : limitController.signal;
  const stats = {
    processed: 0,
    discovered: 0,
    foundFiles: 0,
    matches: 0,
    skipped: 0,
    errors: 0,
    elapsedMs: 0,
  };
  const current = new Map();
  let lastProgress = 0,
    limited = false;
  const progress = (force = false) => {
    stats.elapsedMs = Date.now() - startedAt;
    if (force || Date.now() - lastProgress > 100) {
      lastProgress = Date.now();
      onEvent({
        type: "progress",
        stats: { ...stats },
        currentFiles: [...current.values()],
      });
    }
  };
  const issue = (filePath, kind, message) => {
    if (kind === "skip") stats.skipped++;
    else if (kind === "error") stats.errors++;
    onEvent({ type: "issue", filePath, kind, message });
    progress();
  };
  onEvent({ type: "start", root: options.root, stats: { ...stats } });
  const iterator = scanFiles(options, issue, workSignal);
  const lanes = Array.from(
    { length: options.concurrency },
    () => new WorkerLane(workSignal),
  );
  const tasks = lanes.map(async (lane, index) => {
    while (!signal?.aborted && !limited) {
      const { value: file, done } = await iterator.next();
      if (done || signal?.aborted || limited) break;
      stats.discovered++;
      current.set(index, file.relativePath);
      progress();
      const outcome = await lane.execute(file, options);
      current.delete(index);
      if (!outcome || signal?.aborted || limited) break;
      stats.processed++;
      if (outcome.issue)
        issue(file.filePath, outcome.issue.kind, outcome.issue.message);
      for (const warning of outcome.warnings ?? [])
        issue(file.filePath, "warning", warning);
      if (outcome.matchCount) {
        stats.foundFiles++;
        stats.matches += outcome.matchCount;
        onEvent({
          type: "result",
          result: {
            ...file,
            matches: outcome.matches,
            matchCount: outcome.matchCount,
            truncated: outcome.truncated,
          },
        });
        if (stats.foundFiles >= options.maxResults) {
          limited = true;
          limitController.abort();
        }
      }
      progress();
    }
  });
  try {
    await Promise.all(tasks);
  } finally {
    await Promise.all(lanes.map((lane) => lane.close()));
    await iterator.return();
  }
  progress(true);
  const result = {
    status: signal?.aborted ? "cancelled" : limited ? "limit" : "complete",
    root: options.root,
    stats: { ...stats },
  };
  onEvent({ type: "done", ...result });
  return result;
}
