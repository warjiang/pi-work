import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const iconsRoot = join(desktopRoot, "resources", "icons");
const sourceRoot = join(iconsRoot, "source");
const generatedRoot = join(iconsRoot, "generated");
const appSource = join(sourceRoot, "app-icon.svg");
const menuBarSource = join(sourceRoot, "menu-bar-template.svg");
const traySource = join(sourceRoot, "tray.svg");

function run(command, args) {
  execFileSync(command, args, { stdio: "inherit" });
}

async function render(source, output, size) {
  await mkdir(dirname(output), { recursive: true });
  run("sips", ["-s", "format", "png", source, "--out", output]);
  if (size !== 1024) {
    run("sips", ["-z", String(size), String(size), output]);
  }
}

async function resizeMaster(master, output, size) {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, await readFile(master));
  if (size !== 1024) {
    run("sips", ["-z", String(size), String(size), output]);
  }
}

async function writeIco(pngFiles, output) {
  const images = await Promise.all(pngFiles.map(async ({ size, path }) => ({
    size,
    data: await readFile(path),
  })));
  const headerSize = 6 + images.length * 16;
  let offset = headerSize;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  images.forEach(({ size, data }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size === 256 ? 0 : size, entry);
    header.writeUInt8(size === 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  await writeFile(output, Buffer.concat([header, ...images.map(({ data }) => data)]));
}

await rm(generatedRoot, { recursive: true, force: true });
await mkdir(generatedRoot, { recursive: true });

const master = join(generatedRoot, "app-icon-1024.png");
await render(appSource, master, 1024);

const macIconset = join(generatedRoot, "mac", "PiWork.iconset");
const macSizes = [
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024],
];
await mkdir(macIconset, { recursive: true });
for (const [name, size] of macSizes) {
  await resizeMaster(master, join(macIconset, name), size);
}
run("iconutil", ["-c", "icns", macIconset, "-o", join(generatedRoot, "mac", "icon.icns")]);

const windowsSizes = [16, 24, 32, 48, 64, 128, 256];
const windowsPngs = [];
for (const size of windowsSizes) {
  const output = join(generatedRoot, "windows", `${size}x${size}.png`);
  await resizeMaster(master, output, size);
  windowsPngs.push({ size, path: output });
}
await writeIco(windowsPngs, join(generatedRoot, "windows", "icon.ico"));

for (const size of [16, 32, 48, 64, 128, 256, 512]) {
  await resizeMaster(master, join(generatedRoot, "linux", `${size}x${size}.png`), size);
}

await render(menuBarSource, join(generatedRoot, "mac", "pi-workTemplate.png"), 16);
await render(menuBarSource, join(generatedRoot, "mac", "pi-workTemplate@2x.png"), 32);

for (const size of [16, 20, 24, 32, 48]) {
  await render(traySource, join(generatedRoot, "tray", `pi-work-${size}.png`), size);
}

console.log(`Generated icons in ${generatedRoot}`);
