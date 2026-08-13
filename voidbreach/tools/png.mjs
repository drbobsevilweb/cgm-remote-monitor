// Minimal PNG reader/writer for the validators. No dependencies: the gauntlet
// must not need an image library to be trustworthy.

import zlib from 'node:zlib';
import fs from 'node:fs';

export function readPng(path) {
  const buf = fs.readFileSync(path);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  let pos = 8;
  let width = 0, height = 0, bitDepth = 8, colorType = 6;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('unsupported bit depth ' + bitDepth);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  let ri = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[ri++];
    const line = Buffer.from(raw.subarray(ri, ri + stride));
    ri += stride;
    unfilter(filter, line, prev, channels);
    for (let x = 0; x < width; x++) {
      const s = x * channels, d = (y * width + x) * 4;
      out[d] = line[s];
      out[d + 1] = channels >= 3 ? line[s + 1] : line[s];
      out[d + 2] = channels >= 3 ? line[s + 2] : line[s];
      out[d + 3] = channels === 4 ? line[s + 3] : 255;
    }
    prev = line;
  }
  return { width, height, data: out };
}

function unfilter(filter, line, prev, bpp) {
  const n = line.length;
  switch (filter) {
    case 0: break;
    case 1: for (let i = bpp; i < n; i++) line[i] = (line[i] + line[i - bpp]) & 255; break;
    case 2: for (let i = 0; i < n; i++) line[i] = (line[i] + prev[i]) & 255; break;
    case 3:
      for (let i = 0; i < n; i++) {
        const a = i >= bpp ? line[i - bpp] : 0;
        line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255;
      }
      break;
    case 4:
      for (let i = 0; i < n; i++) {
        const a = i >= bpp ? line[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
        line[i] = (line[i] + pr) & 255;
      }
      break;
    default: throw new Error('bad filter ' + filter);
  }
}

export function writePng(path, width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunks = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.concat([t, data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(crcBuf) >>> 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  chunks.push(chunk('IHDR', ihdr));
  chunks.push(chunk('IDAT', zlib.deflateSync(raw)));
  chunks.push(chunk('IEND', Buffer.alloc(0)));
  fs.writeFileSync(path, Buffer.concat(chunks));
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}
