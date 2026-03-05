import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// Setup profile
router.put('/profile/setup', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const { college, department, year, skills, bio, portfolio, role } = req.body;

        if (!college) {
            return res.status(400).json({ error: 'College is required' });
        }

        const user = await prisma.user.update({
            where: { id: req.user.id },
            data: {
                college,
                department: department || null,
                year: year ? parseInt(year) : null,
                skills: JSON.stringify(skills || []),
                bio: bio || null,
                portfolio: portfolio || null,
                role: role || 'BUYER',
                profileSetup: true,
            },
        });

        res.json({ user });
    } catch (error) {
        console.error('Profile setup error:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

// Update profile
router.put('/profile', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const { name, college, department, year, skills, bio, portfolio, avatar } = req.body;

        const user = await prisma.user.update({
            where: { id: req.user.id },
            data: {
                ...(name && { name }),
                ...(college && { college }),
                ...(department !== undefined && { department }),
                ...(year !== undefined && { year: year ? parseInt(year) : null }),
                ...(skills && { skills: JSON.stringify(skills) }),
                ...(bio !== undefined && { bio }),
                ...(portfolio !== undefined && { portfolio }),
                ...(avatar && { avatar }),
            },
        });

        res.json({ user });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

// Get user by ID (public profile)
router.get('/:id', async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.params.id },
            select: {
                id: true,
                name: true,
                avatar: true,
                college: true,
                department: true,
                year: true,
                skills: true,
                bio: true,
                portfolio: true,
                role: true,
                rating: true,
                totalRatings: true,
                badges: true,
                createdAt: true,
                _count: {
                    select: {
                        projectsPosted: true,
                        bids: true,
                        reviewsReceived: true,
                    },
                },
                reviewsReceived: {
                    take: 5,
                    orderBy: { createdAt: 'desc' },
                    include: {
                        reviewer: { select: { id: true, name: true, avatar: true } },
                        project: { select: { id: true, title: true } },
                    },
                },
            },
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Parse JSON fields
        const processedUser = {
            ...user,
            skills: user.skills ? JSON.parse(user.skills as string) : [],
            badges: user.badges ? JSON.parse(user.badges as string) : [],
        };

        res.json({ user: processedUser });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get user' });
    }
});

export default router;
