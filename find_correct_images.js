const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');

const tempDir = 'C:/Users/admin/.gemini/antigravity-ide/brain/18e3979d-ef62-4b08-b413-c663541b1948/.tempmediaStorage';
const destDir = 'd:/xueya/ceshi_file';

async function run() {
    if (!fs.existsSync(tempDir)) {
        console.log("Temp dir does not exist:", tempDir);
        return;
    }
    const files = fs.readdirSync(tempDir);
    console.log("Files in tempDir:", files);
    
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.endsWith('.jpg')) {
            const src = path.join(tempDir, file);
            const dest = path.join(destDir, `temp_artifact_${i}.jpg`);
            fs.copyFileSync(src, dest);
            
            const img = await Jimp.read(src);
            console.log(`Copied ${file} to ${dest}. Resolution: ${img.bitmap.width}x${img.bitmap.height}`);
        }
    }
}

run().catch(console.error);
