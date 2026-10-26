import { _electron as electron } from "playwright";
import { expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createSamples } from "./create-samples.js";

const directory = path.resolve("test-results");
const samples = path.resolve("samples");
await fs.mkdir(directory, { recursive: true });
await createSamples(samples);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const executable = process.argv[2];
const profile = path.join(
  directory,
  executable ? "profile-packaged" : "profile-dev",
);
const profileArg = `--user-data-dir=${profile}`;
const application = await electron.launch({
  ...(executable
    ? { executablePath: path.resolve(executable), args: [profileArg] }
    : { args: [".", profileArg] }),
  cwd: process.cwd(),
  env,
  timeout: 30000,
});
const errors = [];
try {
  const page = await application.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.waitForSelector("#root");
  await expect(page.locator("#form-error")).toBeHidden();
  await page.screenshot({
    path: path.join(
      directory,
      executable ? "packaged-initial.png" : "initial.png",
    ),
  });
  const output = path.join(directory, "results.csv");
  await application.evaluate(({ dialog, shell }, output) => {
    globalThis.testOpened = [];
    globalThis.testRevealed = [];
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: output });
    shell.openPath = async (filePath) => {
      globalThis.testOpened.push(filePath);
      return "";
    };
    shell.showItemInFolder = (filePath) => {
      globalThis.testRevealed.push(filePath);
    };
  }, output);
  await page.locator("#root").fill(samples);
  await page.locator("#query").fill("자동화 테스트");
  await page.locator("#search-button").click();
  await expect(page.locator("#search-state")).toHaveText("검색 완료", {
    timeout: 30000,
  });
  await expect(page.locator("#result-count")).toHaveText("8");
  await expect(page.locator("#file-list").getByRole("option")).toHaveCount(8);
  await page
    .locator("#file-list")
    .getByRole("option")
    .filter({ hasText: "테스트계획.xlsx" })
    .click();
  await expect(page.locator("#preview")).toContainText("TC목록!D18");
  await expect(page.locator("#preview mark").first()).toHaveText(
    "자동화 테스트",
  );
  await page.getByRole("button", { name: "경로 복사", exact: true }).click();
  expect(
    await application.evaluate(({ clipboard }) => clipboard.readText()),
  ).toBe(path.join(samples, "테스트계획.xlsx"));
  await page.getByRole("button", { name: "파일 열기", exact: true }).click();
  await page
    .getByRole("button", { name: "폴더에서 보기", exact: true })
    .click();
  expect(await application.evaluate(() => globalThis.testOpened)).toEqual([
    path.join(samples, "테스트계획.xlsx"),
  ]);
  expect(await application.evaluate(() => globalThis.testRevealed)).toEqual([
    path.join(samples, "테스트계획.xlsx"),
  ]);
  const rejection = await page.evaluate(async () => {
    try {
      await window.docsFinder.openFile("C:\\Windows\\System32\\cmd.exe");
      return "";
    } catch (error) {
      return error.message;
    }
  });
  expect(rejection).toContain("현재 검색 결과");
  await page.locator("#export-results").click();
  await expect(page.locator("#toast")).toContainText("CSV");
  const csv = await fs.readFile(output, "utf8");
  expect(csv).toContain("TC목록!D18");
  expect(csv).toContain("자동화 테스트");
  await expect(page.locator("#toast")).toBeHidden();
  await page.locator("#file-list").evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.locator("#preview").evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({
    path: path.join(
      directory,
      executable ? "packaged-results.png" : "results.png",
    ),
  });
  await page.locator("[data-type=pdf]").click();
  await expect(page.locator("#file-list").getByRole("option")).toHaveCount(1);
  await expect(page.locator("#preview")).toContainText("2페이지");
  await page.locator("#issues-toggle").click();
  await expect(page.locator("#issues-panel")).toContainText("OCR");
  await page.locator("#query").fill("no-such-text-123456789");
  await page.locator("#search-button").click();
  await expect(page.locator("#search-state")).toHaveText("검색 완료");
  await expect(page.locator("#result-count")).toHaveText("0");
  await expect(page.locator("#list-empty")).toBeVisible();
  await expect(page.locator("#preview")).toContainText(
    "표시할 검색 결과가 없습니다.",
  );
  await page.locator("#regex").check();
  await page.locator("#query").fill("[");
  await page.locator("#search-button").click();
  await expect(page.locator("#form-error")).toContainText("정규식");
  await page.locator("#query").fill("자동화 테스트");
  await page.locator("#regex").uncheck();
  await page.locator("#search-button").click();
  await page.locator("#cancel-button").click();
  await expect(page.locator("#search-state")).toHaveText("검색 중지됨", {
    timeout: 10000,
  });
  expect(errors).toEqual([]);
  console.log(
    `Electron UI 검증 통과${executable ? " (패키지)" : ""}: 5종 파일 검색, 미리보기, 복사, 열기·탐색기 IPC, CSV, 필터, 오류, 취소`,
  );
} finally {
  await application.close();
}
