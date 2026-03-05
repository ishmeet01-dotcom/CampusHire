import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthRequest, requireProfileSetup } from '../middleware/auth';
import { createNotification } from '../services/notifications';

const router = Router();
const prisma = new PrismaClient();

// Create project
router.post('/', authenticate, requireProfileSetup, async (req: AuthRequest, res: Response) => {
    try {
        const { title, description, category, budget, deadline, skills } = req.body;

        if (!title || !description || !budget || !deadline) {
            return res.status(400).json({ error: 'Title, description, budget, and deadline are required' });
        }

        const project = await prisma.project.create({
            data: {
                title,
                description,
                category: category || 'General',
                budget: parseFloat(budget),
                deadline: new Date(deadline),
                skills: JSON.stringify(skills || []),
                buyerId: req.user.id,
            },
            include: {
                buyer: { select: { id: true, name: true, avatar: true, college: true } },
            },
        });

        // Parse JSON fields
        const processedProject = {
            ...project,
            skills: project.skills ? JSON.parse(project.skills as string) : [],
        };

        res.status(201).json({ project: processedProject });
    } catch (error) {
        console.error('Error creating project:', error);
        res.status(500).json({ error: 'Failed to create project' });
    }
});

// List projects with filters
router.get('/', async (req: Request, res: Response) => {
    try {
        const { search, category, skill, minBudget, maxBudget, status, page = '1', limit = '12' } = req.query;
        const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

        const where: any = {};
        if (search) {
            where.OR = [
                { title: { contains: search as string, mode: 'insensitive' } },
                { description: { contains: search as string, mode: 'insensitive' } },
            ];
        }
        if (category) where.category = category;
        if (skill) where.skills = { contains: skill as string };
        if (minBudget) where.budget = { ...where.budget, gte: parseFloat(minBudget as string) };
        if (maxBudget) where.budget = { ...where.budget, lte: parseFloat(maxBudget as string) };
        if (status) where.status = status;
        else where.status = 'OPEN';

        const [projects, total] = await Promise.all([
            prisma.project.findMany({
                where,
                include: {
                    buyer: { select: { id: true, name: true, avatar: true, college: true } },
                    _count: { select: { bids: true } },
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: parseInt(limit as string),
            }),
            prisma.project.count({ where }),
        ]);

        // Parse JSON fields for each project
        const processedProjects = projects.map(project => ({
            ...project,
            skills: project.skills ? JSON.parse(project.skills as string) : [],
        }));

        res.json({
            projects: processedProjects,
            pagination: {
                total,
                page: parseInt(page as string),
                limit: parseInt(limit as string),
                totalPages: Math.ceil(total / parseInt(limit as string)),
            },
        });
    } catch (error) {
        console.error('Error listing projects:', error);
        res.status(500).json({ error: 'Failed to list projects' });
    }
});

// Get project by ID
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const project = await prisma.project.findUnique({
            where: { id: req.params.id },
            include: {
                buyer: { select: { id: true, name: true, avatar: true, college: true, rating: true } },
                bids: {
                    include: {
                        helper: { select: { id: true, name: true, avatar: true, college: true, rating: true, skills: true } },
                    },
                    orderBy: { createdAt: 'desc' },
                },
                _count: { select: { bids: true } },
            },
        });

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        // Parse JSON fields
        const processedProject = {
            ...project,
            skills: project.skills ? JSON.parse(project.skills as string) : [],
            bids: project.bids.map(bid => ({
                ...bid,
                helper: {
                    ...bid.helper,
                    skills: bid.helper.skills ? JSON.parse(bid.helper.skills as string) : [],
                },
            })),
        };

        res.json({ project: processedProject });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get project' });
    }
});

// Update project
router.put('/:id', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const project = await prisma.project.findUnique({ where: { id: req.params.id } });
        if (!project) return res.status(404).json({ error: 'Project not found' });
        if (project.buyerId !== req.user.id) return res.status(403).json({ error: 'Unauthorized' });

        const { title, description, category, budget, deadline, skills, status } = req.body;

        const updated = await prisma.project.update({
            where: { id: req.params.id },
            data: {
                ...(title && { title }),
                ...(description && { description }),
                ...(category && { category }),
                ...(budget && { budget: parseFloat(budget) }),
                ...(deadline && { deadline: new Date(deadline) }),
                ...(skills && { skills: JSON.stringify(skills) }),
                ...(status && { status }),
            },
            include: {
                buyer: { select: { id: true, name: true, avatar: true, college: true } },
            },
        });

        // Parse JSON fields
        const processedProject = {
            ...updated,
            skills: updated.skills ? JSON.parse(updated.skills as string) : [],
        };

        res.json({ project: processedProject });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update project' });
    }
});

// Get my projects (as buyer)
router.get('/my/posted', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const projects = await prisma.project.findMany({
            where: { buyerId: req.user.id },
            include: {
                _count: { select: { bids: true } },
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ projects });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get projects' });
    }
});

// Get projects I've bid on (as helper)
router.get('/my/bids', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const bids = await prisma.bid.findMany({
            where: { helperId: req.user.id },
            include: {
                project: {
                    include: {
                        buyer: { select: { id: true, name: true, avatar: true } },
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ bids });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get bids' });
    }
});

export default router;
