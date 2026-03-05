import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// Submit support ticket
router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const { subject, message } = req.body;

        if (!subject || !message) {
            return res.status(400).json({ error: 'Subject and message are required' });
        }

        const ticket = await prisma.supportTicket.create({
            data: {
                subject,
                message,
                userId: req.user.id,
            },
        });

        res.status(201).json({ ticket });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create support ticket' });
    }
});

// Get my tickets
router.get('/my', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const tickets = await prisma.supportTicket.findMany({
            where: { userId: req.user.id },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ tickets });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get tickets' });
    }
});

export default router;
