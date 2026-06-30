const express = require('express');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { checkProjectAccess } = require('./utils/authCheck');
const { JWT_SECRET } = require('./middleware');

const router = express.Router();
const prisma = new PrismaClient();

// Resolve to an ABSOLUTE path: res.sendFile() rejects relative paths
// ("path must be absolute or specify root"), which would 500 every media
// request when DATA_PATH is configured relatively (e.g. "./storage").
const DATA_PATH = path.resolve(process.env.DATA_PATH || path.join(__dirname, 'storage'));

// Helper to verify token from Header OR Query
const verifyAuth = (req) => {
    let token = req.headers['authorization']?.split(' ')[1]; // Bearer <token>
    if (!token && req.query.token) {
        token = req.query.token;
    }

    if (!token) return null;

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        return decoded; // { id, email, role, ... }
    } catch (err) {
        return null;
    }
};

// Use Regex to match everything including slashes
router.get(/(.*)/, async (req, res) => {
    try {
        const filePath = req.params[0]; // Captured by regex group
        if (!filePath) return res.status(400).json({ error: 'File path required' });

        // 1. Allow Public Routes (Avatars, System)
        // These are usually handled by specific express.static routes in server.js BEFORE this wildcard,
        // but if this catches them, we allow them or let express continue?
        // In server.js we will keep avatars/system as static routes.
        // But if they fall through here, we should double check.
        if (filePath.startsWith('avatars/') || filePath.startsWith('system/')) {
            // Serve directly if it exists
            const fullPath = path.join(DATA_PATH, filePath.startsWith('media/') ? '' : 'media', filePath);
            if (fs.existsSync(fullPath)) {
                return res.sendFile(fullPath);
            }
            return res.sendStatus(404);
        }

        // 2. Authenticate
        const userPayload = verifyAuth(req);
        if (!userPayload) {
            return res.status(401).json({ error: 'Unauthorized', code: 'TOKEN_REQUIRED' });
        }

        // 3. Parse Path to identify Project
        // Expected structure: TeamSlug/ProjectSlug/Filename (e.g., "my-team/project-alpha/video.mp4")
        // OR "admin/project-beta/video.mp4"
        const cleanPath = filePath.replace(/^\/+/, ''); // Remove leading slashes
        const parts = cleanPath.split('/');

        // Sanity check on path traversal
        if (filePath.includes('..')) return res.status(400).json({ error: 'Invalid path' });

        // If path doesn't look like Team/Project/File, we might be dealing with legacy or flat structure.
        // But all new projects follow structure.
        // If we can't identify project from path, we have to look it up in DB by 'path' or 'filename'.
        // This is safer/more robust than assuming URL structure matches exactly.

        // Strategy: Lookup asset by path
        // The path in DB for threeDAsset/Video/Image is typically relative, e.g. "team-slug/project-slug/file.ext"

        let authorized = false;

        // Try to find matching asset
        // We check Video, Image (via Bundle?), ThreeDAsset.
        // Note: ImageBundle stores images in Image table. 

        // This search could be expensive. 
        // OPTIMIZATION: Try to infer from path first.
        if (parts.length >= 2) {
            const teamSlug = parts[0];
            const projectSlug = parts[1];

            // If it matches Team/Project structure
            if (teamSlug && projectSlug) {
                // Find Project
                // Case A: Team Project
                let project = null;

                if (teamSlug === 'admin') {
                    // Admin personal project (null teamId)
                    // Re-verify if 'admin' folder is used for admin projects
                    project = await prisma.project.findFirst({
                        where: {
                            slug: projectSlug,
                            teamId: null
                        }
                    });
                } else {
                    // Team Project
                    project = await prisma.project.findFirst({
                        where: {
                            slug: projectSlug,
                            team: { slug: teamSlug }
                        }
                    });
                }

                if (project) {
                    const access = await checkProjectAccess(userPayload.id, project.id);
                    if (access.authorized) {
                        authorized = true;
                    }
                }
            }
        }

        // If structure didn't match or project not found (e.g. file moved or weird path), 
        // Fallback: Exact DB match (slower but covers edge cases)
        if (!authorized) {
            // Check valid path against DB is hard because we don't know the table.
            // We return 403 if we couldn't match strict Team/Project structure.
            // Security First: Default Deny.
            // If the file is orphaned or follows non-standard path, it won't be accessible.
            return res.status(403).json({ error: 'Access Denied or Asset not recognized' });
        }

        // 4. Serve File
        // The middleware `express.static` served from `DATA_PATH/media`.
        // So we join `DATA_PATH` + `media` + `filePath`

        // Wait, DATA_PATH points to `storage`. `media` is subdir.
        const absolutePath = path.join(DATA_PATH, 'media', filePath);

        if (!fs.existsSync(absolutePath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Security: Prevent MIME Sniffing XSS
        res.setHeader('X-Content-Type-Options', 'nosniff');

        // Optional: Force download for dangerous types if we can't guarantee safety?
        // But we need to display images/videos in browser.
        // CSP in server.js handles script execution prevention.

        res.sendFile(absolutePath);

    } catch (error) {
        console.error('Media Serve Error:', error);
        res.sendStatus(500);
    }
});

module.exports = router;
