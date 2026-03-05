import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// Google OAuth - Exchange token
router.post('/google', async (req: Request, res: Response) => {
    try {
        const { googleId, email, name, avatar } = req.body;

        if (!email || !googleId) {
            return res.status(400).json({ error: 'Email and Google ID are required' });
        }

        // Find or create user
        let user = await prisma.user.findUnique({ where: { googleId } });

        if (!user) {
            user = await prisma.user.findUnique({ where: { email } });
            if (user) {
                // Link Google account to existing user
                user = await prisma.user.update({
                    where: { email },
                    data: { googleId, avatar: avatar || user.avatar },
                });
            } else {
                // Create new user
                user = await prisma.user.create({
                    data: { googleId, email, name: name || email.split('@')[0], avatar },
                });
            }
        }

        // Generate JWT
        const token = jwt.sign(
            { userId: user.id },
            process.env.JWT_SECRET!,
            { expiresIn: '7d' }
        );

        res.json({
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                avatar: user.avatar,
                role: user.role,
                profileSetup: user.profileSetup,
                college: user.college,
            },
        });
    } catch (error) {
        console.error('Auth error:', error);
        res.status(500).json({ error: 'Authentication failed' });
    }
});

// Get current user
router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            include: {
                _count: {
                    select: {
                        projectsPosted: true,
                        bids: true,
                        reviewsReceived: true,
                    },
                },
            },
        });
        res.json({ user });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get user' });
    }
});

// Logout (client-side token removal)
router.post('/logout', (_req: Request, res: Response) => {
    res.json({ message: 'Logged out successfully' });
});

export default router;
