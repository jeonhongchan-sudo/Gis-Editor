/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type SupportedEncoding = 'auto' | 'euc-kr' | 'utf-8';

/**
 * Detect whether buffer is likely UTF-8 or CP949 (EUC-KR)
 * Korean CAD (AutoCAD, ZWCAD, CadAuto) predominantly saves DXF in CP949 / ANSI 949.
 */
export function detectKoreanEncoding(buffer: ArrayBuffer): 'utf-8' | 'euc-kr' {
  const bytes = new Uint8Array(buffer);
  const sampleLength = Math.min(bytes.length, 32768); // Inspect first 32KB

  // 0. Check for UTF-8 BOM
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return 'utf-8';
  }

  // 1. Check for explicit AutoCAD DXF CodePage header: $DWGCODEPAGE -> ANSI_949 or DOS949 or 949
  let headerAscii = '';
  const headerLen = Math.min(bytes.length, 4096);
  for (let i = 0; i < headerLen; i++) {
    headerAscii += String.fromCharCode(bytes[i]);
  }

  if (
    headerAscii.includes('ANSI_949') || 
    headerAscii.includes('DOS949') || 
    headerAscii.includes('CP949') || 
    headerAscii.includes('EUC-KR') ||
    headerAscii.includes('949')
  ) {
    return 'euc-kr';
  }

  if (headerAscii.includes('UTF-8') || headerAscii.includes('UTF8')) {
    return 'utf-8';
  }

  // 2. Fast Strict UTF-8 validation probe
  try {
    const utf8Strict = new TextDecoder('utf-8', { fatal: true });
    const sampleText = utf8Strict.decode(bytes.subarray(0, sampleLength));
    // If it contains Hangul syllables decoded successfully, it's UTF-8!
    if (/[\uAC00-\uD7AF\u1100-\u11FF]/.test(sampleText)) {
      return 'utf-8';
    }
  } catch {
    // Byte sequence is invalid in UTF-8 (typical for CP949 Korean characters)
    return 'euc-kr';
  }

  // 2. Statistical Analysis of Korean CP949 vs UTF-8 byte patterns
  // In UTF-8: Korean characters are 3 bytes: 1110xxxx (0xE0-0xEF) followed by 10xxxxxx (0x80-0xBF)
  // In CP949 / EUC-KR: Korean characters are 2 bytes: lead byte 0x81-0xFE, trail byte 0x41-0xFE
  let validUtf8Sequences = 0;
  let invalidUtf8Sequences = 0;
  let validCp949Sequences = 0;

  let i = 0;
  while (i < sampleLength) {
    const byte1 = bytes[i];

    if (byte1 <= 0x7F) {
      // Standard ASCII
      i++;
      continue;
    }

    // Check UTF-8 multibyte
    if ((byte1 & 0xE0) === 0xC0 && i + 1 < sampleLength) {
      // 2-byte UTF-8
      const byte2 = bytes[i + 1];
      if ((byte2 & 0xC0) === 0x80) {
        validUtf8Sequences++;
        i += 2;
        continue;
      }
    } else if ((byte1 & 0xF0) === 0xE0 && i + 2 < sampleLength) {
      // 3-byte UTF-8 (Korean Hangul in UTF-8: 0xEA, 0xEB, 0xEC, 0xED)
      const byte2 = bytes[i + 1];
      const byte3 = bytes[i + 2];
      if ((byte2 & 0xC0) === 0x80 && (byte3 & 0xC0) === 0x80) {
        validUtf8Sequences++;
        i += 3;
        continue;
      }
    } else if ((byte1 & 0xF8) === 0xF0 && i + 3 < sampleLength) {
      // 4-byte UTF-8
      const byte2 = bytes[i + 1];
      const byte3 = bytes[i + 2];
      const byte4 = bytes[i + 3];
      if ((byte2 & 0xC0) === 0x80 && (byte3 & 0xC0) === 0x80 && (byte4 & 0xC0) === 0x80) {
        validUtf8Sequences++;
        i += 4;
        continue;
      }
    }

    invalidUtf8Sequences++;

    // Check CP949 2-byte Korean
    if (byte1 >= 0x81 && byte1 <= 0xFE && i + 1 < sampleLength) {
      const byte2 = bytes[i + 1];
      if ((byte2 >= 0x41 && byte2 <= 0x5A) || 
          (byte2 >= 0x61 && byte2 <= 0x7A) || 
          (byte2 >= 0x81 && byte2 <= 0xFE)) {
        validCp949Sequences++;
        i += 2;
        continue;
      }
    }

    i++;
  }

  // Decision
  if (invalidUtf8Sequences > 0 && validCp949Sequences > 0) {
    return 'euc-kr';
  }

  if (validUtf8Sequences > validCp949Sequences * 2) {
    return 'utf-8';
  }

  if (validCp949Sequences > 0) {
    return 'euc-kr';
  }

  return 'utf-8';
}

/**
 * Decode ArrayBuffer into string using specified or auto-detected encoding
 */
export function decodeBufferText(
  buffer: ArrayBuffer, 
  encoding: SupportedEncoding = 'auto'
): { text: string; detectedEncoding: 'utf-8' | 'euc-kr' } {
  let targetEncoding: 'utf-8' | 'euc-kr';

  if (encoding === 'auto') {
    targetEncoding = detectKoreanEncoding(buffer);
  } else {
    targetEncoding = encoding;
  }

  try {
    const decoder = new TextDecoder(targetEncoding, { fatal: false });
    const text = decoder.decode(buffer);
    return { text, detectedEncoding: targetEncoding };
  } catch (err) {
    console.warn(`Failed to decode as ${targetEncoding}, falling back to euc-kr:`, err);
    try {
      const fallback = new TextDecoder('euc-kr', { fatal: false });
      return { text: fallback.decode(buffer), detectedEncoding: 'euc-kr' };
    } catch {
      const utf8Fallback = new TextDecoder('utf-8', { fatal: false });
      return { text: utf8Fallback.decode(buffer), detectedEncoding: 'utf-8' };
    }
  }
}
