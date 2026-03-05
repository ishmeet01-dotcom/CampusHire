import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthRequest, requireProfileSetup } from '../middleware/auth';
import { createNotification } from '../services/notifications';

const router = Router();
const prisma = new PrismaClient();

// Submit bid
router.post('/', authenticate, requireProfileSetup, async (req: AuthRequest, res: Response) => {
    try {
        const { projectId, amount, message } = req.body;

        const project = await prisma.project.findUnique({ where: { id: projectId } });
        if (!project) return res.status(404).json({ error: 'Project not found' });
        if (project.status !== 'OPEN') return res.status(400).json({ error: 'Project is not open for bidding' });
        if (project.buyerId === req.user.id) return res.status(400).json({ error: 'Cannot bid on your own project' });

        // Check if already bid
        const existingBid = await prisma.bid.findFirst({
            where: { projectId, helperId: req.user.id },
        });
        if (existingBid) return res.status(400).json({ error: 'You already bid on this project' });

        const bid = await prisma.bid.create({
            data: {
                projectId,
                helperId: req.user.id,
                amount: parseFloat(amount),
                message: message || null,
            },
            include: {
                helper: { select: { id: true, name: true, avatar: true, college: true, rating: true, skills: true } },
            },
        });

        // Notify project buyer
        const io = req.app.get('io');
        await createNotification(
            project.buyerId,
            'BID_RECEIVED',
            'New Bid Received',
            `${req.user.name} placed a bid of ₹${amount} on "${project.title}"`,
            `/projects/${projectId}`,
            io
        );

        res.status(201).json({ bid });
    } catch (error) {
        console.error('Error submitting bid:', error);
        res.status(500).json({ error: 'Failed to submit bid' });
    }
});

// Accept bid
router.put('/:id/accept', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const bid = await prisma.bid.findUnique({
            where: { id: req.params.id },
            include: { project: true },
        });

        if (!bid) return res.status(404).json({ error: 'Bid not found' });
        if (bid.project.buyerId !== req.user.id) return res.status(403).json({ error: 'Unauthorized' });

        // Accept this bid and reject others
        await prisma.$transaction([
            prisma.bid.update({
                where: { id: bid.id },
                data: { status: 'ACCEPTED' },
            }),
            prisma.bid.updateMany({
                where: { projectId: bid.projectId, id: { not: bid.id } },
                data: { status: 'REJECTED' },
            }),
            prisma.project.update({
                where: { id: bid.projectId },
                data: { status: 'IN_PROGRESS', helperId: bid.helperId },
            }),
        ]);

        // Notify helper
        const io = req.app.get('io');
        await createNotification(
            bid.helperId,
            'BID_ACCEPTED',
            'Bid Accepted!',
            `Your bid on "${bid.project.title}" has been accepted!`,
            `/projects/${bid.projectId}`,
            io
        );

        res.json({ message: 'Bid accepted successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to accept bid' });
    }
});

// Reject bid
router.put('/:id/reject', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const bid = await prisma.bid.findUnique({
            where: { id: req.params.id },
            include: { project: true },
        });

        if (!bid) return res.status(404).json({ error: 'Bid not found' });
        if (bid.project.buyerId !== req.user.id) return res.status(403).json({ error: 'Unauthorized' });

        await prisma.bid.update({
            where: { id: bid.id },
            data: { status: 'REJECTED' },
        });

        const io = req.app.get('io');
        await createNotification(
            bid.helperId,
            'BID_REJECTED',
            'Bid Rejected',
            `Your bid on "${bid.project.title}" was not selected`,
            `/projects/${bid.projectId}`,
            io
        );

        res.json({ message: 'Bid rejected' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to reject bid' });
    }
});

export default router;
