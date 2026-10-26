import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ExcelJS from "exceljs";
import PptxGenJS from "pptxgenjs";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  Header,
  Footer,
} from "docx";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import iconv from "iconv-lite";

export async function createSamples(directory) {
  await fs.mkdir(directory, { recursive: true });
  await fs.mkdir(path.join(directory, "하위폴더"), { recursive: true });
  await fs.writeFile(
    path.join(directory, "자동화-test.js"),
    '// 테스트 실행기\nconst project = "Docs Finder";\n// 자동화 테스트 실행 기능\nconst message = "SEARCH_TOKEN";\n',
  );
  await fs.writeFile(
    path.join(directory, "하위폴더", "회의록.txt"),
    "회의록\n다음 일정: 자동화 테스트 검토\n담당자: 김철수\n",
  );
  await fs.writeFile(
    path.join(directory, "CP949-메모.txt"),
    iconv.encode("구형 인코딩\n자동화 테스트 CP949\n", "cp949"),
  );
  await fs.writeFile(
    path.join(directory, "UTF16-메모.txt"),
    Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      iconv.encode("인코딩 확인\n자동화 테스트 UTF16\n", "utf16le"),
    ]),
  );
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("TC목록");
  sheet.getCell("A1").value = "테스트 계획";
  sheet.getCell("D18").value = "자동화 테스트 수행 및 결과 저장 SEARCH_TOKEN";
  sheet.getCell("B4").value = {
    richText: [{ text: "자동화 " }, { text: "테스트 리치 텍스트" }],
  };
  sheet.getCell("B5").value = { formula: "SUM(1,2)", result: 3 };
  sheet.getCell("B6").value = {
    text: "프로젝트 문서",
    hyperlink: "https://example.com",
  };
  sheet.getCell("C7").value = "메모 셀";
  sheet.getCell("C7").note = "자동화 테스트 메모";
  sheet.getCell("E3").value = "병합 셀 자동화 테스트";
  sheet.mergeCells("E3:F3");
  sheet.columns = [
    { width: 20 },
    { width: 35 },
    { width: 20 },
    { width: 55 },
    { width: 30 },
  ];
  workbook.addWorksheet("숨김 시트", { state: "hidden" }).getCell("A2").value =
    "SEARCH_TOKEN 숨김 내용";
  await workbook.xlsx.writeFile(path.join(directory, "테스트계획.xlsx"));
  const document = new Document({
    sections: [
      {
        headers: {
          default: new Header({
            children: [new Paragraph("자동화 테스트 머리글")],
          }),
        },
        footers: {
          default: new Footer({
            children: [new Paragraph("Docs Finder sample")],
          }),
        },
        children: [
          new Paragraph({ text: "개발 명세", heading: "Heading1" }),
          new Paragraph({
            children: [
              new TextRun("자동화 "),
              new TextRun({ text: "테스트", bold: true }),
              new TextRun(" 모듈의 인터페이스 SEARCH_TOKEN"),
            ],
          }),
          new Table({
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph("구분")] }),
                  new TableCell({
                    children: [new Paragraph("자동화 테스트 표 데이터")],
                  }),
                ],
              }),
            ],
          }),
        ],
      },
    ],
  });
  await fs.writeFile(
    path.join(directory, "개발명세.docx"),
    await Packer.toBuffer(document),
  );
  const ppt = new PptxGenJS();
  ppt.author = "Docs Finder";
  ppt.title = "프로젝트 보고";
  ppt.lang = "ko-KR";
  const slide1 = ppt.addSlide();
  slide1.addText("프로젝트 진행 현황", {
    x: 1,
    y: 1,
    w: 8,
    h: 1,
    fontFace: "맑은 고딕",
    fontSize: 28,
    color: "157962",
  });
  slide1.addText(
    [
      { text: "자동화 " },
      { text: "테스트", options: { bold: true } },
      { text: " 진행률: 85% SEARCH_TOKEN" },
    ],
    { x: 1, y: 2.5, w: 8, h: 1, fontFace: "맑은 고딕", fontSize: 20 },
  );
  slide1.addNotes("자동화 테스트 발표자 노트");
  const slide2 = ppt.addSlide();
  slide2.addText("다음 일정", { x: 1, y: 1, w: 8, h: 1, fontSize: 28 });
  slide2.addTable(
    [
      [{ text: "항목" }, { text: "일정" }],
      [{ text: "자동화 테스트 검토" }, { text: "11월 10일" }],
    ],
    { x: 1, y: 2, w: 8 },
  );
  await ppt.writeFile({ fileName: path.join(directory, "프로젝트보고.pptx") });
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  let font;
  try {
    font = await pdf.embedFont(
      await fs.readFile("C:/Windows/Fonts/malgun.ttf"),
      { subset: true },
    );
  } catch {
    font = await pdf.embedFont(StandardFonts.Helvetica);
  }
  const korean = font.name !== "Helvetica";
  const page1 = pdf.addPage([595, 842]);
  page1.drawText(korean ? "요구사항 정의서" : "Requirements", {
    x: 55,
    y: 760,
    font,
    size: 24,
    color: rgb(0.08, 0.45, 0.35),
  });
  const page2 = pdf.addPage([595, 842]);
  page2.drawText(
    korean
      ? "자동화 테스트 실행 기능 SEARCH_TOKEN"
      : "Automated testing SEARCH_TOKEN",
    { x: 55, y: 740, font, size: 16 },
  );
  await fs.writeFile(
    path.join(directory, "요구사항정의서.pdf"),
    await pdf.save(),
  );
  const scanned = await PDFDocument.create();
  const scanPage = scanned.addPage([595, 842]);
  scanPage.drawRectangle({
    x: 50,
    y: 600,
    width: 450,
    height: 100,
    color: rgb(0.9, 0.92, 0.91),
  });
  await fs.writeFile(
    path.join(directory, "텍스트없는문서.pdf"),
    await scanned.save(),
  );
  return directory;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const directory = path.resolve(process.argv[2] || "samples");
  await createSamples(directory);
  console.log(
    `샘플 생성 완료: ${directory}\n검색어: 자동화 테스트 / SEARCH_TOKEN`,
  );
}
