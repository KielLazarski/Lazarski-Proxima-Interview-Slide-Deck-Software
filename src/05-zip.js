/* ==========================================================================
   05-zip.js — ZIP read and write with no dependencies.

   A .pptx is a ZIP of XML parts, so opening and saving PowerPoint files means
   reading and writing ZIP. Rather than carry a copy of a library, this uses
   the browser's own DEFLATE: CompressionStream / DecompressionStream with
   'deflate-raw', which is exactly the codec ZIP entries use (method 8).
   That keeps the app a single file that works with no network at all.

   Scope: the stored (0) and deflated (8) methods, which is everything Office
   and every other producer actually writes. Encrypted entries are reported
   rather than silently mangled. ZIP64 is handled on read, since a deck with
   large media can cross 4 GB of entries in principle and the central
   directory offset is then parked at 0xFFFFFFFF.
   ========================================================================== */

const ZIP_SIG = { LOCAL: 0x04034b50, CD: 0x02014b50, EOCD: 0x06054b50, EOCD64: 0x06064b50, EOCD64_LOC: 0x07064b50 };

const CRC_TABLE = (function () {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

async function inflateRaw(bytes) {
  if (!bytes.length) return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function deflateRaw(bytes) {
  if (!bytes.length) return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* --------------------------------------------------------------------------
   READ
   Returns { files: Map<name, Uint8Array>, order: [names] }.
   Entries are read via the central directory, which is authoritative — local
   headers may carry zeroed sizes when a producer streamed the file with a
   data descriptor, and trusting them is the classic way to read garbage.
   -------------------------------------------------------------------------- */
async function unzip(arrayBuffer) {
  const u8 = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);
  const n = u8.length;
  if (n < 22) throw new Error('File is too small to be a ZIP archive.');

  /* End of central directory: scan back over the comment field. */
  let eocd = -1;
  const floor = Math.max(0, n - 22 - 65535);
  for (let i = n - 22; i >= floor; i--) { if (dv.getUint32(i, true) === ZIP_SIG.EOCD) { eocd = i; break; } }
  if (eocd < 0) throw new Error('No ZIP end-of-directory record found — the file is not a ZIP archive (a .pptx is one; a .ppt is not).');

  let count = dv.getUint16(eocd + 10, true);
  let cdOff = dv.getUint32(eocd + 16, true);

  /* ZIP64: the 32-bit fields are saturated and the real values live in a
     separate record pointed at by a locator just before the EOCD. */
  if (count === 0xFFFF || cdOff === 0xFFFFFFFF) {
    const loc = eocd - 20;
    if (loc >= 0 && dv.getUint32(loc, true) === ZIP_SIG.EOCD64_LOC) {
      const z64 = Number(dv.getBigUint64(loc + 8, true));
      if (z64 >= 0 && z64 < n && dv.getUint32(z64, true) === ZIP_SIG.EOCD64) {
        count = Number(dv.getBigUint64(z64 + 32, true));
        cdOff = Number(dv.getBigUint64(z64 + 48, true));
      }
    }
  }
  if (!(cdOff >= 0 && cdOff < n)) throw new Error('ZIP central directory offset is out of range — the file looks truncated.');

  const dec = new TextDecoder('utf-8');
  const decCp437 = new TextDecoder('windows-1252'); /* closest built-in to CP437 for legacy names */
  const files = new Map(), order = [];
  let p = cdOff;

  for (let i = 0; i < count && p + 46 <= n; i++) {
    if (dv.getUint32(p, true) !== ZIP_SIG.CD) break;
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const usize = dv.getUint32(p + 24, true);
    const fnLen = dv.getUint16(p + 28, true);
    const exLen = dv.getUint16(p + 30, true);
    const cmLen = dv.getUint16(p + 32, true);
    let lho = dv.getUint32(p + 42, true);
    const nameBytes = u8.subarray(p + 46, p + 46 + fnLen);
    /* Bit 11 promises UTF-8; without it the spec says CP437, but in practice
       everything modern writes UTF-8 anyway, so try that and fall back. */
    let name = (flags & 0x800) ? dec.decode(nameBytes) : (function () {
      try { return dec.decode(nameBytes); } catch (e) { return decCp437.decode(nameBytes); }
    })();

    let realC = csize, realU = usize;
    /* ZIP64 extended information extra field (header id 0x0001). */
    if (csize === 0xFFFFFFFF || usize === 0xFFFFFFFF || lho === 0xFFFFFFFF) {
      let ep = p + 46 + fnLen; const epEnd = ep + exLen;
      while (ep + 4 <= epEnd) {
        const id = dv.getUint16(ep, true), sz = dv.getUint16(ep + 2, true);
        if (id === 0x0001) {
          let q = ep + 4;
          if (usize === 0xFFFFFFFF) { realU = Number(dv.getBigUint64(q, true)); q += 8; }
          if (csize === 0xFFFFFFFF) { realC = Number(dv.getBigUint64(q, true)); q += 8; }
          if (lho === 0xFFFFFFFF) { lho = Number(dv.getBigUint64(q, true)); q += 8; }
          break;
        }
        ep += 4 + sz;
      }
    }

    p += 46 + fnLen + exLen + cmLen;

    if (name.endsWith('/')) continue;                /* directory entry */
    if (flags & 0x0001) throw new Error('This file is password-protected, which this app cannot open. Remove the password in PowerPoint and save again.');
    if (!(lho >= 0 && lho + 30 <= n) || dv.getUint32(lho, true) !== ZIP_SIG.LOCAL) continue;

    const lFnLen = dv.getUint16(lho + 26, true);
    const lExLen = dv.getUint16(lho + 28, true);
    const dataAt = lho + 30 + lFnLen + lExLen;
    if (dataAt + realC > n) continue;
    const raw = u8.subarray(dataAt, dataAt + realC);

    let out;
    if (method === 0) out = raw.slice();
    else if (method === 8) {
      try { out = await inflateRaw(raw); }
      catch (e) { throw new Error('Could not decompress "' + name + '" — the file may be damaged.'); }
    } else {
      /* Method 6 (implode), 12/14 (bzip2/lzma) etc. are legal ZIP but no
         Office build writes them, so flag rather than guess. */
      throw new Error('"' + name + '" uses an unsupported compression method (' + method + ').');
    }
    if (realU && out.length !== realU) {
      /* Not fatal on its own — some producers get the directory copy wrong —
         but worth keeping the decompressed truth. */
    }
    files.set(name, out);
    order.push(name);
  }

  if (!files.size) throw new Error('The ZIP archive contains no readable entries.');
  return { files, order };
}

/* --------------------------------------------------------------------------
   WRITE
   zipFiles([{ name, data: Uint8Array|string, store?: true }]) -> Blob
   Deflates each entry and keeps whichever of the two is smaller, so already
   compressed media (png, jpeg) is stored rather than grown.
   -------------------------------------------------------------------------- */
async function zipFiles(entries, mime) {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = ((now.getHours() & 31) << 11) | ((now.getMinutes() & 63) << 5) | ((now.getSeconds() >> 1) & 31);
  const dosDate = (((now.getFullYear() - 1980) & 127) << 9) | (((now.getMonth() + 1) & 15) << 5) | (now.getDate() & 31);

  const parts = [];      /* Blob pieces, in file order */
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    const crc = crc32(data);

    let method = 8, payload;
    if (e.store) { method = 0; payload = data; }
    else {
      payload = await deflateRaw(data);
      if (payload.length >= data.length) { method = 0; payload = data; }
    }

    const lh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, ZIP_SIG.LOCAL, true);
    lv.setUint16(4, 20, true);                 /* version needed: 2.0 */
    lv.setUint16(6, 0x0800, true);             /* flags: UTF-8 names */
    lv.setUint16(8, method, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, payload.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    lh.set(nameBytes, 30);

    parts.push(lh, payload);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, ZIP_SIG.CD, true);
    cv.setUint16(4, 20, true);                 /* version made by */
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, payload.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);                 /* extra */
    cv.setUint16(32, 0, true);                 /* comment */
    cv.setUint16(34, 0, true);                 /* disk */
    cv.setUint16(36, 0, true);                 /* internal attrs */
    cv.setUint32(38, 0, true);                 /* external attrs */
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    central.push(cd);

    offset += lh.length + payload.length;
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) { parts.push(c); cdSize += c.length; }

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, ZIP_SIG.EOCD, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdStart, true);
  ev.setUint16(20, 0, true);
  parts.push(eocd);

  return new Blob(parts, { type: mime || 'application/zip' });
}

/* ---------- data URL <-> bytes, for embedded media ---------- */

function dataUrlToBytes(url) {
  const i = String(url).indexOf(',');
  if (i < 0) return { bytes: new Uint8Array(0), mime: 'application/octet-stream' };
  const head = url.slice(0, i), body = url.slice(i + 1);
  const mime = (head.match(/^data:([^;,]+)/) || [, 'application/octet-stream'])[1];
  if (/;base64/i.test(head)) {
    const bin = atob(body);
    const out = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k);
    return { bytes: out, mime };
  }
  return { bytes: new TextEncoder().encode(decodeURIComponent(body)), mime };
}

function bytesToDataUrl(bytes, mime) {
  /* Chunked to stay clear of the argument-count limit on big images. */
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return 'data:' + (mime || 'application/octet-stream') + ';base64,' + btoa(bin);
}

const EXT_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp',
  tif: 'image/tiff', tiff: 'image/tiff', svg: 'image/svg+xml', webp: 'image/webp',
  emf: 'image/x-emf', wmf: 'image/x-wmf', ico: 'image/x-icon', avif: 'image/avif'
};
const mimeForExt = (ext) => EXT_MIME[String(ext || '').toLowerCase().replace(/^\./, '')] || 'application/octet-stream';
const extForMime = (m) => {
  const k = Object.keys(EXT_MIME).find((e) => EXT_MIME[e] === m);
  return k || 'png';
};
