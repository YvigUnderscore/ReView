const fs = require('fs').promises;

/**
 * Checks if a file is a valid video file based on its magic numbers.
 * Supports MP4, MOV, WEBM.
 * @param {string} filepath
 * @returns {Promise<string|null>}
 */
const isValidVideoFile = async (filepath) => {
    let handle;
    try {
        const buffer = Buffer.alloc(12); // Read enough for signatures
        handle = await fs.open(filepath, 'r');
        await handle.read(buffer, 0, 12, 0);

        // Check for WEBM: 1A 45 DF A3
        if (buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3) {
            return '.webm';
        }

        // Check for MP4/MOV: 'ftyp' at offset 4
        // 'ftyp' in hex is 66 74 79 70
        if (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {

            // Vérification de la "Major Brand" aux offsets 8-11
            // 'qt  ' (hex: 71 74 20 20) indique QuickTime (.mov)
            if (buffer[8] === 0x71 && buffer[9] === 0x74 && buffer[10] === 0x20 && buffer[11] === 0x20) {
                return '.mov';
            }

            // Sinon, on assume que c'est un MP4 standard (isom, mp41, mp42, etc.)
            return '.mp4';
        }

        return null;
    } catch (err) {
        console.error('Error validating video file:', err);
        return null;
    } finally {
        if (handle) await handle.close();
    }
};

/**
 * Checks if a file is a valid image file based on its magic numbers.
 * Supports JPG, PNG, WEBP.
 * @param {string} filepath
 * @returns {Promise<string|null>}
 */
const isValidImageFile = async (filepath) => {
    let handle;
    try {
        const buffer = Buffer.alloc(12);
        handle = await fs.open(filepath, 'r');
        await handle.read(buffer, 0, 12, 0);

        // JPG: FF D8 FF
        if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
            return '.jpg';
        }

        // PNG: 89 50 4E 47 0D 0A 1A 0A
        if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 &&
            buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A) {
            return '.png';
        }

        // WEBP: RIFF at 0, WEBP at 8
        // RIFF: 52 49 46 46
        // WEBP: 57 45 42 50
        if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
            buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
            return '.webp';
        }

        return null;
    } catch (err) {
        console.error('Error validating image file:', err);
        return null;
    } finally {
        if (handle) await handle.close();
    }
};

/**
 * Checks if a file is a valid 3D file based on its magic numbers.
 * Supports GLB, FBX, USD (Binary/Text/Zip), PLY (Gaussian Splat), SPLAT, SOG.
 * @param {string} filepath
<<<<<<< Updated upstream
 * @returns {Promise<string|null>}
 */
const isValidThreeDFile = async (filepath) => {
    let handle;
=======
 * @param {string|null} hintExt - Original file extension (e.g. '.splat') for formats without magic bytes
 * @returns {string|null} - Canonical extension or null if invalid
 */
const isValidThreeDFile = (filepath, hintExt = null) => {
>>>>>>> Stashed changes
    try {
        const buffer = Buffer.alloc(24); // Read enough for FBX (23 bytes)
        handle = await fs.open(filepath, 'r');
        await handle.read(buffer, 0, 24, 0);

        // GLB: glTF (67 6C 74 46) -> Should be 67 6C 54 46
        // 'g' (67) 'l' (6C) 'T' (54) 'F' (46)
        if (buffer[0] === 0x67 && buffer[1] === 0x6C && buffer[2] === 0x54 && buffer[3] === 0x46) {
            return '.glb';
        }

        // FBX: "Kaydara FBX Binary  \x00"
        // 4B 61 79 64 61 72 61 20 46 42 58 20 42 69 6E 61 72 79 20 20 00
        if (buffer.toString('utf8', 0, 18) === 'Kaydara FBX Binary') {
            return '.fbx';
        }

        // USDZ (Zip): PK (50 4B 03 04)
        if (buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04) {
            return '.usdz';
        }

        // USDC (Binary Crate): PXR-USDC (50 58 52 2D 55 53 44 43)
        if (buffer.toString('utf8', 0, 8) === 'PXR-USDC') {
            return '.usdc';
        }

        // USDA (ASCII): #usda (23 75 73 64 61)
        if (buffer.toString('utf8', 0, 5) === '#usda') {
            return '.usda';
        }

        // PLY (Gaussian Splat or mesh): "ply\n" (70 6C 79 0A)
        if (buffer[0] === 0x70 && buffer[1] === 0x6C && buffer[2] === 0x79 && buffer[3] === 0x0A) {
            return '.ply';
        }

        // glTF (text/JSON): a .gltf is a JSON document. It has no binary magic
        // bytes, so we validate by extension hint + a JSON-looking start (first
        // non-whitespace byte is '{', optionally preceded by a UTF-8 BOM).
        if (hintExt === '.gltf') {
            let i = 0;
            // Skip UTF-8 BOM (EF BB BF) if present
            if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) i = 3;
            // Skip leading ASCII whitespace
            while (i < buffer.length && (buffer[i] === 0x20 || buffer[i] === 0x09 || buffer[i] === 0x0A || buffer[i] === 0x0D)) i++;
            if (buffer[i] === 0x7B) { // '{'
                return '.gltf';
            }
        }

        // SPLAT (Gaussian Splat binary): no magic bytes – validate by extension hint + size heuristic
        // Each splat record is exactly 32 bytes (pos 12B + scale 12B + RGBA 4B + rot 4B)
        if (hintExt === '.splat') {
            const stats = fs.statSync(filepath);
            if (stats.size > 0 && stats.size % 32 === 0) {
                return '.splat';
            }
        }

        // SOG (Spatially Ordered Gaussians, compressed splat container): no stable
        // magic bytes across versions – accept by extension hint + non-empty size.
        // (Note: `.compressed.ply` is a regular PLY and is already matched above.)
        if (hintExt === '.sog') {
            const stats = fs.statSync(filepath);
            if (stats.size > 0) {
                return '.sog';
            }
        }

        return null;
    } catch (err) {
        console.error('Error validating 3D file:', err);
        return null;
    } finally {
        if (handle) await handle.close();
    }
};

/**
 * Checks if a file is a valid ZIP file.
 * @param {string} filepath
 * @returns {Promise<boolean>}
 */
const isValidZipFile = async (filepath) => {
    let handle;
    try {
        const buffer = Buffer.alloc(4);
        handle = await fs.open(filepath, 'r');
        await handle.read(buffer, 0, 4, 0);

        // ZIP: PK (50 4B 03 04)
        if (buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04) {
            return true;
        }

        return false;
    } catch (err) {
        console.error('Error validating ZIP file:', err);
        return false;
    } finally {
        if (handle) await handle.close();
    }
};

/**
 * Validates text input length to prevent DoS/Storage exhaustion.
 * @param {string} text - The text to validate
 * @param {number} maxLength - Maximum allowed length
 * @returns {boolean} - True if valid
 */
const isValidText = (text, maxLength) => {
    if (text === undefined || text === null) return true; // Optional fields might be null
    if (typeof text !== 'string') return false;
    return text.length <= maxLength;
};

/**
 * Validates password strength: at least 8 chars, max 128 chars, 1 letter, 1 number.
 * @param {string} password
 * @returns {boolean}
 */
const isValidPassword = (password) => {
    if (!password || typeof password !== 'string') return false;
    if (password.length < 8) return false;
    if (password.length > 128) return false; // Max length to prevent bcrypt DoS
    if (!/[A-Za-z]/.test(password)) return false; // At least one letter
    if (!/[0-9]/.test(password)) return false; // At least one number
    return true;
};

/**
 * Checks if a buffer contains a valid image based on its magic numbers.
 * Supports JPG, PNG, WEBP.
 * @param {Buffer} buffer
 * @returns {boolean}
 */
const isValidImageBuffer = (buffer) => {
    try {
        if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;

        // JPG: FF D8 FF
        if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
            return true;
        }

        // PNG: 89 50 4E 47 0D 0A 1A 0A
        if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 &&
            buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A) {
            return true;
        }

        // WEBP: RIFF at 0, WEBP at 8
        if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
            buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
            return true;
        }

        return false;
    } catch (err) {
        console.error('Error validating image buffer:', err);
        return false;
    }
};

/**
 * Validates email format and length.
 * @param {string} email
 * @returns {boolean}
 */
const isValidEmail = (email) => {
    if (!email || typeof email !== 'string') return false;
    if (email.length > 254) return false; // RFC 5321 limit
    // Strict regex for email validation
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(email);
};

const GAUSSIAN_SPLAT_EXTENSIONS = ['.splat', '.ply', '.sog'];
const isGaussianSplat = (filename) => {
    if (!filename) return false;
    const ext = filename.split('.').pop().toLowerCase();
    return GAUSSIAN_SPLAT_EXTENSIONS.includes(`.${ext}`);
};

module.exports = { isValidVideoFile, isValidImageFile, isValidThreeDFile, isValidZipFile, isValidText, isValidPassword, isValidImageBuffer, isValidEmail, isGaussianSplat };
