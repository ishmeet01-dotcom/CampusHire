import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Get leaderboard
router.get('/', async (req, res) => {
    try {
        const { type = 'rating', limit = '20' } = req.query;

        let orderBy: any = { rating: 'desc' };
        if (type === 'projects') orderBy = { totalRatings: 'desc' };

        const users = await prisma.user.findMany({
            where: { profileSetup: true, banned: false },
            select: {
                id: true,
                name: true,
                avatar: true,
                college: true,
                rating: true,
                totalRatings: true,
                skills: true,
                badges: true,
                _count: {
                    select: {
                        bids: { where: { status: 'ACCEPTED' } },
                        reviewsReceived: true,
                    },
                },
            },
            orderBy,
            take: parseInt(limit as string),
        });

        // Add rank
        const ranked = users.map((user, index) => ({
            ...user,
            rank: index + 1,
        }));

        res.json({ leaderboard: ranked });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get leaderboard' });
    }
});

export default router;
