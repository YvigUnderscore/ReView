const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Checks if a user has access to a specific project.
 *
 * @param {object|number} userOrId - The user object (with id) or user ID.
 * @param {number} projectId - The project ID to check access for.
 * @returns {Promise<{authorized: boolean, error?: string, status?: number, project?: object, user?: object}>}
 */
const checkProjectAccess = async (userOrId, projectId) => {
    const userId = typeof userOrId === 'object' ? userOrId.id : userOrId;

    if (!userId) return { authorized: false, error: 'User ID required', status: 401 };

    // Check if user object already has the required data (avoid redundant fetch)
    let user = typeof userOrId === 'object' && userOrId.teamMemberships && userOrId.ownedTeams
        ? userOrId
        : await prisma.user.findUnique({
            where: { id: userId },
            include: {
                teamMemberships: { select: { teamId: true, role: true } },
                ownedTeams: { select: { id: true } }
            }
        });

    if (!user) return { authorized: false, error: 'User not found', status: 401 };

    const project = await prisma.project.findUnique({ where: { id: parseInt(projectId) } });
    if (!project) return { authorized: false, error: 'Project not found', status: 404 };

    // User is global admin
    if (user.role === 'admin') {
        return { authorized: true, project, user };
    }

    // User is team owner
    const isOwner = user.ownedTeams.some(t => t.id === project.teamId);
    if (isOwner) {
        return { authorized: true, project, user };
    }

    // Check membership
    const membership = user.teamMemberships.find(tm => tm.teamId === project.teamId);

    if (!membership) {
         return { authorized: false, error: 'Access denied', status: 403 };
    }

    // Check Client Restriction
    if (membership.role === 'CLIENT' && project.status !== 'CLIENT_REVIEW') {
         return { authorized: false, error: 'Access restricted to client reviews', status: 403 };
    }

    return { authorized: true, project, user };
};

/**
 * Checks if a user has access to a project associated with a specific comment.
 * Useful for PATCH/DELETE comment operations.
 *
 * @param {object|number} userOrId - The user object (with id) or user ID.
 * @param {number} commentId - The comment ID.
 * @returns {Promise<{authorized: boolean, error?: string, status?: number, comment?: object, project?: object}>}
 */
const checkCommentAccess = async (userOrId, commentId) => {
    const userId = typeof userOrId === 'object' ? userOrId.id : userOrId;

    const comment = await prisma.comment.findUnique({
        where: { id: parseInt(commentId) },
        include: {
            video: { select: { projectId: true } },
            image: { include: { bundle: { select: { projectId: true } } } },
            threeDAsset: { select: { projectId: true } }
        }
    });

    if (!comment) return { authorized: false, error: 'Comment not found', status: 404 };

    // Determine Project ID from relations
    let projectId = null;
    if (comment.video) projectId = comment.video.projectId;
    else if (comment.image && comment.image.bundle) projectId = comment.image.bundle.projectId;
    else if (comment.threeDAsset) projectId = comment.threeDAsset.projectId;

    if (!projectId) {
        // Orphaned comment or unexpected structure?
        // If we can't find a project, we can't authorize via project team.
        // Fallback: check if user is the comment author (if we allowed personal comments?)
        // But for now, fail safe.
        return { authorized: false, error: 'Project context not found for comment', status: 404 };
    }

    const access = await checkProjectAccess(userId, projectId);
    if (!access.authorized) return access;

    return { authorized: true, comment, project: access.project };
};

module.exports = { checkProjectAccess, checkCommentAccess };
