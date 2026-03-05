import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth';
import { createNotification } from '../services/notifications';

const router = Router();
const prisma = new PrismaClient();

// Get escrow status for a project
router.get('/project/:projectId', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const transaction = await prisma.transaction.findFirst({
            where: { projectId: req.params.projectId },
            include: {
                escrow: true,
                project: { select: { id: true, title: true, status: true } },
                buyer: { select: { id: true, name: true } },
                helper: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: 'desc' },
        });

        if (!transaction) {
            return res.status(404).json({ error: 'No transaction found for this project' });
        }

        res.json({ transaction });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get escrow status' });
    }
});

// Get all escrows for current user
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const transactions = await prisma.transaction.findMany({
            where: {
                OR: [{ buyerId: req.user.id }, { helperId: req.user.id }],
                escrow: { isNot: null },
            },
            include: {
                escrow: true,
                project: { select: { id: true, title: true, status: true } },
                buyer: { select: { id: true, name: true } },
                helper: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: 'desc' },
        });

        res.json({ escrows: transactions });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get escrows' });
    }
});

// Release escrow (buyer confirms delivery)
router.post('/release', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const { transactionId } = req.body;

        const transaction = await prisma.transaction.findUnique({
            where: { id: transactionId },
            include: { escrow: true, project: true },
        });

        if (!transaction) return res.status(404).json({ error: 'Transaction not found' });
        if (transaction.buyerId !== req.user.id) return res.status(403).json({ error: 'Only the buyer can release funds' });
        if (!transaction.escrow || transaction.escrow.status !== 'HELD') {
            return res.status(400).json({ error: 'Escrow is not in held status' });
        }

        // Release funds
        await prisma.$transaction([
            prisma.escrow.update({
                where: { id: transaction.escrow.id },
                data: { status: 'RELEASED', releaseDate: new Date() },
            }),
            prisma.transaction.update({
                where: { id: transactionId },
                data: { status: 'RELEASED' },
            }),
            prisma.project.update({
                where: { id: transaction.projectId },
                data: { status: 'COMPLETED' },
            }),
        ]);

        const io = req.app.get('io');
        if (transaction.helperId) {
            await createNotification(
                transaction.helperId,
                'PAYMENT_RELEASED',
                'Payment Released!',
                `₹${transaction.amount} for "${transaction.project.title}" has been released to you`,
                `/transactions`,
                io
            );
        }

        res.json({ message: 'Escrow released successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to release escrow' });
    }
});

// Get transaction history
router.get('/transactions', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const transactions = await prisma.transaction.findMany({
            where: {
                OR: [{ buyerId: req.user.id }, { helperId: req.user.id }],
            },
            include: {
                project: { select: { id: true, title: true } },
                buyer: { select: { id: true, name: true } },
                helper: { select: { id: true, name: true } },
                escrow: true,
            },
            orderBy: { createdAt: 'desc' },
        });

        res.json({ transactions });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get transactions' });
    }
});

export default router;
