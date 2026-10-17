/**
 * A minimal, deterministic USTAR writer and reader.
 *
 * The export exists so the editorial set can be recovered without this
 * application, so the archive has to be readable by ordinary tools — `tar xf`
 * on any machine — rather than by a bespoke format only this code
 * understands. No tar dependency is added for it; the format is small and
 * fully specified, and the reader here is what validates every export.
 *
 * Deterministic by construction: entries are sorted by name, and mode, uid,
 * gid, mtime and owner names are all fixed. The same input therefore always
 * produces byte-identical output, which is what makes the archive hash in the
 * manifest meaningful.
 */

const BLOCK = 512;
const NAME_MAX = 100; // the `prefix` field is not used, so names must fit here

export interface TarEntry {
  name: string;
  content: string;
}

/** Octal, zero-padded, NUL-terminated — the USTAR numeric convention. */
function octalField(value: number, length: number): Buffer {
  const digits = value.toString(8).padStart(length - 1, "0");
  if (digits.length > length - 1) {
    throw new Error(`Value ${value} does not fit a ${length}-byte tar field`);
  }
  return Buffer.from(`${digits}\0`, "ascii");
}

function writeAscii(block: Buffer, offset: number, length: number, value: string): void {
  const bytes = Buffer.from(value, "utf-8");
  if (bytes.length > length) {
    throw new Error(`"${value}" exceeds its ${length}-byte tar field`);
  }
  bytes.copy(block, offset);
}

function header(name: string, size: number): Buffer {
  if (Buffer.byteLength(name, "utf-8") > NAME_MAX) {
    throw new Error(`Archive entry name is longer than ${NAME_MAX} bytes: "${name}"`);
  }
  const block = Buffer.alloc(BLOCK);

  writeAscii(block, 0, 100, name);
  octalField(0o644, 8).copy(block, 100); // mode
  octalField(0, 8).copy(block, 108); // uid
  octalField(0, 8).copy(block, 116); // gid
  octalField(size, 12).copy(block, 124);
  octalField(0, 12).copy(block, 136); // mtime — fixed, for determinism
  block.write("        ", 148, 8, "ascii"); // checksum placeholder: eight spaces
  block.write("0", 156, 1, "ascii"); // typeflag: regular file
  block.write("ustar\0", 257, 6, "ascii");
  block.write("00", 263, 2, "ascii");
  // uname, gname, devmajor, devminor and prefix stay zeroed.

  let sum = 0;
  for (const byte of block) sum += byte;
  // GNU/BSD convention: six octal digits, then NUL, then a space.
  block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");

  return block;
}

function pad(size: number): number {
  const remainder = size % BLOCK;
  return remainder === 0 ? 0 : BLOCK - remainder;
}

/** Builds one archive. Entry order is normalised, so output is reproducible. */
export function createTar(entries: TarEntry[]): Buffer {
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const parts: Buffer[] = [];
  for (const entry of sorted) {
    const body = Buffer.from(entry.content, "utf-8");
    parts.push(header(entry.name, body.length), body, Buffer.alloc(pad(body.length)));
  }
  // Two zero blocks mark the end of the archive.
  parts.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(parts);
}

function readAscii(block: Buffer, offset: number, length: number): string {
  const slice = block.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString("utf-8");
}

function readOctal(block: Buffer, offset: number, length: number): number {
  const text = readAscii(block, offset, length).trim();
  return text === "" ? 0 : parseInt(text, 8);
}

/**
 * Reads an archive back, verifying each header's checksum.
 *
 * This is how an export is validated: the archive is parsed from its own
 * bytes rather than trusted because the writer just produced it.
 */
export function readTar(buffer: Buffer): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;

  while (offset + BLOCK <= buffer.length) {
    const block = buffer.subarray(offset, offset + BLOCK);
    if (block.every((b) => b === 0)) break; // end-of-archive marker

    const recorded = readOctal(block, 148, 8);
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : block[i];
    if (sum !== recorded) {
      throw new Error(`Archive header checksum mismatch at byte ${offset} (expected ${recorded}, computed ${sum})`);
    }

    const name = readAscii(block, 0, 100);
    const size = readOctal(block, 124, 12);
    const start = offset + BLOCK;
    if (start + size > buffer.length) {
      throw new Error(`Archive entry "${name}" claims ${size} bytes but the archive ends first`);
    }

    entries.push({ name, content: buffer.subarray(start, start + size).toString("utf-8") });
    offset = start + size + pad(size);
  }

  return entries;
}
