import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { createSamples } from "../scripts/create-samples.js";
import { runSearch } from "../core/search-engine.js";
import { makeMatcher } from "../core/matcher.js";
import { normalizeOptions } from "../core/options.js";
import { readOffice } from "../core/extractors/zip.js";

let root;
before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "docs-finder-test-"));
  await createSamples(root);
  await fs.mkdir(path.join(root, "node_modules"));
  await fs.writeFile(
    path.join(root, "node_modules", "ignored.txt"),
    "자동화 테스트",
  );
  await fs.writeFile(path.join(root, ".hidden.txt"), "자동화 테스트");
  await fs.writeFile(path.join(root, "legacy.doc"), "자동화 테스트");
  await fs.writeFile(path.join(root, "broken.docx"), "not a zip");
  await fs.writeFile(
    path.join(root, "binary.unknown"),
    Buffer.from([0, 1, 2, 3, 0, 1]),
  );
  await fs.writeFile(
    path.join(root, "notes.custom"),
    "자동화 테스트 사용자 확장자",
  );
});
after(async () => {
  const target = path.resolve(root);
  assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
  assert.ok(path.basename(target).startsWith("docs-finder-test-"));
  await fs.rm(target, { recursive: true, force: true });
});
async function search(extra = {}, callback) {
  const events = [];
  const outcome = await runSearch(
    { root, query: "자동화 테스트", concurrency: 2, ...extra },
    {
      onEvent: (event) => {
        events.push(event);
        callback?.(event);
      },
    },
  );
  return {
    outcome,
    events,
    results: events.filter((e) => e.type === "result").map((e) => e.result),
    issues: events.filter((e) => e.type === "issue"),
  };
}

test("PDF, Excel, PowerPoint, Word와 한국어 일반 텍스트를 실제 파일에서 검색한다", async () => {
  const { results, issues, outcome } = await search();
  assert.equal(outcome.status, "complete");
  assert.deepEqual(
    new Set(results.map((r) => r.type)),
    new Set(["pdf", "excel", "word", "powerpoint", "text"]),
  );
  const excel = results.find((r) => r.type === "excel");
  assert.ok(
    excel.matches.some(
      (m) => m.location.sheet === "TC목록" && m.location.address === "D18",
    ),
  );
  assert.ok(excel.matches.some((m) => m.location.address === "B4"));
  assert.ok(excel.matches.some((m) => m.location.address === "C7"));
  assert.equal(
    excel.matches.filter((m) => ["E3", "F3"].includes(m.location.address))
      .length,
    1,
  );
  const word = results.find((r) => r.type === "word");
  assert.ok(
    word.matches.some(
      (m) => m.location.paragraph === 2 && m.location.section === "본문",
    ),
  );
  assert.ok(word.matches.some((m) => m.location.section === "머리글"));
  const ppt = results.find((r) => r.type === "powerpoint");
  assert.ok(
    ppt.matches.some((m) => m.location.slide === 1 && !m.location.section),
  );
  assert.ok(
    ppt.matches.some(
      (m) => m.location.slide === 1 && m.location.section === "발표자 노트",
    ),
  );
  assert.ok(ppt.matches.some((m) => m.location.slide === 2));
  assert.equal(
    results.find((r) => r.type === "pdf").matches[0].location.page,
    2,
  );
  assert.equal(
    results.find((r) => r.fileName === "자동화-test.js").matches[0].location
      .line,
    3,
  );
  assert.ok(results.some((r) => r.fileName.startsWith("CP949")));
  assert.ok(results.some((r) => r.fileName.startsWith("UTF16")));
  assert.ok(results.some((r) => r.fileName === "notes.custom"));
  assert.ok(
    !results.some(
      (r) =>
        r.relativePath.includes("node_modules") ||
        r.fileName.startsWith(".hidden"),
    ),
  );
  assert.ok(
    issues.some(
      (i) => i.filePath.endsWith("broken.docx") && i.kind === "error",
    ),
  );
  assert.ok(
    issues.some((i) => i.filePath.endsWith("legacy.doc") && i.kind === "skip"),
  );
  assert.ok(
    issues.some(
      (i) =>
        i.filePath.endsWith("텍스트없는문서.pdf") && i.message.includes("OCR"),
    ),
  );
  assert.ok(
    issues.some(
      (i) => i.filePath.endsWith("binary.unknown") && i.kind === "skip",
    ),
  );
});
test("수식과 숨김 시트의 캐시된 텍스트도 검색한다", async () => {
  const formula = await search({ query: "SUM(1,2)", extensions: "xlsx" });
  assert.equal(formula.results[0].matches[0].location.address, "B5");
  const hidden = await search({ query: "SEARCH_TOKEN", extensions: ".xlsx" });
  assert.ok(
    hidden.results[0].matches.some((m) => m.location.sheet === "숨김 시트"),
  );
});
test("확장자·재귀·제외 경로·숨김 설정을 적용한다", async () => {
  const { results } = await search({
    extensions: "*.txt, *.custom",
    recursive: false,
    hidden: true,
    excludes: "node_modules, CP949-*",
  });
  assert.ok(results.some((r) => r.fileName === ".hidden.txt"));
  assert.ok(results.some((r) => r.fileName === "notes.custom"));
  assert.ok(
    !results.some(
      (r) =>
        r.relativePath.includes("하위폴더") || r.fileName.startsWith("CP949"),
    ),
  );
  assert.ok(results.every((r) => r.type === "text"));
});
test("정규식, 유니코드 단어 경계, 대소문자, 0길이 패턴을 처리한다", () => {
  assert.equal(
    makeMatcher({ query: "hello", wholeWord: true })(
      "Hello helloWorld 안hello 한글 hello!",
    ).ranges.length,
    2,
  );
  assert.equal(
    makeMatcher({ query: "hello", caseSensitive: true })("Hello hello").ranges
      .length,
    1,
  );
  assert.equal(
    makeMatcher({ query: "테스트", wholeWord: true })(
      "테스트 테스트중 자동화테스트",
    ).ranges.length,
    1,
  );
  assert.equal(
    makeMatcher({ query: "테스트\\s+\\d+", regex: true })("테스트 42 테스트 A")
      .ranges.length,
    1,
  );
  assert.equal(
    makeMatcher({ query: "(?:)", regex: true })("😀한글").ranges.length,
    0,
  );
  assert.throws(
    () => normalizeOptions({ root, query: "[", regex: true }),
    /정규식/,
  );
  assert.throws(() => normalizeOptions({ root, query: "" }), /검색어/);
});
test("파일별 일치 수와 전체 결과 파일 수를 제한한다", async () => {
  const { results, outcome } = await search({
    maxMatchesPerFile: 1,
    maxResults: 2,
  });
  assert.equal(results.length, 2);
  assert.equal(outcome.status, "limit");
  assert.ok(results.every((r) => r.matchCount === 1 && r.truncated));
});
test("검색 취소는 파싱 중인 워커를 정리하고 종료한다", async () => {
  const folder = path.join(root, "cancel-worker");
  await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, "input.txt"), "a".repeat(100000) + "!");
  const controller = new AbortController();
  const started = Date.now();
  const timer = setTimeout(() => controller.abort(), 350);
  const result = await runSearch(
    { root: folder, query: "(a+)+$", regex: true, concurrency: 1 },
    { signal: controller.signal },
  );
  clearTimeout(timer);
  assert.equal(result.status, "cancelled");
  assert.ok(Date.now() - started < 3000);
});
test("복잡한 정규식이 멈추면 제한 시간에 워커를 종료한다", async () => {
  const folder = path.join(root, "regex-limit");
  await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, "input.txt"), "a".repeat(100000) + "!");
  const { issues, outcome } = await search({
    root: folder,
    query: "(a+)+$",
    regex: true,
    timeoutMs: 1000,
    concurrency: 1,
  });
  assert.equal(outcome.status, "complete");
  assert.ok(issues.some((i) => i.message.includes("제한 시간")));
});
test("ZIP 압축 해제 크기 제한이 작은 압축 폭탄을 거부한다", async () => {
  const zip = new JSZip();
  zip.file("word/document.xml", "a".repeat(33 * 1024 * 1024));
  const file = path.join(root, "too-big.docx");
  await fs.writeFile(
    file,
    await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
  );
  await assert.rejects(readOffice(file), /안전 한도/);
});
test("존재하지 않는 폴더는 명확한 오류를 반환한다", async () => {
  await assert.rejects(
    search({ root: path.join(root, "no-such-folder") }),
    /접근/,
  );
});
test("PPT의 파일 이름이 아닌 발표 순서로 슬라이드 번호를 반환한다", async () => {
  const zip = await JSZip.loadAsync(
    await fs.readFile(path.join(root, "프로젝트보고.pptx")),
  );
  const presentation = await zip.file("ppt/presentation.xml").async("string");
  const ids = presentation.match(/<p:sldId\s[^>]+\/>/g);
  assert.equal(ids.length, 2);
  zip.file(
    "ppt/presentation.xml",
    presentation.replace(ids.join(""), [...ids].reverse().join("")),
  );
  const folder = path.join(root, "slide-order");
  await fs.mkdir(folder);
  await fs.writeFile(
    path.join(folder, "reordered.pptx"),
    await zip.generateAsync({ type: "nodebuffer" }),
  );
  const { results } = await search({ root: folder, query: "SEARCH_TOKEN" });
  assert.equal(results[0].matches[0].location.slide, 2);
});
test("파일 크기 한도와 폴더 밖 정션을 건너뛴다", async () => {
  const folder = path.join(root, "size-limit");
  await fs.mkdir(folder);
  await fs.writeFile(
    path.join(folder, "large.txt"),
    "자동화 테스트" + "a".repeat(2 * 1024 * 1024),
  );
  // A directory junction does not require the Windows symlink privilege.
  await fs.symlink(os.tmpdir(), path.join(folder, "outside-link"), "junction");
  const { results, issues } = await search({ root: folder, maxSizeMB: 1 });
  assert.equal(results.length, 0);
  assert.ok(issues.some((i) => i.message.includes("크기")));
  assert.ok(issues.some((i) => i.message.includes("정션")));
});
