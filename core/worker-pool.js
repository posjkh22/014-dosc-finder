import { Worker } from "node:worker_threads";

// Each lane owns one reusable worker. A timeout replaces that worker, including
// runaway regular expressions and parsers blocked inside synchronous code.
export class WorkerLane {
  constructor(signal) {
    this.signal = signal;
    this.worker = null;
  }
  async execute(file, options) {
    if (this.signal?.aborted) return null;
    this.worker ??= new Worker(
      new URL("./workers/extract.worker.js", import.meta.url),
      { resourceLimits: { maxOldGenerationSizeMb: 384 } },
    );
    const worker = this.worker;
    return new Promise((resolve) => {
      let finished = false;
      let timer;
      const finish = (value, kill = false) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        worker.off("message", onMessage);
        worker.off("error", onError);
        worker.off("exit", onExit);
        this.signal?.removeEventListener("abort", onAbort);
        if (kill) {
          this.worker = null;
          worker.terminate().catch(() => {});
        }
        resolve(value);
      };
      const onMessage = (value) => finish(value);
      const onError = (error) =>
        finish(
          {
            issue: {
              kind: "error",
              message: `문서 처리 실패: ${error.message}`,
            },
          },
          true,
        );
      const onExit = (code) =>
        finish(
          {
            issue: {
              kind: "error",
              message: `문서 워커가 종료되었습니다 (${code}).`,
            },
          },
          true,
        );
      const onAbort = () => finish(null, true);
      worker.once("message", onMessage);
      worker.once("error", onError);
      worker.once("exit", onExit);
      this.signal?.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(
        () =>
          finish(
            {
              issue: {
                kind: "error",
                message: `파일 처리 제한 시간 ${options.timeoutMs / 1000}초 초과`,
              },
            },
            true,
          ),
        options.timeoutMs,
      );
      if (this.signal?.aborted) onAbort();
      else worker.postMessage({ file, options });
    });
  }
  async close() {
    const worker = this.worker;
    this.worker = null;
    if (worker) await worker.terminate();
  }
}
