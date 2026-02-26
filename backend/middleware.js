const jwt = require('jsonwebtoken');

let JWT_SECRET = process.env.JWT_SECRET;
let isDefaultSecret = false;

if (!JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is not defined. Please check your .env file.');
}

// Middleware to verify JWT
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, async (err, user) => {
    if (err) return res.sendStatus(403);

    // SECURITY FIX: Zombie Token Check
    // Verify user actually exists in DB and has not been deleted/banned
    try {
      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: {
          id: true,
          email: true,
          role: true,
          name: true,
          avatarPath: true,
          teamMemberships: {
            select: {
              teamId: true,
              role: true,
              team: { select: { id: true, slug: true } }
            }
          },
          ownedTeams: { select: { id: true, slug: true } }
        }
      });

      if (!dbUser) {
        // User deleted or invalid
        return res.status(401).json({ error: 'User no longer exists' });
      }

      // Update req.user with latest DB info (in case role changed)
      req.user = dbUser;
      next();
    } catch (dbError) {
      console.error("Auth Middleware DB Error:", dbError);
      res.sendStatus(500);
    }
  });
};

// Middleware to verify Admin Role
const requireAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'Access denied: Admins only.' });
  }
};

module.exports = { authenticateToken, requireAdmin, JWT_SECRET, isDefaultSecret };
