import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// Get conversations
router.get('/conversations', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user.id;

        // Get unique conversation partners
        const messages = await prisma.message.findMany({
            where: {
                OR: [{ senderId: userId }, { receiverId: userId }],
            },
            orderBy: { createdAt: 'desc' },
            include: {
                sender: { select: { id: true, name: true, avatar: true } },
                receiver: { select: { id: true, name: true, avatar: true } },
            },
        });

        // Group by conversation partner
        const conversationMap = new Map<string, any>();
        for (const msg of messages) {
            const partnerId = msg.senderId === userId ? msg.receiverId : msg.senderId;
            if (!conversationMap.has(partnerId)) {
                const partner = msg.senderId === userId ? msg.receiver : msg.sender;
                const unreadCount = await prisma.message.count({
                    where: { senderId: partnerId, receiverId: userId, read: false },
                });
                conversationMap.set(partnerId, {
                    partner,
                    lastMessage: msg,
                    unreadCount,
                });
            }
        }

        res.json({ conversations: Array.from(conversationMap.values()) });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get conversations' });
    }
});

// Get messages with a specific user
router.get('/:userId', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const { page = '1', limit = '50' } = req.query;
        const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

        const messages = await prisma.message.findMany({
            where: {
                OR: [
                    { senderId: req.user.id, receiverId: req.params.userId },
                    { senderId: req.params.userId, receiverId: req.user.id },
                ],
            },
            include: {
                sender: { select: { id: true, name: true, avatar: true } },
            },
            orderBy: { createdAt: 'asc' },
            skip,
            take: parseInt(limit as string),
        });

        // Mark messages as read
        await prisma.message.updateMany({
            where: {
                senderId: req.params.userId,
                receiverId: req.user.id,
                read: false,
            },
            data: { read: true },
        });

        res.json({ messages });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get messages' });
    }
});

// Send message (REST fallback)
router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const { receiverId, content, projectId } = req.body;

        const message = await prisma.message.create({
            data: {
                senderId: req.user.id,
                receiverId,
                content,
                projectId: projectId || null,
            },
            include: {
                sender: { select: { id: true, name: true, avatar: true } },
            },
        });

        res.status(201).json({ message });
    } catch (error) {
        res.status(500).json({ error: 'Failed to send message' });
    }
});

export default router;
