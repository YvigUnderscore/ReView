// Client-side Gaussian-splat compression, run BEFORE upload.
//
// Transcodes a PLY / SPLAT file into a smaller representation that the vendored
// PlayCanvas SuperSplat viewer reads natively. Powered by the browser build of
// `@playcanvas/splat-transform`. Three levels are offered:
//
//   - 'none'       : original file, untouched (lossless, no processing).
//   - 'compressed' : Compressed PLY (`.compressed.ply`) — chunk quantization.
//                    CPU-only, no GPU required, mild & barely visible loss.
//                    Still a real PLY, so universally viewer-compatible.
//   - 'sog'        : SOG bundle (`.sog`) — k-means clustering + lossless WebP.
//                    ~10-20x smaller, needs WebGPU. Falls back to 'compressed'
//                    if WebGPU / the GPU device is unavailable.
//
// The heavy libraries (`@playcanvas/splat-transform`, `playcanvas`) are loaded
// through dynamic `import()` so they are code-split into separate chunks and
// only fetched when the user actually compresses — the initial app bundle is
// unaffected.

// Matches the splat inputs the app accepts. `.sog` is already maximally
// compressed, so it is never re-processed.
const SPLAT_EXT_RE = /\.(ply|splat|sog)$/i;

export const COMPRESSION_LEVELS = [
    {
        id: 'none',
        label: 'Sans compression',
        sub: 'Qualité d\'origine — sans perte',
        description: 'Envoie le fichier tel quel, sans aucune perte de qualité.',
    },
    {
        id: 'compressed',
        label: 'Compressé (recommandé)',
        sub: 'Peu de perte • PLY compressé',
        description: 'Quantification par blocs. Réduit fortement la taille avec une perte quasi imperceptible. Compatible avec tous les viewers PLY.',
    },
    {
        id: 'sog',
        label: 'Compression maximale',
        sub: 'Avec perte • SOG (WebGPU)',
        description: 'Format SOG (k-means + WebP sans perte). Jusqu\'à 10-20× plus petit. Nécessite WebGPU ; repli automatique sur le PLY compressé sinon.',
    },
];

/** True for files we treat as Gaussian splats (by extension). */
export const isSplatFile = (file) => !!file && SPLAT_EXT_RE.test(file.name || '');

/** True when the file can actually be transcoded (ply/splat input, not already .sog). */
export const isCompressibleSplat = (file) =>
    !!file && /\.(ply|splat)$/i.test(file.name || '');

/** Whether the current browser exposes WebGPU (required for the SOG level). */
export const isWebGpuAvailable = () =>
    typeof navigator !== 'undefined' && 'gpu' in navigator;

// Strip the extension (and a trailing `.compressed`) to derive a clean base name.
const baseName = (name) =>
    (name || 'model').replace(/\.[^.]+$/, '').replace(/\.compressed$/i, '');

let _splatTransform = null;
const loadSplatTransform = async () => {
    if (!_splatTransform) {
        _splatTransform = await import('@playcanvas/splat-transform');
    }
    return _splatTransform;
};

// Lazily create a single WebGPU GraphicsDevice for SOG compression.
let _devicePromise = null;
const createWebgpuDevice = async () => {
    if (!_devicePromise) {
        _devicePromise = (async () => {
            const pc = await import('playcanvas');
            const canvas = document.createElement('canvas');
            return pc.createGraphicsDevice(canvas, { deviceTypes: ['webgpu'] });
        })();
    }
    return _devicePromise;
};

/**
 * Compress a splat file according to `level`.
 *
 * @param {File} file - The source splat file.
 * @param {'none'|'compressed'|'sog'} level - Desired compression level.
 * @param {(pct:number, message:string)=>void} [onProgress] - Progress callback.
 * @returns {Promise<{ file: File, level: string }>} The (possibly new) file and
 *          the level actually applied (may differ from requested if a fallback
 *          occurred, e.g. SOG → compressed).
 */
export async function compressSplat(file, level, onProgress) {
    const report = (pct, message) => {
        try { onProgress?.(pct, message); } catch { /* ignore */ }
    };

    // Nothing to do for the lossless option or non-splat / already-SOG files.
    if (!file || level === 'none' || !isCompressibleSplat(file)) {
        return { file, level: 'none' };
    }

    let st;
    try {
        st = await loadSplatTransform();
    } catch (e) {
        console.warn('[splatCompression] failed to load splat-transform; uploading original', e);
        return { file, level: 'none' };
    }

    const {
        readFile, getInputFormat, writeFile,
        MemoryReadFileSystem, MemoryFileSystem,
    } = st;

    let inputFormat;
    try {
        inputFormat = getInputFormat(file.name);
    } catch (e) {
        console.warn('[splatCompression] unsupported input format; uploading original', e);
        return { file, level: 'none' };
    }

    // --- Read + decode -----------------------------------------------------
    report(5, 'Lecture du fichier…');
    const inputBuf = new Uint8Array(await file.arrayBuffer());
    const readFs = new MemoryReadFileSystem();
    readFs.set(file.name, inputBuf);

    report(15, 'Décodage des gaussiennes…');
    let dataTable;
    try {
        const tables = await readFile({
            filename: file.name,
            inputFormat,
            options: { iterations: 10 },
            params: [],
            fileSystem: readFs,
        });
        dataTable = tables?.[0];
    } catch (e) {
        console.warn('[splatCompression] decode failed; uploading original', e);
        return { file, level: 'none' };
    }
    if (!dataTable) return { file, level: 'none' };

    const writeFs = new MemoryFileSystem();
    const base = baseName(file.name);

    const writeOut = async (outName, outputFormat, options, createDevice) => {
        await writeFile({ filename: outName, outputFormat, dataTable, options, createDevice }, writeFs);
        const bytes = writeFs.results.get(outName);
        if (!bytes || !bytes.length) throw new Error('empty output');
        return new File([bytes], outName, { type: 'application/octet-stream' });
    };

    // --- SOG (best compression, WebGPU) ------------------------------------
    if (level === 'sog') {
        if (isWebGpuAvailable()) {
            try {
                report(35, 'Compression SOG (WebGPU)…');
                const createDevice = createWebgpuDevice;
                const outFile = await writeOut(`${base}.sog`, 'sog-bundle', { iterations: 10 }, createDevice);
                report(100, 'Compression terminée');
                return { file: outFile, level: 'sog' };
            } catch (e) {
                console.warn('[splatCompression] SOG failed; falling back to compressed PLY', e);
                report(45, 'SOG indisponible — repli sur PLY compressé…');
            }
        } else {
            report(45, 'WebGPU indisponible — repli sur PLY compressé…');
        }
        // fall through to compressed
    }

    // --- Compressed PLY (CPU, robust default) ------------------------------
    try {
        report(55, 'Compression PLY (quantification)…');
        const outFile = await writeOut(`${base}.compressed.ply`, 'compressed-ply', { iterations: 10 }, undefined);
        report(100, 'Compression terminée');
        return { file: outFile, level: 'compressed' };
    } catch (e) {
        console.warn('[splatCompression] compressed PLY failed; uploading original', e);
        return { file, level: 'none' };
    }
}
