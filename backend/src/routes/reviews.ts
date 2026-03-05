import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthRequest, requireProfileSetup } from '../middleware/auth';
import { createNotification } from '../services/notifications';

const router = Router();
const prisma = new PrismaClient();

// Submit review
router.post('/', authenticate, requireProfileSetup, async (req: AuthRequest, res: Response) => {
    try {
        const { projectId, reviewedId, rating, comment } = req.body;

        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({ error: 'Rating must be between 1 and 5' });
        }

        const project = await prisma.project.findUnique({ where: { id: projectId } });
        if (!project) return res.status(404).json({ error: 'Project not found' });
        if (project.status !== 'COMPLETED') return res.status(400).json({ error: 'Can only review completed projects' });

        // Check if already reviewed
        const existing = await prisma.review.findFirst({
            where: { projectId, reviewerId: req.user.id, reviewedId },
        });
        if (existing) return res.status(400).json({ error: 'You already reviewed this user for this project' });

        const review = await prisma.review.create({
            data: {
                projectId,
                reviewerId: req.user.id,
                reviewedId,
                rating: parseInt(rating),
                comment: comment || null,
            },
            include: {
                reviewer: { select: { id: true, name: true, avatar: true } },
                project: { select: { id: true, title: true } },
            },
        });

        // Update user rating
        const allReviews = await prisma.review.findMany({ where: { reviewedId } });
        const avgRating = allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length;
        await prisma.user.update({
            where: { id: reviewedId },
            data: { rating: Math.round(avgRating * 10) / 10, totalRatings: allReviews.length },
        });

        // Notify reviewed user
        const io = req.app.get('io');
        await createNotification(
            reviewedId,
            'REVIEW_RECEIVED',
            'New Review',
            `${req.user.name} gave you a ${rating}-star review`,
            `/profile/${reviewedId}`,
            io
        );

        res.status(201).json({ review });
    } catch (error) {
        console.error('Review error:', error);
        res.status(500).json({ error: 'Failed to submit review' });
    }
});

// Get reviews for a user
router.get('/user/:userId', async (req, res) => {
    try {
        const reviews = await prisma.review.findMany({
            where: { reviewedId: req.params.userId },
            include: {
                reviewer: { select: { id: true, name: true, avatar: true } },
                project: { select: { id: true, title: true } },
            },
            orderBy: { createdAt: 'desc' },
        });

        const avgRating = reviews.length > 0
            ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
            : 0;

        res.json({ reviews, avgRating, total: reviews.length });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get reviews' });
    }
});

// Get reviews for a project
router.get('/project/:projectId', async (req, res) => {
    try {
        const reviews = await prisma.review.findMany({
            where: { projectId: req.params.projectId },
            include: {
                reviewer: { select: { id: true, name: true, avatar: true } },
                reviewed: { select: { id: true, name: true, avatar: true } },
            },
        });
        res.json({ reviews });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get reviews' });
    }
});

export default router;
