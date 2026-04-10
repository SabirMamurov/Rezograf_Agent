/**
 * Deep analysis of BarTender .btw files to extract text content.
 * Tries multiple strategies: zlib decompression, UTF-16LE scanning, raw byte scanning.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const labelsDir = 'C:\\Users\\Пользователь\\Desktop\\extracted_labels';

// Get first 5 .btw files for analysis
function findBtwFiles(dir, limit = 5) {
  const results = [];
  function walk(d) {
    if (results.length >= limit) return;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (results.length >= limit) return;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.btw')) results.push(full);
    }
  }
  walk(dir);
  return results;
}

function extractStrings(buf, encoding, minLen = 10) {
  const text = buf.toString(encoding);
  // Match Cyrillic text runs
  const re = /[\u0400-\u04FF][\u0400-\u04FF\u0020-\u007E\d\s.,;:!?%()\/\-+°№«»""]{10,}/g;
  const matches = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    matches.push(m[0].trim());
  }
  return matches;
}

function tryDecompress(buf, startOffset) {
  // Try to find zlib-compressed blocks (0x78 0x9C or 0x78 0x01 or 0x78 0xDA)
  const results = [];
  for (let i = startOffset; i < buf.length - 2; i++) {
    if (buf[i] === 0x78 && (buf[i+1] === 0x9C || buf[i+1] === 0x01 || buf[i+1] === 0xDA || buf[i+1] === 0x5E)) {
      try {
        const slice = buf.slice(i, Math.min(i + 500000, buf.length));
        const decompressed = zlib.inflateSync(slice);
        results.push({ offset: i, size: decompressed.length, data: decompressed });
      } catch (e) {
        // Not a valid zlib block, continue
      }
    }
  }
  return results;
}

function extractUTF16LEStrings(buf, minLen = 6) {
  const strings = [];
  let current = '';
  for (let i = 0; i < buf.length - 1; i += 2) {
    const code = buf[i] | (buf[i+1] << 8);
    // Printable character (Latin, Cyrillic, digits, punctuation)
    if ((code >= 0x20 && code <= 0x7E) || (code >= 0x400 && code <= 0x4FF) || code === 0xB0 || code === 0xAB || code === 0xBB || code === 0x2116) {
      current += String.fromCharCode(code);
    } else {
      if (current.length >= minLen) {
        strings.push(current.trim());
      }
      current = '';
    }
  }
  if (current.length >= minLen) strings.push(current.trim());
  return strings;
}

// Analyze files
const files = findBtwFiles(labelsDir, 5);
console.log(`Analyzing ${files.length} .btw files...\n`);

for (const filePath of files) {
  const name = path.basename(filePath);
  const buf = fs.readFileSync(filePath);
  console.log(`\n${'='.repeat(80)}`);
  console.log(`FILE: ${name} (${buf.length} bytes)`);
  console.log(`${'='.repeat(80)}`);
  
  // 1. Find header end (after the dashes line)
  const headerEnd = buf.indexOf(Buffer.from('---\r\n'));
  const header2End = buf.lastIndexOf(Buffer.from('---\r\n'));
  console.log(`\nHeader boundary at: ${headerEnd}, second at: ${header2End}`);
  
  // 2. Try zlib decompression on binary portion
  const binaryStart = header2End > 0 ? header2End + 5 : 500;
  console.log(`\nScanning for zlib blocks from offset ${binaryStart}...`);
  const decompressed = tryDecompress(buf, binaryStart);
  console.log(`Found ${decompressed.length} zlib blocks`);
  
  for (const block of decompressed) {
    console.log(`  Block at offset ${block.offset}: ${block.size} bytes decompressed`);
    
    // Try extracting text from decompressed data
    const utf16Strings = extractUTF16LEStrings(block.data);
    if (utf16Strings.length > 0) {
      console.log(`  UTF-16LE strings from decompressed block:`);
      utf16Strings.forEach(s => console.log(`    "${s}"`));
    }
    
    // Try Latin-1 (raw bytes)
    const cyrStrings = extractStrings(block.data, 'latin1', 8);
    if (cyrStrings.length > 0) {
      console.log(`  Cyrillic (latin1) from decompressed block:`);
      cyrStrings.forEach(s => console.log(`    "${s}"`));
    }
    
    // Try Windows-1251
    const decoded1251 = Buffer.from(block.data).toString('latin1');
    // Re-encode: treat byte values as cp1251
    let cp1251text = '';
    for (let i = 0; i < block.data.length; i++) {
      const b = block.data[i];
      if (b >= 0xC0 && b <= 0xFF) {
        // Russian letters in CP1251
        cp1251text += String.fromCharCode(b - 0xC0 + 0x410);
      } else if (b === 0xA8) {
        cp1251text += 'Ё';
      } else if (b === 0xB8) {
        cp1251text += 'ё';
      } else if (b >= 0x20 && b <= 0x7E) {
        cp1251text += String.fromCharCode(b);
      } else {
        cp1251text += ' ';
      }
    }
    const cp1251matches = cp1251text.match(/[\u0400-\u04FF][\u0400-\u04FF\u0020-\u007E\d\s.,;:!?%()\/\-+°]{8,}/g);
    if (cp1251matches && cp1251matches.length > 0) {
      console.log(`  CP1251 decoded from decompressed block:`);
      cp1251matches.forEach(s => console.log(`    "${s.trim()}"`));
    }
  }
  
  // 3. Try directly on the raw file
  const rawUtf16 = extractUTF16LEStrings(buf);
  if (rawUtf16.length > 0) {
    console.log(`\nRaw UTF-16LE strings from full file:`);
    rawUtf16.forEach(s => console.log(`  "${s}"`));
  }
  
  // 4. Try CP1251 directly on the raw file binary data
  let rawCp1251 = '';
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b >= 0xC0 && b <= 0xFF) {
      rawCp1251 += String.fromCharCode(b - 0xC0 + 0x410);
    } else if (b === 0xA8) {
      rawCp1251 += 'Ё';
    } else if (b === 0xB8) {
      rawCp1251 += 'ё';
    } else if (b >= 0x20 && b <= 0x7E) {
      rawCp1251 += String.fromCharCode(b);
    } else {
      rawCp1251 += '\x00';
    }
  }
  const rawCp1251matches = rawCp1251.match(/[\u0410-\u044F\u0401\u0451][\u0410-\u044F\u0401\u0451\u0020-\u007E]{8,}/g);
  if (rawCp1251matches && rawCp1251matches.length > 0) {
    console.log(`\nCP1251 strings from raw file (${rawCp1251matches.length}):`);
    rawCp1251matches.forEach(s => console.log(`  "${s.trim()}"`));
  }
  
  // 5. Check for UTF-8 sequences
  const utf8Text = buf.toString('utf8');
  const utf8matches = utf8Text.match(/[\u0400-\u04FF][\u0400-\u04FF\u0020-\u007E\d\s.,;:!?%()\/\-+°]{8,}/g);
  if (utf8matches && utf8matches.length > 0) {
    console.log(`\nUTF-8 strings from raw file (${utf8matches.length}):`);
    utf8matches.forEach(s => console.log(`  "${s.trim()}"`));
  }
}
