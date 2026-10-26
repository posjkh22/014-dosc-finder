import fs from "node:fs/promises";
import yauzl from "yauzl";
import { XMLParser, XMLValidator } from "fast-xml-parser";

const MAX_EXPANDED = 180 * 1024 * 1024;
const MAX_ENTRY = 32 * 1024 * 1024;
export const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  processEntities: true,
  htmlEntities: false,
  parseTagValue: false,
});
export const orderedParser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  processEntities: true,
  parseTagValue: false,
  trimValues: false,
});
export const array = (value) =>
  value == null ? [] : Array.isArray(value) ? value : [value];
export function xml(text, ordered = false) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error("DTD / ENTITY 선언이 있는 XML은 지원하지 않습니다.");
  const valid = XMLValidator.validate(text);
  if (valid !== true) throw new Error(`손상된 문서 XML: ${valid.err.msg}`);
  return (ordered ? orderedParser : parser).parse(text);
}

export async function readOffice(filePath) {
  const buffer = await fs.readFile(filePath);
  const parts = new Map();
  await new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, validateEntrySizes: true },
      (error, archive) => {
        if (error)
          return reject(
            new Error(`문서 ZIP을 읽을 수 없습니다: ${error.message}`),
          );
        let expanded = 0,
          count = 0,
          finished = false;
        const fail = (err) => {
          if (finished) return;
          finished = true;
          archive.close();
          reject(err);
        };
        archive.on("error", fail);
        archive.on("end", () => {
          if (!finished) {
            finished = true;
            resolve();
          }
        });
        archive.on("entry", (entry) => {
          expanded += entry.uncompressedSize;
          if (
            ++count > 15000 ||
            expanded > MAX_EXPANDED ||
            entry.uncompressedSize > MAX_ENTRY
          )
            return fail(
              new Error("Office 압축 해제 안전 한도를 초과했습니다."),
            );
          if ((entry.generalPurposeBitFlag & 1) !== 0)
            return fail(new Error("암호화된 Office 문서는 지원하지 않습니다."));
          // Keep only textual OOXML parts; media and embedded objects are never expanded.
          if (!/^(word|ppt|xl)\/.*\.(xml|rels)$/.test(entry.fileName))
            return archive.readEntry();
          archive.openReadStream(entry, (err, stream) => {
            if (err) return fail(err);
            let length = 0;
            const chunks = [];
            stream.on("data", (chunk) => {
              length += chunk.length;
              if (length > MAX_ENTRY) {
                stream.destroy(new Error("XML 크기 한도 초과"));
                return;
              }
              chunks.push(chunk);
            });
            stream.on("error", fail);
            stream.on("end", () => {
              if (finished) return;
              const text = Buffer.concat(chunks).toString("utf8");
              if (/<!DOCTYPE|<!ENTITY/i.test(text))
                return fail(
                  new Error(
                    "DTD / ENTITY 선언이 있는 XML은 지원하지 않습니다.",
                  ),
                );
              parts.set(entry.fileName, text);
              archive.readEntry();
            });
          });
        });
        archive.readEntry();
      },
    );
  });
  return { buffer, parts };
}

export function paragraphs(nodes, tag, textTag) {
  const output = [];
  const collect = (list) => {
    let result = "";
    for (const node of list ?? []) {
      for (const [key, value] of Object.entries(node)) {
        if (key === textTag)
          result += value.map((v) => v["#text"] ?? "").join("");
        else if (key.endsWith(":tab")) result += "\t";
        else if (key.endsWith(":br") || key.endsWith(":cr")) result += "\n";
        else if (key !== ":@" && key !== "w:del" && Array.isArray(value))
          result += collect(value);
      }
    }
    return result;
  };
  const visit = (list) => {
    for (const node of list ?? [])
      for (const [key, value] of Object.entries(node)) {
        if (key === tag) output.push(collect(value));
        else if (key !== ":@" && key !== "w:del" && Array.isArray(value))
          visit(value);
      }
  };
  visit(nodes);
  return output;
}
