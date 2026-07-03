const Tesseract = require('tesseract.js');
const fs = require('fs');

async function run() {
    const worker = await Tesseract.createWorker('eng', 1);
    await worker.setParameters({
        tessedit_pageseg_mode: '11', // 自动页面分割，寻找所有的数字
        tessedit_char_whitelist: '0123456789ilIoOuUsSbBgGzZtT\n '
    });

    for (let i = 0; i <= 5; i++) {
        const p = `d:/xueya/ceshi_file/temp_artifact_${i}.jpg`;
        const { data: { text } } = await worker.recognize(p);
        console.log(`\n--- temp_artifact_${i}.jpg ---`);
        console.log(text.trim());
    }
    await worker.terminate();
}

run().catch(console.error);
