const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const { isValidText, isValidImageBuffer, isValidImageFile } = require('./utils/validation');
const { rateLimit } = require('./utils/rateLimiter');
const { sanitizeHtml } = require('./utils/security');

const router = express.Router();
const prisma = new PrismaClient();

const DATA_PATH = process.env.DATA_PATH || path.join(__dirname, 'storage');
const UPLOAD_DIR = path.join(DATA_PATH, 'media');

if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = crypto.randomUUID();
        const ext = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '');
        cb(null, uniqueSuffix + ext);
    }
});

const commentUpload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB for file attachments
        fieldSize: 20 * 1024 * 1024  // 20MB for field values (annotations, screenshots in base64)
    }
});

// GET /api/client/projects/:token
// Public endpoint to fetch project data
router.get('/projects/:token', async (req, res) => {
    const { token } = req.params;

    try {
        const project = await prisma.project.findUnique({
            where: { clientToken: token },
            include: {
                videos: {
                    where: { published: true },
                    include: {
                        // Include comments, but we will filter them in code
                        comments: {
                            where: { parentId: null }, // Only fetch root comments
                            include: {
                                user: { select: { id: true, name: true } },
                                replies: {
                                    include: {
                                        user: { select: { id: true, name: true } }
                                    }
                                }
                            },
                            orderBy: { timestamp: 'asc' }
                        }
                    },
                    orderBy: { createdAt: 'desc' }
                },
                imageBundles: {
                    where: { published: true },
                    include: {
                        images: {
                            orderBy: { order: 'asc' },
                            include: {
                                comments: {
                                    where: { parentId: null },
                                    include: {
                                        user: { select: { id: true, name: true } },
                                        replies: {
                                            include: {
                                                user: { select: { id: true, name: true } }
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
                    where: { published: true },
                    include: {
                        comments: {
                            where: { parentId: null },
                            include: {
                                user: { select: { id: true, name: true } },
                                replies: {
                                    include: {
                                        user: { select: { id: true, name: true } }
                                    }
                                }
                            },
                            orderBy: { createdAt: 'desc' }
                        }
                    }
                }
            }
        });

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        if (project.status === 'INTERNAL_REVIEW') {
            return res.status(403).json({ error: 'Review not started', status: 'INTERNAL_REVIEW' });
        }

        // Filter comments based on visibility
        // Client can see:
        // 1. Comments where isVisibleToClient is true
        // 2. Comments where guestName is present (their own/other guests)
        // 3. Actually, guest comments should implicitly be visible.

        const filterComments = (comments) => {
            return comments.filter(c => c.isVisibleToClient || c.guestName).map(c => {
                if (c.replies) {
                    c.replies = filterComments(c.replies);
                }
                return c;
            });
        };

        if (project.videos) {
            project.videos.forEach(video => {
                video.comments = filterComments(video.comments);
            });
        }

        if (project.imageBundles) {
            project.imageBundles.forEach(bundle => {
                if (bundle.images) {
                    bundle.images.forEach(image => {
                        image.comments = filterComments(image.comments);
                    });
                }
            });
        }

        if (project.threeDAssets) {
            project.threeDAssets.forEach(asset => {
                asset.comments = filterComments(asset.comments);
            });
        }

        res.json(project);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch project' });
    }
});

// Rate limit for guest comments: 30 comments per 5 minutes per IP
const commentLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 30,
    message: { error: 'You are posting comments too fast. Please wait a moment.' }
});

// POST /api/client/projects/:token/comments
// Public endpoint for guest comments
// Accept both 'attachment' (single, legacy) and 'attachments' (multiple, new)
router.post('/projects/:token/comments', commentLimiter, commentUpload.fields([
    { name: 'attachment', maxCount: 1 },
    { name: 'attachments', maxCount: 10 }
]), async (req, res) => {
    const { token } = req.params;
    const { content, timestamp, annotation, guestName, videoId, imageId, threeDAssetId, parentId, cameraState, hotspots, screenshot } = req.body;

    // Combine attachment files from both field names
    const attachmentFiles = [
        ...(req.files?.attachment || []),
        ...(req.files?.attachments || [])
    ];

    const cleanupFiles = () => attachmentFiles.forEach(f => { try { fs.unlinkSync(f.path); } catch (e) { } });

    if (!guestName) {
        cleanupFiles();
        return res.status(400).json({ error: 'Guest name is required' });
    }

    // Security: Input Validation
    if (!isValidText(content, 5000)) {
        cleanupFiles();
        return res.status(400).json({ error: 'Comment content exceeds 5000 characters' });
    }
    if (!isValidText(guestName, 100)) {
        cleanupFiles();
        return res.status(400).json({ error: 'Guest name exceeds 100 characters' });
    }

    // Validate attachments (max 10 files, 5MB each)
    let attachmentPaths = [];
    for (const attachmentFile of attachmentFiles) {
        if (attachmentFile.size > 5 * 1024 * 1024) {
            cleanupFiles();
            return res.status(400).json({ error: 'Each attachment must be under 5MB' });
        }
        const attExt = await isValidImageFile(attachmentFile.path);
        if (!attExt) {
            cleanupFiles();
            return res.status(400).json({ error: 'Invalid attachment file format' });
        }

        // Enforce extension
        const newPath = attachmentFile.path.replace(path.extname(attachmentFile.path), attExt);
        if (newPath !== attachmentFile.path) {
            fs.renameSync(attachmentFile.path, newPath);
            attachmentFile.path = newPath;
            attachmentFile.filename = path.basename(newPath);
        }

        attachmentPaths.push(attachmentFile.filename);
    }

    try {
        const project = await prisma.project.findUnique({
            where: { clientToken: token },
        });

        if (!project) {
            cleanupFiles();
            return res.status(404).json({ error: 'Project not found' });
        }

        if (project.status !== 'CLIENT_REVIEW' && project.status !== 'ALL_REVIEWS_DONE') {
            cleanupFiles();
            return res.status(403).json({ error: 'Reviews are not active for this project' });
        }

        if (project.status === 'ALL_REVIEWS_DONE') {
            cleanupFiles();
            return res.status(403).json({ error: 'Reviews are closed for this project' });
        }

        // Verify asset belongs to project
        let assetFound = false;
        if (videoId) {
            const video = await prisma.video.findFirst({ where: { id: parseInt(videoId), projectId: project.id } });
            if (video) assetFound = true;
        } else if (imageId) {
            const img = await prisma.image.findUnique({ where: { id: parseInt(imageId) }, include: { bundle: true } });
            if (img && img.bundle.projectId === project.id) assetFound = true;
        } else if (threeDAssetId) {
            const asset = await prisma.threeDAsset.findFirst({ where: { id: parseInt(threeDAssetId), projectId: project.id } });
            if (asset) assetFound = true;
        }

        if (!assetFound) {
            cleanupFiles();
            return res.status(404).json({ error: 'Asset not found or does not belong to this project' });
        }

        let screenshotPath = null;
        if (screenshot) {
            const matches = screenshot.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
                const buffer = Buffer.from(matches[2], 'base64');

                if (buffer.length > 5 * 1024 * 1024) {
                    cleanupFiles();
                    return res.status(400).json({ error: 'Screenshot too large (max 5MB)' });
                }

                if (!isValidImageBuffer(buffer)) {
                    cleanupFiles();
                    return res.status(400).json({ error: 'Invalid screenshot file format' });
                }

                const filename = `shot-${crypto.randomUUID()}.jpg`;
                const filepath = path.join(DATA_PATH, 'comments', filename);
                if (!fs.existsSync(path.dirname(filepath))) fs.mkdirSync(path.dirname(filepath), { recursive: true });
                fs.writeFileSync(filepath, buffer);
                screenshotPath = filename;
            }
        }

        const data = {
            content: sanitizeHtml(content),
            timestamp: parseFloat(timestamp),
            annotation: annotation ? (typeof annotation === 'string' ? annotation : JSON.stringify(annotation)) : null,
            guestName: sanitizeHtml(guestName),
            isVisibleToClient: true,
            parentId: parentId ? parseInt(parentId) : null,
            cameraState: cameraState ? (typeof cameraState === 'string' ? cameraState : JSON.stringify(cameraState)) : null,
            hotspots: hotspots ? (typeof hotspots === 'string' ? hotspots : JSON.stringify(hotspots)) : null,
            screenshotPath,
            attachmentPaths: attachmentPaths.length > 0 ? JSON.stringify(attachmentPaths) : null
        };

        if (videoId) data.videoId = parseInt(videoId);
        if (imageId) data.imageId = parseInt(imageId);
        if (threeDAssetId) data.threeDAssetId = parseInt(threeDAssetId);

        const comment = await prisma.comment.create({
            data,
            include: {
                user: { select: { id: true, name: true } },
                replies: {
                    include: { user: { select: { id: true, name: true } } }
                }
            }
        });

        res.json(comment);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to post comment' });
    }
});

// DELETE /api/client/projects/:token/comments/:commentId
// Guest comment deletion
router.delete('/projects/:token/comments/:commentId', async (req, res) => {
    const { token, commentId } = req.params;
    const { guestName } = req.body;

    if (!guestName) return res.status(400).json({ error: 'Guest name is required for verification' });

    try {
        const project = await prisma.project.findUnique({
            where: { clientToken: token }
        });

        if (!project) return res.status(404).json({ error: 'Project not found' });

        // Check if reviews are active
        if (project.status === 'INTERNAL_REVIEW') return res.status(403).json({ error: 'Review not active' });
        // NOTE: We might allow deletion even if status is ALL_REVIEWS_DONE? usually no, read-only.
        if (project.status === 'ALL_REVIEWS_DONE') return res.status(403).json({ error: 'Project is read-only' });

        const comment = await prisma.comment.findUnique({
            where: { id: parseInt(commentId) },
            include: {
                video: { select: { projectId: true } },
                image: { include: { bundle: { select: { projectId: true } } } },
                threeDAsset: { select: { projectId: true } }
            }
        });

        if (!comment) return res.status(404).json({ error: 'Comment not found' });

        if (comment.guestName !== guestName) {
            return res.status(403).json({ error: 'You can only delete your own comments' });
        }

        // Fix IDOR: Ensure comment actually belongs to this project
        let commentProjectId = null;
        if (comment.video) commentProjectId = comment.video.projectId;
        else if (comment.image && comment.image.bundle) commentProjectId = comment.image.bundle.projectId;
        else if (comment.threeDAsset) commentProjectId = comment.threeDAsset.projectId;

        if (commentProjectId !== project.id) {
            // Return 404 to avoid leaking existence of other comments
            return res.status(404).json({ error: 'Comment not found in this project' });
        }

        await prisma.comment.delete({ where: { id: parseInt(commentId) } });
        res.json({ message: 'Comment deleted' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete comment' });
    }
});

// PATCH /api/client/projects/:token/comments/:commentId
// Guest comment editing
router.patch('/projects/:token/comments/:commentId', async (req, res) => {
    const { token, commentId } = req.params;
    const { guestName, content, annotation } = req.body;

    if (!guestName) return res.status(400).json({ error: 'Guest name is required for verification' });
    if (!content && annotation === undefined) return res.status(400).json({ error: 'Content or annotation is required' });

    // Validate content length if provided
    if (content && !isValidText(content, 5000)) {
        return res.status(400).json({ error: 'Comment content exceeds 5000 characters' });
    }

    // Validate annotation if provided
    if (annotation !== undefined && annotation !== null) {
        try {
            if (typeof annotation === 'string') {
                JSON.parse(annotation);
            }
        } catch (e) {
            return res.status(400).json({ error: 'Invalid annotation format' });
        }
    }

    try {
        const project = await prisma.project.findUnique({
            where: { clientToken: token }
        });

        if (!project) return res.status(404).json({ error: 'Project not found' });

        // Check if reviews are active
        if (project.status === 'INTERNAL_REVIEW') return res.status(403).json({ error: 'Review not active' });
        if (project.status === 'ALL_REVIEWS_DONE') return res.status(403).json({ error: 'Project is read-only' });

        const comment = await prisma.comment.findUnique({
            where: { id: parseInt(commentId) },
            include: {
                video: { select: { projectId: true } },
                image: { include: { bundle: { select: { projectId: true } } } },
                threeDAsset: { select: { projectId: true } },
                user: { select: { id: true, name: true } },
                replies: {
                    include: {
                        user: { select: { id: true, name: true } }
                    }
                }
            }
        });

        if (!comment) return res.status(404).json({ error: 'Comment not found' });

        // Verify ownership
        if (comment.guestName !== guestName) {
            return res.status(403).json({ error: 'You can only edit your own comments' });
        }

        // Verify comment belongs to this project
        let commentProjectId = null;
        if (comment.video) commentProjectId = comment.video.projectId;
        else if (comment.image && comment.image.bundle) commentProjectId = comment.image.bundle.projectId;
        else if (comment.threeDAsset) commentProjectId = comment.threeDAsset.projectId;

        if (commentProjectId !== project.id) {
            return res.status(404).json({ error: 'Comment not found in this project' });
        }

        // Build update data
        const updateData = { isEdited: true };
        if (content !== undefined) updateData.content = sanitizeHtml(content);
        if (annotation !== undefined) {
            updateData.annotation = annotation ? (typeof annotation === 'string' ? annotation : JSON.stringify(annotation)) : null;
        }

        // Update comment
        const updatedComment = await prisma.comment.update({
            where: { id: parseInt(commentId) },
            data: updateData,
            include: {
                user: { select: { id: true, name: true } },
                replies: {
                    include: {
                        user: { select: { id: true, name: true } }
                    }
                }
            }
        });

        res.json(updatedComment);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update comment' });
    }
});

module.exports = router;
