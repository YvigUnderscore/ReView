const fs = require('fs');
const path = require('path');
const os = require('os');
const { performance } = require('perf_hooks');

// Simple mock for the setup
const projectTargetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-'));
const teamSlugToUse = 'team';
const slug = 'slug';

// Generate dummy image files
const numImages = 50;
const imageFiles = [];
for (let i = 0; i < numImages; i++) {
    const tmpFile = path.join(os.tmpdir(), `dummy-${i}.tmp`);
    // Create a 1MB dummy file
    fs.writeFileSync(tmpFile, Buffer.alloc(1024 * 1024));
    imageFiles.push({
        originalname: `image-${i}.jpg`,
        path: tmpFile,
        mimetype: 'image/jpeg',
        size: 1024 * 1024
    });
}

function restoreFiles() {
    for (let i = 0; i < numImages; i++) {
        fs.writeFileSync(imageFiles[i].path, Buffer.alloc(1024 * 1024));
    }
}

async function runBenchmark(useAsync) {
    const start = performance.now();
    let projectData = {};

    if (useAsync) {
        projectData.imageBundles = {
            create: {
                versionName: 'V01',
                uploaderId: 1,
                images: {
                    create: await Promise.all(imageFiles.map(async (file, index) => {
                        const sanName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
                        const targetFilename = `V01_${index}_${sanName}`;
                        const targetFullPath = path.join(projectTargetDir, targetFilename);

                        await fs.promises.copyFile(file.path, targetFullPath);
                        try { await fs.promises.unlink(file.path); } catch (e) { }

                        const finalRelPath = path.join(teamSlugToUse, slug, targetFilename).replace(/\\/g, '/');

                        if (index === 0) {
                            projectData.thumbnailPath = finalRelPath;
                        }

                        return {
                            filename: finalRelPath,
                            originalName: file.originalname,
                            mimeType: file.mimetype,
                            path: finalRelPath,
                            order: index,
                            size: BigInt(file.size)
                        };
                    }))
                }
            }
        };
    } else {
        projectData.imageBundles = {
            create: {
                versionName: 'V01',
                uploaderId: 1,
                images: {
                    create: imageFiles.map((file, index) => {
                        const sanName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
                        const targetFilename = `V01_${index}_${sanName}`;
                        const targetFullPath = path.join(projectTargetDir, targetFilename);
                        fs.copyFileSync(file.path, targetFullPath);
                        try { fs.unlinkSync(file.path); } catch (e) { }
                        const finalRelPath = path.join(teamSlugToUse, slug, targetFilename).replace(/\\/g, '/');

                        if (index === 0) {
                            projectData.thumbnailPath = finalRelPath;
                        }

                        return {
                            filename: finalRelPath,
                            originalName: file.originalname,
                            mimeType: file.mimetype,
                            path: finalRelPath,
                            order: index,
                            size: BigInt(file.size)
                        };
                    })
                }
            }
        };
    }

    const end = performance.now();

    // Cleanup copied files
    for (const file of fs.readdirSync(projectTargetDir)) {
        fs.unlinkSync(path.join(projectTargetDir, file));
    }

    return end - start;
}

function checkEventLoopSync(name, fn) {
    return new Promise((resolve) => {
        let maxDelay = 0;
        let lastTime = performance.now();
        const interval = setInterval(() => {
            const now = performance.now();
            if (lastTime) {
                const delay = now - lastTime - 10; // 10ms expected
                if (delay > maxDelay) maxDelay = delay;
            }
            lastTime = now;
        }, 10);

        restoreFiles();

        // This blocks the event loop
        fn();

        // Let event loop catch up
        setTimeout(() => {
            clearInterval(interval);
            console.log(`${name} Max Event Loop Delay: ${maxDelay.toFixed(2)} ms`);
            resolve(maxDelay);
        }, 100);
    });
}

async function checkEventLoopAsync(name, fn) {
    return new Promise(async (resolve) => {
        let maxDelay = 0;
        let lastTime = performance.now();
        const interval = setInterval(() => {
            const now = performance.now();
            if (lastTime) {
                const delay = now - lastTime - 10; // 10ms expected
                if (delay > maxDelay) maxDelay = delay;
            }
            lastTime = now;
        }, 10);

        restoreFiles();
        await fn();

        setTimeout(() => {
            clearInterval(interval);
            console.log(`${name} Max Event Loop Delay: ${maxDelay.toFixed(2)} ms`);
            resolve(maxDelay);
        }, 100);
    });
}

async function main() {
    console.log(`Running benchmark with ${numImages} files (1MB each)...`);

    // Warmup
    restoreFiles();
    await runBenchmark(false);
    restoreFiles();
    await runBenchmark(true);

    // Test sync
    let syncTotal = 0;
    for (let i = 0; i < 5; i++) {
        restoreFiles();
        syncTotal += await runBenchmark(false);
    }
    const syncAvg = syncTotal / 5;

    // Test async
    let asyncTotal = 0;
    for (let i = 0; i < 5; i++) {
        restoreFiles();
        asyncTotal += await runBenchmark(true);
    }
    const asyncAvg = asyncTotal / 5;

    console.log(`Sync (baseline): ${syncAvg.toFixed(2)} ms`);
    console.log(`Async (optimized): ${asyncAvg.toFixed(2)} ms`);

    if (asyncAvg < syncAvg) {
        const improvement = ((syncAvg - asyncAvg) / syncAvg) * 100;
        console.log(`Improvement: ${improvement.toFixed(2)}% faster`);
    } else {
        const regression = ((asyncAvg - syncAvg) / syncAvg) * 100;
        console.log(`Regression: ${regression.toFixed(2)}% slower`);
    }

    // Event loop blocking test
    console.log('\nRunning Event Loop Blocking Test...');

    await checkEventLoopSync('Sync', () => runBenchmark(false));
    await checkEventLoopAsync('Async', () => runBenchmark(true));

    // Cleanup temp dir
    fs.rmdirSync(projectTargetDir);
}

main().catch(console.error);
