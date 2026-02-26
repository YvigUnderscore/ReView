/**
 * FBX to GLB Converter Utility
 * 
 * This module provides FBX to GLB conversion capabilities.
 * It prioritizes fsx2gltf (local binary or global) and falls back to assimp.
 */

const { exec, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const { promisify } = require('util');

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// Path to local binary
const BIN_DIR = path.join(__dirname, '..', 'bin');
const FBX2GLTF_BINARY = process.platform === 'win32' ? 'fbx2gltf.exe' : 'fbx2gltf';
const LOCAL_BINARY_PATH = path.join(BIN_DIR, FBX2GLTF_BINARY);

let cachedConverterMethod = null;

/**
 * Check availability of conversion tools
 * @returns {Promise<{method: 'fbx2gltf-local' | 'fbx2gltf-global' | 'assimp' | null, version?: string}>}
 */
async function getConverterMethod() {
    if (cachedConverterMethod) {
        return cachedConverterMethod;
    }

    // 1. Check local fbx2gltf
    if (fs.existsSync(LOCAL_BINARY_PATH)) {
        // Ensure executable permissions on Linux/Mac
        if (process.platform !== 'win32') {
            try {
                await fsPromises.chmod(LOCAL_BINARY_PATH, '755');
            } catch (e) {
                console.warn('[FBX Converter] Failed to set chmod +x on local binary:', e);
            }
        }
        cachedConverterMethod = { method: 'fbx2gltf-local' };
        return cachedConverterMethod;
    }

    // 2. Check global fbx2gltf
    try {
        await execAsync('fbx2gltf --version');
        cachedConverterMethod = { method: 'fbx2gltf-global' };
        return cachedConverterMethod;
    } catch (e) {
        // Not found globally
    }

    // 3. Fallback to assimp
    try {
        await execAsync('assimp help');
        cachedConverterMethod = { method: 'assimp' };
        return cachedConverterMethod;
    } catch (e) {
        cachedConverterMethod = { method: null };
        return cachedConverterMethod;
    }
}

/**
 * Convert FBX file to GLB
 * @param {string} inputPath - Path to the input FBX file
 * @param {string} outputPath - Path for the output GLB file (optional)
 * @returns {Promise<{success: boolean, outputPath: string, error?: string, method: string}>}
 */
async function convertFbxToGlb(inputPath, outputPath = null) {
    try {
        await fsPromises.access(inputPath);

        const inputExt = path.extname(inputPath).toLowerCase();
        if (inputExt !== '.fbx') {
            throw new Error(`Input file must be .fbx, got ${inputExt}`);
        }

        if (!outputPath) {
            outputPath = inputPath.replace(/\.fbx$/i, '.glb');
        }

        const { method } = await getConverterMethod();

        if (!method) {
            return {
                success: false,
                outputPath: null,
                error: 'No compatible converter found (fbx2gltf or assimp). Please check server configuration.'
            };
        }

        console.log(`[FBX Converter] Using method: ${method}`);

        let file;
        let args = [];

        if (method === 'fbx2gltf-local') {
            file = LOCAL_BINARY_PATH;
            args = ['-i', inputPath, '-o', outputPath, '--binary', '--embed'];
        } else if (method === 'fbx2gltf-global') {
            file = 'fbx2gltf';
            args = ['-i', inputPath, '-o', outputPath, '--binary', '--embed'];
        } else if (method === 'assimp') {
            file = 'assimp';
            args = ['export', inputPath, outputPath, '-fglb2'];
        }

        console.log(`[FBX Converter] Running: ${file} ${args.map(a => `"${a}"`).join(' ')}`);

        // Use execFile to prevent shell injection
        const { stdout, stderr } = await execFileAsync(file, args, {
            timeout: 300000, // 5 min
            maxBuffer: 50 * 1024 * 1024
        });

        // Check if output exists
        try {
            await fsPromises.access(outputPath);
        } catch (e) {
            // If fbx2gltf failed silently or with minor warnings but didn't produce output
            // check stderr for clues
            throw new Error(`Conversion failed, output file not created. Stderr: ${stderr}`);
        }

        console.log(`[FBX Converter] Success: ${outputPath}`);

        return {
            success: true,
            outputPath,
            method
        };

    } catch (error) {
        console.error('[FBX Converter] Error:', error.message);
        return {
            success: false,
            outputPath: null,
            error: error.message
        };
    }
}

/**
 * Convert FBX buffer to GLB
 */
async function convertFbxBufferToGlb(fbxBuffer, tempDir) {
    const tempInputPath = path.join(tempDir, `temp_${Date.now()}.fbx`);
    const tempOutputPath = path.join(tempDir, `temp_${Date.now()}.glb`);

    try {
        await fsPromises.writeFile(tempInputPath, fbxBuffer);
        const result = await convertFbxToGlb(tempInputPath, tempOutputPath);

        if (!result.success) {
            throw new Error(result.error);
        }

        const glbBuffer = await fsPromises.readFile(tempOutputPath);

        try { await fsPromises.unlink(tempInputPath); } catch (e) { }
        try { await fsPromises.unlink(tempOutputPath); } catch (e) { }

        return {
            success: true,
            glbBuffer
        };
    } catch (error) {
        try { await fsPromises.unlink(tempInputPath); } catch (e) { }
        try { await fsPromises.unlink(tempOutputPath); } catch (e) { }

        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Check capabilities
 */
async function checkFbxConversionCapability() {
    const { method } = await getConverterMethod();
    if (method) {
        return {
            available: true,
            method,
            message: `FBX conversion available via ${method}`
        };
    }
    return {
        available: false,
        message: 'FBX conversion not available. Install fbx2gltf or assimp.'
    };
}

module.exports = {
    convertFbxToGlb,
    convertFbxBufferToGlb,
    checkFbxConversionCapability,
    isFbx2GltfAvailable: async () => (await getConverterMethod()).method !== null
};
