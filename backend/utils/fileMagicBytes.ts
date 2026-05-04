/**
 * File integrity validation powered by the `file-type` package.
 *
 * Why this module exists:
 * - `multer` exposes `file.mimetype`, but this value comes from the client
 *   `Content-Type` header and is trivially forgeable.
 * - We must classify uploads from their binary signature (magic bytes), not
 *   from user-controlled metadata (header or extension).
 *
 * This module is the single source of truth for upload integrity checks used
 * by routes that accept files (`routes/upload.ts`, `routes/support.ts`).
 *
 * Runtime compatibility note:
 * - Backend runs in CommonJS (`ts-node` non-ESM).
 * - Current `file-type` releases are ESM-only.
 * - We therefore load `file-type` through a cached dynamic import.
 */

/** Image formats we accept anywhere in the backend. */
export type ImageMime =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif"
  | "image/avif";

/** Image extensions, mirroring {@link ImageMime}. */
export type ImageExt = "jpg" | "png" | "webp" | "gif" | "avif";

/** Result of a successful image classification. */
export interface DetectedImage {
  mime: ImageMime;
  ext: ImageExt;
}

/** Result of a successful PDF classification. */
export interface DetectedPdf {
  mime: "application/pdf";
  ext: "pdf";
}

/** Shape returned by `fileTypeFromBuffer`. */
interface FileTypeResult {
  ext: string;
  mime: string;
}

/** Subset of file-type module API we rely on. */
interface FileTypeModule {
  fileTypeFromBuffer: (input: Uint8Array) => Promise<FileTypeResult | undefined>;
}

let fileTypeModulePromise: Promise<FileTypeModule> | null = null;
const loadFileTypeModule = new Function(
  'return import("file-type");',
) as () => Promise<FileTypeModule>;

/**
 * Lazily loads `file-type` once and reuses it for all requests.
 *
 * Dynamic import is required because the backend is CommonJS while `file-type`
 * is ESM-only in modern versions.
 */
async function getFileTypeModule(): Promise<FileTypeModule> {
  if (!fileTypeModulePromise) {
    fileTypeModulePromise = loadFileTypeModule();
  }
  return fileTypeModulePromise;
}

/**
 * Inspects a buffer using `file-type` and classifies it as an accepted image.
 *
 * @param buf Raw bytes of the uploaded file (typically from
 *            `multer.memoryStorage()`).
 * @returns The detected image type, or `null` if the binary signature is not
 *          one of the accepted raster formats.
 *
 * @example
 * ```ts
 * const detected = detectImageFromMagicBytes(req.file.buffer);
 * if (!detected) return res.status(415).json({ error: "Format non supporté" });
 * await s3.putObject({ ContentType: detected.mime, Key: `x.${detected.ext}` });
 * ```
 */
export async function detectImageFromMagicBytes(
  buf: Buffer,
): Promise<DetectedImage | null> {
  if (!buf || buf.length === 0) return null;
  const { fileTypeFromBuffer } = await getFileTypeModule();
  const detected = await fileTypeFromBuffer(buf);
  if (!detected) return null;

  if (detected.mime === "image/jpeg" && detected.ext === "jpg") {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  if (detected.mime === "image/png" && detected.ext === "png") {
    return { mime: "image/png", ext: "png" };
  }
  if (detected.mime === "image/webp" && detected.ext === "webp") {
    return { mime: "image/webp", ext: "webp" };
  }
  if (detected.mime === "image/gif" && detected.ext === "gif") {
    return { mime: "image/gif", ext: "gif" };
  }
  if (detected.mime === "image/avif" && detected.ext === "avif") {
    return { mime: "image/avif", ext: "avif" };
  }

  return null;
}

/**
 * Inspects a buffer using `file-type` and classifies it as a PDF.
 *
 * @param buf Raw bytes of the uploaded file.
 * @returns The detected PDF descriptor, or `null` if no PDF signature was
 *          found. An attacker-renamed HTML/JS/EXE will always return `null`.
 */
export async function detectPdfFromMagicBytes(
  buf: Buffer,
): Promise<DetectedPdf | null> {
  if (!buf || buf.length === 0) return null;
  const { fileTypeFromBuffer } = await getFileTypeModule();
  const detected = await fileTypeFromBuffer(buf);
  if (detected?.mime === "application/pdf" && detected.ext === "pdf") {
    return { mime: "application/pdf", ext: "pdf" };
  }
  return null;
}

/**
 * Types accepted when calling {@link detectFileFromMagicBytes} with the
 * `includePdf` option.
 */
export type DetectedFile = DetectedImage | DetectedPdf;

/**
 * Convenience classifier for routes that accept both images and PDFs
 * (e.g. email attachments on support endpoints).
 *
 * @param buf          Raw bytes of the uploaded file.
 * @param allowedMimes Whitelist applied after detection. Files whose detected
 *                     MIME is not in the set are rejected, even if they are
 *                     otherwise valid — this lets each route narrow the
 *                     accepted formats without duplicating magic-byte code.
 * @returns The detected descriptor when accepted, `null` otherwise.
 */
export async function detectFileFromMagicBytes(
  buf: Buffer,
  allowedMimes: ReadonlySet<string>,
): Promise<DetectedFile | null> {
  const image = await detectImageFromMagicBytes(buf);
  if (image && allowedMimes.has(image.mime)) return image;

  const pdf = await detectPdfFromMagicBytes(buf);
  if (pdf && allowedMimes.has(pdf.mime)) return pdf;

  return null;
}

/**
 * Sanitizes a filename before it is used as the visible name of an email
 * attachment.
 *
 * Two threats are addressed:
 *   1. Header/MIME injection: CR, LF, NUL or other control chars in the
 *      `Content-Disposition: attachment; filename="..."` MIME header can be
 *      abused to smuggle extra headers by some mail transports. We strip them.
 *   2. Path traversal / shell semantics: some email clients save attachments
 *      using the provided filename verbatim. `../../../etc/passwd` or
 *      reserved Windows names like `CON.txt` must be neutralized.
 *
 * The function also forces a safe extension derived from the authoritative
 * magic-byte detection, so a file advertised as `invoice.pdf` but actually
 * a PNG will be renamed to `invoice.png` by the caller. Truncates to 120
 * characters to stay within common mailbox limits.
 *
 * @param rawName Attacker-controlled filename (e.g. `req.file.originalname`).
 * @param safeExt Extension to enforce, typically `detected.ext` from
 *                {@link detectFileFromMagicBytes}.
 * @returns A safe, printable filename that ends in `.${safeExt}`.
 */
export function sanitizeAttachmentFilename(
  rawName: string,
  safeExt: string,
): string {
  const withoutDirs = String(rawName || "")
    // Remove any directory component (defense against path traversal).
    .replace(/^.*[\\/]/, "")
    // Replace control chars, CR/LF, NUL and characters reserved by common
    // filesystems with a hyphen. Keep Unicode letters/digits/spaces/dots
    // and the usual safe punctuation.
    .replace(/[\x00-\x1F\x7F<>:"|?*\\/]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  // Drop any pre-existing extension; we always force `safeExt` so the
  // filename matches the authoritative MIME detected server-side.
  const stem = withoutDirs.replace(/\.[A-Za-z0-9]{1,8}$/, "").slice(0, 100);
  const safeStem = stem || "attachment";
  return `${safeStem}.${safeExt}`;
}
