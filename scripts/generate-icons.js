import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

// Minimal PNG generator using Node built-in zlib
function createPng(width, height, drawFn) {
  // RGBA buffer: height rows, each row has 1 filter byte (0) + width * 4 bytes
  const rowSize = 1 + width * 4;
  const rawData = Buffer.alloc(height * rowSize);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // Filter type 0 (None)
    for (let x = 0; x < width; x++) {
      const pixelOffset = rowOffset + 1 + x * 4;
      const [r, g, b, a] = drawFn(x, y, width, height);
      rawData[pixelOffset] = r;
      rawData[pixelOffset + 1] = g;
      rawData[pixelOffset + 2] = b;
      rawData[pixelOffset + 3] = a;
    }
  }

  const deflated = zlib.deflateSync(rawData);

  // CRC32 table
  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[i] = c;
  }

  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function makeChunk(type, data) {
    const len = data.length;
    const buf = Buffer.alloc(12 + len);
    buf.writeUInt32BE(len, 0);
    buf.write(type, 4, 4, 'ascii');
    data.copy(buf, 8);
    const typeAndData = buf.subarray(4, 8 + len);
    const crc = crc32(typeAndData);
    buf.writeUInt32BE(crc, 8 + len);
    return buf;
  }

  // PNG Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 bit depth
  ihdr[9] = 6; // RGBA color type
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const ihdrChunk = makeChunk('IHDR', ihdr);

  // IDAT
  const idatChunk = makeChunk('IDAT', deflated);

  // IEND
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// Drawing logic: Dark slate background, grid lines, cyan polyline nodes, and green snap marker
function drawCadIcon(isMaskable) {
  return (x, y, w, h) => {
    const nx = x / w;
    const ny = y / h;

    // Background gradient: Deep slate-900 to slate-950
    const bgR = Math.floor(15 - 8 * ny);
    const bgG = Math.floor(23 - 12 * ny);
    const bgB = Math.floor(42 - 18 * ny);

    // If maskable, full bleed background with safe zone in center
    // If regular, rounded squircle corner check
    if (!isMaskable) {
      const cornerR = 0.22;
      const dx = Math.abs(nx - 0.5);
      const dy = Math.abs(ny - 0.5);
      if (dx > 0.5 - cornerR && dy > 0.5 - cornerR) {
        const cdx = dx - (0.5 - cornerR);
        const cdy = dy - (0.5 - cornerR);
        if (cdx * cdx + cdy * cdy > cornerR * cornerR) {
          return [0, 0, 0, 0]; // Transparent outside squircle
        }
      }
    }

    // Grid lines (subtle gray)
    const gridCount = 5;
    const gx = (nx * gridCount) % 1;
    const gy = (ny * gridCount) % 1;
    const isGrid = (gx < 0.02 || gy < 0.02) && (nx > 0.15 && nx < 0.85 && ny > 0.15 && ny < 0.85);

    // Nodes (Points)
    const points = [
      { x: 0.25, y: 0.70, color: [56, 189, 248] }, // Pt 1 Cyan
      { x: 0.45, y: 0.40, color: [56, 189, 248] }, // Pt 2 Cyan
      { x: 0.65, y: 0.55, color: [56, 189, 248] }, // Pt 3 Cyan
      { x: 0.78, y: 0.28, color: [34, 197, 94] },  // Pt 4 Green Snap
    ];

    // Distance to polyline segments
    function distToSegment(px, py, x1, y1, x2, y2) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len2 = dx * dx + dy * dy;
      let t = ((px - x1) * dx + (py - y1) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const projX = x1 + t * dx;
      const projY = y1 + t * dy;
      return Math.hypot(px - projX, py - projY);
    }

    // Check line segments
    let minLineDist = 1;
    for (let i = 0; i < points.length - 1; i++) {
      const d = distToSegment(nx, ny, points[i].x, points[i].y, points[i+1].x, points[i+1].y);
      if (d < minLineDist) minLineDist = d;
    }

    // Check point nodes
    for (const pt of points) {
      const d = Math.hypot(nx - pt.x, ny - pt.y);
      if (d < 0.025) {
        return [255, 255, 255, 255]; // Center white dot
      }
      if (d < 0.055) {
        return [...pt.color, 255]; // Outer circle
      }
      if (d < 0.070) {
        return [255, 255, 255, 230]; // White border ring
      }
    }

    // Draw Snap square around green point 4
    const snapPt = points[3];
    const sDx = Math.abs(nx - snapPt.x);
    const sDy = Math.abs(ny - snapPt.y);
    if ((sDx < 0.085 && sDy < 0.085) && (sDx > 0.075 || sDy > 0.075)) {
      return [34, 197, 94, 255]; // Green snap box
    }

    // Line stroke
    if (minLineDist < 0.018) {
      return [56, 189, 248, 255]; // Bright cyan polyline
    }
    if (minLineDist < 0.035) {
      return [14, 165, 233, 140]; // Polyline glow
    }

    if (isGrid) {
      return [30, 41, 59, 255]; // Slate grid
    }

    return [bgR, bgG, bgB, 255];
  };
}

const publicDir = path.resolve('public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// Generate Icons
console.log('Generating PWA PNG icons...');

const png192 = createPng(192, 192, drawCadIcon(false));
fs.writeFileSync(path.join(publicDir, 'pwa-192x192.png'), png192);

const png512 = createPng(512, 512, drawCadIcon(false));
fs.writeFileSync(path.join(publicDir, 'pwa-512x512.png'), png512);

const pngMaskable = createPng(512, 512, drawCadIcon(true));
fs.writeFileSync(path.join(publicDir, 'pwa-maskable-512x512.png'), pngMaskable);

const appleTouch = createPng(180, 180, drawCadIcon(false));
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), appleTouch);

// Simple favicon
fs.writeFileSync(path.join(publicDir, 'favicon.ico'), png192);

console.log('PWA icons created successfully.');
