import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthRequest, requireProfileSetup } from '../middleware/auth';
import { createNotification } from '../services/notifications';

const router = Router();
const prisma = new PrismaClient();

// Raise dispute
router.post('/', authenticate, requireProfileSetup, async (req: AuthRequest, res: Response) => {
    try {
        const { projectId, reason } = req.body;

        const project = await prisma.project.findUnique({ where: { id: projectId } });
        if (!project) return res.status(404).json({ error: 'Project not found' });

        const dispute = await prisma.dispute.create({
            data: {
                projectId,
                buyerId: project.buyerId,
                helperId: project.helperId || req.user.id,
                reason,
            },
            include: {
                project: { select: { id: true, title: true } },
                buyer: { select: { id: true, name: true } },
                helper: { select: { id: true, name: true } },
            },
        });

        // Update project and escrow status
        await prisma.project.update({
            where: { id: projectId },
            data: { status: 'DISPUTED' },
        });

        const escrow = await prisma.escrow.findFirst({
            where: { transaction: { projectId } },
        });
        if (escrow) {
            await prisma.escrow.update({
                where: { id: escrow.id },
                data: { disputeFlag: true, status: 'DISPUTED' },
            });
        }

        res.status(201).json({ dispute });
    } catch (error) {
        console.error('Dispute error:', error);
        res.status(500).json({ error: 'Failed to raise dispute' });
    }
});

// Get my disputes
router.get('/my', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const disputes = await prisma.dispute.findMany({
            where: {
                OR: [{ buyerId: req.user.id }, { helperId: req.user.id }],
            },
            include: {
                project: { select: { id: true, title: true } },
                buyer: { select: { id: true, name: true } },
                helper: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ disputes });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get disputes' });
    }
});

// Get dispute by ID
router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const dispute = await prisma.dispute.findUnique({
            where: { id: req.params.id },
            include: {
                project: true,
                buyer: { select: { id: true, name: true, avatar: true, email: true } },
                helper: { select: { id: true, name: true, avatar: true, email: true } },
            },
        });
        if (!dispute) return res.status(404).json({ error: 'Dispute not found' });
        res.json({ dispute });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get dispute' });
    }
});

export default router;
