import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import iconv from "iconv-lite";
import { readOffice, xml, array, paragraphs } from "./zip.js";

const require = createRequire(import.meta.url);
const MAX_TEXT = 16000000;
class SkipError extends Error {
  constructor(message) {
    super(message);
    this.skip = true;
  }
}

async function* textChunks(filePath, options) {
  const buffer = await fs.readFile(filePath);
  let encoding = options.encoding;
  if (encoding === "auto") {
    if (buffer[0] === 0xff && buffer[1] === 0xfe) encoding = "utf16le";
    else if (buffer[0] === 0xfe && buffer[1] === 0xff) encoding = "utf16be";
    else {
      if (buffer.subarray(0, 8192).includes(0))
        throw new SkipError("바이너리 파일: 일반 텍스트로 읽을 수 없습니다.");
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(buffer);
        encoding = "utf8";
      } catch {
        encoding = "cp949";
      }
    }
  }
  const text = iconv.decode(buffer, encoding).replace(/^\uFEFF/, "");
  if (text.length > MAX_TEXT)
    throw new SkipError("추출 텍스트 크기 한도(1,600만 자)를 초과했습니다.");
  const lines = text.split(/\r\n|\n|\r/);
  for (let index = 0; index < lines.length; index++)
    if (lines[index].trim())
      yield { text: lines[index], location: { type: "line", line: index + 1 } };
}

async function* pdfChunks(filePath) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const base = path
    .dirname(require.resolve("pdfjs-dist/package.json"))
    .replaceAll("\\", "/");
  const task = getDocument({
    data: new Uint8Array(await fs.readFile(filePath)),
    isEvalSupported: false,
    useSystemFonts: true,
    verbosity: 0,
    cMapUrl: `${base}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}/standard_fonts/`,
    wasmUrl: `${base}/wasm/`,
  });
  let found = false,
    imageOnly = 0;
  try {
    const doc = await task.promise;
    if (doc.numPages > 10000)
      throw new SkipError("PDF 페이지 수 한도(10,000)를 초과했습니다.");
    for (let page = 1; page <= doc.numPages; page++) {
      const documentPage = await doc.getPage(page);
      const content = await documentPage.getTextContent();
      let text = "",
        previous;
      for (const item of content.items) {
        if (typeof item.str !== "string") continue;
        if (previous && !/\s$/.test(text) && !/^\s/.test(item.str)) {
          const gap =
            item.transform[4] - (previous.transform[4] + previous.width);
          if (
            Math.abs(item.transform[5] - previous.transform[5]) > 3 ||
            gap > 1.5
          )
            text += " ";
        }
        text += item.str + (item.hasEOL ? "\n" : "");
        previous = item;
      }
      documentPage.cleanup();
      if (text.trim()) {
        found = true;
        yield { text, location: { type: "page", page } };
      } else imageOnly++;
    }
    if (!found)
      throw new SkipError(
        "추출 가능한 텍스트가 없는 PDF입니다. 스캔 문서는 OCR이 필요합니다.",
      );
    if (imageOnly)
      yield {
        warning: `텍스트가 없는 PDF 페이지 ${imageOnly}개는 검색할 수 없습니다. OCR이 필요할 수 있습니다.`,
      };
  } finally {
    await task.destroy();
  }
}

function cellText(value) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return String(value);
  if (value.richText) return value.richText.map((run) => run.text).join("");
  if (value.formula || value.sharedFormula)
    return `${value.formula ? `=${value.formula}` : ""}\n${cellText(value.result)}`;
  if (value.text != null) return String(value.text);
  if (value.error) return value.error;
  return "";
}

async function* excelChunks(buffer) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  for (const sheet of workbook.worksheets) {
    const cells = [];
    sheet.eachRow({ includeEmpty: false }, (row) =>
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.isMerged && cell.master.address !== cell.address) return;
        let text = cellText(cell.value);
        if (cell.note)
          text +=
            "\n" +
            (typeof cell.note === "string"
              ? cell.note
              : (cell.note.texts ?? []).map((run) => run.text).join(""));
        if (text.trim())
          cells.push({
            text,
            location: {
              type: "cell",
              sheet: sheet.name,
              address: cell.address,
            },
          });
      }),
    );
    for (const cell of cells) yield cell;
  }
}

async function* wordChunks(parts) {
  const body = parts.get("word/document.xml");
  if (!body) throw new Error("Word 본문을 찾을 수 없습니다.");
  const sections = [
    ["word/document.xml", "본문"],
    ...[...parts.keys()]
      .filter((name) =>
        /^word\/(header\d+|footer\d+|footnotes|endnotes|comments)\.xml$/.test(
          name,
        ),
      )
      .sort()
      .map((name) => [
        name,
        name.includes("header")
          ? "머리글"
          : name.includes("footer")
            ? "바닥글"
            : name.includes("comments")
              ? "메모"
              : "각주·미주",
      ]),
  ];
  for (const [name, section] of sections) {
    const texts = paragraphs(xml(parts.get(name), true), "w:p", "w:t");
    for (let index = 0; index < texts.length; index++)
      if (texts[index].trim())
        yield {
          text: texts[index],
          location: { type: "paragraph", paragraph: index + 1, section },
        };
  }
}

function resolvePart(base, target) {
  const resolved = target.startsWith("/")
    ? target.slice(1)
    : path.posix.normalize(path.posix.join(path.posix.dirname(base), target));
  if (resolved.startsWith("../"))
    throw new Error("문서 내부 참조 경로가 올바르지 않습니다.");
  return resolved;
}
async function* pptChunks(parts) {
  const presentation = xml(parts.get("ppt/presentation.xml") ?? "");
  const relationships = xml(parts.get("ppt/_rels/presentation.xml.rels") ?? "");
  const rels = new Map(
    array(relationships.Relationships?.Relationship)
      .filter((r) => r["@_TargetMode"] !== "External")
      .map((r) => [
        r["@_Id"],
        resolvePart("ppt/presentation.xml", r["@_Target"]),
      ]),
  );
  const slides = array(
    presentation["p:presentation"]?.["p:sldIdLst"]?.["p:sldId"],
  );
  if (!slides.length)
    throw new Error("PowerPoint 슬라이드를 찾을 수 없습니다.");
  for (let index = 0; index < slides.length; index++) {
    const name = rels.get(slides[index]["@_r:id"]);
    if (!name || !parts.has(name))
      throw new Error(`${index + 1}번 슬라이드를 읽을 수 없습니다.`);
    const texts = paragraphs(xml(parts.get(name), true), "a:p", "a:t");
    yield {
      text: texts.join("\n"),
      location: { type: "slide", slide: index + 1 },
    };
    const relName = `${path.posix.dirname(name)}/_rels/${path.posix.basename(name)}.rels`;
    if (parts.has(relName)) {
      const relation = array(
        xml(parts.get(relName)).Relationships?.Relationship,
      ).find(
        (r) =>
          r["@_Type"]?.endsWith("/notesSlide") &&
          r["@_TargetMode"] !== "External",
      );
      if (relation) {
        const note = parts.get(resolvePart(name, relation["@_Target"]));
        if (note)
          yield {
            text: paragraphs(xml(note, true), "a:p", "a:t").join("\n"),
            location: {
              type: "slide",
              slide: index + 1,
              section: "발표자 노트",
            },
          };
      }
    }
  }
}

export async function* extract(file, options) {
  let total = 0;
  let iterator;
  if (file.type === "text") iterator = textChunks(file.filePath, options);
  else if (file.type === "pdf") iterator = pdfChunks(file.filePath);
  else {
    const { buffer, parts } = await readOffice(file.filePath);
    if (file.type === "excel") iterator = excelChunks(buffer);
    else if (file.type === "word") iterator = wordChunks(parts);
    else iterator = pptChunks(parts);
  }
  for await (const chunk of iterator) {
    total += chunk.text?.length ?? 0;
    if (total > MAX_TEXT)
      throw new SkipError("추출 텍스트 크기 한도(1,600만 자)를 초과했습니다.");
    yield chunk;
  }
}
