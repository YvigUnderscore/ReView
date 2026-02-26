const fs = require('fs');
const path = require('path');
const { isValidVideoFile, isValidImageFile, isValidThreeDFile, isValidZipFile } = require('../utils/validation');

const TEST_DIR = path.join(__dirname, 'test_temp');

beforeAll(() => {
    if (!fs.existsSync(TEST_DIR)) {
        fs.mkdirSync(TEST_DIR);
    }
});

afterAll(() => {
    if (fs.existsSync(TEST_DIR)) {
        fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
});

// Helper to create dummy files with specific headers
function createDummyFile(filename, bufferContent) {
    const filepath = path.join(TEST_DIR, filename);
    const buffer = Buffer.alloc(100);
    if (bufferContent) {
        for (let i = 0; i < bufferContent.length; i++) {
            buffer[i] = bufferContent[i];
        }
    }
    fs.writeFileSync(filepath, buffer);
    return filepath;
}

describe('Validation Utils', () => {

    describe('isValidVideoFile', () => {
        test('should validate WEBM file (1A 45 DF A3)', async () => {
            const filepath = createDummyFile('test.webm', [0x1A, 0x45, 0xDF, 0xA3]);
            expect(await isValidVideoFile(filepath)).toBe('.webm');
        });

        test('should validate MP4 file (ftyp at 4)', async () => {
            // Buffer must be at least 12 bytes
            // [0-3]: 00 00 00 00
            // [4-7]: 66 74 79 70 ('ftyp')
            // [8-11]: anything
            const content = [0x00, 0x00, 0x00, 0x00, 0x66, 0x74, 0x79, 0x70, 0x00, 0x00, 0x00, 0x00];
            const filepath = createDummyFile('test.mp4', content);
            expect(await isValidVideoFile(filepath)).toBe('.mp4');
        });

        test('should validate MOV file (ftyp qt  )', async () => {
            // [0-3]: 00 00 00 00
            // [4-7]: 66 74 79 70 ('ftyp')
            // [8-11]: 71 74 20 20 ('qt  ')
            const content = [0x00, 0x00, 0x00, 0x00, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20];
            const filepath = createDummyFile('test.mov', content);
            expect(await isValidVideoFile(filepath)).toBe('.mov');
        });

        test('should return null for invalid video file', async () => {
            const filepath = createDummyFile('invalid.txt', [0x00, 0x01, 0x02, 0x03]);
            expect(await isValidVideoFile(filepath)).toBeNull();
        });
    });

    describe('isValidImageFile', () => {
        test('should validate JPG file (FF D8 FF)', async () => {
            const filepath = createDummyFile('test.jpg', [0xFF, 0xD8, 0xFF]);
            expect(await isValidImageFile(filepath)).toBe('.jpg');
        });

        test('should validate PNG file (89 50 4E 47 0D 0A 1A 0A)', async () => {
            const content = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
            const filepath = createDummyFile('test.png', content);
            expect(await isValidImageFile(filepath)).toBe('.png');
        });

        test('should validate WEBP file (RIFF...WEBP)', async () => {
            // RIFF: 52 49 46 46 (at 0)
            // WEBP: 57 45 42 50 (at 8)
            const content = [
                0x52, 0x49, 0x46, 0x46, // RIFF
                0x00, 0x00, 0x00, 0x00, // Size
                0x57, 0x45, 0x42, 0x50  // WEBP
            ];
            const filepath = createDummyFile('test.webp', content);
            expect(await isValidImageFile(filepath)).toBe('.webp');
        });

        test('should return null for invalid image file', async () => {
            const filepath = createDummyFile('invalid.txt', [0x00, 0x00, 0x00, 0x00]);
            expect(await isValidImageFile(filepath)).toBeNull();
        });
    });

    describe('isValidThreeDFile', () => {
        test('should validate GLB file (glTF)', async () => {
            // 'glTF' -> 67 6C 54 46
            // Wait, previous code checked: 67 6C 54 46
            // But comments said: glTF (67 6C 74 46) -> Should be 67 6C 54 46
            // 'g' (67) 'l' (6C) 'T' (54) 'F' (46)
            // It seems 'T' is 54 in hex (84 dec), 't' is 74 in hex (116 dec).
            // glTF spec says magic is 0x46546C67 (Little Endian) -> 67 6C 54 46.
            // So 0x54 ('T') is correct.
            const content = [0x67, 0x6C, 0x54, 0x46];
            const filepath = createDummyFile('test.glb', content);
            expect(await isValidThreeDFile(filepath)).toBe('.glb');
        });

        test('should validate FBX file (Kaydara FBX Binary)', async () => {
            // "Kaydara FBX Binary  \x00"
            const buffer = Buffer.from('Kaydara FBX Binary  \x00', 'utf8'); // 21 bytes
            const content = [];
            for (const b of buffer) content.push(b);
            const filepath = createDummyFile('test.fbx', content);
            expect(await isValidThreeDFile(filepath)).toBe('.fbx');
        });

        test('should validate USDZ (Zip magic PK)', async () => {
            const content = [0x50, 0x4B, 0x03, 0x04];
            const filepath = createDummyFile('test.usdz', content);
            expect(await isValidThreeDFile(filepath)).toBe('.usdz');
        });

        test('should validate USDC (PXR-USDC)', async () => {
            const buffer = Buffer.from('PXR-USDC', 'utf8');
            const content = [];
            for (const b of buffer) content.push(b);
            const filepath = createDummyFile('test.usdc', content);
            expect(await isValidThreeDFile(filepath)).toBe('.usdc');
        });

        test('should validate USDA (#usda)', async () => {
            const buffer = Buffer.from('#usda', 'utf8');
            const content = [];
            for (const b of buffer) content.push(b);
            const filepath = createDummyFile('test.usda', content);
            expect(await isValidThreeDFile(filepath)).toBe('.usda');
        });

        test('should return null for invalid 3D file', async () => {
            const filepath = createDummyFile('invalid.txt', [0x00]);
            expect(await isValidThreeDFile(filepath)).toBeNull();
        });
    });

    describe('isValidZipFile', () => {
        test('should validate ZIP file (PK)', async () => {
            const content = [0x50, 0x4B, 0x03, 0x04];
            const filepath = createDummyFile('test.zip', content);
            expect(await isValidZipFile(filepath)).toBe(true);
        });

        test('should return false for non-ZIP file', async () => {
            const filepath = createDummyFile('invalid.txt', [0x00]);
            expect(await isValidZipFile(filepath)).toBe(false);
        });
    });
});
