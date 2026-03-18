const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken } = require('./middleware');
const { generateThumbnail } = require('./utils/thumbnail');
const { isValidVideoFile, isValidImageFile, isValidThreeDFile, isValidZipFile, isValidText, isValidImageBuffer } = require('./utils/validation');
const { sanitizeHtml } = require('./utils/security');
const { generatePDF, generateCSV } = require('./utils/export');
const { getVideoMetadata } = require('./utils/metadata');
const { checkProjectAccess, checkCommentAccess } = require('./utils/authCheck');
const { checkQuota, updateStorage } = require('./utils/storage');
const { rateLimit } = require('./utils/rateLimiter');
const ffmpeg = require('fluent-ffmpeg');
const AdmZip = require('adm-zip');
const { createAndBroadcast } = require('./services/notificationService');
const { getIo } = require('./services/socketService');
const { notifyDiscord } = require('./services/discordService');
const { convertFbxToGlb, checkFbxConversionCapability } = require('./utils/fbxConverter');
const { generateGifTurnaround } = require('./services/threeDService');

const router = express.Router();

// Helper to check GIF config
async function isGifGenerationEnabled() {
    const prismaInstance = new (require('@prisma/client').PrismaClient)();
    try {
        const setting = await prismaInstance.systemSetting.findUnique({
            where: { key: 'enable_3d_gif' }
        });
        // Default to true
        return setting ? setting.value === 'true' : true;
    } finally {
        await prismaInstance.$disconnect();
    }
}

// Rate Limiters for Authenticated Actions

// 1. Comment Creation (Spam prevention)
// Limit: 60 comments per minute per user (1 per second avg)
const commentRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    message: { error: 'You are commenting too fast. Please wait a moment.' },
    keyGenerator: (req) => req.user ? req.user.id : req.ip
});

// 2. Project Creation (Spam/Storage prevention)
// Limit: 10 projects per hour per user
const projectRateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { error: 'You have created too many projects recently. Please try again later.' },
    keyGenerator: (req) => req.user ? req.user.id : req.ip
});

// 3. Version Upload (Spam/Storage prevention)
// Limit: 20 uploads per hour per user
const versionRateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    message: { error: 'You have uploaded too many versions recently. Please try again later.' },
    keyGenerator: (req) => req.user ? req.user.id : req.ip
});

function slugify(text) {
    return text
        .toString()
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^\w\-]+/g, '')
        .replace(/\-\-+/g, '-');
}

// Helper to check if FBX server conversion is enabled
async function isFbxConversionEnabled() {
    const prismaInstance = new (require('@prisma/client').PrismaClient)();
    try {
        const setting = await prismaInstance.systemSetting.findUnique({
            where: { key: 'fbx_server_conversion' }
        });
        // Default to true if setting doesn't exist
        return setting ? setting.value === 'true' : true;
    } finally {
        await prismaInstance.$disconnect();
    }
}
const prisma = new PrismaClient();

// Configure Multer
const DATA_PATH = process.env.DATA_PATH || path.join(__dirname, 'storage');
const UPLOAD_DIR = path.join(DATA_PATH, 'media');
const THUMBNAIL_DIR = path.join(DATA_PATH, 'thumbnails');

if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
if (!fs.existsSync(THUMBNAIL_DIR)) {
    fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (file.fieldname === 'thumbnail') {
            cb(null, THUMBNAIL_DIR);
        } else {
            cb(null, UPLOAD_DIR);
        }
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = crypto.randomUUID();
        const ext = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '');
        cb(null, uniqueSuffix + ext);
    }
});

const upload = multer({ storage: storage });

const commentUpload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB for file attachments
        fieldSize: 20 * 1024 * 1024  // 20MB for field values (annotations, screenshots in base64)
    }
});

// Helper to calculate next version name
const getNextVersionName = async (projectId) => {
    const videoCount = await prisma.video.count({ where: { projectId } });
    const imageBundleCount = await prisma.imageBundle.count({ where: { projectId } });
    const threeDCount = await prisma.threeDAsset.count({ where: { projectId } });
    const nextNum = videoCount + imageBundleCount + threeDCount + 1;
    return `V${nextNum.toString().padStart(2, '0')}`;
};

const getFrameRate = (filePath) => {
    return new Promise((resolve) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) {
                console.error('Error getting framerate:', err);
                return resolve(24.0); // Default fallback
            }
            const videoStream = metadata.streams.find(s => s.codec_type === 'video');
            if (videoStream && videoStream.r_frame_rate) {
                const parts = videoStream.r_frame_rate.split('/');
                if (parts.length === 2) {
                    const fps = parseFloat(parts[0]) / parseFloat(parts[1]);
                    if (!isNaN(fps) && fps > 0) return resolve(fps);
                }
            }
            resolve(24.0);
        });
    });
};

const generateVideoGif = (filePath, outputDir, duration) => {
    return new Promise((resolve, reject) => {
        const gifFilename = `vid-${crypto.randomUUID()}.gif`;
        const outputPath = path.join(outputDir, gifFilename);

        // Target: 40 frames total.
        // Duration of GIF: 4 seconds (40 frames / 10 fps).
        // Source video duration: 'duration' seconds.
        // We want to pick 1 frame every (duration / 40) seconds.

        let selectFilter = '';
        if (duration > 0) {
            // Calculate interval in seconds
            const interval = duration / 40;
            // Use 'select' filter with time timestamps
            selectFilter = `select='isnan(prev_selected_t)+gte(t-prev_selected_t,${interval})'`;
        } else {
            // Fallback if duration unknown: just take every 10th frame?
            selectFilter = `select='not(mod(n,10))'`;
        }

        // Filter Chain:
        // 1. Select frames distributed over time
        // 2. Scale to width 320 (preserve ratio)
        // 3. FPS = 10
        // 4. Generate Palette & Apply for optimization

        ffmpeg(filePath)
            .complexFilter(
                `${selectFilter},scale=320:-1:flags=lanczos,fps=10,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`
            )
            .outputOptions('-loop', '0') // Loop forever
            .on('end', () => resolve(gifFilename))
            .on('error', (err) => {
                console.error('Error generating video GIF:', err);
                reject(err);
            })
            .save(outputPath);
    });
};

// Trash Helpers
// Structure: media/Trash/{teamSlug}/{projectSlug}/
async function moveProjectAssetsToTrash(projectId) {
    const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
            videos: true,
            threeDAssets: true,
            imageBundles: { include: { images: true } },
            team: { select: { slug: true } }
        }
    });

    if (!project) return;

    // Determine team slug for trash path
    const teamSlug = project.team?.slug || 'personal';
    const trashBase = path.join(UPLOAD_DIR, 'Trash', teamSlug, project.slug);

    if (!fs.existsSync(trashBase)) fs.mkdirSync(trashBase, { recursive: true });

    const moveFile = (srcDir, filename, destDir) => {
        if (!filename) return;
        const src = path.join(srcDir, filename);
        // For files with nested paths (Team/Project/file.ext), just use the basename in trash
        const basename = path.basename(filename);
        const dest = path.join(destDir, basename);

        if (fs.existsSync(src)) {
            try {
                fs.renameSync(src, dest);
            } catch (e) { console.error('Failed to move to trash:', src, e); }
        }
    };

    // Move all assets to trash folder
    if (project.thumbnailPath) {
        if (project.thumbnailPath.includes('/') || project.thumbnailPath.includes('\\')) {
            moveFile(UPLOAD_DIR, project.thumbnailPath, trashBase);
        } else {
            moveFile(THUMBNAIL_DIR, project.thumbnailPath, trashBase);
        }
    }
    project.videos.forEach(v => moveFile(UPLOAD_DIR, v.path, trashBase));
    project.threeDAssets.forEach(a => moveFile(UPLOAD_DIR, a.path, trashBase));
    project.imageBundles.forEach(b => b.images.forEach(i => moveFile(UPLOAD_DIR, i.path, trashBase)));

    // Clean up the now-empty project folder
    const teamSlugForPath = project.team?.slug || 'personal';
    const projectFolder = path.join(UPLOAD_DIR, teamSlugForPath, project.slug);
    try {
        if (fs.existsSync(projectFolder)) {
            fs.rmSync(projectFolder, { recursive: true, force: true });
        }
    } catch (e) { console.error('Failed to clean project folder:', e); }
}

async function restoreProjectAssetsFromTrash(projectId) {
    const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
            videos: true,
            threeDAssets: true,
            imageBundles: { include: { images: true } },
            team: { select: { slug: true } }
        }
    });

    if (!project) return;

    // Trash location
    const teamSlug = project.team?.slug || 'personal';
    const trashBase = path.join(UPLOAD_DIR, 'Trash', teamSlug, project.slug);

    // Restore destination (original project folder)
    const projectFolder = path.join(UPLOAD_DIR, teamSlug, project.slug);
    if (!fs.existsSync(projectFolder)) fs.mkdirSync(projectFolder, { recursive: true });

    const moveBack = (trashDir, filename, destDir) => {
        if (!filename) return;
        // Files in trash are stored with basename only
        const basename = path.basename(filename);
        const src = path.join(trashDir, basename);
        // Restore to original path structure
        const dest = path.join(destDir, basename);

        if (fs.existsSync(src)) {
            try {
                fs.renameSync(src, dest);
            } catch (e) { console.error('Failed to restore from trash:', src, e); }
        }
    };

    // Restore all assets from trash to project folder
    if (project.thumbnailPath) {
        moveBack(trashBase, project.thumbnailPath, projectFolder);
    }
    project.videos.forEach(v => moveBack(trashBase, v.path, projectFolder));
    project.threeDAssets.forEach(a => moveBack(trashBase, a.path, projectFolder));
    project.imageBundles.forEach(b => b.images.forEach(i => moveBack(trashBase, i.path, projectFolder)));

    // Clean up trash folder
    try { fs.rmSync(trashBase, { recursive: true, force: true }); } catch (e) { }
}

// GET /projects/trash: List deleted projects
router.get('/trash', authenticateToken, async (req, res) => {
    try {
        const user = req.user;

        const userTeamIds = [...user.teamMemberships.map(tm => tm.team.id), ...user.ownedTeams.map(t => t.id)];
        const uniqueTeamIds = [...new Set(userTeamIds)];

        const where = {
            deletedAt: { not: null }
        };

        if (user.role !== 'admin') {
            if (uniqueTeamIds.length === 0) {
                return res.json([]);
            }
            where.teamId = { in: uniqueTeamIds };
        }

        const projects = await prisma.project.findMany({
            where: where,
            include: {
                team: { select: { name: true } }
            },
            orderBy: { deletedAt: 'desc' }
        });

        res.json(projects);
    } catch (error) {
        console.error('Error fetching trash:', error);
        res.status(500).json({ error: 'Failed to fetch trash' });
    }
});

// GET /projects: List all projects
router.get('/', authenticateToken, async (req, res) => {
    try {
        const user = req.user;

        const userTeamIds = [...user.teamMemberships.map(tm => tm.team.id), ...user.ownedTeams.map(t => t.id)];
        const uniqueTeamIds = [...new Set(userTeamIds)];

        if (uniqueTeamIds.length === 0 && user.role !== 'admin') {
            return res.json([]);
        }

        const where = {};
        if (user.role === 'admin') {
            // Admin sees all
        } else {
            where.teamId = { in: uniqueTeamIds };
        }

        // Filter out deleted projects
        where.deletedAt = null;

        const projects = await prisma.project.findMany({
            where: where,
            include: {
                videos: {
                    take: 1,
                    orderBy: { createdAt: 'desc' }
                },
                imageBundles: {
                    take: 1,
                    orderBy: { createdAt: 'desc' },
                    include: { images: { take: 1, orderBy: { order: 'asc' } } }
                },
                threeDAssets: {
                    take: 1,
                    orderBy: { createdAt: 'desc' }
                },
                team: {
                    select: { id: true, name: true, slug: true }
                },
                roles: true
            },
            orderBy: { updatedAt: 'desc' }
        });
        res.json(projects);
    } catch (error) {
        console.error('Error fetching projects:', error);
        res.status(500).json({ error: 'Failed to fetch projects' });
    }
});

// GET /projects/slug/:teamSlug/:projectSlug: Get full project details by slug
router.get('/slug/:teamSlug/:projectSlug', authenticateToken, async (req, res) => {
    try {
        const { teamSlug, projectSlug } = req.params;

        const user = req.user;

        const userTeams = [...user.teamMemberships.map(tm => tm.team), ...user.ownedTeams];

        // Find team by slug to verify access
        const team = await prisma.team.findUnique({ where: { slug: teamSlug } });
        if (!team) return res.status(404).json({ error: 'Team not found' });

        // Access check
        const hasAccess = user.role === 'admin' || userTeams.some(t => t.id === team.id);
        if (!hasAccess) return res.status(403).json({ error: 'Access denied' });

        const basicProject = await prisma.project.findFirst({
            where: {
                slug: projectSlug,
                teamId: team.id
            },
            include: { mutedBy: { select: { id: true } } }
        });

        if (!basicProject) return res.status(404).json({ error: 'Project not found' });

        // Delegate to fetchFullProject logic (reused)
        const project = await fetchFullProject(basicProject.id, req.user.id, basicProject.teamId);
        if (!project) return res.status(404).json({ error: 'Project not found' });

        const projectWithVersions = {
            ...project,
            // Re-map versions as before
            versions: [
                ...project.videos.map(v => ({ ...v, type: 'video' })),
                ...project.imageBundles.map(b => ({ ...b, type: 'image_bundle' })),
                ...project.threeDAssets.map(a => ({ ...a, type: 'three_d_asset' }))
            ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
            isMuted: basicProject.mutedBy.some(u => u.id === req.user.id)
        };

        res.json(projectWithVersions);

    } catch (error) {
        console.error('Error fetching project by slug:', error);
        res.status(500).json({ error: 'Failed to fetch project' });
    }
});

// Reuseable fetch function
async function fetchFullProject(projectId, userId, teamId, isClient = false) {
    const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
            videos: {
                include: {
                    comments: {
                        where: { parentId: null },
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    name: true,
                                    role: true,
                                    avatarPath: true,
                                    teamRoles: true
                                }
                            },
                            reactions: true,
                            replies: {
                                include: {
                                    user: {
                                        select: {
                                            id: true,
                                            name: true,
                                            role: true,
                                            avatarPath: true,
                                            teamRoles: true
                                        }
                                    },
                                    reactions: true
                                }
                            }
                        },
                        orderBy: { timestamp: 'asc' }
                    }
                },
            },
            imageBundles: {
                include: {
                    images: {
                        orderBy: { order: 'asc' },
                        include: {
                            comments: {
                                where: { parentId: null },
                                include: {
                                    user: {
                                        select: {
                                            id: true,
                                            name: true,
                                            role: true,
                                            avatarPath: true,
                                            teamRoles: true
                                        }
                                    },
                                    reactions: true,
                                    replies: {
                                        include: {
                                            user: {
                                                select: {
                                                    id: true,
                                                    name: true,
                                                    role: true,
                                                    avatarPath: true,
                                                    teamRoles: true
                                                }
                                            },
                                            reactions: true
                                        }
                                    }
                                },
                                orderBy: { createdAt: 'desc' }
                            }
                        }
                    }
                }
            },
            threeDAssets: {
                include: {
                    comments: {
                        where: { parentId: null },
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    name: true,
                                    role: true,
                                    avatarPath: true,
                                    teamRoles: true
                                }
                            },
                            reactions: true,
                            replies: {
                                include: {
                                    user: {
                                        select: {
                                            id: true,
                                            name: true,
                                            role: true,
                                            avatarPath: true,
                                            teamRoles: true
                                        }
                                    },
                                    reactions: true
                                }
                            }
                        },
                        orderBy: { createdAt: 'desc' }
                    }
                }
            },
            team: {
                include: {
                    members: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    name: true,
                                    avatarPath: true,
                                    teamRoles: true
                                }
                            }
                        }
                    },
                    roles: true
                }
            }
        }
    });

    if (project) {
        // Filter roles logic (copied from original)
        const filterRoles = (user) => {
            if (user && user.teamRoles) {
                user.teamRoles = user.teamRoles.filter(role => role.teamId === teamId);
            }
        };

        // NEW: Client/Guest Comment Filtering
        const filterComments = (comments) => {
            return comments.filter(c => c.isVisibleToClient || c.guestName).map(c => {
                if (c.replies) {
                    c.replies = filterComments(c.replies);
                }
                return c;
            });
        };

        // Apply team role filter to all users in comments
        if (project.videos) project.videos.forEach(v => v.comments?.forEach(c => { filterRoles(c.user); c.replies?.forEach(r => filterRoles(r.user)); }));
        if (project.imageBundles) project.imageBundles.forEach(ib => ib.images?.forEach(img => img.comments?.forEach(c => { filterRoles(c.user); c.replies?.forEach(r => filterRoles(r.user)); })));
        if (project.threeDAssets) project.threeDAssets.forEach(a => a.comments?.forEach(c => { filterRoles(c.user); c.replies?.forEach(r => filterRoles(r.user)); }));

        // Apply Client Filtering if isClient is true
        if (isClient) {
            if (project.videos) {
                project.videos.forEach(video => {
                    if (video.comments) video.comments = filterComments(video.comments);
                });
            }
            if (project.imageBundles) {
                project.imageBundles.forEach(bundle => {
                    if (bundle.images) {
                        bundle.images.forEach(image => {
                            if (image.comments) image.comments = filterComments(image.comments);
                        });
                    }
                });
            }
            if (project.threeDAssets) {
                project.threeDAssets.forEach(asset => {
                    if (asset.comments) asset.comments = filterComments(asset.comments);
                });
            }
        }

        if (project.team?.members) {
            project.team.members = project.team.members.map(m => {
                if (m.user) {
                    const user = { ...m.user, role: m.role, joinedAt: m.joinedAt };
                    filterRoles(user);
                    return user;
                }
                return null;
            }).filter(Boolean);
        }
    }

    return project;
}

// GET /projects/:id: Get full project details
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const projectId = parseInt(req.params.id);
        if (isNaN(projectId)) return res.status(400).json({ error: 'Invalid project ID' });

        const user = req.user;

        const userTeamIds = [...user.teamMemberships.map(tm => tm.team.id), ...user.ownedTeams.map(t => t.id)];

        // Fetch basic project info first to check access and optimize subsequent query
        const basicProject = await prisma.project.findUnique({
            where: { id: projectId },
            include: {
                mutedBy: { select: { id: true } }
            }
        });

        if (!basicProject) return res.status(404).json({ error: 'Project not found' });

        if (user.role !== 'admin' && (!basicProject.teamId || !userTeamIds.includes(basicProject.teamId))) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const project = await fetchFullProject(projectId, req.user.id, basicProject.teamId, req.user.role === 'CLIENT');

        if (!project) return res.status(404).json({ error: 'Project not found' });

        // Merge and sort versions
        const allVersions = [
            ...project.videos.map(v => ({ ...v, type: 'video' })),
            ...project.imageBundles.map(b => ({ ...b, type: 'image_bundle' })),
            ...project.threeDAssets.map(a => ({ ...a, type: 'three_d_asset' }))
        ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        // We attach sorted versions to the response object instead of raw videos/imageBundles
        // But to keep API consistent, we can just return the raw data and let frontend sort,
        // or return a 'versions' field.
        // Frontend expects 'videos' array usually. Let's add 'versions' field.
        const projectWithVersions = {
            ...project,
            versions: allVersions,
            isMuted: basicProject.mutedBy.some(u => u.id === req.user.id)
        };

        res.json(projectWithVersions);
    } catch (error) {
        console.error(`Error fetching project ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to fetch project' });
    }
});

// PATCH /projects/:id/roles: Update project roles (tags)
router.patch('/:id/roles', authenticateToken, async (req, res) => {
    try {
        const projectId = parseInt(req.params.id);
        const { roleIds } = req.body; // Array of role IDs

        if (isNaN(projectId) || !Array.isArray(roleIds)) {
            return res.status(400).json({ error: 'Invalid input' });
        }

        const project = await prisma.project.findUnique({
            where: { id: projectId },
            include: { team: true }
        });

        if (!project) return res.status(404).json({ error: 'Project not found' });

        // Check access (must be admin or team member with manage permissions?)
        // Assuming team members can edit project settings if they have access to team
        // Or restrict to owner/admin?
        // Let's stick to standard check: User must be in the team.
        const user = req.user;

        const isOwner = user.ownedTeams.some(t => t.id === project.teamId);
        const isMember = user.teamMemberships.some(tm => tm.teamId === project.teamId);
        const isAdmin = user.role === 'admin';

        if (!isOwner && !isMember && !isAdmin) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Validate that roles belong to the same team
        const validRoles = await prisma.teamRole.count({
            where: {
                id: { in: roleIds },
                teamId: project.teamId
            }
        });

        if (validRoles !== roleIds.length) {
            // Some roles might not belong to the team or not exist
            return res.status(400).json({ error: 'Invalid roles provided' });
        }

        // Update project roles
        await prisma.project.update({
            where: { id: projectId },
            data: {
                roles: {
                    set: roleIds.map(id => ({ id }))
                }
            }
        });

        res.json({ success: true });

    } catch (error) {
        console.error('Error updating project roles:', error);
        res.status(500).json({ error: 'Failed to update roles' });
    }
});

// POST /projects: Create new project
router.post('/', authenticateToken, projectRateLimiter, upload.fields([{ name: 'file', maxCount: 1 }, { name: 'images', maxCount: 50 }, { name: 'thumbnail', maxCount: 1 }]), async (req, res) => {
    const videoFile = req.files.file ? req.files.file[0] : null;
    const imageFiles = req.files.images || [];
    const thumbnailFile = req.files.thumbnail ? req.files.thumbnail[0] : null;
    let generatedGifPath = null;

    // Notify user of start
    const io = getIo();
    io.to(`user_${req.user.id}`).emit('UPLOAD_STATUS', { message: 'Processing upload...' });

    // Calculate total size for quota check
    let totalSize = 0;
    if (videoFile) totalSize += videoFile.size;
    if (imageFiles) imageFiles.forEach(f => totalSize += f.size);
    // Thumbnails usually small, but let's be strict if we want
    // if (thumbnailFile) totalSize += thumbnailFile.size;

    // Check for 3D file (treated as 'file' but validated as GLB/FBX/USD if extension matches)
    let isThreeD = false;
    let isZip = false;
    if (videoFile) {
        const ext = path.extname(videoFile.originalname).toLowerCase();
        const valid3DExtensions = ['.glb', '.fbx', '.usd', '.usdz', '.usda', '.usdc'];

        if (valid3DExtensions.includes(ext)) {
            isThreeD = true;
        } else if (ext === '.zip') {
            isThreeD = true;
            isZip = true;
        }
    }

    if (!videoFile && imageFiles.length === 0) {
        return res.status(400).json({ error: 'File or images are required' });
    }

    if (isThreeD) {
        if (isZip) {
            if (!(await isValidZipFile(videoFile.path))) {
                try { fs.unlinkSync(videoFile.path); } catch (e) { }
                if (thumbnailFile) try { fs.unlinkSync(thumbnailFile.path); } catch (e) { }
                return res.status(400).json({ error: 'Invalid ZIP file format' });
            }
        } else {
            const ext3d = await isValidThreeDFile(videoFile.path);
            if (!ext3d) {
                try { fs.unlinkSync(videoFile.path); } catch (e) { }
                if (thumbnailFile) try { fs.unlinkSync(thumbnailFile.path); } catch (e) { }
                return res.status(400).json({ error: 'Invalid 3D file format' });
            }
            // Enforce extension
            const newPath = videoFile.path.replace(path.extname(videoFile.path), ext3d);
            if (newPath !== videoFile.path) {
                fs.renameSync(videoFile.path, newPath);
                videoFile.path = newPath;
                videoFile.filename = path.basename(newPath);
            }
        }
    } else if (videoFile) {
        // Validate Video
        const vidExt = await isValidVideoFile(videoFile.path);
        if (!vidExt) {
            try { fs.unlinkSync(videoFile.path); } catch (e) { }
            if (thumbnailFile) try { fs.unlinkSync(thumbnailFile.path); } catch (e) { }
            return res.status(400).json({ error: 'Invalid video file format' });
        }
        // Enforce extension
        const newPath = videoFile.path.replace(path.extname(videoFile.path), vidExt);
        if (newPath !== videoFile.path) {
            fs.renameSync(videoFile.path, newPath);
            videoFile.path = newPath;
            videoFile.filename = path.basename(newPath);
        }
    }

    // Validate Images
    for (const img of imageFiles) {
        const imgExt = await isValidImageFile(img.path);
        if (!imgExt) {
            // Cleanup all uploaded files
            if (videoFile) try { fs.unlinkSync(videoFile.path); } catch (e) { }
            imageFiles.forEach(f => { try { fs.unlinkSync(f.path); } catch (e) { } });
            if (thumbnailFile) try { fs.unlinkSync(thumbnailFile.path); } catch (e) { }
            return res.status(400).json({ error: `Invalid image file format: ${img.originalname}` });
        }
        // Enforce extension
        const newPath = img.path.replace(path.extname(img.path), imgExt);
        if (newPath !== img.path) {
            fs.renameSync(img.path, newPath);
            img.path = newPath;
            img.filename = path.basename(newPath);
        }
    }

    if (thumbnailFile) {
        const thumbExt = await isValidImageFile(thumbnailFile.path);
        if (!thumbExt) {
            if (videoFile) try { fs.unlinkSync(videoFile.path); } catch (e) { }
            imageFiles.forEach(f => { try { fs.unlinkSync(f.path); } catch (e) { } });
            try { fs.unlinkSync(thumbnailFile.path); } catch (e) { }
            return res.status(400).json({ error: 'Invalid thumbnail file format' });
        }
        // Enforce extension
        const newPath = thumbnailFile.path.replace(path.extname(thumbnailFile.path), thumbExt);
        if (newPath !== thumbnailFile.path) {
            fs.renameSync(thumbnailFile.path, newPath);
            thumbnailFile.path = newPath;
            thumbnailFile.filename = path.basename(newPath);
        }
    }

    const { name, description, teamId } = req.body;

    // Input Validation
    if (!isValidText(name, 100)) return res.status(400).json({ error: 'Project name exceeds 100 characters' });
    if (!isValidText(description, 2000)) return res.status(400).json({ error: 'Project description exceeds 2000 characters' });

    if (!teamId && req.user.role !== 'admin') {
        return res.status(400).json({ error: 'Team ID is required' });
    }

    try {
        const parsedTeamId = teamId ? parseInt(teamId) : null;

        // Check Quota
        try {
            await checkQuota({
                userId: req.user.id,
                teamId: parsedTeamId,
                fileSize: totalSize
            });
        } catch (e) {
            if (videoFile) try { fs.unlinkSync(videoFile.path); } catch (err) { }
            if (thumbnailFile) try { fs.unlinkSync(thumbnailFile.path); } catch (err) { }
            imageFiles.forEach(f => { try { fs.unlinkSync(f.path); } catch (err) { } });
            return res.status(403).json({ error: e.message });
        }

        const user = req.user;

        const userTeamIds = [...user.teamMemberships.map(tm => tm.team.id), ...user.ownedTeams.map(t => t.id)];

        if (user.role !== 'admin') {
            if (!teamId || !userTeamIds.includes(parseInt(teamId))) {
                return res.status(403).json({ error: 'You must be a member of the team to create projects.' });
            }
        }

        let baseSlug = slugify(name);
        if (!baseSlug) baseSlug = `project-${Date.now()}`;
        let slug = baseSlug;
        let counter = 1;

        // Uniqueness within team
        if (parsedTeamId) {
            while (true) {
                const existing = await prisma.project.findFirst({
                    where: {
                        teamId: parsedTeamId,
                        slug: slug
                    }
                });
                if (!existing) break;
                slug = `${baseSlug}-${counter}`;
                counter++;
            }
        } else {
            // Admin project (no team)
            // Ensure uniqueness even for null teamId to prevent confusion
            while (true) {
                const existing = await prisma.project.findFirst({
                    where: {
                        teamId: null,
                        slug: slug
                    }
                });
                if (!existing) break;
                slug = `${baseSlug}-${counter}`;
                counter++;
            }
        }

        // Determine Team Slug and Project Target Directory
        let teamSlugToUse = 'personal';
        if (parsedTeamId) {
            const t = await prisma.team.findUnique({ where: { id: parsedTeamId }, select: { slug: true } });
            if (t && t.slug) teamSlugToUse = t.slug;
        } else if (req.user.role === 'admin') {
            teamSlugToUse = 'admin';
        }

        const projectTargetDir = path.join(UPLOAD_DIR, teamSlugToUse, slug);

        let thumbnailPath = null;
        let hasCustomThumbnail = false;

        if (!fs.existsSync(projectTargetDir)) {
            fs.mkdirSync(projectTargetDir, { recursive: true });
        }

        if (thumbnailFile) {
            thumbnailPath = thumbnailFile.filename;
            hasCustomThumbnail = true;
            // Move custom thumbnail to project dir?
            // "Enregistrer le thumbnail directement dans le dossier où est l'asset"
            // Yes, move it.
            const thumbExt = path.extname(thumbnailFile.originalname);
            const thumbName = `thumb-${crypto.randomUUID()}${thumbExt}`;
            const thumbDest = path.join(projectTargetDir, thumbName);
            fs.copyFileSync(thumbnailFile.path, thumbDest);
            try { fs.unlinkSync(thumbnailFile.path); } catch (e) { }
            thumbnailPath = path.join(teamSlugToUse, slug, thumbName).replace(/\\/g, '/');
        } else if (videoFile && !isThreeD) {
            try {
                // Generate thumbnail directly in Project Folder
                io.to(`user_${req.user.id}`).emit('UPLOAD_STATUS', { message: 'Generating thumbnail...' });
                const thumbName = await generateThumbnail(videoFile.path, projectTargetDir);
                thumbnailPath = path.join(teamSlugToUse, slug, thumbName).replace(/\\/g, '/');
            } catch (e) {
                console.error("Failed to generate thumbnail", e);
            }
        } else if (imageFiles.length > 0) {
            const firstImg = imageFiles[0];
            const thumbName = `thumb-${firstImg.filename}`;
            const thumbDest = path.join(projectTargetDir, thumbName);
            fs.copyFileSync(firstImg.path, thumbDest);
            thumbnailPath = path.join(teamSlugToUse, slug, thumbName).replace(/\\/g, '/');
        }

        // Parse roleIds if present
        let roleIdsParsed = [];
        if (req.body.roleIds) {
            try {
                roleIdsParsed = JSON.parse(req.body.roleIds);
            } catch (e) {
                console.warn('Failed to parse roleIds', e);
            }
        }

        let projectData = {
            name: name ? sanitizeHtml(name) : 'Untitled Project',
            description: description ? sanitizeHtml(description) : '',
            teamId: parsedTeamId,
            thumbnailPath,
            hasCustomThumbnail,
            slug,
            roles: roleIdsParsed.length > 0 ? {
                connect: roleIdsParsed.map(id => ({ id: parseInt(id) }))
            } : undefined
        };

        if (videoFile) {
            if (isThreeD) {
                let finalPath = videoFile.path;
                let finalFilename = videoFile.filename;
                let mimeType = 'model/gltf-binary'; // Default for GLB

                const ext = path.extname(videoFile.originalname).toLowerCase();
                if (ext === '.fbx') mimeType = 'application/octet-stream';
                else if (ext === '.usdz') mimeType = 'model/vnd.usdz+zip';
                else if (['.usd', '.usda', '.usdc'].includes(ext)) mimeType = 'model/usd';

                if (isZip) {
                    // Extract ZIP
                    try {
                        const zip = new AdmZip(videoFile.path);
                        const extractDir = path.join(UPLOAD_DIR, 'unpacked', path.parse(videoFile.filename).name);
                        fs.mkdirSync(extractDir, { recursive: true });

                        // Secure Extraction: Only extract allowlisted extensions
                        const SAFE_EXTENSIONS = ['.glb', '.gltf', '.bin', '.png', '.jpg', '.jpeg', '.webp', '.fbx', '.tga', '.bmp', '.tif', '.tiff'];
                        const zipEntries = zip.getEntries();

                        zipEntries.forEach(entry => {
                            if (!entry.isDirectory) {
                                const ext = path.extname(entry.entryName).toLowerCase();
                                if (SAFE_EXTENSIONS.includes(ext)) {
                                    zip.extractEntryTo(entry, extractDir, true, true);
                                }
                            }
                        });


                        const findMainFile = (dir) => {
                            const files = fs.readdirSync(dir);
                            for (const file of files) {
                                const fullPath = path.join(dir, file);
                                const stat = fs.statSync(fullPath);
                                if (stat.isDirectory()) {
                                    const found = findMainFile(fullPath);
                                    if (found) return found;
                                } else {
                                    const ext = file.toLowerCase().split('.').pop();
                                    if (ext === 'glb' || ext === 'fbx') {
                                        return fullPath;
                                    }
                                }
                            }
                            return null;
                        };

                        const mainFileFullPath = findMainFile(extractDir);
                        if (!mainFileFullPath) {
                            throw new Error('No GLB or FBX file found in ZIP');
                        }

                        // Sanitize original name for file system
                        const sanitizedOriginalName = videoFile.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
                        let versionPrefix = 'V01'; // Try to use version

                        // Construct Target Directory
                        // Construct Target Directory
                        // Already defined at top level: projectTargetDir

                        // Determine new filename
                        const ext = path.extname(mainFileFullPath).toLowerCase();
                        let targetFilename = `${versionPrefix}_${sanitizedOriginalName}`;

                        // If it ends with .zip (original), strip it and add real ext
                        if (targetFilename.toLowerCase().endsWith('.zip')) {
                            targetFilename = targetFilename.substring(0, targetFilename.length - 4) + ext;
                        } else if (!targetFilename.toLowerCase().endsWith(ext)) {
                            targetFilename += ext;
                        }

                        const targetPath = path.join(projectTargetDir, targetFilename);

                        // Move MAIN file
                        fs.copyFileSync(mainFileFullPath, targetPath); // Copy to be safe

                        // Also need to move textures if it's FBX? 
                        // If FBX in ZIP, textures are flattened in extraction. 
                        // We should copy them too if we want them to work? 
                        // Or just reference the extracted path? 
                        // Plan said: "Organize ... int Team/Project". 
                        // If we just move the main file, textures might be lost if relative paths break.
                        // For simplicity in this step, let's keep the extracted folder logic for ZIPs 
                        // BUT move the whole extracted content to the new structure?
                        // Or simplify: If it's a Zip, we might need a folder per asset if it has dependencies.
                        // Let's stick to the plan: Move file to `Team/Project/`.
                        // For self-contained GLB, it's fine. 
                        // For FBX+Textures, they need to be together.
                        // Let's copy the PARENT FOLDER of the main file if it was a ZIP?
                        // Or just copy the main file and hope textures are embedded? (GLB yes, FBX maybe not).

                        // Current logic uses `convertFbxToGlb` later.
                        // That conversion happens on `finalPath`. 
                        // Let's let the conversion happen in temp, THEN move the RESULT.

                        // Actually, looking at the code flow:
                        // Conversion happens below.
                        // So we should NOT move yet here?
                        // The original code sets `finalPath = mainFileFullPath` (in temp).
                        // Then does conversion.
                        // Then saves to DB.

                        // Strategy: Let the existing logic process (unzip, convert).
                        // At the very end of processing (before DB create), MOVE the result.

                        finalFilename = path.relative(UPLOAD_DIR, mainFileFullPath); // Keep temp relative for now
                        finalPath = mainFileFullPath; // Keep temp abs for now

                        const mainExt = path.extname(finalPath).toLowerCase();

                        // Auto-link textures for FBX: Flatten all images to the same directory as the FBX
                        if (mainExt === '.fbx') {
                            try {
                                const mainFileDir = path.dirname(mainFileFullPath);
                                const textureExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.tga', '.bmp', '.tif', '.tiff'];

                                const findAndCopyTextures = (dir) => {
                                    const files = fs.readdirSync(dir);
                                    for (const file of files) {
                                        const fullPath = path.join(dir, file);
                                        const stat = fs.statSync(fullPath);
                                        if (stat.isDirectory()) {
                                            findAndCopyTextures(fullPath);
                                        } else {
                                            const ext = path.extname(file).toLowerCase();
                                            if (textureExtensions.includes(ext)) {
                                                const destPath = path.join(mainFileDir, file);
                                                // Copy if it's not the same file and doesn't exist at destination (or we can overwrite, best to not overwrite to preserve root priority)
                                                if (fullPath !== destPath && !fs.existsSync(destPath)) {
                                                    fs.copyFileSync(fullPath, destPath);
                                                }
                                            }
                                        }
                                    }
                                };
                                findAndCopyTextures(extractDir);
                                console.log('[3D Upload] Textures flattened for FBX conversion');
                            } catch (err) {
                                console.warn('[3D Upload] Failed to flatten textures:', err);
                            }
                        }

                        // If the main file in ZIP is FBX, try to convert it
                        if (mainExt === '.fbx') {
                            // Check if server conversion is enabled
                            const conversionEnabled = await isFbxConversionEnabled();
                            if (!conversionEnabled) {
                                console.log('[3D Upload] FBX server conversion is disabled by admin');
                                try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch (err) { }
                                if (thumbnailFile) try { fs.unlinkSync(thumbnailFile.path); } catch (err) { }
                                return res.status(400).json({
                                    error: 'FBX server conversion is disabled. Please convert your FBX to GLB format before uploading.'
                                });
                            }

                            console.log('[3D Upload] Found FBX in ZIP, attempting conversion...');
                            io.to(`user_${req.user.id}`).emit('UPLOAD_STATUS', { message: 'Converting FBX to GLB...' });
                            const glbPath = finalPath.replace(/\.fbx$/i, '.glb');
                            const result = await convertFbxToGlb(finalPath, glbPath);

                            if (result.success) {
                                console.log('[3D Upload] FBX from ZIP converted to GLB successfully');
                                finalPath = result.outputPath;
                                finalFilename = path.relative(UPLOAD_DIR, result.outputPath);
                                mimeType = 'model/gltf-binary';
                            } else {
                                console.error('[3D Upload] FBX conversion failed:', result.error);
                                // Cleanup
                                try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch (err) { }
                                if (thumbnailFile) try { fs.unlinkSync(thumbnailFile.path); } catch (err) { }
                                return res.status(400).json({
                                    error: 'ZIP contains FBX file which requires conversion. Server conversion failed: ' + result.error
                                });
                            }
                        } else {
                            mimeType = 'model/gltf-binary'; // GLB
                        }

                        // Clean up the original ZIP file
                        try { fs.unlinkSync(videoFile.path); } catch (err) { }

                    } catch (e) {
                        console.error('Error processing ZIP:', e);
                        try { fs.unlinkSync(videoFile.path); } catch (err) { }
                        if (thumbnailFile) try { fs.unlinkSync(thumbnailFile.path); } catch (err) { }

                        // Cleanup extracted directory if it exists
                        const extractDir = path.join(UPLOAD_DIR, 'unpacked', path.parse(videoFile.filename).name);
                        try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch (err) { }

                        return res.status(400).json({ error: 'Failed to process ZIP file: ' + e.message });
                    }
                }

                // FBX to GLB Conversion (for non-ZIP FBX files)
                if (ext === '.fbx' && !isZip) {
                    // Check if server conversion is enabled
                    const conversionEnabled = await isFbxConversionEnabled();
                    if (!conversionEnabled) {
                        console.log('[3D Upload] FBX server conversion is disabled by admin');
                        try { fs.unlinkSync(videoFile.path); } catch (err) { }
                        if (thumbnailFile) try { fs.unlinkSync(thumbnailFile.path); } catch (err) { }
                        return res.status(400).json({
                            error: 'FBX server conversion is disabled. Please convert your FBX to GLB format before uploading.'
                        });
                    }

                    console.log('[3D Upload] Attempting FBX to GLB conversion...');
                    io.to(`user_${req.user.id}`).emit('UPLOAD_STATUS', { message: 'Converting FBX to GLB...' });
                    const glbPath = finalPath.replace(/\.fbx$/i, '.glb');
                    const result = await convertFbxToGlb(finalPath, glbPath);

                    if (result.success) {
                        console.log('[3D Upload] FBX converted to GLB successfully');
                        // Delete original FBX file - no longer needed after conversion
                        try { fs.unlinkSync(videoFile.path); } catch (err) { console.log('[3D Upload] FBX temp file cleanup:', err.message); }

                        // Delete .fbm folder created by fbx2gltf (contains extracted textures)
                        const fbmFolder = videoFile.path.replace(/\.fbx$/i, '.fbm');
                        if (fs.existsSync(fbmFolder)) {
                            try {
                                fs.rmSync(fbmFolder, { recursive: true, force: true });
                                console.log('[3D Upload] Cleaned up .fbm folder:', fbmFolder);
                            } catch (err) { console.log('[3D Upload] FBM folder cleanup:', err.message); }
                        }

                        finalPath = result.outputPath;
                        finalFilename = path.basename(result.outputPath);
                        mimeType = 'model/gltf-binary';
                    } else {
                        console.error('[3D Upload] FBX conversion failed:', result.error);
                        // Cleanup the uploaded file
                        try { fs.unlinkSync(videoFile.path); } catch (err) { }
                        if (thumbnailFile) try { fs.unlinkSync(thumbnailFile.path); } catch (err) { }
                        return res.status(400).json({
                            error: 'FBX files require conversion to GLB format. Server conversion failed: ' + result.error
                        });
                    }
                }

                // AFTER CONVERSION/PROCESSING, MOVE TO FINAL DESTINATION
                // AFTER CONVERSION/PROCESSING, MOVE TO FINAL DESTINATION
                // teamSlugToUse and projectTargetDir are already defined at top level

                // If conversion happened, finalPath is the GLB.
                // If it was ZIP, finalPath is extracted file.
                // If direct upload, finalPath is temp upload.

                const sanName = videoFile.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');

                // Ensure name doesn't have double extension if original had one
                const finalExt = path.extname(finalPath);
                let safeName = sanName;
                if (safeName.toLowerCase().endsWith(finalExt)) {
                    // nothing
                } else {
                    // remove extension from original if exists?
                    const origExt = path.extname(safeName);
                    if (origExt) safeName = safeName.substring(0, safeName.length - origExt.length);
                    safeName += finalExt;
                }
                const targetFilename = `V01_${safeName}`;
                const targetFullPath = path.join(projectTargetDir, targetFilename);

                // If it was a GLB/FBX (single file or converted), just move/copy it.
                // Note: finalPath might be in 'unpacked' or root 'media'.
                fs.copyFileSync(finalPath, targetFullPath);

                // Cleanup temporary files after copying to final destination
                if (isZip) {
                    // Clean up unpacked directory
                    const extractDir = path.join(UPLOAD_DIR, 'unpacked', path.parse(videoFile.filename).name);
                    try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch (err) { }
                } else if (finalPath !== targetFullPath && fs.existsSync(finalPath)) {
                    // Clean up temp converted file if it was in a different location
                    try { fs.unlinkSync(finalPath); } catch (err) { }
                }

                // Update final variables for DB
                finalPath = targetFullPath;
                finalFilename = path.join(teamSlugToUse, slug, targetFilename).replace(/\\/g, '/'); // Normalize slashes for DB/URL

                projectData.threeDAssets = {
                    create: {
                        filename: finalFilename, // Relative path for serving
                        originalName: videoFile.originalname,
                        mimeType: mimeType,
                        path: finalFilename, // We store the RELATIVE path in 'path' too? 
                        // Wait, schema says `path` is String. 
                        // Previous code: `path: finalPath` (Absolute). `filename: finalFilename` (Relative).
                        // Let's check schema/usage. 
                        // Schema: `path String`. `filename String`.
                        // Code uses `path.resolve(UPLOAD_DIR, asset.path)` for GIF generation.
                        // So `asset.path` should be relative to UPLOAD_DIR?
                        // Original code: `finalFilename = path.relative(UPLOAD_DIR, mainFileFullPath)`.
                        // `finalPath = mainFileFullPath` (Absolute).
                        // But wait! `projectData` uses: `filename: finalFilename`, `path: finalPath`.
                        // If I change `path` to relative, subsequent code `path.resolve(UPLOAD_DIR, asset.path)` works if asset.path is relative.
                        // BUT if `asset.path` was absolute before, then `path.resolve` handles it (if abs, it ignores first arg).
                        // So it seems `path` WAS absolute.
                        // Let's keep `path` absolute or relative? 
                        // "In the base de donnée... il faut voir le nom des assets".
                        // If I store relative path `Team/Project/File.glb`, it's readable.
                        // If I store absolute `C:\Users...\Team\Project\File.glb`, it's readable but not portable.
                        // Best practice: Store relative.
                        // Let's switch `path` to be RELATIVE to UPLOAD_DIR.
                        // But I need to verify if other parts of app expect absolute.
                        // `api/media` serves `media` folder.
                        // Frontend accesses `filename` (which was relative).
                        // So `filename` MUST be relative.
                        // `path` is used for server-side ops (ffmpeg, thumbnails).
                        // Let's store RELATIVE in both, and ensure server-side ops use `path.join(UPLOAD_DIR, asset.path)`.

                        // HOWEVER, I should check `Video` model in schema.
                        // `path: String`. 
                        // Let's look at `isValidVideoFile(videoFile.path)` -> assumes absolute usually.
                        // `ffmpeg.ffprobe(filePath)` -> needs valid path (abs or rel to CWD).
                        // `generateGifTurnaround(fullModelPath)` where `fullModelPath = path.resolve(UPLOAD_DIR, asset.path)`.
                        // If `asset.path` is absolute, `path.resolve` returns it.
                        // If `asset.path` is relative, `path.resolve` joins it.
                        // So SAFE to change to relative.
                        // I will set BOTH to relative path `Team/Project/Name`.

                        path: finalFilename, // Store relative path
                        versionName: 'V01',
                        size: BigInt(videoFile.size),
                        uploaderId: req.user.id
                    }
                };
            } else {
                // VIDEO PROCESSING
                // Move video to structured folder
                let teamSlugToUse = 'personal';
                if (parsedTeamId) {
                    const t = await prisma.team.findUnique({ where: { id: parsedTeamId }, select: { slug: true } });
                    if (t && t.slug) teamSlugToUse = t.slug;
                } else if (req.user.role === 'admin') {
                    teamSlugToUse = 'admin';
                }

                const sanName = videoFile.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
                const projectTargetDir = path.join(UPLOAD_DIR, teamSlugToUse, slug);
                if (!fs.existsSync(projectTargetDir)) fs.mkdirSync(projectTargetDir, { recursive: true });

                const targetFilename = `V01_${sanName}`;
                const targetFullPath = path.join(projectTargetDir, targetFilename);

                fs.copyFileSync(videoFile.path, targetFullPath);
                try { fs.unlinkSync(videoFile.path); } catch (e) { } // delete temp

                const finalRelPath = path.join(teamSlugToUse, slug, targetFilename).replace(/\\/g, '/');
                const { frameRate, duration } = await getVideoMetadata(targetFullPath);

                // Generate Video GIF
                let gifPath = null;
                try {
                    const gifEnabled = await isGifGenerationEnabled();
                    if (gifEnabled) {
                        io.to(`user_${req.user.id}`).emit('UPLOAD_STATUS', { message: 'Generating GIF preview...' });
                        const gifName = await generateVideoGif(targetFullPath, projectTargetDir, duration);
                        gifPath = path.join(teamSlugToUse, slug, gifName).replace(/\\/g, '/');
                        generatedGifPath = gifPath; // Use this for notification
                        projectData.thumbnailPath = gifPath; // Use GIF as thumbnail
                    }
                } catch (e) {
                    console.error("Failed to generate Video GIF", e);
                }

                projectData.videos = {
                    create: {
                        filename: finalRelPath,
                        originalName: videoFile.originalname,
                        mimeType: videoFile.mimetype,
                        path: finalRelPath, // Storing relative path now
                        versionName: 'V01',
                        frameRate,
                        size: BigInt(videoFile.size),
                        uploaderId: req.user.id
                    }
                };
            }
        }

        // IMAGES processing
        else {
            // We have imageFiles to move
            let teamSlugToUse = 'personal';
            if (parsedTeamId) {
                const t = await prisma.team.findUnique({ where: { id: parsedTeamId }, select: { slug: true } });
                if (t && t.slug) teamSlugToUse = t.slug;
            } else if (req.user.role === 'admin') {
                teamSlugToUse = 'admin';
            }
            const projectTargetDir = path.join(UPLOAD_DIR, teamSlugToUse, slug);
            if (!fs.existsSync(projectTargetDir)) fs.mkdirSync(projectTargetDir, { recursive: true });

            projectData.imageBundles = {
                create: {
                    versionName: 'V01',
                    uploaderId: req.user.id,
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
        }

        const project = await prisma.project.create({
            data: projectData,
            include: { videos: true, imageBundles: { include: { images: true } }, threeDAssets: true }
        });

        // 3D GIF Generation
        // Remove 'let' to use outer scope variable
        generatedGifPath = null;
        if (isThreeD && project.threeDAssets && project.threeDAssets.length > 0) {
            const asset = project.threeDAssets[0];
            try {
                const gifEnabled = await isGifGenerationEnabled();
                if (gifEnabled) {
                    console.log('[3D GIF] Generating turnaround for project ' + project.id);
                    io.to(`user_${req.user.id}`).emit('UPLOAD_STATUS', { message: 'Generating 3D preview (this may take a while)...' });

                    // generate in project directory
                    const relativeAssetPath = asset.path; // already relative Team/Slug/File.glb
                    const fullModelPath = path.join(UPLOAD_DIR, relativeAssetPath);
                    const modelDir = path.dirname(fullModelPath); // This is projectTargetDir

                    const gifFilename = await generateGifTurnaround(fullModelPath, modelDir);

                    console.log('[3D GIF] Turnaround generated successfully:', gifFilename);

                    const relativeGifPath = path.join(teamSlugToUse, slug, gifFilename).replace(/\\/g, '/');

                    // Update project thumbnail if not custom
                    if (!project.hasCustomThumbnail) {
                        await prisma.project.update({
                            where: { id: project.id },
                            data: { thumbnailPath: relativeGifPath }
                        });
                        project.thumbnailPath = relativeGifPath;
                        generatedGifPath = relativeGifPath; // Update for notification
                    }
                } else {
                    console.log('[3D GIF] Turnaround skipped (disabled in settings)');
                }
            } catch (e) {
                console.error('[3D GIF] Generation failed:', e);
            }
        }

        // Update Storage Usage
        // Attribute to Team Storage AND User Storage
        if (parsedTeamId) {
            await updateStorage({ teamId: parsedTeamId, deltaBytes: totalSize });
        }
        // Update User Storage (Global Limit)
        await updateStorage({ userId: req.user.id, deltaBytes: totalSize });

        // Notification: PROJECT_CREATE
        if (parsedTeamId) {
            const team = await prisma.team.findUnique({
                where: { id: parsedTeamId },
                include: { members: { select: { userId: true } }, owner: { select: { id: true } } }
            });

            const recipients = new Set();
            if (team) {
                if (team.ownerId !== req.user.id) recipients.add(team.ownerId);
                team.members.forEach(m => {
                    if (m.userId !== req.user.id) recipients.add(m.userId);
                });
            }

            // Send Live Update to Team Members
            // We iterate and emit to each user's room
            const io = getIo();
            recipients.forEach(userId => {
                io.to(`user_${userId}`).emit('PROJECT_CREATE', project);
            });
            // Also emit to myself (the creator) so my list updates if I'm on multiple devices or tabs
            io.to(`user_${req.user.id}`).emit('PROJECT_CREATE', project);

            // Also emit to the project room (though newly created, no one is there yet, but for consistency)
            io.to(`project_${project.id}`).emit('PROJECT_CREATE', project);

            const videoId = project.videos.length > 0 ? project.videos[0].id : null;

            await createAndBroadcast(Array.from(recipients), {
                type: 'PROJECT_CREATE',
                content: `New project "${project.name}" created`,
                referenceId: project.id,
                projectId: project.id,
                videoId: videoId,
                data: { gifPath: generatedGifPath, thumbnailPath: project.thumbnailPath } // Pass GIF path to notification service
            });

            // Discord Notification
            // Skip if 3D project and NO custom thumbnail AND NO generated GIF (client will generate and trigger later)
            const shouldSkipDiscord = isThreeD && !hasCustomThumbnail && !generatedGifPath;

            if (!shouldSkipDiscord) {
                console.log('[Discord] Triggering notification for project:', project.id, 'with GIF:', generatedGifPath);
                await notifyDiscord(parsedTeamId, 'PROJECT_CREATE', {
                    id: project.id,
                    projectId: project.id, // Explicitly pass ProjectID for role filtering
                    name: project.name,
                    description: project.description,
                    thumbnailPath: project.thumbnailPath,
                    gifPath: generatedGifPath, // Pass to Discord service
                    projectSlug: project.slug,
                    user: { name: user.name, avatarPath: user.avatarPath }
                });
            } else {
                console.log('[Discord] Skipped notification (3D project expecting thumbnail later)');
            }

        }

        res.json(project);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to create project' });
    }
});

// POST /projects/:id/versions: Upload a new version (Video or Images)
router.post('/:id/versions', authenticateToken, versionRateLimiter, upload.fields([{ name: 'file', maxCount: 1 }, { name: 'images', maxCount: 50 }]), async (req, res) => {
    console.log('DEBUG: Upload Version Params:', req.params);
    const projectId = parseInt(req.params.id);
    const io = getIo();
    io.to(`project_${projectId}`).emit('UPLOAD_STATUS', { message: 'Processing upload...' });
    const videoFile = req.files.file ? req.files.file[0] : null;
    const imageFiles = req.files.images || [];

    // Notification helpers
    let notificationGifPath = null;
    let notificationThumbnailPath = null;

    let totalSize = 0;
    if (videoFile) totalSize += videoFile.size;
    if (imageFiles) imageFiles.forEach(f => totalSize += f.size);

    // Check for 3D
    let isThreeD = false;
    let isZip = false;
    if (videoFile) {
        const ext = path.extname(videoFile.originalname).toLowerCase();
        const valid3DExtensions = ['.glb', '.fbx', '.usd', '.usdz', '.usda', '.usdc'];

        if (valid3DExtensions.includes(ext)) {
            isThreeD = true;
        } else if (ext === '.zip') {
            isThreeD = true;
            isZip = true;
        }
    }

    if (!videoFile && imageFiles.length === 0) {
        return res.status(400).json({ error: 'File is required' });
    }

    if (isThreeD) {
        if (isZip) {
            if (!(await isValidZipFile(videoFile.path))) {
                try { await fs.promises.unlink(videoFile.path); } catch (e) { }
                return res.status(400).json({ error: 'Invalid ZIP file format' });
            }
        } else {
            const ext3d = await isValidThreeDFile(videoFile.path);
            if (!ext3d) {
                try { await fs.promises.unlink(videoFile.path); } catch (e) { }
                return res.status(400).json({ error: 'Invalid 3D file format' });
            }
            // Enforce extension
            const newPath = videoFile.path.replace(path.extname(videoFile.path), ext3d);
            if (newPath !== videoFile.path) {
                await fs.promises.rename(videoFile.path, newPath);
                videoFile.path = newPath;
                videoFile.filename = path.basename(newPath);
            }
        }
    } else if (videoFile) {
        const vidExt = await isValidVideoFile(videoFile.path);
        if (!vidExt) {
            try { await fs.promises.unlink(videoFile.path); } catch (e) { }
            return res.status(400).json({ error: 'Invalid video file format' });
        }
        // Enforce extension
        const newPath = videoFile.path.replace(path.extname(videoFile.path), vidExt);
        if (newPath !== videoFile.path) {
            await fs.promises.rename(videoFile.path, newPath);
            videoFile.path = newPath;
            videoFile.filename = path.basename(newPath);
        }
    }

    for (const img of imageFiles) {
        const imgExt = await isValidImageFile(img.path);
        if (!imgExt) {
            if (videoFile) try { await fs.promises.unlink(videoFile.path); } catch (e) { }
            await Promise.all(imageFiles.map(f => fs.promises.unlink(f.path).catch(e => { })));
            return res.status(400).json({ error: 'Invalid image file format' });
        }
        // Enforce extension
        const newPath = img.path.replace(path.extname(img.path), imgExt);
        if (newPath !== img.path) {
            await fs.promises.rename(img.path, newPath);
            img.path = newPath;
            img.filename = path.basename(newPath);
        }
    }

    // projectId is already parsed at start of route
    // const projectId = parseInt(req.params.id);

    try {
        // Security: Use centralized check
        const access = await checkProjectAccess(req.user, projectId);
        if (!access.authorized) {
            if (videoFile) try { fs.unlinkSync(videoFile.path); } catch (e) { }
            imageFiles.forEach(f => { try { fs.unlinkSync(f.path); } catch (e) { } });
            return res.status(access.status).json({ error: access.error });
        }
        const { project, user } = access;

        // Quota Check
        if (project.teamId) {
            try {
                await checkQuota({ userId: req.user.id, teamId: project.teamId, fileSize: totalSize });
            } catch (e) {
                if (videoFile) try { fs.unlinkSync(videoFile.path); } catch (err) { }
                imageFiles.forEach(f => { try { fs.unlinkSync(f.path); } catch (err) { } });
                return res.status(403).json({ error: e.message });
            }
        }

        const versionName = await getNextVersionName(projectId);

        if (!project.hasCustomThumbnail) {
            if (videoFile && !isThreeD) {
                try {
                    const newThumb = await generateThumbnail(videoFile.path, THUMBNAIL_DIR);
                    await prisma.project.update({
                        where: { id: projectId },
                        data: { thumbnailPath: newThumb }
                    });
                } catch (e) {
                    console.error("Failed to generate thumbnail for new version", e);
                }
            } else if (imageFiles.length > 0) {
                const firstImg = imageFiles[0];
                const thumbName = `thumb-${firstImg.filename}`;
                const thumbDest = path.join(THUMBNAIL_DIR, thumbName);
                try {
                    await fs.promises.copyFile(firstImg.path, thumbDest);
                    await prisma.project.update({
                        where: { id: projectId },
                        data: { thumbnailPath: thumbName }
                    });
                } catch (e) {
                    console.error("Failed to set thumbnail from image", e);
                }
            }
        }

        let newVersion;

        if (videoFile) {
            if (isThreeD) {
                let finalPath = videoFile.path;
                let finalFilename = videoFile.filename;
                let mimeType = 'model/gltf-binary'; // Default for GLB

                const ext = path.extname(videoFile.originalname).toLowerCase();
                if (ext === '.fbx') mimeType = 'application/octet-stream';
                else if (ext === '.usdz') mimeType = 'model/vnd.usdz+zip';
                else if (['.usd', '.usda', '.usdc'].includes(ext)) mimeType = 'model/usd';

                if (isZip) {
                    try {
                        const zip = new AdmZip(videoFile.path);
                        const extractDir = path.join(UPLOAD_DIR, 'unpacked', path.parse(videoFile.filename).name);
                        await fs.promises.mkdir(extractDir, { recursive: true });

                        // Secure Extraction: Only extract allowlisted extensions
                        const zipEntries = zip.getEntries();
                        const SAFE_EXTENSIONS = ['.glb', '.gltf', '.fbx', '.bin', '.png', '.jpg', '.jpeg', '.webp'];

                        zipEntries.forEach(entry => {
                            if (!entry.isDirectory) {
                                const ext = path.extname(entry.entryName).toLowerCase();
                                if (SAFE_EXTENSIONS.includes(ext)) {
                                    zip.extractEntryTo(entry, extractDir, true, true);
                                }
                            }
                        });

                        const findModel = async (dir) => {
                            const files = await fs.promises.readdir(dir);
                            for (const file of files) {
                                const fullPath = path.join(dir, file);
                                const stat = await fs.promises.stat(fullPath);
                                if (stat.isDirectory()) {
                                    const found = await findModel(fullPath);
                                    if (found) return found;
                                } else {
                                    const lower = file.toLowerCase();
                                    if (lower.endsWith('.glb') || lower.endsWith('.fbx')) {
                                        return fullPath;
                                    }
                                }
                            }
                            return null;
                        };

                        const modelFullPath = await findModel(extractDir);
                        if (!modelFullPath) {
                            throw new Error('No 3D model (GLB/FBX) found in ZIP');
                        }

                        finalFilename = path.relative(UPLOAD_DIR, modelFullPath);
                        finalPath = modelFullPath;

                        const ext = path.extname(finalFilename).toLowerCase();

                        // Conversion Logic for FBX in ZIP
                        if (ext === '.fbx') {
                            const conversionEnabled = await isFbxConversionEnabled();
                            if (!conversionEnabled) {
                                console.log('[3D Upload] FBX server conversion is disabled by admin');
                                try { await fs.promises.rm(extractDir, { recursive: true, force: true }); } catch (err) { }
                                try { await fs.promises.unlink(videoFile.path); } catch (err) { }
                                return res.status(400).json({
                                    error: 'FBX server conversion is disabled. Please convert your FBX to GLB format before uploading.'
                                });
                            }

                            console.log('[3D Upload] Found FBX in ZIP, attempting conversion (Version)...');
                            const io = getIo();
                            io.to(`project_${projectId}`).emit('UPLOAD_STATUS', { message: 'Converting FBX to GLB...' });
                            const glbPath = finalPath.replace(/\.fbx$/i, '.glb');
                            const result = await convertFbxToGlb(finalPath, glbPath);

                            if (result.success) {
                                console.log('[3D Upload] FBX from ZIP converted to GLB successfully');
                                finalPath = result.outputPath;
                                finalFilename = path.relative(UPLOAD_DIR, result.outputPath);
                                mimeType = 'model/gltf-binary';
                            } else {
                                console.error('[3D Upload] FBX conversion failed:', result.error);
                                try { await fs.promises.rm(extractDir, { recursive: true, force: true }); } catch (err) { }
                                try { await fs.promises.unlink(videoFile.path); } catch (err) { }
                                return res.status(400).json({
                                    error: 'ZIP contains FBX file which requires conversion. Server conversion failed: ' + result.error
                                });
                            }
                        } else {
                            mimeType = 'model/gltf-binary'; // Default to GLB
                        }

                        // Clean up the original ZIP file
                        try { await fs.promises.unlink(videoFile.path); } catch (err) { }

                    } catch (e) {
                        console.error('Error processing ZIP:', e);
                        try { await fs.promises.unlink(videoFile.path); } catch (err) { }
                        // Cleanup extracted directory if it exists
                        const extractDir = path.join(UPLOAD_DIR, 'unpacked', path.parse(videoFile.filename).name);
                        try { await fs.promises.rm(extractDir, { recursive: true, force: true }); } catch (err) { }

                        return res.status(400).json({ error: 'Failed to process ZIP file: ' + e.message });
                    }
                }

                // FBX to GLB Conversion (for non-ZIP FBX files)
                if (ext === '.fbx' && !isZip) {
                    const conversionEnabled = await isFbxConversionEnabled();
                    if (!conversionEnabled) {
                        try { await fs.promises.unlink(videoFile.path); } catch (err) { }
                        return res.status(400).json({
                            error: 'FBX server conversion is disabled. Please convert your FBX to GLB format before uploading.'
                        });
                    }

                    console.log('[3D Upload] Attempting FBX to GLB conversion (Version)...');
                    const io = getIo();
                    io.to(`project_${projectId}`).emit('UPLOAD_STATUS', { message: 'Converting FBX to GLB...' });
                    const glbPath = finalPath.replace(/\.fbx$/i, '.glb');
                    const result = await convertFbxToGlb(finalPath, glbPath);

                    if (result.success) {
                        console.log('[3D Upload] FBX converted to GLB successfully');
                        try { await fs.promises.unlink(videoFile.path); } catch (err) { } // clean original

                        // Delete .fbm folder created by fbx2gltf
                        const fbmFolder = videoFile.path.replace(/\.fbx$/i, '.fbm');
                        if (fs.existsSync(fbmFolder)) {
                            try { await fs.promises.rm(fbmFolder, { recursive: true, force: true }); } catch (err) { }
                        }

                        finalPath = result.outputPath;
                        finalFilename = path.basename(result.outputPath);
                        mimeType = 'model/gltf-binary';
                    } else {
                        try { await fs.promises.unlink(videoFile.path); } catch (err) { }
                        return res.status(400).json({
                            error: 'FBX files require conversion. Server conversion failed: ' + result.error
                        });
                    }
                }

                // MOVE NEW VERSION TO STRUCTURED FOLDER
                const project = await prisma.project.findUnique({ where: { id: projectId }, include: { team: true } });
                const teamSlugToUse = project.team ? project.team.slug : 'admin'; // or 'personal' if null team and not admin? 

                const sanName = videoFile.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
                const projectTargetDir = path.join(UPLOAD_DIR, teamSlugToUse, project.slug);
                await fs.promises.mkdir(projectTargetDir, { recursive: true });

                // Construct filename with version prefix
                const finalExt = path.extname(finalPath);
                let safeName = sanName;
                if (safeName.toLowerCase().endsWith(finalExt)) {
                    // nothing
                } else {
                    const origExt = path.extname(safeName);
                    if (origExt) safeName = safeName.substring(0, safeName.length - origExt.length);
                    safeName += finalExt;
                }
                const targetFilename = `${versionName}_${safeName}`;
                const targetFullPath = path.join(projectTargetDir, targetFilename);

                await fs.promises.copyFile(finalPath, targetFullPath);

                // Cleanup intermediate file/folder after copy
                if (isZip) {
                    const extractDir = path.join(UPLOAD_DIR, 'unpacked', path.parse(videoFile.filename).name);
                    try { await fs.promises.rm(extractDir, { recursive: true, force: true }); } catch (err) { }
                } else if (ext === '.fbx') {
                    // For standalone FBX, finalPath is the temp GLB in /media
                    try { await fs.promises.unlink(finalPath); } catch (err) { }
                }

                finalPath = targetFullPath;
                finalFilename = path.join(teamSlugToUse, project.slug, targetFilename).replace(/\\/g, '/');

                newVersion = await prisma.threeDAsset.create({
                    data: {
                        projectId,
                        filename: finalFilename,
                        originalName: videoFile.originalname,
                        mimeType: mimeType,
                        path: finalFilename, // Store relative
                        versionName,
                        size: BigInt(videoFile.size),
                        uploaderId: req.user.id
                    }
                });

                // 3D GIF Generation for Version
                if (newVersion) {
                    try {
                        const gifEnabled = await isGifGenerationEnabled();
                        if (gifEnabled) {
                            console.log('[3D GIF] Generating turnaround for version ' + newVersion.versionName);
                            const io = getIo();
                            io.to(`project_${projectId}`).emit('UPLOAD_STATUS', { message: 'Generating 3D preview (this may take a moment)...' });

                            const fullVersionPath = path.join(UPLOAD_DIR, newVersion.path);
                            const modelDir = path.dirname(fullVersionPath);

                            const gifFilename = await generateGifTurnaround(fullVersionPath, modelDir);
                            const relativeGifPath = path.join(teamSlugToUse, project.slug, gifFilename).replace(/\\/g, '/');

                            newVersion.gifPath = relativeGifPath; // Attach to object for notification
                            notificationGifPath = relativeGifPath; // Set for Discord/In-app notification

                            // Optional: Update project thumbnail if auto-generated
                            if (!project.hasCustomThumbnail) {
                                await prisma.project.update({
                                    where: { id: projectId },
                                    data: { thumbnailPath: relativeGifPath }
                                });
                            }
                        }
                    } catch (e) {
                        console.error('[3D GIF] Version generation failed:', e);
                    }
                }

                // Cleanup temp files if they exist (unpacked zip etc) are already handled above by try-catch blocks in the zip/convert logic
                // But let's be sure to clean up the original videoFile if it wasn't cleaned
                try { if (fs.existsSync(videoFile.path)) await fs.promises.unlink(videoFile.path); } catch (e) { }

            } else {
                // VIDEO VERSION PROCESSING
                const project = await prisma.project.findUnique({ where: { id: projectId }, include: { team: true } });
                const teamSlugToUse = project.team ? project.team.slug : 'admin';

                const sanName = videoFile.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
                const projectTargetDir = path.join(UPLOAD_DIR, teamSlugToUse, project.slug);
                await fs.promises.mkdir(projectTargetDir, { recursive: true });

                const targetFilename = `${versionName}_${sanName}`;
                const targetFullPath = path.join(projectTargetDir, targetFilename);

                await fs.promises.copyFile(videoFile.path, targetFullPath);
                try { await fs.promises.unlink(videoFile.path); } catch (e) { }

                const finalRelPath = path.join(teamSlugToUse, project.slug, targetFilename).replace(/\\/g, '/');
                const { frameRate, duration } = await getVideoMetadata(targetFullPath);

                // Generate Video GIF for Version
                let gifPath = null;
                try {
                    if (await isGifGenerationEnabled()) {
                        io.to(`project_${projectId}`).emit('UPLOAD_STATUS', { message: 'Generating GIF preview...' });
                        const gifName = await generateVideoGif(targetFullPath, projectTargetDir, duration);
                        gifPath = path.join(teamSlugToUse, project.slug, gifName).replace(/\\/g, '/');
                        notificationGifPath = gifPath;

                        // Update project thumbnail to this new GIF
                        await prisma.project.update({
                            where: { id: projectId },
                            data: { thumbnailPath: gifPath }
                        });
                    }
                } catch (e) {
                    console.error("Failed to generate Video GIF for version", e);
                }

                const frameRateOld = await getFrameRate(targetFullPath); // keep fallback or remove if getVideoMetadata works

                // Generate Thumbnail for new video version if project doesn't have custom one
                if (!project.hasCustomThumbnail) {
                    try {
                        io.to(`project_${projectId}`).emit('UPLOAD_STATUS', { message: 'Generating thumbnail...' });
                        const thumbName = await generateThumbnail(targetFullPath, projectTargetDir);
                        const relativeThumbPath = path.join(teamSlugToUse, project.slug, thumbName).replace(/\\/g, '/');
                        await prisma.project.update({
                            where: { id: projectId },
                            data: { thumbnailPath: relativeThumbPath }
                        });
                        notificationThumbnailPath = relativeThumbPath;
                    } catch (e) {
                        console.error("Failed to generate thumbnail for new video version", e);
                    }
                }

                newVersion = await prisma.video.create({
                    data: {
                        projectId,
                        filename: finalRelPath,
                        originalName: videoFile.originalname,
                        mimeType: videoFile.mimetype,
                        path: finalRelPath,
                        versionName,
                        frameRate,
                        size: BigInt(videoFile.size),
                        uploaderId: req.user.id
                    }
                });

                // Fetch recipients
                const projectForNotify = await prisma.project.findUnique({
                    where: { id: projectId },
                    include: { team: { include: { members: true } } }
                });
                const recipients = new Set();
                if (projectForNotify && projectForNotify.team) {
                    if (projectForNotify.team.ownerId !== req.user.id) recipients.add(projectForNotify.team.ownerId);
                    projectForNotify.team.members.forEach(m => {
                        if (m.userId !== req.user.id) recipients.add(m.userId);
                    });
                }

                await createAndBroadcast(Array.from(recipients), {
                    type: 'VIDEO_VERSION',
                    content: `New version ${newVersion.versionName} uploaded to ${project.name}`,
                    referenceId: newVersion.id,
                    projectId: project.id,
                    videoId: newVersion.id, // For Video/3D
                    data: {
                        versionName: newVersion.versionName,
                        projectId: project.id,
                        gifPath: gifPath || (newVersion.threeDAssets ? newVersion.gifPath : null),
                        thumbnailPath: project.thumbnailPath // fallback
                    }
                });

            }
        } else {
            // IMAGE BUNDLE VERSION
            const project = await prisma.project.findUnique({ where: { id: projectId }, include: { team: true } });
            const teamSlugToUse = project.team ? project.team.slug : 'admin';
            const projectTargetDir = path.join(UPLOAD_DIR, teamSlugToUse, project.slug);
            if (!fs.existsSync(projectTargetDir)) fs.mkdirSync(projectTargetDir, { recursive: true });

            newVersion = await prisma.imageBundle.create({
                data: {
                    projectId,
                    versionName,
                    uploaderId: req.user.id,
                    images: {
                        create: await Promise.all(imageFiles.map(async (file, index) => {
                            const sanName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
                            const targetFilename = `${versionName}_${index}_${sanName}`;
                            const targetFullPath = path.join(projectTargetDir, targetFilename);

                            await fs.promises.copyFile(file.path, targetFullPath);
                            try { await fs.promises.unlink(file.path); } catch (e) { }

                            const finalRelPath = path.join(teamSlugToUse, project.slug, targetFilename).replace(/\\/g, '/');
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
                },
                include: { images: true }
            });
        }

        await prisma.project.update({
            where: { id: projectId },
            data: { updatedAt: new Date() }
        });

        // Update Storage (Team + User)
        if (project.teamId) {
            await updateStorage({ teamId: project.teamId, deltaBytes: totalSize });
        }
        await updateStorage({ userId: req.user.id, deltaBytes: totalSize });

        // Broadcast to Project Room
        // io is already defined at top of route
        io.to(`project_${projectId}`).emit('VERSION_ADDED', { projectId, version: newVersion });

        // Set notification thumbnail for Image Bundles if not set
        if (!notificationThumbnailPath && newVersion.images && newVersion.images.length > 0) {
            notificationThumbnailPath = newVersion.images[0].path;
        }

        // Notification: VIDEO_VERSION (Generalized for version)
        if (project.teamId) {
            const team = await prisma.team.findUnique({
                where: { id: project.teamId },
                include: { members: { select: { userId: true } }, owner: { select: { id: true } } }
            });

            const recipients = new Set();
            if (team) {
                if (team.ownerId !== req.user.id) recipients.add(team.ownerId);
                team.members.forEach(m => {
                    if (m.userId !== req.user.id) recipients.add(m.userId);
                });
            }

            console.log(`[Version Notification] gifPath: ${notificationGifPath}, thumbnailPath: ${notificationThumbnailPath}`);

            await createAndBroadcast(Array.from(recipients), {
                type: 'VIDEO_VERSION',
                content: `New version ${versionName} uploaded to "${project.name}"`,
                projectId: projectId,
                videoId: (videoFile && !isThreeD) ? newVersion.id : null,
                data: {
                    gifPath: notificationGifPath,
                    thumbnailPath: notificationThumbnailPath
                }
            });

            // Discord Notification
            await notifyDiscord(project.teamId, 'VIDEO_VERSION', {
                projectId: projectId, // Explicitly pass ProjectID for role filtering
                projectName: project.name,
                projectSlug: project.slug,
                versionName: versionName,
                gifPath: notificationGifPath,
                thumbnailPath: notificationThumbnailPath,
                user: { name: user.name, avatarPath: user.avatarPath }
            });
        }

        res.json(newVersion);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to upload version' });
    }
});

// POST /projects/:id/comments: Add comment (Video or Image)
// Accept both 'attachment' (single, legacy) and 'attachments' (multiple, new)
router.post('/:id/comments', authenticateToken, commentRateLimiter, commentUpload.fields([
    { name: 'attachment', maxCount: 1 },
    { name: 'attachments', maxCount: 10 }
]), async (req, res) => {
    const { content, timestamp, annotation, parentId, duration, assigneeId, videoId, imageId, threeDAssetId, cameraState, hotspots, screenshot, annotationScreenshot } = req.body;

    // Combine attachment files from both field names
    const attachmentFiles = [
        ...(req.files?.attachment || []),
        ...(req.files?.attachments || [])
    ];

    // Calculate sizes for quota
    let totalSize = 0;
    attachmentFiles.forEach(f => totalSize += f.size);
    // Screenshot is base64 string, length is approx size in chars (bytes? Base64 is ~1.33x larger than binary)
    // But we store binary. We will calculate binary size.
    // We do it below in matches.

    // Input Validation
    if (!isValidText(content, 5000)) {
        await Promise.all(attachmentFiles.map(f => fs.promises.unlink(f.path).catch(e => { })));
        return res.status(400).json({ error: 'Comment content exceeds 5000 characters' });
    }

    // Validate attachments (max 10 files, 5MB each)
    let attachmentPaths = [];
    for (const attachmentFile of attachmentFiles) {
        if (attachmentFile.size > 5 * 1024 * 1024) {
            await Promise.all(attachmentFiles.map(f => fs.promises.unlink(f.path).catch(e => { })));
            return res.status(400).json({ error: 'Each attachment must be under 5MB' });
        }
        const attExt = await isValidImageFile(attachmentFile.path);
        if (!attExt) {
            await Promise.all(attachmentFiles.map(f => fs.promises.unlink(f.path).catch(e => { })));
            return res.status(400).json({ error: 'Invalid attachment file format' });
        }

        // Enforce extension
        const newPath = attachmentFile.path.replace(path.extname(attachmentFile.path), attExt);
        if (newPath !== attachmentFile.path) {
            await fs.promises.rename(attachmentFile.path, newPath);
            attachmentFile.path = newPath;
            attachmentFile.filename = path.basename(newPath);
        }

        attachmentPaths.push(attachmentFile.filename);
    }

    const projectId = parseInt(req.params.id);

    // Security: Check if user has access to the project
    const access = await checkProjectAccess(req.user, projectId);
    if (!access.authorized) {
        await Promise.all(attachmentFiles.map(f => fs.promises.unlink(f.path).catch(e => { })));
        return res.status(access.status).json({ error: access.error });
    }

    try {
        let screenshotPath = null;
        let screenshotSize = 0;
        let annotationScreenshotPath = null;

        const processBase64Image = async (base64Str, prefix) => {
            const matches = base64Str.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
                const buffer = Buffer.from(matches[2], 'base64');
                const size = buffer.length;

                // Security: Validate buffer size (Max 5MB)
                if (buffer.length > 5 * 1024 * 1024) throw new Error('Screenshot too large (max 5MB)');

                // Security: Validate image content
                if (!isValidImageBuffer(buffer)) throw new Error('Invalid screenshot file format');

                const filename = `${prefix}-${crypto.randomUUID()}.jpg`;
                const commentsDir = path.join(DATA_PATH, 'comments');
                const filepath = path.join(commentsDir, filename);
                await fs.promises.mkdir(commentsDir, { recursive: true });
                await fs.promises.writeFile(filepath, buffer);
                return { filename, size };
            }
            return null;
        };

        if (screenshot) {
            try {
                const result = await processBase64Image(screenshot, 'shot');
                if (result) {
                    screenshotPath = result.filename;
                    screenshotSize += result.size;
                }
            } catch (e) {
                await Promise.all(attachmentFiles.map(f => fs.promises.unlink(f.path).catch(e => { })));
                return res.status(400).json({ error: e.message });
            }
        }

        if (annotationScreenshot) {
            try {
                const result = await processBase64Image(annotationScreenshot, 'annot');
                if (result) {
                    annotationScreenshotPath = result.filename;
                    screenshotSize += result.size;
                }
            } catch (e) {
                // Ignore error for annotation screenshot, nice to have
            }
        }

        totalSize += screenshotSize;

        if (totalSize > 0) {
            try {
                await checkQuota({
                    userId: req.user.id,
                    teamId: null, // Comments count towards USER quota
                    fileSize: totalSize
                });
            } catch (e) {
                await Promise.all(attachmentFiles.map(f => fs.promises.unlink(f.path).catch(e => { })));
                // Clean up screenshots if quota exceeded
                if (screenshotPath) try { await fs.promises.unlink(path.join(DATA_PATH, 'comments', screenshotPath)); } catch (err) { }
                if (annotationScreenshotPath) try { await fs.promises.unlink(path.join(DATA_PATH, 'comments', annotationScreenshotPath)); } catch (err) { }
                return res.status(403).json({ error: e.message });
            }
        }

        // Prepare data
        // Handle JSON stringified fields if coming from FormData (they might be strings already)
        const parseJSONIfNeeded = (val) => {
            if (typeof val === 'string') {
                try {
                    // Check if it looks like JSON? Or just return it if Prisma expects string?
                    // Prisma expects String for annotation/cameraState.
                    // But we want to ensure we store consistent format.
                    // If the client sends `"[...]"`, it is a string.
                    // If the client sends a JS object (via JSON body), `req.body` has object.
                    // `multer` populates `req.body` with strings for text fields.
                    // So `annotation` will be a string `"[{...}]"`.
                    // Current code: `annotation ? JSON.stringify(annotation) : null`
                    // If it is already a string, stringifying it again makes it `"\"[...]\""`.
                    // We should check type.
                    if (val.trim().startsWith('[') || val.trim().startsWith('{')) {
                        return val; // It's already a JSON string
                    }
                    return JSON.stringify(val); // It's something else?
                } catch (e) {
                    return val;
                }
            }
            return val ? JSON.stringify(val) : null;
        };

        const data = {
            content: sanitizeHtml(content),
            timestamp: timestamp ? parseFloat(timestamp) : 0,
            duration: duration ? parseFloat(duration) : null,
            annotation: annotation ? (typeof annotation === 'string' ? annotation : JSON.stringify(annotation)) : null,
            userId: req.user.id,
            parentId: parentId ? parseInt(parentId) : null,
            assigneeId: assigneeId ? parseInt(assigneeId) : null,
            cameraState: cameraState ? (typeof cameraState === 'string' ? cameraState : JSON.stringify(cameraState)) : null,
            hotspots: hotspots ? (typeof hotspots === 'string' ? hotspots : JSON.stringify(hotspots)) : null,
            screenshotPath,
            annotationScreenshotPath,
            attachmentPaths: attachmentPaths.length > 0 ? JSON.stringify(attachmentPaths) : null,
            size: BigInt(totalSize)
        };

        if (videoId) data.videoId = parseInt(videoId);
        if (imageId) data.imageId = parseInt(imageId);
        if (threeDAssetId) data.threeDAssetId = parseInt(threeDAssetId);

        const comment = await prisma.comment.create({
            data: data,
            include: {
                user: { select: { id: true, name: true, avatarPath: true, teamRoles: true } },
                assignee: { select: { id: true, name: true } },
                replies: {
                    include: {
                        user: { select: { id: true, name: true, avatarPath: true, teamRoles: true } }
                    }
                }
            }
        });

        if (totalSize > 0) {
            await updateStorage({ userId: req.user.id, teamId: null, deltaBytes: totalSize });
            // Also update Team storage if we wanted comments to count towards Team, but we stick to User Quota for comments
        }

        const project = await prisma.project.findUnique({
            where: { id: projectId },
            include: { mutedBy: { select: { id: true } } }
        });

        const mutedUserIds = new Set(project.mutedBy.map(u => u.id));

        // 1. Notify all team members (COMMENT)
        // Filter out author and muted users
        if (project && project.teamId) {
            const team = await prisma.team.findUnique({
                where: { id: project.teamId },
                include: { members: { select: { userId: true } }, owner: { select: { id: true } } }
            });

            const recipients = new Set();
            if (team) {
                // Add owner
                recipients.add(team.ownerId);
                // Add members
                team.members.forEach(m => recipients.add(m.userId));
            }

            // Live Comment Update (to everyone in team, including muted, excluding author maybe? or include author for sync)
            // Including author is good for multi-tab.
            const io = getIo();
            recipients.forEach(userId => {
                // Emit full comment object with projectId context
                io.to(`user_${userId}`).emit('COMMENT_ADDED', { ...comment, projectId });
            });

            // Also emit to Project Room (for Guests and focused views)
            io.to(`project_${projectId}`).emit('COMMENT_ADDED', { ...comment, projectId });

            const notifyIds = Array.from(recipients).filter(id => !mutedUserIds.has(id) && id !== req.user.id);

            if (notifyIds.length > 0) {
                await createAndBroadcast(notifyIds, {
                    type: 'COMMENT',
                    content: `New comment on ${project.name}`,
                    referenceId: comment.id,
                    projectId,
                    videoId: videoId ? parseInt(videoId) : null,
                    extraData: {
                        projectName: project.name,
                        projectSlug: project.slug,
                        teamSlug: project.team?.slug,
                        user: { name: comment.user?.name || 'User', avatarPath: comment.user?.avatarPath },
                        id: comment.id
                    }
                });
            }

            // Discord Notification
            // Determine if this is a MENTION or just a COMMENT to avoid duplicates
            // If mentions exist, treat as MENTION (Instant in Hybrid). The service handles routing.
            const hasMentions = content && content.includes('@');
            await notifyDiscord(project.teamId, hasMentions ? 'MENTION' : 'COMMENT', {
                ...comment,
                projectId: project.id, // Explicitly pass ProjectID for GIF generation
                cameraState: comment.cameraState, // Ensure camera state is passed
                projectName: project.name,
                projectSlug: project.slug,
                user: { name: comment.user?.name || 'User', avatarPath: comment.user?.avatarPath }
            });
        }

        // Handle Mentions (Internal Only)
        if (project && project.teamId && content && content.includes('@')) {
            const matches = content.match(/@([\w_\-]+)/g);
            if (matches) {
                const mentions = matches.map(m => m.substring(1).replace(/_/g, ' '));

                // ... (User/Role fetching remains same) ...

                const mentionedUsers = await prisma.user.findMany({
                    where: {
                        OR: [
                            { teamMemberships: { some: { teamId: project.teamId } } },
                            { ownedTeams: { some: { id: project.teamId } } }
                        ],
                        name: { in: mentions }
                    }
                });

                const mentionedRoles = await prisma.teamRole.findMany({
                    where: {
                        teamId: project.teamId,
                        name: { in: mentions }
                    },
                    include: { users: true }
                });

                const userIdsToNotify = new Set();
                mentionedUsers.forEach(u => userIdsToNotify.add(u.id));
                mentionedRoles.forEach(r => {
                    r.users.forEach(u => userIdsToNotify.add(u.id));
                });

                // Remove author
                userIdsToNotify.delete(req.user.id);
                // Muted users SHOULD still get Mentions

                await createAndBroadcast(Array.from(userIdsToNotify), {
                    type: 'MENTION',
                    content: `You were mentioned in a comment on ${project.name}`,
                    referenceId: comment.id,
                    projectId,
                    videoId: videoId ? parseInt(videoId) : null,
                    extraData: {
                        projectName: project.name,
                        projectSlug: project.slug,
                        teamSlug: project.team?.slug,
                        user: { name: comment.user?.name || 'User', avatarPath: comment.user?.avatarPath },
                        id: comment.id
                    }
                });

                // Removed duplicate notifyDiscord('MENTION') call here
            }
        }

        // Handle Replies
        if (parentId) {
            const parentComment = await prisma.comment.findUnique({ where: { id: parseInt(parentId) } });
            if (parentComment && parentComment.userId && parentComment.userId !== req.user.id) {
                // Check if already notified via mention?
                // The service doesn't check dupes across calls, but distinct types are fine.
                // Like Mentions, Replies often override mute settings or have their own preference.
                // We'll keep it sending.
                await createAndBroadcast([parentComment.userId], {
                    type: 'REPLY',
                    content: `New reply to your comment on ${project ? project.name : 'video'}`,
                    referenceId: comment.id,
                    projectId,
                    videoId: videoId ? parseInt(videoId) : null,
                    extraData: {
                        projectName: project.name,
                        projectSlug: project.slug,
                        teamSlug: project.team?.slug,
                        user: { name: comment.user?.name || 'User', avatarPath: comment.user?.avatarPath },
                        id: comment.id
                    }
                });
            }
        }

        await prisma.project.update({
            where: { id: projectId },
            data: { updatedAt: new Date() }
        });

        res.json(comment);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to post comment' });
    }
});

// PATCH /projects/comments/:commentId: Update comment
router.patch('/comments/:commentId', authenticateToken, async (req, res) => {
    const { isResolved, isVisibleToClient, assigneeId, content, annotation } = req.body;
    const commentId = parseInt(req.params.commentId);

    // Security: Check if user has access to the project containing the comment
    const access = await checkCommentAccess(req.user, commentId);
    if (!access.authorized) return res.status(access.status).json({ error: access.error });

    // If content or annotation is being edited, verify user owns the comment
    if (content !== undefined || annotation !== undefined) {
        const comment = await prisma.comment.findUnique({ where: { id: commentId } });
        if (!comment) return res.status(404).json({ error: 'Comment not found' });

        // Only the comment author, team owner, or admin can edit content/annotations
        const project = await prisma.project.findFirst({
            where: {
                OR: [
                    { videos: { some: { comments: { some: { id: commentId } } } } },
                    { imageBundles: { some: { images: { some: { comments: { some: { id: commentId } } } } } } },
                    { threeDAssets: { some: { comments: { some: { id: commentId } } } } }
                ]
            },
            include: { team: { select: { ownerId: true } } }
        });

        const isOwner = comment.userId === req.user.id;
        const isTeamOwner = project?.team?.ownerId === req.user.id;
        const isAdmin = req.user.role === 'admin';

        if (!isOwner && !isTeamOwner && !isAdmin) {
            return res.status(403).json({ error: 'You can only edit your own comments' });
        }

        // Validate content length if provided
        if (content !== undefined && !isValidText(content, 5000)) {
            return res.status(400).json({ error: 'Comment content exceeds 5000 characters' });
        }

        // Validate annotation if provided (should be valid JSON or null)
        if (annotation !== undefined && annotation !== null) {
            try {
                if (typeof annotation === 'string') {
                    JSON.parse(annotation);
                }
            } catch (e) {
                return res.status(400).json({ error: 'Invalid annotation format' });
            }
        }
    }

    try {
        const data = {};
        if (isResolved !== undefined) data.isResolved = isResolved;
        if (isVisibleToClient !== undefined) data.isVisibleToClient = isVisibleToClient;
        if (assigneeId !== undefined) data.assigneeId = assigneeId ? parseInt(assigneeId) : null;
        if (content !== undefined) {
            data.content = sanitizeHtml(content);
            data.isEdited = true;
        }
        if (annotation !== undefined) {
            data.annotation = annotation ? (typeof annotation === 'string' ? annotation : JSON.stringify(annotation)) : null;
            data.isEdited = true;
        }

        const comment = await prisma.comment.update({
            where: { id: commentId },
            data: data,
            include: {
                user: { select: { id: true, name: true, avatarPath: true, teamRoles: true } },
                assignee: { select: { id: true, name: true } },
                reactions: true,
                replies: {
                    include: {
                        user: { select: { id: true, name: true, avatarPath: true, teamRoles: true } },
                        reactions: true
                    }
                }
            }
        });

        // Broadcast update to all connected users in the project
        const project = await prisma.project.findFirst({
            where: {
                OR: [
                    { videos: { some: { comments: { some: { id: commentId } } } } },
                    { imageBundles: { some: { images: { some: { comments: { some: { id: commentId } } } } } } },
                    { threeDAssets: { some: { comments: { some: { id: commentId } } } } }
                ]
            },
            include: { team: { include: { members: { select: { userId: true } } } } }
        });

        if (project) {
            const io = getIo();
            // Broadcast to project room (for guests and focused views)
            io.to(`project_${project.id}`).emit('COMMENT_UPDATED', { ...comment, projectId: project.id });

            // Also broadcast to team members
            if (project.team) {
                const recipients = new Set([project.team.ownerId]);
                project.team.members.forEach(m => recipients.add(m.userId));
                recipients.forEach(userId => {
                    io.to(`user_${userId}`).emit('COMMENT_UPDATED', { ...comment, projectId: project.id });
                });
            }
        }

        res.json(comment);
    } catch (error) {
        console.error('Error updating comment:', error);
        res.status(500).json({ error: 'Failed to update comment' });
    }
});

// POST /projects/comments/:commentId/reactions: Toggle reaction
router.post('/comments/:commentId/reactions', authenticateToken, commentRateLimiter, async (req, res) => {
    const { emoji, guestName } = req.body;
    const commentId = parseInt(req.params.commentId);

    if (!emoji) return res.status(400).json({ error: 'Emoji is required' });

    // Security check
    const access = await checkCommentAccess(req.user, commentId);
    if (!access.authorized) return res.status(access.status).json({ error: access.error });

    try {
        const existing = await prisma.reaction.findFirst({
            where: {
                commentId,
                emoji,
                userId: req.user.id
            }
        });

        if (existing) {
            // Remove (Toggle Off)
            await prisma.reaction.delete({ where: { id: existing.id } });
        } else {
            // Add (Toggle On)
            await prisma.reaction.create({
                data: {
                    commentId,
                    emoji,
                    userId: req.user.id,
                    guestName: guestName ? sanitizeHtml(guestName) : null
                }
            });
        }

        const updatedComment = await prisma.comment.findUnique({
            where: { id: commentId },
            include: {
                user: { select: { id: true, name: true, avatarPath: true } },
                assignee: { select: { id: true, name: true } },
                reactions: true,
                replies: {
                    include: {
                        user: { select: { id: true, name: true, avatarPath: true } },
                        reactions: true
                    }
                }
            }
        });

        res.json(updatedComment);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to toggle reaction' });
    }
});

// GET /projects/:id/images/:imageId/export/:format
router.get('/:id/images/:imageId/export/:format', authenticateToken, async (req, res) => {
    const { id, imageId, format } = req.params;

    if (format === 'csv') {
        return res.status(400).send('CSV export disabled for images');
    }

    // Security: Check access
    const access = await checkProjectAccess(req.user, id);
    if (!access.authorized) return res.status(access.status).send(access.error);

    try {
        const project = access.project;
        // Fetch the bundle ID first from the requested image
        const requestedImage = await prisma.image.findUnique({ where: { id: parseInt(imageId) } });

        if (!requestedImage) return res.status(404).send('Not found');

        // Fetch the full bundle (all images in this version)
        const imageBundle = await prisma.imageBundle.findUnique({
            where: { id: requestedImage.bundleId },
            include: {
                images: {
                    orderBy: { order: 'asc' },
                    include: {
                        comments: {
                            where: { parentId: null }, // Only root comments
                            include: {
                                user: true,
                                assignee: true
                            },
                            orderBy: { createdAt: 'asc' }
                        }
                    }
                }
            }
        });

        if (!imageBundle) return res.status(404).send('Bundle not found');

        // Security: Ensure bundle belongs to the authorized project
        if (imageBundle.projectId !== parseInt(id)) {
            return res.status(403).send('Access denied');
        }

        const dateFormatSetting = await prisma.systemSetting.findUnique({ where: { key: 'date_format' } });
        const dateFormat = dateFormatSetting ? dateFormatSetting.value : 'DD/MM/YYYY';
        const siteTitleSetting = await prisma.systemSetting.findUnique({ where: { key: 'site_title' } });
        const siteTitle = siteTitleSetting ? siteTitleSetting.value : 'ReView';

        const settings = { dateFormat, siteTitle };

        if (format === 'pdf') {
            // Pass the entire bundle object to generatePDF, instead of a single image
            await generatePDF(project, imageBundle, [], res, settings);
        } else {
            res.status(400).send('Invalid format');
        }
    } catch (e) {
        console.error("Export error", e);
        res.status(500).send("Export failed");
    }
});

// GET /projects/:id/3d/:threeDAssetId/export/:format
router.get('/:id/3d/:threeDAssetId/export/:format', authenticateToken, async (req, res) => {
    const { id, threeDAssetId, format } = req.params;

    if (format === 'csv') {
        return res.status(400).send('CSV export disabled for 3D assets');
    }

    // Security: Check access
    const access = await checkProjectAccess(req.user, id);
    if (!access.authorized) return res.status(access.status).send(access.error);

    try {
        const project = access.project;
        const asset = await prisma.threeDAsset.findUnique({ where: { id: parseInt(threeDAssetId) } });

        if (!asset) return res.status(404).send('Not found');

        // Security: Ensure asset belongs to the authorized project
        if (asset.projectId !== parseInt(id)) {
            return res.status(403).send('Access denied');
        }

        const comments = await prisma.comment.findMany({
            where: { threeDAssetId: parseInt(threeDAssetId) },
            include: {
                user: true,
                assignee: true
            },
            orderBy: { createdAt: 'asc' }
        });

        const dateFormatSetting = await prisma.systemSetting.findUnique({ where: { key: 'date_format' } });
        const dateFormat = dateFormatSetting ? dateFormatSetting.value : 'DD/MM/YYYY';
        const siteTitleSetting = await prisma.systemSetting.findUnique({ where: { key: 'site_title' } });
        const siteTitle = siteTitleSetting ? siteTitleSetting.value : 'ReView';

        const settings = { dateFormat, siteTitle };

        if (format === 'pdf') {
            // Treat 3D asset as video/image hybrid for export (single item with comments)
            // Passing asset as the 'mediaObject'
            await generatePDF(project, asset, comments, res, settings);
        } else {
            res.status(400).send('Invalid format');
        }
    } catch (e) {
        console.error("Export error", e);
        res.status(500).send("Export failed");
    }
});

// GET /projects/:id/videos/:videoId/export/:format
router.get('/:id/videos/:videoId/export/:format', authenticateToken, async (req, res) => {
    const { id, videoId, format } = req.params;

    // Security: Check access
    const access = await checkProjectAccess(req.user, id);
    if (!access.authorized) return res.status(access.status).send(access.error);

    try {
        const project = access.project;
        const video = await prisma.video.findUnique({ where: { id: parseInt(videoId) } });

        if (!video) return res.status(404).send('Not found');

        // Security: Ensure video belongs to the authorized project
        if (video.projectId !== parseInt(id)) {
            return res.status(403).send('Access denied');
        }

        // Fetch Metadata
        const metadata = await getVideoMetadata(video.path);
        const extendedVideo = { ...video, ...metadata };

        const comments = await prisma.comment.findMany({
            where: { videoId: parseInt(videoId) },
            include: {
                user: true,
                assignee: true
            },
            orderBy: { timestamp: 'asc' }
        });

        const dateFormatSetting = await prisma.systemSetting.findUnique({ where: { key: 'date_format' } });
        const dateFormat = dateFormatSetting ? dateFormatSetting.value : 'DD/MM/YYYY';
        const siteTitleSetting = await prisma.systemSetting.findUnique({ where: { key: 'site_title' } });
        const siteTitle = siteTitleSetting ? siteTitleSetting.value : 'ReView';

        const settings = { dateFormat, siteTitle };

        if (format === 'pdf') {
            await generatePDF(project, extendedVideo, comments, res, settings);
        } else if (format === 'csv') {
            await generateCSV(project, extendedVideo, comments, res, dateFormat);
        } else {
            res.status(400).send('Invalid format');
        }
    } catch (e) {
        console.error("Export error", e);
        res.status(500).send("Export failed");
    }
});

// PATCH /projects/:id: Update project details
router.patch('/:id', authenticateToken, upload.single('thumbnail'), async (req, res) => {
    const { name, description, status } = req.body;

    // Input Validation
    if (name !== undefined && !isValidText(name, 100)) return res.status(400).json({ error: 'Project name exceeds 100 characters' });
    if (description !== undefined && !isValidText(description, 2000)) return res.status(400).json({ error: 'Project description exceeds 2000 characters' });

    const projectId = parseInt(req.params.id);
    const thumbnailFile = req.file;

    if (thumbnailFile && !(await isValidImageFile(thumbnailFile.path))) {
        try { fs.unlinkSync(thumbnailFile.path); } catch (e) { }
        return res.status(400).json({ error: 'Invalid thumbnail file format' });
    }

    try {
        const user = req.user;

        const userTeamIds = [...user.teamMemberships.map(tm => tm.team.id), ...user.ownedTeams.map(t => t.id)];

        const project = await prisma.project.findUnique({ where: { id: projectId } });

        if (!project) return res.status(404).json({ error: 'Project not found' });

        // Access/Role Check
        if (user.role !== 'admin') {
            const isOwner = user.ownedTeams.some(t => t.id === project.teamId);
            const membership = user.teamMemberships.find(tm => tm.team.id === project.teamId);

            if (!isOwner && !membership) return res.status(403).json({ error: 'Access denied' });

            // Require ADMIN or OWNER role (or Team Owner)
            const memberRole = membership ? membership.role : null;
            if (!isOwner && memberRole !== 'OWNER' && memberRole !== 'ADMIN') {
                return res.status(403).json({ error: 'Access denied: Team Admin/Owner only' });
            }
        }

        const data = {};
        if (name !== undefined) data.name = sanitizeHtml(name);
        if (description !== undefined) data.description = sanitizeHtml(description);

        let statusChanged = false;
        if (status !== undefined) {
            data.status = status;
            if (status !== project.status) statusChanged = true;
            if (!project.clientToken) {
                data.clientToken = crypto.randomUUID();
            }
        }

        if (thumbnailFile) {
            data.thumbnailPath = thumbnailFile.filename;
            data.hasCustomThumbnail = true;
        }

        const updatedProject = await prisma.project.update({
            where: { id: projectId },
            data
        });

        // Notification: STATUS_CHANGE & Real-time Update
        if (project.teamId) { // Check teamId for updates generally
            const team = await prisma.team.findUnique({
                where: { id: project.teamId },
                include: { members: { select: { userId: true } }, owner: { select: { id: true } } }
            });

            const recipients = new Set();
            if (team) {
                recipients.add(team.ownerId); // Include owner
                team.members.forEach(m => recipients.add(m.userId));
            }

            // Real-time Update
            const io = getIo();
            recipients.forEach(userId => {
                io.to(`user_${userId}`).emit('PROJECT_UPDATE', updatedProject);
            });

            io.to(`project_${updatedProject.id}`).emit('PROJECT_UPDATE', updatedProject);

            if (statusChanged) {
                // Filter out current user for notification
                const notifyRecipients = new Set(recipients);
                notifyRecipients.delete(req.user.id);

                await createAndBroadcast(Array.from(notifyRecipients), {
                    type: 'STATUS_CHANGE',
                    content: `Status changed to ${status} for "${updatedProject.name}"`,
                    referenceId: updatedProject.id, // Using projectId as reference
                    projectId: updatedProject.id
                });

                // Discord Notification
                await notifyDiscord(project.teamId, 'STATUS_CHANGE', {
                    projectName: updatedProject.name,
                    projectSlug: updatedProject.slug,
                    status: status,
                    user: { name: user.name, avatarPath: user.avatarPath }
                });
            }
        }

        res.json(updatedProject);
    } catch (error) {
        console.error('Error updating project:', error);
        res.status(500).json({ error: 'Failed to update project' });
    }
});

// PATCH /videos/:id: Rename version
router.patch('/videos/:id', authenticateToken, async (req, res) => {
    const { versionName } = req.body;
    const videoId = parseInt(req.params.id);

    try {
        const video = await prisma.video.findUnique({
            where: { id: videoId },
            include: { project: true }
        });
        if (!video) return res.status(404).json({ error: 'Video not found' });

        const user = req.user;

        const userTeamIds = [...user.teamMemberships.map(tm => tm.team.id), ...user.ownedTeams.map(t => t.id)];

        if (user.role !== 'admin' && (!video.project.teamId || !userTeamIds.includes(video.project.teamId))) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const updatedVideo = await prisma.video.update({
            where: { id: videoId },
            data: { versionName }
        });
        res.json(updatedVideo);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to update video' });
    }
});

// PATCH /assets/:id: Update 3D asset (versionName, scale)
router.patch('/assets/:id', authenticateToken, async (req, res) => {
    const { versionName, scale } = req.body;
    const assetId = parseInt(req.params.id);

    try {
        const asset = await prisma.threeDAsset.findUnique({
            where: { id: assetId },
            include: { project: true }
        });
        if (!asset) return res.status(404).json({ error: 'Asset not found' });

        const user = req.user;

        const userTeamIds = [...user.teamMemberships.map(tm => tm.team.id), ...user.ownedTeams.map(t => t.id)];

        // Access Check: Admin, Team Member, or Project Owner (if no team)
        const isTeamMember = asset.project.teamId && userTeamIds.includes(asset.project.teamId);
        // Note: Project model doesn't store ownerId directly for personal projects usually,
        // but if it did, we'd check it.
        // Based on existing routes (DELETE /:id), we only check teamId membership or admin.
        // If the project has NO teamId, it's likely an Admin Personal Project or orphaned?
        // Let's stick to the convention used in other routes:
        if (user.role !== 'admin' && (!asset.project.teamId || !userTeamIds.includes(asset.project.teamId))) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const data = {};
        if (versionName !== undefined) data.versionName = versionName;


        const updatedAsset = await prisma.threeDAsset.update({
            where: { id: assetId },
            data
        });
        res.json(updatedAsset);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to update asset' });
    }
});

// DELETE /projects/:id: Soft Delete a project (Trash)
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const projectId = parseInt(req.params.id);
        const user = req.user;

        const userTeamIds = [...user.teamMemberships.map(tm => tm.team.id), ...user.ownedTeams.map(t => t.id)];

        const project = await prisma.project.findUnique({ where: { id: projectId } });

        if (!project) return res.status(404).json({ error: 'Project not found' });

        // Access/Role Check
        if (user.role !== 'admin') {
            const isOwner = user.ownedTeams.some(t => t.id === project.teamId);
            const membership = user.teamMemberships.find(tm => tm.team.id === project.teamId);

            if (!isOwner && !membership) return res.status(403).json({ error: 'Access denied' });

            // Require ADMIN or OWNER role (or Team Owner)
            const memberRole = membership ? membership.role : null;
            if (!isOwner && memberRole !== 'OWNER' && memberRole !== 'ADMIN') {
                return res.status(403).json({ error: 'Access denied: Team Admin/Owner only' });
            }
        }

        // Soft Delete
        await prisma.project.update({
            where: { id: projectId },
            data: { deletedAt: new Date() }
        });

        // Move assets to trash folder
        await moveProjectAssetsToTrash(projectId);

        // Real-time Update (Trash)
        if (project.teamId) {
            const team = await prisma.team.findUnique({
                where: { id: project.teamId },
                include: { members: { select: { userId: true } }, owner: { select: { id: true } } }
            });

            if (team) {
                const recipients = new Set();
                recipients.add(team.ownerId);
                team.members.forEach(m => recipients.add(m.userId));

                const io = getIo();
                recipients.forEach(userId => {
                    // Emitting PROJECT_DELETE causes frontend to remove from list and fetch trash count
                    io.to(`user_${userId}`).emit('PROJECT_DELETE', { id: projectId });
                });
            }
        } else {
            // Admin personal project
            const io = getIo();
            io.to(`user_${req.user.id}`).emit('PROJECT_DELETE', { id: projectId });
        }

        res.json({ message: 'Project moved to trash' });
    } catch (error) {
        console.error('Error deleting project:', error);
        res.status(500).json({ error: 'Failed to delete project' });
    }
});

// POST /projects/:id/restore: Restore a project from Trash
router.post('/:id/restore', authenticateToken, async (req, res) => {
    try {
        const projectId = parseInt(req.params.id);
        const user = req.user;

        const userTeamIds = [...user.teamMemberships.map(tm => tm.team.id), ...user.ownedTeams.map(t => t.id)];

        const project = await prisma.project.findUnique({ where: { id: projectId } });

        if (!project) return res.status(404).json({ error: 'Project not found' });

        if (user.role !== 'admin' && (!project.teamId || !userTeamIds.includes(project.teamId))) {
            return res.status(403).json({ error: 'Access denied' });
        }

        await prisma.project.update({
            where: { id: projectId },
            data: { deletedAt: null }
        });

        // Restore assets from trash folder
        await restoreProjectAssetsFromTrash(projectId);

        // Real-time Update (Restore)
        const restoredProject = await prisma.project.findUnique({ where: { id: projectId }, include: { team: true } });

        if (restoredProject.teamId) {
            const team = await prisma.team.findUnique({
                where: { id: restoredProject.teamId },
                include: { members: { select: { userId: true } }, owner: { select: { id: true } } }
            });

            if (team) {
                const recipients = new Set();
                recipients.add(team.ownerId);
                team.members.forEach(m => recipients.add(m.userId));

                const io = getIo();
                recipients.forEach(userId => {
                    io.to(`user_${userId}`).emit('PROJECT_RESTORE', restoredProject);
                });
            }
        } else {
            const io = getIo();
            io.to(`user_${req.user.id}`).emit('PROJECT_RESTORE', restoredProject);
        }

        res.json({ message: 'Project restored' });
    } catch (error) {
        console.error('Error restoring project:', error);
        res.status(500).json({ error: 'Failed to restore project' });
    }
});

// DELETE /projects/:id/permanent: Permanently delete a project from trash
router.delete('/:id/permanent', authenticateToken, async (req, res) => {
    try {
        const projectId = parseInt(req.params.id);
        const user = req.user;

        const userTeamIds = [...user.teamMemberships.map(tm => tm.team.id), ...user.ownedTeams.map(t => t.id)];

        const project = await prisma.project.findUnique({
            where: { id: projectId },
            include: { team: { select: { slug: true } } }
        });

        if (!project) return res.status(404).json({ error: 'Project not found' });

        // Only allow deletion of trashed projects
        if (!project.deletedAt) {
            return res.status(400).json({ error: 'Project must be in trash to permanently delete' });
        }

        if (user.role !== 'admin' && (!project.teamId || !userTeamIds.includes(project.teamId))) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Calculate storage to reclaim
        const videos = await prisma.video.findMany({ where: { projectId }, select: { size: true } });
        const assets = await prisma.threeDAsset.findMany({ where: { projectId }, select: { size: true } });
        const images = await prisma.image.findMany({
            where: { bundle: { projectId } },
            select: { size: true }
        });

        let totalSize = 0n;
        videos.forEach(v => totalSize += BigInt(v.size || 0));
        assets.forEach(a => totalSize += BigInt(a.size || 0));
        images.forEach(i => totalSize += BigInt(i.size || 0));

        // Delete trash folder from disk
        const teamSlug = project.team?.slug || 'personal';
        const trashBase = path.join(UPLOAD_DIR, 'Trash', teamSlug, project.slug);
        if (fs.existsSync(trashBase)) {
            try {
                fs.rmSync(trashBase, { recursive: true, force: true });
                console.log(`[Permanent Delete] Removed trash folder: ${trashBase}`);
            } catch (e) {
                console.error('[Permanent Delete] Failed to remove trash folder:', e);
            }
        }

        // Delete project from database (cascade deletes videos, assets, comments, etc.)
        await prisma.project.delete({ where: { id: projectId } });

        // Update storage counters
        if (totalSize > 0n) {
            await updateStorage({ userId: project.creatorId, teamId: project.teamId, deltaBytes: -Number(totalSize) });
        }

        // Real-time Update
        if (project.teamId) {
            const team = await prisma.team.findUnique({
                where: { id: project.teamId },
                include: { members: { select: { userId: true } }, owner: { select: { id: true } } }
            });

            if (team) {
                const recipients = new Set();
                recipients.add(team.ownerId);
                team.members.forEach(m => recipients.add(m.userId));

                const io = getIo();
                recipients.forEach(userId => {
                    io.to(`user_${userId}`).emit('PROJECT_PERMANENT_DELETE', { id: projectId });
                });
            }
        } else {
            const io = getIo();
            io.to(`user_${req.user.id}`).emit('PROJECT_PERMANENT_DELETE', { id: projectId });
        }

        res.json({ message: 'Project permanently deleted' });
    } catch (error) {
        console.error('Error permanently deleting project:', error);
        res.status(500).json({ error: 'Failed to permanently delete project' });
    }
});

// POST /projects/:id/thumbnail-notify: Upload deferred thumbnail and notify Discord
router.post('/:id/thumbnail-notify', authenticateToken, upload.single('thumbnail'), async (req, res) => {
    try {
        const projectId = parseInt(req.params.id);
        const thumbnailFile = req.file;

        if (!thumbnailFile) {
            return res.status(400).json({ error: 'Thumbnail file is required' });
        }

        if (isNaN(projectId)) {
            try { fs.unlinkSync(thumbnailFile.path); } catch (e) { }
            return res.status(400).json({ error: 'Invalid project ID' });
        }

        const user = req.user;

        const userTeamIds = [...user.teamMemberships.map(tm => tm.team.id), ...user.ownedTeams.map(t => t.id)];

        const project = await prisma.project.findUnique({
            where: { id: projectId },
            include: {
                team: true // Include team to get teamSlug easily if needed, though we have user teams
            }
        });

        if (!project) {
            try { fs.unlinkSync(thumbnailFile.path); } catch (e) { }
            return res.status(404).json({ error: 'Project not found' });
        }

        if (user.role !== 'admin' && (!project.teamId || !userTeamIds.includes(project.teamId))) {
            try { fs.unlinkSync(thumbnailFile.path); } catch (e) { }
            return res.status(403).json({ error: 'Access denied' });
        }

        // 1. Update Project with new thumbnail
        const updatedProject = await prisma.project.update({
            where: { id: projectId },
            data: {
                thumbnailPath: thumbnailFile.filename,
                hasCustomThumbnail: true, // It is now custom generated/set
                updatedAt: new Date()
            }
        });

        // 2. Broadcast Update
        if (project.teamId) {
            const team = await prisma.team.findUnique({
                where: { id: project.teamId },
                include: { members: { select: { userId: true } }, owner: { select: { id: true } } }
            });

            const recipients = new Set();
            if (team) {
                recipients.add(team.ownerId);
                team.members.forEach(m => recipients.add(m.userId));
            }

            const io = getIo();
            recipients.forEach(userId => {
                io.to(`user_${userId}`).emit('PROJECT_UPDATE', updatedProject);
            });
            io.to(`project_${projectId}`).emit('PROJECT_UPDATE', updatedProject);

            // 3. Send Delayed Discord Notification (PROJECT_CREATE type usually)
            // We use 'PROJECT_CREATE' because we skipped it earlier.
            // Only send if project didn't already have a thumbnail (server-side GIF generation already sent notification)
            const hadThumbnailBefore = !!project.thumbnailPath;
            if (project.team && !hadThumbnailBefore) {
                await notifyDiscord(project.teamId, 'PROJECT_CREATE', {
                    id: project.id,
                    name: project.name,
                    description: project.description,
                    thumbnailPath: thumbnailFile.filename, // New thumb
                    projectSlug: project.slug,
                    user: { name: user.name, avatarPath: user.avatarPath }
                });
            }
        }

        res.json({ message: 'Thumbnail updated and notifications sent', project: updatedProject });

    } catch (error) {
        console.error('Error in thumbnail-notify:', error);
        // Clean up if file exists and we failed
        if (req.file) {
            try { fs.unlinkSync(req.file.path); } catch (e) { }
        }
        res.status(500).json({ error: 'Failed to process thumbnail notification' });
    }
});

// DELETE /projects/:id/permanent: Permanently delete a project
router.delete('/:id/permanent', authenticateToken, async (req, res) => {
    try {
        const projectId = parseInt(req.params.id);
        const user = req.user;

        const userTeamIds = [...user.teamMemberships.map(tm => tm.team.id), ...user.ownedTeams.map(t => t.id)];

        const project = await prisma.project.findUnique({
            where: { id: projectId }
        });

        if (!project) return res.status(404).json({ error: 'Project not found' });

        if (user.role !== 'admin' && (!project.teamId || !userTeamIds.includes(project.teamId))) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Release Storage Calculation
        let teamBytesToRelease = 0;
        const filesToDelete = [];

        // 1. Videos
        const videos = await prisma.video.findMany({ where: { projectId } });
        for (const video of videos) {
            teamBytesToRelease += Number(video.size);
            if (video.path) {
                filesToDelete.push(video.path);
            }
            // If uploaderId exists, we should release user quota?
            // Currently we only enforce USER quota on comments.
            // But if we track upload, we should technically release it.
            if (video.uploaderId) {
                // await updateStorage({ userId: video.uploaderId, teamId: null, deltaBytes: -Number(video.size) });
                // Not doing this yet as we decided User Quota is mostly Comments for now.
            }
        }

        // 2. ThreeDAssets
        const assets = await prisma.threeDAsset.findMany({ where: { projectId } });
        for (const asset of assets) {
            teamBytesToRelease += Number(asset.size);
            if (asset.path) {
                filesToDelete.push(asset.path);
            }
        }

        // 3. ImageBundles / Images
        const bundles = await prisma.imageBundle.findMany({ where: { projectId }, include: { images: true } });
        for (const bundle of bundles) {
            for (const img of bundle.images) {
                teamBytesToRelease += Number(img.size);
                if (img.path) {
                    filesToDelete.push(img.path);
                }
            }
        }

        // 4. Comments (Attachments/Screenshots)
        // Note: Comment attachments DO count towards User Quota.
        // We should iterate comments to release USER quota.
        // However, finding all comments for a project is tricky:
        // Linked to video/image/asset -> easy.
        // We need to fetch all comments.

        // Fetch videos IDs, asset IDs, bundle IDs -> Image IDs.
        const videoIds = videos.map(v => v.id);
        const assetIds = assets.map(a => a.id);
        const imageIds = bundles.flatMap(b => b.images.map(i => i.id));

        const comments = await prisma.comment.findMany({
            where: {
                OR: [
                    { videoId: { in: videoIds } },
                    { threeDAssetId: { in: assetIds } },
                    { imageId: { in: imageIds } }
                ]
            }
        });

        for (const c of comments) {
            // Release User Storage
            if (c.userId && c.size > 0) {
                await updateStorage({ userId: c.userId, teamId: null, deltaBytes: -Number(c.size) });
            }
            // Also release Team Storage? Currently comments don't count towards Team Quota in our logic (only project media).
            // If they did, we'd add to teamBytesToRelease.

            // Delete files
            if (c.attachmentPaths) {
                try {
                    const paths = JSON.parse(c.attachmentPaths);
                    for (const attachPath of paths) {
                        const p = path.join(DATA_PATH, 'media', attachPath);
                        filesToDelete.push(p);
                    }
                } catch (e) { }
            }
            if (c.screenshotPath) {
                const p = path.join(DATA_PATH, 'comments', c.screenshotPath);
                filesToDelete.push(p);
            }
        }

        // Asynchronously delete all collected file paths without blocking the event loop
        await Promise.all(
            filesToDelete.map(async (filePath) => {
                try {
                    await fs.promises.unlink(filePath);
                } catch (e) {
                    // Ignore ENOENT (file not found) errors
                    if (e.code !== 'ENOENT') {
                        console.error(`Error deleting file: ${filePath}`, e);
                    }
                }
            })
        );

        // Update Team Storage
        if (project.teamId && teamBytesToRelease > 0) {
            await updateStorage({ teamId: project.teamId, deltaBytes: -teamBytesToRelease });
        }

        // Real-time Update (DELETE)
        // We need to notify team members that this project is GONE (so remove from list)
        if (project.teamId) {
            const team = await prisma.team.findUnique({
                where: { id: project.teamId },
                include: { members: { select: { id: true } }, owner: { select: { id: true } } }
            });

            if (team) {
                const recipients = new Set();
                recipients.add(team.ownerId);
                team.members.forEach(m => recipients.add(m.id));

                const io = getIo();
                recipients.forEach(userId => {
                    io.to(`user_${userId}`).emit('PROJECT_DELETE', { id: projectId });
                });
            }
        } else {
            const io = getIo();
            io.to(`user_${req.user.id}`).emit('PROJECT_DELETE', { id: projectId });
        }

        await prisma.project.delete({ where: { id: projectId } });
        res.json({ message: 'Project permanently deleted' });
    } catch (error) {
        console.error('Error deleting project:', error);
        res.status(500).json({ error: 'Failed to delete project' });
    }
});

// POST /projects/:id/mute: Mute project notifications
router.post('/:id/mute', authenticateToken, async (req, res) => {
    try {
        const projectId = parseInt(req.params.id);
        const access = await checkProjectAccess(req.user, projectId);
        if (!access.authorized) return res.status(access.status).json({ error: access.error });

        await prisma.project.update({
            where: { id: projectId },
            data: {
                mutedBy: {
                    connect: { id: req.user.id }
                }
            }
        });
        res.json({ message: 'Project muted' });
    } catch (error) {
        console.error('Error muting project:', error);
        res.status(500).json({ error: 'Failed to mute project' });
    }
});

// DELETE /projects/:id/mute: Unmute project notifications
router.delete('/:id/mute', authenticateToken, async (req, res) => {
    try {
        const projectId = parseInt(req.params.id);
        const access = await checkProjectAccess(req.user, projectId);
        if (!access.authorized) return res.status(access.status).json({ error: access.error });

        await prisma.project.update({
            where: { id: projectId },
            data: {
                mutedBy: {
                    disconnect: { id: req.user.id }
                }
            }
        });
        res.json({ message: 'Project unmuted' });
    } catch (error) {
        console.error('Error unmuting project:', error);
        res.status(500).json({ error: 'Failed to unmute project' });
    }
});

// DELETE /projects/comments/:commentId: Delete a comment
router.delete('/comments/:commentId', authenticateToken, async (req, res) => {
    const commentId = parseInt(req.params.commentId);

    try {
        const comment = await prisma.comment.findUnique({
            where: { id: commentId },
            include: {
                video: { select: { projectId: true } },
                image: { include: { bundle: { select: { projectId: true } } } },
                threeDAsset: { select: { projectId: true } }
            }
        });

        if (!comment) return res.status(404).json({ error: 'Comment not found' });

        // Determine Project ID
        let projectId = null;
        if (comment.video) projectId = comment.video.projectId;
        else if (comment.image && comment.image.bundle) projectId = comment.image.bundle.projectId;
        else if (comment.threeDAsset) projectId = comment.threeDAsset.projectId;

        // Fetch Project to check Team Owner
        let teamOwnerId = null;
        if (projectId) {
            const project = await prisma.project.findUnique({
                where: { id: projectId },
                include: { team: true }
            });
            if (project && project.team) {
                teamOwnerId = project.team.ownerId;
            }
        }

        // Authorization Logic
        const isAuthor = comment.userId === req.user.id;
        const isAdmin = req.user.role === 'admin';
        const isTeamOwner = teamOwnerId && teamOwnerId === req.user.id;

        if (!isAuthor && !isAdmin && !isTeamOwner) {
            return res.status(403).json({ error: 'Access denied' });
        }

        await prisma.comment.delete({ where: { id: commentId } });
        res.json({ message: 'Comment deleted successfully' });
    } catch (error) {
        console.error('Error deleting comment:', error);
        res.status(500).json({ error: 'Failed to delete comment' });
    }
});

module.exports = router;
