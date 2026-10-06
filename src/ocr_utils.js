(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    root.ocrUtils = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function mapConfusedCharacters(str) {
        if (!str) return '';
        let res = '';
        for (let i = 0; i < str.length; i++) {
            const char = str[i];
            const lower = char.toLowerCase();
            if (lower === 'i' || lower === 'l' || char === '|') {
                res += '1';
            } else if (lower === 'o' || lower === 'u') {
                res += '0';
            } else if (lower === 's') {
                res += '5';
            } else if (lower === 'b') {
                res += '8';
            } else if (lower === 'z') {
                res += '2';
            } else if (lower === 't') {
                res += '7';
            } else if (lower === 'g') {
                res += '9';
            } else {
                res += char;
            }
        }
        return res;
    }

    function extractNumericCandidates(rawText) {
        if (!rawText) return [];
        const normalized = mapConfusedCharacters(String(rawText));
        const matches = normalized.match(/\d+/g) || [];
        const values = matches
            .map((m) => parseInt(m, 10))
            .filter((n) => Number.isInteger(n) && n >= 10 && n <= 250);

        if (values.length === 0) {
            const singleDigits = Array.from(normalized).filter((ch) => /\d/.test(ch));
            if (singleDigits.length > 0) {
                return singleDigits.map((ch) => parseInt(ch, 10)).filter((n) => n >= 0 && n <= 9);
            }
        }
        return values;
    }

    function parseBPValues(nums) {
        if (!nums || nums.length < 2) return null;

        const cleanNums = nums.filter((n) => Number.isInteger(n) && n >= 10 && n <= 250);
        if (cleanNums.length < 2) return null;

        const sysCandidates = cleanNums.filter((n) => n >= 90 && n <= 195);
        const diaCandidates = cleanNums.filter((n) => n >= 50 && n <= 115);
        const pulseCandidates = cleanNums.filter((n) => n >= 40 && n <= 160);

        let systolic = null;
        let diastolic = null;
        let pulse = null;

        if (sysCandidates.length > 0) {
            systolic = sysCandidates.sort((a, b) => b - a)[0];
        }

        if (diaCandidates.length > 0 && systolic !== null) {
            diastolic = diaCandidates
                .filter((n) => n < systolic)
                .sort((a, b) => a - b)[0] || null;
        }

        if (!diastolic && diaCandidates.length > 0) {
            diastolic = diaCandidates.sort((a, b) => a - b)[0];
        }

        if (pulseCandidates.length > 0) {
            pulse = pulseCandidates.sort((a, b) => a - b)[0];
        }

        if (systolic !== null && diastolic !== null) {
            return { systolic, diastolic, pulse };
        }

        return null;
    }

    return {
        mapConfusedCharacters,
        extractNumericCandidates,
        parseBPValues
    };
}));
