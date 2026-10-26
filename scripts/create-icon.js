import { createCanvas, loadImage } from "@napi-rs/canvas";
import fs from "node:fs/promises";
const canvas = createCanvas(256, 256);
const context = canvas.getContext("2d");
context.drawImage(
  await loadImage(
    await fs.readFile(new URL("../assets/logo.svg", import.meta.url)),
  ),
  0,
  0,
  256,
  256,
);
const png = canvas.toBuffer("image/png");
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18);
await fs.writeFile(
  new URL("../assets/icon.ico", import.meta.url),
  Buffer.concat([header, png]),
);
await fs.writeFile(new URL("../assets/icon.png", import.meta.url), png);
