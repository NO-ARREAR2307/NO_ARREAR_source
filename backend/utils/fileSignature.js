'use strict';

const fs = require('fs');

// Single source of truth for the file types students may upload.
//   key        : internal type name returned by detectFileType()
//   kind       : 'pdf' (text extraction) or 'image' (OCR)
//   mime       : the only MIME type accepted for this type
//   extensions : client file extensions accepted for this type (lower case)
//   storedExt  : extension of the server-generated filename (never taken from the client)
//   signature  : the magic bytes the file content must start with
const FILE_TYPES = {
  pdf: {
    key: 'pdf',
    kind: 'pdf',
    label: 'PDF',
    mime: 'application/pdf',
    extensions: ['.pdf'],
    storedExt: '.pdf',
    signature: Buffer.from('%PDF-'),
  },
  jpeg: {
    key: 'jpeg',
    kind: 'image',
    label: 'JPEG',
    mime: 'image/jpeg',
    extensions: ['.jpg', '.jpeg'],
    storedExt: '.jpg',
    signature: Buffer.from([0xff, 0xd8, 0xff]),
  },
  png: {
    key: 'png',
    kind: 'image',
    label: 'PNG',
    mime: 'image/png',
    extensions: ['.png'],
    storedExt: '.png',
    signature: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
};

const ALLOWED_EXTENSIONS = Object.values(FILE_TYPES).flatMap((type) => type.extensions);
const ALLOWED_MIME_TYPES = Object.values(FILE_TYPES).map((type) => type.mime);
const ALLOWED_DESCRIPTION = 'PDF (.pdf) or image (.jpg, .jpeg, .png)';

// Stored names are always "<uuid><.pdf|.jpg|.png>". Anything else is refused.
const STORED_NAME_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png)$/;

const getTypeByExtension = (ext) =>
  Object.values(FILE_TYPES).find((type) => type.extensions.includes(String(ext || '').toLowerCase())) || null;

const getTypeByMime = (mime) => Object.values(FILE_TYPES).find((type) => type.mime === mime) || null;

const getTypeByStoredName = (storedName) => {
  const name = String(storedName);
  return getTypeByExtension(name.slice(name.lastIndexOf('.')));
};

const matchesSignature = (header, type) =>
  header.length >= type.signature.length && header.subarray(0, type.signature.length).equals(type.signature);

// Reads the first bytes of a file and returns the matching FILE_TYPES entry, or null if the
// content is not a PDF, JPEG or PNG (for example a renamed .txt/.exe, or an empty file).
const detectFileType = async (filePath) => {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const header = Buffer.alloc(8);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const bytes = header.subarray(0, bytesRead);
    return Object.values(FILE_TYPES).find((type) => matchesSignature(bytes, type)) || null;
  } finally {
    await handle.close();
  }
};

module.exports = {
  FILE_TYPES,
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  ALLOWED_DESCRIPTION,
  STORED_NAME_PATTERN,
  getTypeByExtension,
  getTypeByMime,
  getTypeByStoredName,
  detectFileType,
};
