import iconv from 'iconv-lite';

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
/**
 * Encode string into Uint8Array using specified encoding
 */
export function encodeText(
  text: string, 
  encoding: 'utf-8' | 'euc-kr' | 'utf-8-bom'
): Uint8Array {
  if (encoding === 'utf-8-bom') {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(text);
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const result = new Uint8Array(bom.length + bytes.length);
    result.set(bom);
    result.set(bytes, bom.length);
    return result;
  }

  if (encoding === 'utf-8') {
    return new TextEncoder().encode(text);
  }

  if (encoding === 'euc-kr') {
    try {
      return iconv.encode(text, 'euc-kr');
    } catch (err) {
      console.warn('Encoding to euc-kr failed, falling back to utf-8', err);
    }
  }

  // Final fallback to UTF-8 if everything else fails
  return new TextEncoder().encode(text);
}

/**
 * Clips a string by its byte length in a specific encoding without splitting multibyte characters.
 * Useful for fixed-byte formats like DBF.
 */
export function safeByteClip(
  text: string,
  maxBytes: number,
  encoding: 'utf-8' | 'euc-kr'
): Uint8Array {
  const bytes = encodeText(text, encoding === 'euc-kr' ? 'euc-kr' : 'utf-8');
  if (bytes.length <= maxBytes) return bytes;

  // If UTF-8, we check from the end for continuation bytes (10xxxxxx)
  if (encoding === 'utf-8') {
    let i = maxBytes;
    // UTF-8 continuation bytes are 0x80 to 0xBF (10xxxxxx)
    while (i > 0 && (bytes[i] & 0xC0) === 0x80) {
      i--;
    }
    // Now i points to the start of a multibyte char that might be split
    // Check if the whole char fits
    let charLen = 0;
    const firstByte = bytes[i];
    if (firstByte <= 0x7F) charLen = 1;
    else if ((firstByte & 0xE0) === 0xC0) charLen = 2;
    else if ((firstByte & 0xF0) === 0xE0) charLen = 3;
    else if ((firstByte & 0xF8) === 0xF0) charLen = 4;

    if (i + charLen <= maxBytes) {
      return bytes.slice(0, i + charLen);
    } else {
      return bytes.slice(0, i);
    }
  }

  // If EUC-KR / CP949: 2-byte Korean characters
  if (encoding === 'euc-kr') {
    let i = 0;
    while (i < maxBytes) {
      const byte = bytes[i];
      if (byte <= 0x7F) {
        // ASCII
        i += 1;
      } else if (byte >= 0x81 && byte <= 0xFE) {
        // Lead byte of 2-byte char
        if (i + 2 <= maxBytes) {
          i += 2;
        } else {
          // Would be split
          break;
        }
      } else {
        // Unknown/Invalid - treat as 1 byte to avoid infinite loops
        i += 1;
      }
    }
    return bytes.slice(0, i);
  }

  return bytes.slice(0, maxBytes);
}

/**
 * Smart decoder for zip entry filenames or byte arrays from Korean Windows/CAD
 */
export function smartDecodeKoreanBytes(rawInput: Uint8Array | Buffer | number[] | string[] | any): string {
  if (!rawInput) return '';
  let bytes: Uint8Array;
  if (rawInput instanceof Uint8Array) {
    bytes = rawInput;
  } else if (Array.isArray(rawInput)) {
    bytes = new Uint8Array(rawInput.map(b => (typeof b === 'string' ? b.charCodeAt(0) & 0xff : Number(b) & 0xff)));
  } else {
    bytes = new Uint8Array(rawInput);
  }

  // If pure ASCII, fast return
  let isAscii = true;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] > 0x7F) {
      isAscii = false;
      break;
    }
  }
  if (isAscii) {
    return String.fromCharCode(...bytes);
  }

  // 1. Try strict UTF-8
  try {
    const utf8 = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (/[\uAC00-\uD7AF\u1100-\u11FF]/.test(utf8)) {
      return utf8;
    }
  } catch {}

  // 2. Try CP949 / EUC-KR
  try {
    const cp949 = iconv.decode(Buffer.from(bytes), 'cp949');
    if (/[\uAC00-\uD7AF\u1100-\u11FF]/.test(cp949)) {
      return cp949;
    }
  } catch {}

  // 3. Try fatal UTF-8 for other non-Korean scripts
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {}

  // 4. Fallback to CP949 (most common in Korean CAD), then non-fatal UTF-8
  try {
    return iconv.decode(Buffer.from(bytes), 'cp949');
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}

