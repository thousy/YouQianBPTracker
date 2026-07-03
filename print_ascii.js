const { Jimp } = require('jimp');
const fs = require('fs');

const file = process.argv[2] || "d:/xueya/sub_sys.jpg";

async function printAscii() {
    if (!fs.existsSync(file)) {
        console.log("File not found:", file);
        return;
    }
    const image = await Jimp.read(file);
    // 缩放到控制台适合的尺寸，例如宽 40，高按比例
    const w = image.bitmap.width;
    const h = image.bitmap.height;
    const targetW = 50;
    const targetH = Math.round((h * targetW) / w / 2); // 字符高宽比大约 2:1，所以高除以2
    
    image.resize({ w: targetW, h: targetH });
    
    // 转为黑白灰度
    for (let y = 0; y < targetH; y++) {
        let row = "";
        for (let x = 0; x < targetW; x++) {
            const idx = (y * targetW + x) * 4;
            const r = image.bitmap.data[idx];
            const g = image.bitmap.data[idx + 1];
            const b = image.bitmap.data[idx + 2];
            const gray = 0.299 * r + 0.587 * g + 0.114 * b;
            if (gray < 128) {
                row += "#";
            } else {
                row += " ";
            }
        }
        console.log(row);
    }
}

printAscii().catch(console.error);
