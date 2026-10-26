import { runSearch } from "../core/search-engine.js";

const args = process.argv.slice(2);
if (!args[0] || !args[1]) {
  console.log(
    '사용법: npm run search -- "D:\\Documents" "검색어" [--regex] [--case-sensitive] [--ext=*.pdf,*.docx]',
  );
  process.exitCode = 1;
} else {
  const controller = new AbortController();
  process.on("SIGINT", () => controller.abort());
  try {
    const result = await runSearch(
      {
        root: args[0],
        query: args[1],
        regex: args.includes("--regex"),
        caseSensitive: args.includes("--case-sensitive"),
        extensions: args.find((a) => a.startsWith("--ext="))?.slice(6) ?? "",
      },
      {
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === "result")
            console.log(JSON.stringify(event.result));
          if (event.type === "issue")
            console.error(
              `[${event.kind}] ${event.filePath}: ${event.message}`,
            );
        },
      },
    );
    console.error(JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
