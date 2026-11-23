// Zero-dependency multi-format barcode decoder (Native BarcodeDetector + pure TypeScript EAN-13/EAN-8/UPC-A/Code-128/Code-39 fallback)

interface NativeBarcodeResult {
  rawValue?: string;
}

interface NativeBarcodeDetector {
  detect: (source: ImageBitmapSource) => Promise<NativeBarcodeResult[]>;
}

type NativeBarcodeDetectorCtor = new (options?: { formats?: string[] }) => NativeBarcodeDetector;

const SUPPORTED_NATIVE_FORMATS = [
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'code_128',
  'code_39',
  'code_93',
  'itf',
  'codabar',
  'qr_code',
  'data_matrix',
];

let cachedNativeDetector: NativeBarcodeDetector | null | undefined;

export function getNativeBarcodeDetector(): NativeBarcodeDetector | null {
  if (cachedNativeDetector !== undefined) return cachedNativeDetector;
  try {
    const DetectorCtor = (
      window as unknown as { BarcodeDetector?: NativeBarcodeDetectorCtor }
    ).BarcodeDetector;
    if (!DetectorCtor) {
      cachedNativeDetector = null;
      return null;
    }
    try {
      cachedNativeDetector = new DetectorCtor({ formats: SUPPORTED_NATIVE_FORMATS });
    } catch {
      cachedNativeDetector = new DetectorCtor();
    }
    return cachedNativeDetector;
  } catch {
    cachedNativeDetector = null;
    return null;
  }
}

// --- EAN-13 / EAN-8 / UPC-A Tables ---
const EAN_L_PATTERNS: ReadonlyArray<readonly [number, number, number, number]> = [
  [3, 2, 1, 1], // 0
  [2, 2, 2, 1], // 1
  [2, 1, 2, 2], // 2
  [1, 4, 1, 1], // 3
  [1, 1, 3, 2], // 4
  [1, 2, 3, 1], // 5
  [1, 1, 1, 4], // 6
  [1, 3, 1, 2], // 7
  [1, 2, 1, 3], // 8
  [3, 1, 1, 2], // 9
];

const EAN_G_PATTERNS: ReadonlyArray<readonly [number, number, number, number]> = EAN_L_PATTERNS.map(
  ([a, b, c, d]) => [d, c, b, a] as const,
);

const EAN13_FIRST_DIGIT_PARITY: ReadonlyArray<string> = [
  'LLLLLL',
  'LLGLGG',
  'LLGGLG',
  'LLGGGL',
  'LGLLGG',
  'LGGLLG',
  'LGGGLL',
  'LGLGLG',
  'LGLGGL',
  'LGGLGL',
];

// --- Code 128 Patterns (values 0..105, 6 runs summing to 11) ---
const CODE128_PATTERNS: ReadonlyArray<readonly number[]> = [
  [2, 1, 2, 2, 2, 2], [2, 2, 2, 1, 2, 2], [2, 2, 2, 2, 2, 1], [1, 2, 1, 2, 2, 3],
  [1, 2, 1, 3, 2, 2], [1, 3, 1, 2, 2, 2], [1, 2, 2, 2, 1, 3], [1, 2, 2, 3, 1, 2],
  [1, 3, 2, 2, 1, 2], [2, 2, 1, 2, 1, 3], [2, 2, 1, 3, 1, 2], [2, 3, 1, 2, 1, 2],
  [1, 1, 2, 2, 3, 2], [1, 2, 2, 1, 3, 2], [1, 2, 2, 2, 3, 1], [1, 1, 3, 2, 2, 2],
  [1, 2, 3, 1, 2, 2], [1, 2, 3, 2, 2, 1], [2, 2, 3, 2, 1, 1], [2, 2, 1, 1, 3, 2],
  [2, 2, 1, 2, 3, 1], [2, 1, 3, 2, 1, 2], [2, 2, 3, 1, 1, 2], [3, 1, 2, 1, 3, 1],
  [3, 1, 1, 2, 2, 2], [3, 2, 1, 1, 2, 2], [3, 2, 1, 2, 2, 1], [3, 1, 2, 2, 1, 2],
  [3, 2, 2, 1, 1, 2], [3, 2, 2, 2, 1, 1], [2, 1, 2, 1, 2, 3], [2, 1, 2, 3, 2, 1],
  [2, 3, 2, 1, 2, 1], [1, 1, 1, 3, 2, 3], [1, 3, 1, 1, 2, 3], [1, 3, 1, 3, 2, 1],
  [1, 1, 2, 3, 1, 3], [1, 3, 2, 1, 1, 3], [1, 3, 2, 3, 1, 1], [2, 1, 1, 3, 1, 3],
  [2, 3, 1, 1, 1, 3], [2, 3, 1, 3, 1, 1], [1, 1, 2, 1, 3, 3], [1, 1, 2, 3, 3, 1],
  [1, 3, 2, 1, 3, 1], [1, 1, 3, 1, 2, 3], [1, 1, 3, 3, 2, 1], [1, 3, 3, 1, 2, 1],
  [3, 1, 3, 1, 2, 1], [2, 1, 1, 3, 3, 1], [2, 3, 1, 1, 3, 1], [2, 1, 3, 1, 1, 3],
  [2, 1, 3, 3, 1, 1], [2, 1, 3, 1, 3, 1], [3, 1, 1, 1, 2, 3], [3, 1, 1, 3, 2, 1],
  [3, 3, 1, 1, 2, 1], [3, 1, 2, 1, 1, 3], [3, 1, 2, 3, 1, 1], [3, 3, 2, 1, 1, 1],
  [3, 1, 4, 1, 1, 1], [2, 2, 1, 4, 1, 1], [4, 3, 1, 1, 1, 1], [1, 1, 1, 2, 2, 4],
  [1, 1, 1, 4, 2, 2], [1, 2, 1, 1, 2, 4], [1, 2, 1, 4, 2, 1], [1, 4, 1, 1, 2, 2],
  [1, 4, 1, 2, 2, 1], [1, 1, 2, 2, 1, 4], [1, 1, 2, 4, 1, 2], [1, 2, 2, 1, 1, 4],
  [1, 2, 2, 4, 1, 1], [1, 4, 2, 1, 1, 2], [1, 4, 2, 2, 1, 1], [2, 4, 1, 2, 1, 1],
  [2, 2, 1, 1, 1, 4], [4, 1, 3, 1, 1, 1], [2, 4, 1, 1, 1, 2], [1, 3, 4, 1, 1, 1],
  [1, 1, 1, 2, 4, 2], [1, 2, 1, 1, 4, 2], [1, 2, 1, 2, 4, 1], [1, 1, 4, 2, 1, 2],
  [1, 2, 4, 1, 1, 2], [1, 2, 4, 2, 1, 1], [4, 1, 1, 2, 1, 2], [4, 2, 1, 1, 1, 2],
  [4, 2, 1, 2, 1, 1], [2, 1, 2, 1, 4, 1], [2, 1, 4, 1, 2, 1], [4, 1, 2, 1, 2, 1],
  [1, 1, 1, 1, 4, 3], [1, 1, 1, 3, 4, 1], [1, 3, 1, 1, 4, 1], [1, 1, 4, 1, 1, 3],
  [1, 1, 4, 3, 1, 1], [4, 1, 1, 1, 1, 3], [4, 1, 1, 3, 1, 1], [1, 1, 3, 1, 4, 1],
  [1, 1, 4, 1, 3, 1], [3, 1, 1, 1, 4, 1], [4, 1, 1, 1, 3, 1], [2, 1, 1, 4, 1, 2],
  [2, 1, 1, 2, 1, 4], [2, 1, 1, 2, 3, 2],
];

const CODE128_STOP = [2, 3, 3, 1, 1, 1, 2];

// --- Code 39 Patterns (9 runs: 1 = wide, 0 = narrow) ---
const CODE39_MAP: Record<string, string> = {
  '000110100': '0', '100100001': '1', '001100001': '2', '101100000': '3',
  '000110001': '4', '100110000': '5', '001110000': '6', '000100101': '7',
  '100100100': '8', '001100100': '9', '100001001': 'A', '001001001': 'B',
  '101001000': 'C', '000011001': 'D', '100011000': 'E', '001011000': 'F',
  '000001101': 'G', '100001100': 'H', '001001100': 'I', '000011100': 'J',
  '100000011': 'K', '001000011': 'L', '101000010': 'M', '000010011': 'N',
  '100010010': 'O', '001010010': 'P', '000000111': 'Q', '100000110': 'R',
  '001000110': 'S', '000010110': 'T', '110000001': 'U', '011000001': 'V',
  '111000000': 'W', '010010001': 'X', '110010000': 'Y', '011010000': 'Z',
  '010000101': '-', '110000100': '.', '011000100': ' ', '010101000': '$',
  '010100010': '/', '010001010': '+', '000101010': '%', '010010100': '*',
};

interface Run {
  dark: boolean;
  len: number;
}

function extractRunsFromRow(
  rgba: Uint8ClampedArray,
  width: number,
  y: number,
  biasOffset: number,
): Run[] {
  const rowStart = y * width * 4;
  const luma = new Float32Array(width);
  let sum = 0;
  for (let x = 0; x < width; x += 1) {
    const idx = rowStart + x * 4;
    const v = 0.299 * rgba[idx] + 0.587 * rgba[idx + 1] + 0.114 * rgba[idx + 2];
    luma[x] = v;
    sum += v;
  }

  // Local sliding-window adaptive threshold handles uneven lighting and shadows
  const winRadius = Math.max(12, Math.floor(width / 16));
  const prefix = new Float32Array(width + 1);
  for (let x = 0; x < width; x += 1) {
    prefix[x + 1] = prefix[x] + luma[x];
  }

  const runs: Run[] = [];
  let currentDark = false;
  let currentLen = 0;
  const globalMean = sum / width;

  for (let x = 0; x < width; x += 1) {
    const left = Math.max(0, x - winRadius);
    const right = Math.min(width, x + winRadius + 1);
    const localMean = (prefix[right] - prefix[left]) / (right - left);
    const threshold = localMean * 0.72 + globalMean * 0.28 + biasOffset;
    const isDark = luma[x] < threshold;

    if (currentLen === 0) {
      currentDark = isDark;
      currentLen = 1;
    } else if (isDark === currentDark) {
      currentLen += 1;
    } else {
      runs.push({ dark: currentDark, len: currentLen });
      currentDark = isDark;
      currentLen = 1;
    }
  }
  if (currentLen > 0) {
    runs.push({ dark: currentDark, len: currentLen });
  }
  return runs;
}

function matchPattern(
  runs: Run[],
  startIdx: number,
  pattern: readonly number[],
  unitWidth: number,
  maxAvgErr: number,
  maxIndividualErr: number,
): number {
  let totalErr = 0;
  for (let i = 0; i < pattern.length; i += 1) {
    const expected = pattern[i] * unitWidth;
    const err = Math.abs(runs[startIdx + i].len - expected) / unitWidth;
    if (err > maxIndividualErr) return Infinity;
    totalErr += err;
  }
  const avgErr = totalErr / pattern.length;
  return avgErr <= maxAvgErr ? avgErr : Infinity;
}

function decodeEanDigit(
  runs: Run[],
  startIdx: number,
  allowG: boolean,
): { digit: number; parity: 'L' | 'G' } | null {
  const total =
    runs[startIdx].len + runs[startIdx + 1].len + runs[startIdx + 2].len + runs[startIdx + 3].len;
  if (total < 4) return null;
  const unit = total / 7;

  let bestErr = 0.42;
  let bestDigit = -1;
  let bestParity: 'L' | 'G' = 'L';

  for (let d = 0; d < 10; d += 1) {
    const errL = matchPattern(runs, startIdx, EAN_L_PATTERNS[d], unit, bestErr, 0.72);
    if (errL < bestErr) {
      bestErr = errL;
      bestDigit = d;
      bestParity = 'L';
    }
    if (allowG) {
      const errG = matchPattern(runs, startIdx, EAN_G_PATTERNS[d], unit, bestErr, 0.72);
      if (errG < bestErr) {
        bestErr = errG;
        bestDigit = d;
        bestParity = 'G';
      }
    }
  }

  return bestDigit >= 0 ? { digit: bestDigit, parity: bestParity } : null;
}

function verifyEan13Checksum(digits: number[]): boolean {
  if (digits.length !== 13) return false;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += digits[i] * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return check === digits[12];
}

function verifyEan8Checksum(digits: number[]): boolean {
  if (digits.length !== 8) return false;
  let sum = 0;
  for (let i = 0; i < 7; i += 1) {
    sum += digits[i] * (i % 2 === 0 ? 3 : 1);
  }
  const check = (10 - (sum % 10)) % 10;
  return check === digits[7];
}

function tryDecodeEan13(runs: Run[]): string | null {
  // EAN-13 has 3 (start) + 24 (left) + 5 (center) + 24 (right) + 3 (end) = 59 runs
  if (runs.length < 59) return null;

  for (let i = 0; i <= runs.length - 59; i += 1) {
    if (!runs[i].dark) continue;
    const guardUnit = (runs[i].len + runs[i + 1].len + runs[i + 2].len) / 3;
    if (guardUnit < 0.8) continue;
    if (matchPattern(runs, i, [1, 1, 1], guardUnit, 0.45, 0.75) === Infinity) continue;

    // Check center guard at i + 27 (5 runs: light, dark, light, dark, light)
    const centerIdx = i + 27;
    if (runs[centerIdx].dark) continue;
    const centerUnit =
      (runs[centerIdx].len +
        runs[centerIdx + 1].len +
        runs[centerIdx + 2].len +
        runs[centerIdx + 3].len +
        runs[centerIdx + 4].len) /
      5;
    if (matchPattern(runs, centerIdx, [1, 1, 1, 1, 1], centerUnit, 0.45, 0.75) === Infinity) {
      continue;
    }

    // Check end guard at i + 56 (3 runs: dark, light, dark)
    const endIdx = i + 56;
    if (!runs[endIdx].dark) continue;
    const endUnit = (runs[endIdx].len + runs[endIdx + 1].len + runs[endIdx + 2].len) / 3;
    if (matchPattern(runs, endIdx, [1, 1, 1], endUnit, 0.48, 0.8) === Infinity) continue;

    const leftDigits: number[] = [];
    let parityStr = '';
    let valid = true;

    for (let d = 0; d < 6; d += 1) {
      const decoded = decodeEanDigit(runs, i + 3 + d * 4, true);
      if (!decoded) {
        valid = false;
        break;
      }
      leftDigits.push(decoded.digit);
      parityStr += decoded.parity;
    }
    if (!valid) continue;

    const firstDigit = EAN13_FIRST_DIGIT_PARITY.indexOf(parityStr);
    if (firstDigit < 0) continue;

    const rightDigits: number[] = [];
    for (let d = 0; d < 6; d += 1) {
      const decoded = decodeEanDigit(runs, i + 32 + d * 4, false);
      if (!decoded) {
        valid = false;
        break;
      }
      rightDigits.push(decoded.digit);
    }
    if (!valid) continue;

    const fullDigits = [firstDigit, ...leftDigits, ...rightDigits];
    if (verifyEan13Checksum(fullDigits)) {
      return fullDigits.join('');
    }
  }
  return null;
}

function tryDecodeEan8(runs: Run[]): string | null {
  // EAN-8 has 3 (start) + 16 (left) + 5 (center) + 16 (right) + 3 (end) = 43 runs
  if (runs.length < 43) return null;

  for (let i = 0; i <= runs.length - 43; i += 1) {
    if (!runs[i].dark) continue;
    const guardUnit = (runs[i].len + runs[i + 1].len + runs[i + 2].len) / 3;
    if (guardUnit < 0.8) continue;
    if (matchPattern(runs, i, [1, 1, 1], guardUnit, 0.45, 0.75) === Infinity) continue;

    const centerIdx = i + 19;
    if (runs[centerIdx].dark) continue;
    const centerUnit =
      (runs[centerIdx].len +
        runs[centerIdx + 1].len +
        runs[centerIdx + 2].len +
        runs[centerIdx + 3].len +
        runs[centerIdx + 4].len) /
      5;
    if (matchPattern(runs, centerIdx, [1, 1, 1, 1, 1], centerUnit, 0.45, 0.75) === Infinity) {
      continue;
    }

    const endIdx = i + 40;
    if (!runs[endIdx].dark) continue;
    const endUnit = (runs[endIdx].len + runs[endIdx + 1].len + runs[endIdx + 2].len) / 3;
    if (matchPattern(runs, endIdx, [1, 1, 1], endUnit, 0.48, 0.8) === Infinity) continue;

    const digits: number[] = [];
    let valid = true;
    for (let d = 0; d < 4; d += 1) {
      const decoded = decodeEanDigit(runs, i + 3 + d * 4, false);
      if (!decoded) {
        valid = false;
        break;
      }
      digits.push(decoded.digit);
    }
    if (!valid) continue;

    for (let d = 0; d < 4; d += 1) {
      const decoded = decodeEanDigit(runs, i + 24 + d * 4, false);
      if (!decoded) {
        valid = false;
        break;
      }
      digits.push(decoded.digit);
    }
    if (!valid) continue;

    if (verifyEan8Checksum(digits)) {
      return digits.join('');
    }
  }
  return null;
}

function matchCode128Symbol(runs: Run[], startIdx: number): number {
  if (startIdx + 6 > runs.length || !runs[startIdx].dark) return -1;
  let sum = 0;
  for (let k = 0; k < 6; k += 1) sum += runs[startIdx + k].len;
  if (sum < 6) return -1;
  const unit = sum / 11;

  let bestErr = 0.45;
  let bestCode = -1;
  for (let code = 0; code < CODE128_PATTERNS.length; code += 1) {
    const err = matchPattern(runs, startIdx, CODE128_PATTERNS[code], unit, bestErr, 0.75);
    if (err < bestErr) {
      bestErr = err;
      bestCode = code;
    }
  }
  return bestCode;
}

function tryDecodeCode128(runs: Run[]): string | null {
  if (runs.length < 25) return null;

  for (let i = 0; i <= runs.length - 19; i += 1) {
    if (!runs[i].dark) continue;
    const startCode = matchCode128Symbol(runs, i);
    if (startCode !== 103 && startCode !== 104 && startCode !== 105) continue;

    const codes: number[] = [startCode];
    let pos = i + 6;
    let foundStop = false;

    while (pos + 7 <= runs.length && codes.length < 48) {
      // Check Stop pattern (7 runs summing to 13)
      let stopSum = 0;
      for (let k = 0; k < 7; k += 1) stopSum += runs[pos + k].len;
      const stopUnit = stopSum / 13;
      if (matchPattern(runs, pos, CODE128_STOP, stopUnit, 0.45, 0.75) !== Infinity) {
        foundStop = true;
        break;
      }

      const nextCode = matchCode128Symbol(runs, pos);
      if (nextCode < 0) break;
      codes.push(nextCode);
      pos += 6;
    }

    if (!foundStop || codes.length < 3) continue;

    // Verify Modulo-103 checksum
    const checkDigit = codes[codes.length - 1];
    let checksum = codes[0];
    for (let idx = 1; idx < codes.length - 1; idx += 1) {
      checksum += codes[idx] * idx;
    }
    if (checksum % 103 !== checkDigit) continue;

    // Translate Code 128 payload
    let codeSet: 'A' | 'B' | 'C' = startCode === 103 ? 'A' : startCode === 104 ? 'B' : 'C';
    let text = '';
    for (let idx = 1; idx < codes.length - 1; idx += 1) {
      const c = codes[idx];
      if (codeSet === 'C') {
        if (c === 100) {
          codeSet = 'B';
        } else if (c === 101) {
          codeSet = 'A';
        } else if (c <= 99) {
          text += c < 10 ? `0${c}` : String(c);
        }
      } else if (codeSet === 'B') {
        if (c === 99) {
          codeSet = 'C';
        } else if (c === 101) {
          codeSet = 'A';
        } else if (c >= 0 && c <= 94) {
          text += String.fromCharCode(c + 32);
        }
      } else {
        if (c === 99) {
          codeSet = 'C';
        } else if (c === 100) {
          codeSet = 'B';
        } else if (c >= 0 && c <= 63) {
          text += String.fromCharCode(c + 32);
        }
      }
    }

    if (text.trim().length >= 2) {
      return text.trim();
    }
  }
  return null;
}

function tryDecodeCode39(runs: Run[]): string | null {
  // Minimum 3 symbols (* + 1 char + *) = 29 runs
  if (runs.length < 29) return null;

  const decodeSymbolAt = (idx: number): string | null => {
    if (idx + 9 > runs.length || !runs[idx].dark) return null;
    const lens: number[] = [];
    for (let k = 0; k < 9; k += 1) lens.push(runs[idx + k].len);
    const sorted = [...lens].sort((a, b) => a - b);
    // In Code 39, 6 elements are narrow and 3 are wide
    const narrowAvg = (sorted[0] + sorted[1] + sorted[2] + sorted[3] + sorted[4] + sorted[5]) / 6;
    const wideAvg = (sorted[6] + sorted[7] + sorted[8]) / 3;
    if (narrowAvg < 0.7 || wideAvg / narrowAvg < 1.65 || wideAvg / narrowAvg > 4.2) return null;
    const threshold = (narrowAvg + wideAvg) / 2;
    const bits = lens.map((l) => (l > threshold ? '1' : '0')).join('');
    return CODE39_MAP[bits] ?? null;
  };

  for (let i = 0; i <= runs.length - 29; i += 1) {
    if (!runs[i].dark) continue;
    if (decodeSymbolAt(i) !== '*') continue;

    let decoded = '';
    let pos = i + 10; // skip 9 runs + 1 inter-character light space
    let closed = false;

    while (pos + 9 <= runs.length && decoded.length < 32) {
      const ch = decodeSymbolAt(pos);
      if (!ch) break;
      if (ch === '*') {
        closed = true;
        break;
      }
      decoded += ch;
      pos += 10;
    }

    if (closed && decoded.trim().length >= 2) {
      return decoded.trim();
    }
  }
  return null;
}

function decodeRowRuns(runs: Run[]): string | null {
  return (
    tryDecodeEan13(runs) ||
    tryDecodeCode128(runs) ||
    tryDecodeEan8(runs) ||
    tryDecodeCode39(runs)
  );
}

export function decodeBarcodeFromCanvas(canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const { width, height } = canvas;
  if (width < 80 || height < 40) return null;

  const imageData = ctx.getImageData(0, 0, width, height);
  const rgba = imageData.data;

  // Sample horizontal lines across the central target band
  const rowRatios = [0.5, 0.44, 0.56, 0.38, 0.62, 0.32, 0.68];
  const biases = [0, -10, 10];

  for (const ratio of rowRatios) {
    const y = Math.min(height - 1, Math.max(0, Math.floor(height * ratio)));
    for (const bias of biases) {
      const runs = extractRunsFromRow(rgba, width, y, bias);
      const forward = decodeRowRuns(runs);
      if (forward) return forward;

      const reversed = decodeRowRuns([...runs].reverse());
      if (reversed) return reversed;
    }
  }

  return null;
}

export async function decodeBarcodeFromVideoFrame(
  videoEl: HTMLVideoElement,
  scratchCanvas: HTMLCanvasElement,
): Promise<string | null> {
  if (videoEl.readyState < 2 || videoEl.videoWidth === 0 || videoEl.videoHeight === 0) {
    return null;
  }

  // 1. Hardware-accelerated native BarcodeDetector (Chrome / Edge / Android)
  const nativeDetector = getNativeBarcodeDetector();
  if (nativeDetector) {
    try {
      const barcodes = await nativeDetector.detect(videoEl);
      const firstValue = barcodes.find((b) => b.rawValue)?.rawValue;
      if (firstValue) return firstValue;
    } catch {
      // fall through to canvas decoder
    }
  }

  // 2. Pure TypeScript canvas 1D barcode decoder fallback (all browsers, zero dependencies)
  const targetWidth = Math.min(960, videoEl.videoWidth);
  const scale = targetWidth / videoEl.videoWidth;
  const targetHeight = Math.max(80, Math.round(videoEl.videoHeight * scale));

  if (scratchCanvas.width !== targetWidth || scratchCanvas.height !== targetHeight) {
    scratchCanvas.width = targetWidth;
    scratchCanvas.height = targetHeight;
  }

  const ctx = scratchCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(videoEl, 0, 0, targetWidth, targetHeight);
  return decodeBarcodeFromCanvas(scratchCanvas);
}

export async function decodeBarcodeFromImageFile(file: File): Promise<string | null> {
  // 1. Native BarcodeDetector on ImageBitmap
  const nativeDetector = getNativeBarcodeDetector();
  if (nativeDetector && typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      try {
        const barcodes = await nativeDetector.detect(bitmap);
        const firstValue = barcodes.find((b) => b.rawValue)?.rawValue;
        if (firstValue) return firstValue;
      } finally {
        bitmap.close();
      }
    } catch {
      // fall through to canvas decoder
    }
  }

  // 2. Pure TypeScript canvas decoder (tries normal and 90-degree rotated orientations)
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('No se pudo cargar la imagen.'));
      el.src = objectUrl;
    });

    const maxDim = 1200;
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const w = Math.max(80, Math.round(img.naturalWidth * scale));
    const h = Math.max(80, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);

    const horizontal = decodeBarcodeFromCanvas(canvas);
    if (horizontal) return horizontal;

    // Try 90-degree rotated in case the user photographed the barcode vertically
    const rotCanvas = document.createElement('canvas');
    rotCanvas.width = h;
    rotCanvas.height = w;
    const rotCtx = rotCanvas.getContext('2d', { willReadFrequently: true });
    if (!rotCtx) return null;
    rotCtx.translate(h / 2, w / 2);
    rotCtx.rotate(Math.PI / 2);
    rotCtx.drawImage(img, -w / 2, -h / 2, w, h);

    return decodeBarcodeFromCanvas(rotCanvas);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
