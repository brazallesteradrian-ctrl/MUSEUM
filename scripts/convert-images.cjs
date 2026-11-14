// Run: npm.cmd install --prefix .image-tools --no-save --package-lock=false sharp
// Then: node scripts/convert-images.cjs
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('../.image-tools/node_modules/sharp');

async function main() {
    const root = path.resolve(__dirname, '..');
    const images = path.join(root, 'public/assets/images');
    const output = path.join(images, 'webp');
    await fs.mkdir(output, { recursive: true });
    const names = new Set();
    let count = 0;
    let originalBytes = 0;
    let outputBytes = 0;
    for (const folder of ['backgrounds', 'artworks']) {
        for (const file of (await fs.readdir(path.join(images, folder))).sort()) {
            if (!/\.(jpe?g|png|webp)$/i.test(file)) continue;
            const name = path.parse(file).name + '.webp';
            if (names.has(name.toLowerCase())) throw new Error(`Duplicate output name: ${name}`);
            names.add(name.toLowerCase());
            const source = path.join(images, folder, file);
            const target = path.join(output, name);
            const before = await sharp(source).metadata();
            if (/\.webp$/i.test(file)) {
                await fs.copyFile(source, target);
            } else {
                // Preserve pixel dimensions; normalize camera orientation.
                await sharp(source).rotate().webp({ quality: 85, effort: 6 }).toFile(target);
            }
            const after = await sharp(target).metadata();
            const swapped = [5, 6, 7, 8].includes(before.orientation) && !/\.webp$/i.test(file);
            const width = swapped ? before.height : before.width;
            const height = swapped ? before.width : before.height;
            if (after.format !== 'webp' || after.width !== width || after.height !== height) {
                throw new Error(`Invalid conversion: ${name}`);
            }
            // Force a complete decode to verify the generated file.
            await sharp(target).raw().toBuffer();
            originalBytes += (await fs.stat(source)).size;
            outputBytes += (await fs.stat(target)).size;
            count++;
        }
    }
    console.log(JSON.stringify({ count, originalBytes, outputBytes, output }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
