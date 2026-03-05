import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth';
import { createNotification } from '../services/notifications';

const router = Router();
const prisma = new PrismaClient();

// Admin dashboard stats
router.get('/stats', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
    try {
        const [totalUsers, totalProjects, totalTransactions, activeDisputes, totalRevenue] = await Promise.all([
            prisma.user.count(),
            prisma.project.count(),
            prisma.transaction.count(),
            prisma.dispute.count({ where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } }),
            prisma.transaction.aggregate({ where: { status: 'RELEASED' }, _sum: { amount: true } }),
        ]);

        res.json({
            totalUsers,
            totalProjects,
            totalTransactions,
            activeDisputes,
            totalRevenue: totalRevenue._sum.amount || 0,
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get stats' });
    }
});

// List all users (admin)
router.get('/users', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
    try {
        const { search, page = '1', limit = '20' } = req.query;
        const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
        const where: any = {};
        if (search) {
            where.OR = [
                { name: { contains: search as string, mode: 'insensitive' } },
                { email: { contains: search as string, mode: 'insensitive' } },
                { college: { contains: search as string, mode: 'insensitive' } },
            ];
        }

        const [users, total] = await Promise.all([
            prisma.user.findMany({
                where,
                select: {
                    id: true, name: true, email: true, avatar: true, college: true, role: true,
                    banned: true, rating: true, createdAt: true,
                    _count: { select: { projectsPosted: true, bids: true } },
                },
                skip,
                take: parseInt(limit as string),
                orderBy: { createdAt: 'desc' },
            }),
            prisma.user.count({ where }),
        ]);

        res.json({ users, total });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get users' });
    }
});

// Ban/unban user
router.put('/users/:id/ban', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.params.id } });
        if (!user) return res.status(404).json({ error: 'User not found' });

        await prisma.user.update({
            where: { id: req.params.id },
            data: { banned: !user.banned },
        });

        res.json({ message: `User ${user.banned ? 'unbanned' : 'banned'} successfully` });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update user' });
    }
});

// Get all disputes (admin)
router.get('/disputes', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
    try {
        const disputes = await prisma.dispute.findMany({
            include: {
                project: { select: { id: true, title: true, budget: true } },
                buyer: { select: { id: true, name: true, email: true } },
                helper: { select: { id: true, name: true, email: true } },
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ disputes });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get disputes' });
    }
});

// Resolve dispute (admin)
router.put('/disputes/:id/resolve', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
    try {
        const { resolution, status, adminNote } = req.body;
        // status: RESOLVED_BUYER or RESOLVED_HELPER

        const dispute = await prisma.dispute.findUnique({
            where: { id: req.params.id },
            include: { project: true },
        });
        if (!dispute) return res.status(404).json({ error: 'Dispute not found' });

        await prisma.dispute.update({
            where: { id: req.params.id },
            data: { resolution, status, adminNote },
        });

        // Handle escrow based on resolution
        const escrow = await prisma.escrow.findFirst({
            where: { transaction: { projectId: dispute.projectId } },
            include: { transaction: true },
        });

        if (escrow) {
            if (status === 'RESOLVED_BUYER') {
                await prisma.escrow.update({
                    where: { id: escrow.id },
                    data: { status: 'REFUNDED', releaseDate: new Date() },
                });
                await prisma.transaction.update({
                    where: { id: escrow.transactionId },
                    data: { status: 'REFUNDED' },
                });
            } else if (status === 'RESOLVED_HELPER') {
                await prisma.escrow.update({
                    where: { id: escrow.id },
                    data: { status: 'RELEASED', releaseDate: new Date() },
                });
                await prisma.transaction.update({
                    where: { id: escrow.transactionId },
                    data: { status: 'RELEASED' },
                });
            }
        }

        // Notify both parties
        const io = req.app.get('io');
        await createNotification(dispute.buyerId, 'DISPUTE_RESOLVED', 'Dispute Resolved',
            `Dispute for "${dispute.project.title}" has been resolved`, `/disputes`, io);
        await createNotification(dispute.helperId, 'DISPUTE_RESOLVED', 'Dispute Resolved',
            `Dispute for "${dispute.project.title}" has been resolved`, `/disputes`, io);

        res.json({ message: 'Dispute resolved' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to resolve dispute' });
    }
});

export default router;
