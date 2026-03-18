const express = require('express');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken, requireAdmin } = require('./middleware');
const { sendEmail } = require('./services/emailService');
const { isValidEmail, isValidText, isValidPassword } = require('./utils/validation');
const { sanitizeHtml } = require('./utils/security');

const router = express.Router();
const prisma = new PrismaClient();

const { sendDigestEmail, getPublicUrl } = require('./services/emailBatchService');

// Send Test Email
router.post('/mail/test', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { email, type } = req.body;

        if (email && !isValidEmail(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        const targetEmail = email || req.user.email;
        const targetUser = { email: targetEmail, name: 'Admin User' };

        if (type && type !== 'SIMPLE') {
            let payload = {};

            switch (type) {
                case 'COMMENT':
                    payload = {
                        projectName: 'Test Project',
                        projectSlug: 'test-project',
                        teamSlug: 'test-team',
                        content: 'This is a test comment notification.',
                        user: { name: 'Test User' },
                        id: 123,
                        image: 'logo_full.png' // Added for testing image placement
                    };
                    break;
                case 'MENTION':
                    payload = {
                        projectName: 'Test Project',
                        projectSlug: 'test-project',
                        teamSlug: 'test-team',
                        content: 'Hey @Admin, check this out!',
                        user: { name: 'Colleague' },
                        id: 124
                    };
                    break;
                case 'PROJECT_CREATE':
                    payload = {
                        projectName: 'New Awesome Project',
                        name: 'New Awesome Project',
                        slug: 'new-awesome-project',
                        teamSlug: 'test-team'
                    };
                    break;
                case 'VIDEO_VERSION':
                    payload = {
                        projectName: 'Test Project',
                        projectSlug: 'test-project',
                        teamSlug: 'test-team',
                        versionName: 'V05'
                    };
                    break;
                case 'STATUS_CHANGE':
                    payload = {
                        projectName: 'Test Project',
                        projectSlug: 'test-project',
                        teamSlug: 'test-team',
                        status: 'Approved'
                    };
                    break;
                case 'TEAM_ADD':
                    payload = {
                        teamName: 'Design Team'
                    };
                    break;
                default:
                    payload = { content: 'Test Event Content' };
            }

            const item = {
                type: type,
                payload: JSON.stringify(payload),
                createdAt: new Date().toISOString()
            };

            const publicUrl = await getPublicUrl();
            // sendDigestEmail expects user object with email, array of items, and publicUrl
            await sendDigestEmail(targetUser, [item], publicUrl);

            return res.json({ message: `Test email (${type}) sent successfully` });
        }

        const success = await sendEmail(
            targetEmail,
            'ReView - Test Email',
            'This is a test email from your ReView instance. If you are reading this, your SMTP configuration is correct.'
        );

        if (success) {
            res.json({ message: 'Test email sent successfully' });
        } else {
            res.status(500).json({ error: 'Failed to send test email. Check server logs.' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Send Broadcast/Announcement
router.post('/mail/broadcast', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { subject, message } = req.body;

        if (!subject || !message) {
            return res.status(400).json({ error: 'Subject and message are required' });
        }

        const users = await prisma.user.findMany({
            select: { email: true }
        });

        let sentCount = 0;
        let failCount = 0;

        // Batch processing to avoid rate limits
        const BATCH_SIZE = 20;
        for (let i = 0; i < users.length; i += BATCH_SIZE) {
            const batch = users.slice(i, i + BATCH_SIZE);
            const batchPromises = batch.map(async (user) => {
                if (user.email) {
                    const result = await sendEmail(user.email, subject, message);
                    if (result) sentCount++;
                    else failCount++;
                }
            });
            await Promise.all(batchPromises);

            // Small delay between batches if not the last batch
            if (i + BATCH_SIZE < users.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        res.json({
            message: 'Broadcast complete',
            stats: { sent: sentCount, failed: failCount, total: users.length }
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                createdAt: true,
                storageUsed: true,
                storageLimit: true,
                teamMemberships: { select: { team: { select: { id: true, name: true } } } },
                ownedTeams: { select: { id: true, name: true } }
            }
        });

        // Map to expected format (flat teams array)
        const formattedUsers = users.map(user => ({
            ...user,
            teams: user.teamMemberships.map(tm => tm.team),
            teamMemberships: undefined // Remove intermediate field
        }));

        res.json(formattedUsers);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// GET /api/admin/teams - List all teams with storage info
router.get('/teams', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const teams = await prisma.team.findMany({
            include: {
                owner: { select: { id: true, name: true, email: true } },
                _count: { select: { members: true } }
            }
        });
        res.json(teams);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch teams' });
    }
});

// PATCH /api/admin/teams/:id - Update team (specifically storageLimit)
router.patch('/teams/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { storageLimit } = req.body;

        const data = {};
        // Allow setting limit to null (to use system default) or a number
        if (storageLimit !== undefined) {
            data.storageLimit = storageLimit === null ? null : BigInt(storageLimit);
        }

        const team = await prisma.team.update({
            where: { id },
            data,
            include: {
                owner: { select: { id: true, name: true } },
                _count: { select: { members: true } }
            }
        });
        res.json(team);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to update team' });
    }
});

router.delete('/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (id === req.user.id) {
            return res.status(400).json({ error: 'Cannot delete yourself' });
        }
        await prisma.user.delete({ where: { id } });
        res.json({ message: 'User deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

// PATCH /api/admin/users/:id
router.patch('/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { name, email, role, password, storageLimit } = req.body;

        const data = {};
        if (name) {
            if (!isValidText(name, 100)) return res.status(400).json({ error: 'Invalid name' });
            data.name = sanitizeHtml(name);
        }
        if (email) {
            if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email' });
            data.email = email;
        }
        if (role) {
            if (!['user', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
            // Prevent stripping own admin status if you are the only admin (optional safety, but good to have)
            if (id === req.user.id && role !== 'admin') {
                return res.status(400).json({ error: 'Cannot remove your own admin status' });
            }
            data.role = role;
        }
        if (password) {
            if (!isValidPassword(password)) return res.status(400).json({ error: 'Invalid password format' });
            data.password = await bcrypt.hash(password, 10);
        }
        if (storageLimit !== undefined) {
            data.storageLimit = storageLimit === null ? null : BigInt(storageLimit);
        }

        const user = await prisma.user.update({
            where: { id },
            data,
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                storageUsed: true,
                storageLimit: true,
                teamMemberships: { select: { team: { select: { id: true, name: true } } } },
                ownedTeams: { select: { id: true, name: true } }
            }
        });

        const formattedUser = {
            ...user,
            teams: user.teamMemberships.map(tm => tm.team),
            teamMemberships: undefined
        };

        res.json(formattedUser);
    } catch (error) {
        console.error(error);
        if (error.code === 'P2002') return res.status(400).json({ error: 'Email already in use' });
        res.status(500).json({ error: 'Failed to update user' });
    }
});

// POST /api/admin/storage/recalculate - Manually recalculate storage usage for all users and teams
router.post('/storage/recalculate', authenticateToken, requireAdmin, async (req, res) => {
    try {
        // Reset all storage counters
        await prisma.user.updateMany({ data: { storageUsed: 0 } });
        await prisma.team.updateMany({ data: { storageUsed: 0 } });

        const userStorage = {};
        const teamStorage = {};

        const addToUser = (userId, size) => {
            if (!userId) return;
            userStorage[userId] = (userStorage[userId] || 0n) + BigInt(size);
        };

        const addToTeam = (teamId, size) => {
            if (!teamId) return;
            teamStorage[teamId] = (teamStorage[teamId] || 0n) + BigInt(size);
        };

        // 1. Videos
        const videos = await prisma.video.findMany({
            select: { size: true, uploaderId: true, project: { select: { teamId: true } } }
        });
        videos.forEach(v => {
            addToUser(v.uploaderId, v.size);
            if (v.project && v.project.teamId) addToTeam(v.project.teamId, v.size);
        });

        // 2. ThreeDAssets
        const threeDAssets = await prisma.threeDAsset.findMany({
            select: { size: true, uploaderId: true, project: { select: { teamId: true } } }
        });
        threeDAssets.forEach(a => {
            addToUser(a.uploaderId, a.size);
            if (a.project && a.project.teamId) addToTeam(a.project.teamId, a.size);
        });

        // 3. Images
        const images = await prisma.image.findMany({
            select: {
                size: true,
                bundle: {
                    select: {
                        uploaderId: true,
                        project: { select: { teamId: true } }
                    }
                }
            }
        });
        images.forEach(img => {
            if (img.bundle) {
                addToUser(img.bundle.uploaderId, img.size);
                if (img.bundle.project && img.bundle.project.teamId) {
                    addToTeam(img.bundle.project.teamId, img.size);
                }
            }
        });

        // 4. Comments (Attachments + Screenshots)
        const comments = await prisma.comment.findMany({
            select: {
                size: true,
                userId: true, // Comment author
                video: { select: { project: { select: { teamId: true } } } },
                image: { select: { bundle: { select: { project: { select: { teamId: true } } } } } },
                threeDAsset: { select: { project: { select: { teamId: true } } } }
            }
        });
        comments.forEach(c => {
            addToUser(c.userId, c.size);

            let teamId = null;
            if (c.video?.project?.teamId) teamId = c.video.project.teamId;
            else if (c.image?.bundle?.project?.teamId) teamId = c.image.bundle.project.teamId;
            else if (c.threeDAsset?.project?.teamId) teamId = c.threeDAsset.project.teamId;

            if (teamId) addToTeam(teamId, c.size);
        });

        // Create an array of update promises for all users
        const userUpdates = Object.entries(userStorage).map(([userId, size]) =>
            prisma.user.update({
                where: { id: parseInt(userId) },
                data: { storageUsed: size }
            })
        );

        // Create an array of update promises for all teams
        const teamUpdates = Object.entries(teamStorage).map(([teamId, size]) =>
            prisma.team.update({
                where: { id: parseInt(teamId) },
                data: { storageUsed: size }
            })
        );

        // Execute all updates efficiently in a single database transaction
        // This solves the N+1 query performance issue while maintaining safety and ORM compatibility
        await prisma.$transaction([...userUpdates, ...teamUpdates]);

        res.json({ message: 'Storage recalculation completed' });
    } catch (error) {
        console.error('Recalculate error:', error);
        res.status(500).json({ error: 'Failed to recalculate storage' });
    }
});

// GET /api/admin/system/settings
router.get('/system/settings', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const settings = await prisma.systemSetting.findMany();
        const formatted = {};
        settings.forEach(s => formatted[s.key] = s.value);
        res.json(formatted);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch settings' });
    }
});

// PATCH /api/admin/system/settings
router.patch('/system/settings', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const updates = req.body;
        // Create an array of operations for a single transaction
        const operations = Object.entries(updates).map(([key, value]) => {
            return prisma.systemSetting.upsert({
                where: { key },
                update: { value: String(value) },
                create: { key, value: String(value) }
            });
        });

        // Execute all upserts in a transaction
        await prisma.$transaction(operations);

        res.json({ message: 'Settings updated' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

module.exports = router;
