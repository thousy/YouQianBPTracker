const XLSX = require('xlsx');

function main() {
    const file1 = 'd:/xueya/YouQian血压历史记录_2026-07-01.xlsx';
    const file2 = 'd:/xueya/YouQian血压历史记录_2026-06-28.xlsx';
    
    [file1, file2].forEach(p => {
        console.log(`=== Reading Excel: ${p} ===`);
        const workbook = XLSX.readFile(p);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet);
        
        console.log("Total rows count:", rows.length);
        if (rows.length > 0) {
            console.log("First 3 rows sample:");
            console.log(JSON.stringify(rows.slice(0, 3), null, 2));
        }
    });
}

main();
