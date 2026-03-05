import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// Get notifications
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const { page = '1', limit = '20' } = req.query;
        const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

        const [notifications, total, unreadCount] = await Promise.all([
            prisma.notification.findMany({
                where: { userId: req.user.id },
                orderBy: { createdAt: 'desc' },
                skip,
                take: parseInt(limit as string),
            }),
            prisma.notification.count({ where: { userId: req.user.id } }),
            prisma.notification.count({ where: { userId: req.user.id, read: false } }),
        ]);

        res.json({ notifications, total, unreadCount });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get notifications' });
    }
});

// Mark notification as read
router.put('/:id/read', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        await prisma.notification.update({
            where: { id: req.params.id },
            data: { read: true },
        });
        res.json({ message: 'Marked as read' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to mark notification' });
    }
});

// Mark all as read
router.put('/read-all', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        await prisma.notification.updateMany({
            where: { userId: req.user.id, read: false },
            data: { read: true },
        });
        res.json({ message: 'All notifications marked as read' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to mark notifications' });
    }
});

export default router;
