const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { generateDigestVideo, buildDigestItems } = require('./digestVideoService');
const { generateCompositeImage } = require('./digestImageService');
const prisma = new PrismaClient();

const DATA_PATH = process.env.DATA_PATH || path.join(__dirname, '../storage');

// Lock to prevent concurrent digest processing per team
const processingTeams = new Set();

// Helper to get Public URL
async function getPublicUrl() {
    const setting = await prisma.systemSetting.findUnique({ where: { key: 'public_url' } });
    return setting ? setting.value.replace(/\/$/, '') : 'http://localhost:3000'; // Default fallback
}

// Helper to resolve file path
function getFilePath(relativePath, type = 'media') {
    if (!relativePath) return null;
    if (type === 'comment') return path.join(DATA_PATH, 'comments', relativePath);
    if (type === 'media') return path.join(DATA_PATH, 'media', relativePath);
    if (type === 'thumbnail') return path.join(DATA_PATH, 'thumbnails', relativePath);
    return null;
}

// 1. Send Immediately
async function sendToDiscord(webhookUrl, payload, files = [], botName = null, botAvatar = null) {
    if (!webhookUrl) return;

    try {
        const formData = new FormData();

        // Override Bot Name/Avatar
        if (botName) payload.username = botName;
        if (botAvatar) payload.avatar_url = botAvatar;

        // If files exist, we must use multipart/form-data
        if (files.length > 0) {
            // Discord expects 'payload_json' field for the JSON body when using multipart
            formData.append('payload_json', JSON.stringify(payload));

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                if (fs.existsSync(file.path)) {
                    formData.append(`files[${i}]`, fs.createReadStream(file.path), {
                        filename: file.name
                    });
                }
            }
        } else {
            // Standard JSON request
            return await axios.post(webhookUrl, payload);
        }

        return await axios.post(webhookUrl, formData, {
            headers: formData.getHeaders()
        });
    } catch (error) {
        console.error('Discord Webhook Error:', error.response ? error.response.data : error.message);
        // Don't throw, just log. We don't want to break the app flow.
    }
}

// 2. Queue Logic
async function addToQueue(teamId, type, data) {
    await prisma.discordQueue.create({
        data: {
            teamId,
            type,
            payload: JSON.stringify(data)
        }
    });
}

// 3. Main Notify Function - now supports multiple Discord channels
async function notifyDiscord(teamId, eventType, data, options = {}) {
    if (!teamId) return;

    const team = await prisma.team.findUnique({
        where: { id: teamId },
        include: {
            roles: true,
            discordChannels: {
                include: {
                    teamRoles: true
                }
            }
        }
    });
    if (!team) return;

    // Get channels to notify
    const channelsToNotify = await getChannelsToNotify(team, data, options);

    // If no channels and no main webhook, exit
    if (channelsToNotify.length === 0 && !team.discordWebhookUrl) return;

    // If no custom channels, use main webhook
    if (channelsToNotify.length === 0 && team.discordWebhookUrl) {
        channelsToNotify.push({
            webhookUrl: team.discordWebhookUrl,
            botName: team.discordBotName,
            botAvatar: team.discordBotAvatar,
            timing: team.discordTiming || 'REALTIME',
            notificationMode: 'VIDEO', // Default for main webhook
            burnAnnotations: team.discordBurnAnnotations
        });
    }

    // Process each channel
    for (const channel of channelsToNotify) {
        const timing = channel.timing || team.discordTiming || 'REALTIME';

        // MAJOR Logic: Only notify major events
        if (timing === 'MAJOR') {
            const majorEvents = ['STATUS_CHANGE', 'VIDEO_VERSION', 'PROJECT_CREATE'];
            if (!majorEvents.includes(eventType)) continue;
            await processInstantNotification(team, channel, eventType, data);
            continue;
        }

        // HYBRID Logic
        if (timing === 'HYBRID') {
            const instantEvents = ['MENTION', 'STATUS_CHANGE', 'VIDEO_VERSION', 'PROJECT_CREATE'];
            if (instantEvents.includes(eventType)) {
                await processInstantNotification(team, channel, eventType, data);
            } else {
                // Queue everything else (Comments)
                await addToQueue(team.id, eventType, { ...data, channelId: channel.id });
            }
            continue;
        }

        // GROUPED / HOURLY Logic
        if (timing === 'GROUPED' || timing === 'HOURLY') {
            await addToQueue(team.id, eventType, { ...data, channelId: channel.id });
            continue;
        }

        // REALTIME (Default)
        await processInstantNotification(team, channel, eventType, data);
    }
}

// Get channels to notify based on project/role association
async function getChannelsToNotify(team, data, options) {
    const channels = [];

    // If project has explicit channel assignments, use those
    if (data.projectId) {
        const projectChannels = await prisma.projectDiscordChannel.findMany({
            where: { projectId: data.projectId },
            include: { channel: { include: { teamRoles: true } } }
        });

        if (projectChannels.length > 0) {
            for (const pc of projectChannels) {
                channels.push({
                    id: pc.channel.id,
                    webhookUrl: pc.channel.webhookUrl,
                    botName: pc.channel.botName || team.discordBotName,
                    botAvatar: pc.channel.botAvatar || team.discordBotAvatar,
                    timing: pc.channel.timing || team.discordTiming,
                    notificationMode: pc.channel.notificationMode || 'VIDEO',
                    burnAnnotations: pc.channel.burnAnnotations ?? team.discordBurnAnnotations
                });
            }
            return channels;
        }
    }

    // Role-based filtering
    let projectRoleIds = [];
    if (data.projectId) {
        // Fetch project roles
        const project = await prisma.project.findUnique({
            where: { id: data.projectId },
            include: { roles: true }
        });
        if (project && project.roles) {
            projectRoleIds = project.roles.map(r => r.id);
        }
    }

    // Mention-based filtering (Bypass Logic)
    let mentionedRoleIds = [];
    if (data && data.content && team && Array.isArray(team.roles)) {
        team.roles.forEach(role => {
            if (role && role.name && data.content.includes(`@${role.name}`)) {
                mentionedRoleIds.push(role.id);
            }
        });
    }

    // Otherwise, check team channels with role filtering
    for (const channel of team.discordChannels || []) {
        // If channel has no role filter, it receives all notifications (Global Channel)
        if (!channel.teamRoles || channel.teamRoles.length === 0) {
            channels.push({
                id: channel.id,
                webhookUrl: channel.webhookUrl,
                botName: channel.botName || team.discordBotName,
                botAvatar: channel.botAvatar || team.discordBotAvatar,
                timing: channel.timing || team.discordTiming,
                notificationMode: channel.notificationMode || 'VIDEO',
                burnAnnotations: channel.burnAnnotations ?? team.discordBurnAnnotations
            });
            continue;
        }

        // If channel HAS role filter, check intersection with project roles OR Mentions
        const channelRoleIdSet = new Set(channel.teamRoles.map(r => r.id));

        const hasProjectRoleMatch = projectRoleIds.length > 0 && projectRoleIds.some(id => channelRoleIdSet.has(id));
        const hasMentionMatch = mentionedRoleIds.length > 0 && mentionedRoleIds.some(id => channelRoleIdSet.has(id));

        if (hasProjectRoleMatch || hasMentionMatch) {
            channels.push({
                id: channel.id,
                webhookUrl: channel.webhookUrl,
                botName: channel.botName || team.discordBotName,
                botAvatar: channel.botAvatar || team.discordBotAvatar,
                timing: channel.timing || team.discordTiming,
                notificationMode: channel.notificationMode || 'VIDEO',
                burnAnnotations: channel.burnAnnotations ?? team.discordBurnAnnotations
            });
        }
        // If project has NO roles, it does NOT trigger channels that REQUIRE roles.
    }

    return channels;
}

// Helper to construct payload and send - now accepts channel config
async function processInstantNotification(team, channel, eventType, data) {
    const publicUrl = await getPublicUrl();
    const { content, embed, files } = await constructDiscordMessage(eventType, data, publicUrl, team, channel);

    await sendToDiscord(
        channel.webhookUrl,
        { content, embeds: embed ? [embed] : [] },
        files,
        channel.botName,
        channel.botAvatar
    );
}

// Construct Message Payload
// channel param added for future Image mode support (Phase A)
async function constructDiscordMessage(eventType, data, publicUrl, team, channel = null) {
    let content = '';
    const projectLink = data.projectSlug ? `${publicUrl}/#/${team.slug}/project/${data.projectSlug}` : `${publicUrl}/#/${team.slug}/dashboard`;

    let embed = {
        color: 3891958, // Default Blue #3b82f6
        footer: { text: `ReView • ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, icon_url: `${publicUrl}/logo_icon.png` },
        timestamp: new Date().toISOString(),
        fields: []
    };
    let files = [];

    // Common Author logic
    if (data.user) {
        embed.author = {
            name: data.user.name || 'User',
            icon_url: data.user.avatarPath ? `${publicUrl}/api/media/avatars/${data.user.avatarPath}` : null
        };
    } else if (data.guestName) {
        embed.author = { name: `${data.guestName} (Guest)` };
    } else {
        embed.author = { name: `ReView Bot`, icon_url: `${publicUrl}/logo_icon.png` };
    }

    switch (eventType) {
        case 'COMMENT':
        case 'MENTION':
        case 'REPLY':
            embed.title = `💬 New Comment on "${data.projectName}"`;
            embed.url = `${publicUrl}/?commentId=${data.id}`;
            embed.description = `"${data.content}"\n\n[Jump to Comment](${embed.url})`;
            embed.color = 3447003; // Blue #3498db

            // Handle Screenshot Attachment (Rich Media)
            if (data.screenshotPath || data.annotationScreenshotPath) {
                const useBurned = team.discordBurnAnnotations;
                let imagePath = null;
                if (useBurned && data.annotationScreenshotPath) {
                    imagePath = getFilePath(data.annotationScreenshotPath, 'comment');
                } else if (data.screenshotPath) {
                    imagePath = getFilePath(data.screenshotPath, 'comment');
                }

                if (imagePath && fs.existsSync(imagePath)) {
                    const filename = path.basename(imagePath);
                    files.push({ path: imagePath, name: filename });
                    embed.image = { url: `attachment://${filename}` }; // Detailed large preview
                }
            }
            break;

        case 'PROJECT_CREATE':
            embed.title = `🚀 New Project: ${data.name}`;
            embed.url = data.slug ? `${publicUrl}/#/${team.slug}/project/${data.slug}` : projectLink;
            embed.description = data.description || 'No description provided.';
            embed.color = 3066993; // Green #2ecc71
            embed.fields.push({ name: 'Created By', value: data.userName || 'Admin', inline: true });

            // Thumbnail OR GIF (prefer GIF if available)
            if (data.gifPath) {
                // Try media first (standard location for GIFs)
                let gifFullPath = getFilePath(data.gifPath, 'media');

                // Fallback: Check if it's already an absolute path or relative to DATA_PATH root?
                // But usually it's in media.

                if (gifFullPath && fs.existsSync(gifFullPath)) {
                    const filename = path.basename(gifFullPath);
                    files.push({ path: gifFullPath, name: filename });
                    embed.image = { url: `attachment://${filename}` };
                } else {
                    // If GIF missing, try thumbnail fallback immediately below
                }
            }

            // Fallback to Thumbnail if GIF failed or not present
            if (!embed.image && data.thumbnailPath) {
                // Try 'thumbnails' dir first (standard video thumbnails)
                let thumbPath = getFilePath(data.thumbnailPath, 'thumbnail');
                if (!thumbPath || !fs.existsSync(thumbPath)) {
                    // Try 'media' dir (Image Bundle "thumbnails" are just the image file)
                    thumbPath = getFilePath(data.thumbnailPath, 'media');
                }

                if (thumbPath && fs.existsSync(thumbPath)) {
                    const filename = path.basename(thumbPath);
                    files.push({ path: thumbPath, name: filename });
                    embed.image = { url: `attachment://${filename}` };
                }
            }
            break;

        case 'VIDEO_VERSION':
            embed.title = `🎬 New Version Uploaded`;
            embed.url = projectLink;
            embed.description = `A new version **${data.versionName}** is available for **${data.projectName}**.`;
            embed.color = 10181046; // Purple #9b59b6
            embed.fields.push(
                { name: 'Project', value: `[${data.projectName}](${projectLink})`, inline: true },
                { name: 'Uploader', value: data.user ? data.user.name : 'Unknown', inline: true }
            );

            // GIF Turnaround
            if (data.gifPath) {
                // Try media first (standard location for GIFs)
                let gifFullPath = getFilePath(data.gifPath, 'media');

                if (gifFullPath && fs.existsSync(gifFullPath)) {
                    const filename = path.basename(gifFullPath);
                    files.push({ path: gifFullPath, name: filename });
                    embed.image = { url: `attachment://${filename}` };
                }
            }

            // Fallback to Thumbnail if GIF failed or not present
            if (!embed.image && data.thumbnailPath) {
                // Try 'thumbnails' dir first
                let thumbPath = getFilePath(data.thumbnailPath, 'thumbnail');
                if (!thumbPath || !fs.existsSync(thumbPath)) {
                    // Try 'media' dir
                    thumbPath = getFilePath(data.thumbnailPath, 'media');
                }

                if (thumbPath && fs.existsSync(thumbPath)) {
                    const filename = path.basename(thumbPath);
                    files.push({ path: thumbPath, name: filename });
                    embed.image = { url: `attachment://${filename}` };
                }
            }
            break;

        case 'STATUS_CHANGE':
            embed.title = `🔄 Status Changed`;
            embed.url = projectLink;
            embed.description = `**${data.projectName}** has been updated.`;
            embed.color = 15105570; // Orange #e67e22
            embed.fields.push(
                { name: 'New Status', value: `**${data.status}**`, inline: true }
            );
            break;
    }

    // Fallback if fields is empty
    if (embed.fields && embed.fields.length === 0) delete embed.fields;

    // Validate Image/Files integrity
    // If we have an image url starting with attachment:// but no files, delete the image
    if (embed.image && embed.image.url && embed.image.url.startsWith('attachment://')) {
        const hasFile = files.some(f => embed.image.url === `attachment://${f.name}`);
        if (!hasFile) {
            console.warn('[Discord] Removed embed.image because attachment is missing');
            delete embed.image;
        }
    }

    return { content, embed, files };
}

// 4. Cron Process Function (Called by server.js/cronService.js)
// Re-export as processDiscordQueue for consistency with team.routes.js

async function processDiscordQueue(force = false) {
    await processDebouncedQueue(force);
}

// Function specifically for Debounce/Grouped flush
async function processDebouncedQueue(force = false) {
    const teams = await prisma.team.findMany({
        where: {
            discordTiming: { in: ['GROUPED', 'HYBRID'] },
            discordQueue: { some: {} }
        },
        include: {
            discordQueue: { orderBy: { createdAt: 'desc' } },
            discordChannels: true
        }
    });

    const publicUrl = await getPublicUrl();

    for (const team of teams) {
        if (team.discordQueue.length === 0) continue;

        // Check "silence" duration
        const lastItem = team.discordQueue[0]; // Descending
        const lastTime = new Date(lastItem.createdAt).getTime();
        const now = Date.now();

        // 5 Minutes Debounce OR Force
        if (force || (now - lastTime) > 5 * 60 * 1000) {
            await flushQueue(team, team.discordQueue, publicUrl);
        }
    }
}

// Function specifically for Hourly flush
async function processHourlyQueue() {
    const teams = await prisma.team.findMany({
        where: {
            discordTiming: 'HOURLY',
            discordQueue: { some: {} }
        },
        include: {
            discordQueue: { orderBy: { createdAt: 'desc' } },
            discordChannels: true
        }
    });

    const publicUrl = await getPublicUrl();

    for (const team of teams) {
        if (team.discordQueue.length > 0) {
            await flushQueue(team, team.discordQueue, publicUrl);
        }
    }
}

// Flush Helper: Combine messages into Digest
async function flushQueue(team, queueItems, publicUrl) {
    // Prevent concurrent processing for the same team
    if (processingTeams.has(team.id)) {
        console.log(`[Discord Digest] Team ${team.id} already processing, skipping...`);
        return;
    }

    processingTeams.add(team.id);
    console.log(`[Discord Digest] Acquired lock for team ${team.id}`);

    try {
        // Sort oldest first for display
        const items = [...queueItems].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

        // Group items by Destination (Main Webhook vs Specific Channel)
        // Key: 'MAIN' or channelId (int)
        const groups = {};

        items.forEach(item => {
            const data = JSON.parse(item.payload);
            const channelId = data.channelId || 'MAIN';

            if (!groups[channelId]) groups[channelId] = [];
            groups[channelId].push({ item, data });
        });

        // Determine Webhooks/Settings for logic
        // We need team channels to map ID -> Webhook
        const channelsMap = new Map();
        if (team.discordChannels) {
            team.discordChannels.forEach(c => channelsMap.set(c.id, c));
        }

        // Process each group
        for (const [key, groupItems] of Object.entries(groups)) {
            let webhookUrl = team.discordWebhookUrl;
            let botName = team.discordBotName;
            let botAvatar = team.discordBotAvatar;

            let burnAnnotations = team.discordBurnAnnotations;
            let allowVideo = true;

            if (key !== 'MAIN') {
                const cId = parseInt(key);
                const channel = channelsMap.get(cId);
                if (!channel) {
                    console.log(`[Discord Digest] Channel ${cId} not found/deleted, skipping items.`);
                    continue;
                }
                webhookUrl = channel.webhookUrl;
                botName = channel.botName || botName;
                botAvatar = channel.botAvatar || botAvatar;

                if (channel.burnAnnotations !== null) burnAnnotations = channel.burnAnnotations;

                // Check notification Mode
                if (channel.notificationMode === 'IMAGE') allowVideo = false;
            }

            if (!webhookUrl) continue;

            // Group by Project WITHIN this channel group
            const byProject = {};
            groupItems.forEach(({ item, data }) => {
                const pid = data.projectName || 'Unknown Project';
                if (!byProject[pid]) byProject[pid] = { items: [], id: data.projectId };
                byProject[pid].items.push({ type: item.type, data });
            });

            // ... Build Digest Description ...
            let description = '';
            const potentialImageFiles = [];
            const potentialCompositeData = []; // For IMAGE mode composite generation
            let fileCounter = 0;
            let potentialGifComments = [];
            let bestProjectId = null;
            let maxComments = 0;

            for (const [projectName, projectData] of Object.entries(byProject)) {
                // console.log(`[Discord Digest] Processing project: ${projectName} (${projectData.items.length} items) for Target: ${key}`);
                description += `**${projectName}**\n`;

                let projectComments = [];

                for (const event of projectData.items) {
                    const d = event.data;
                    let line = '';
                    if (event.type === 'COMMENT' || event.type === 'MENTION') {
                        const author = d.user ? d.user.name : (d.guestName || 'User');
                        line = `• ${author}: "${d.content.substring(0, 50)}${d.content.length > 50 ? '...' : ''}"`;
                        const link = `${publicUrl}/?commentId=${d.id}`;
                        line += ` [View](${link})\n`;

                        if (d.timestamp != null && d.projectId && !d.parentId) {
                            projectComments.push({ ...d, id: d.id });
                        }

                        if (fileCounter < 4 && (d.screenshotPath || d.annotationScreenshotPath)) {
                            // use 'burnAnnotations' derived from channel/team
                            let imagePath = null;
                            if (burnAnnotations && d.annotationScreenshotPath) imagePath = getFilePath(d.annotationScreenshotPath, 'comment');
                            else if (d.screenshotPath) imagePath = getFilePath(d.screenshotPath, 'comment');

                            if (imagePath && fs.existsSync(imagePath)) {
                                const fname = `img_${fileCounter}_${path.basename(imagePath)}`;
                                potentialImageFiles.push({ path: imagePath, name: fname });

                                // Store data for composite image generation (IMAGE mode)
                                potentialCompositeData.push({
                                    screenshotPath: d.screenshotPath ? getFilePath(d.screenshotPath, 'comment') : null,
                                    annotationScreenshotPath: d.annotationScreenshotPath ? getFilePath(d.annotationScreenshotPath, 'comment') : null,
                                    userName: d.user?.name || d.guestName || 'Reviewer',
                                    avatarPath: d.user?.avatarPath || null,
                                    content: d.content || '',
                                    attachmentPaths: d.attachmentPaths ? (typeof d.attachmentPaths === 'string' ? JSON.parse(d.attachmentPaths) : d.attachmentPaths) : [],
                                    burnAnnotations: burnAnnotations
                                });

                                fileCounter++;
                            }
                        }
                    } else if (event.type === 'STATUS_CHANGE') {
                        line = `• Status changed to ${d.status}\n`;
                    } else {
                        line = `• ${event.type}\n`;
                    }
                    description += line;
                }
                description += '\n';

                if (projectComments.length > maxComments) {
                    maxComments = projectComments.length;
                    bestProjectId = projectData.id;
                    potentialGifComments = projectComments;
                }
            }

            // ... Generate Video/Send ...
            const finalFiles = [];
            let videoGenerated = false;


            if (allowVideo && potentialGifComments.length > 0 && bestProjectId) {
                // ... (GIF Logic same as before) ...
                try {
                    const projectForDigest = await prisma.project.findUnique({
                        where: { id: bestProjectId },
                        include: {
                            videos: { orderBy: { createdAt: 'desc' }, take: 1 },
                            threeDAssets: { orderBy: { createdAt: 'desc' }, take: 1 },
                            imageBundles: { orderBy: { createdAt: 'desc' }, take: 1 }
                        }
                    });

                    let assetPath = '';
                    let assetType = '3d';

                    if (projectForDigest) {
                        if (projectForDigest.threeDAssets && projectForDigest.threeDAssets.length > 0) {
                            assetPath = projectForDigest.threeDAssets[0].filename;
                            assetType = '3d';
                        } else if (projectForDigest.videos && projectForDigest.videos.length > 0) {
                            assetPath = projectForDigest.videos[0].filename;
                            assetType = 'video';
                        } else if (projectForDigest.imageBundles && projectForDigest.imageBundles.length > 0) {
                            const bundle = projectForDigest.imageBundles[0];
                            const images = await prisma.image.findMany({ where: { bundleId: bundle.id }, take: 1 });
                            if (images.length > 0) {
                                assetPath = images[0].filename;
                                assetType = 'image';
                            }
                        }
                    }

                    if (assetPath) {
                        const digestItems = [{
                            type: assetType,
                            assetPath: assetPath,
                            projectId: bestProjectId,
                            projectName: Object.keys(byProject).find(k => byProject[k].id === bestProjectId) || 'Project',
                            comments: potentialGifComments.slice(0, 10).map(c => ({
                                id: c.id,
                                content: c.content,
                                timestamp: c.timestamp,
                                cameraState: c.cameraState ? (typeof c.cameraState === 'string' ? JSON.parse(c.cameraState) : c.cameraState) : null,
                                annotation: c.annotation ? (typeof c.annotation === 'string' ? JSON.parse(c.annotation) : c.annotation) : null,
                                user: {
                                    name: c.user?.name || c.guestName || 'Reviewer',
                                    avatarPath: c.user?.avatarPath || null
                                }
                            }))
                        }];

                        const mediaDir = path.join(DATA_PATH, 'media', 'digests');
                        if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

                        const videoPath = await generateDigestVideo(digestItems, mediaDir);
                        if (videoPath) {
                            const fname = path.basename(videoPath);
                            finalFiles.push({ path: videoPath, name: fname });
                            videoGenerated = true;
                        }
                    }
                } catch (e) {
                    console.error('[Discord Digest] Failed to generate digest video', e);
                }
            }

            if (!videoGenerated) {
                // Generate composite images for IMAGE mode (with comment panel on right)
                if (!allowVideo && potentialCompositeData.length > 0) {
                    const compositeDir = path.join(DATA_PATH, 'media', 'digests');
                    if (!fs.existsSync(compositeDir)) fs.mkdirSync(compositeDir, { recursive: true });

                    for (const compositeData of potentialCompositeData.slice(0, 4)) {
                        try {
                            const compositePath = await generateCompositeImage(compositeData, compositeDir);
                            if (compositePath) {
                                const fname = path.basename(compositePath);
                                finalFiles.push({ path: compositePath, name: fname });
                            }
                        } catch (compErr) {
                            console.error('[Discord Digest] Failed to generate composite image:', compErr);
                        }
                    }
                } else {
                    // Fallback to raw screenshots if composite generation fails or not in IMAGE mode
                    finalFiles.push(...potentialImageFiles);
                }
            }

            const embed = {
                title: `Activity Digest (${groupItems.length} updates)`,
                description: description,
                color: 3447003, // Blue
                timestamp: new Date().toISOString()
            };

            await sendToDiscord(
                webhookUrl,
                { embeds: [embed] },
                finalFiles,
                botName,
                botAvatar
            );
        }

        // Delete ALL processed items (from all groups)
        await prisma.discordQueue.deleteMany({
            where: { id: { in: items.map(i => i.id) } }
        });

    } finally {
        // Always release the lock
        processingTeams.delete(team.id);
        console.log(`[Discord Digest] Released lock for team ${team.id}`);
    }
}

module.exports = {
    notifyDiscord,
    processDebouncedQueue,
    processHourlyQueue,
    processDiscordQueue
};
