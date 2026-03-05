import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface AuthRequest extends Request {
    user?: any;
}

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) {
            return res.status(401).json({ error: 'Access denied. No token provided.' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string };
        const user = await prisma.user.findUnique({ where: { id: decoded.userId } });

        if (!user) {
            return res.status(401).json({ error: 'Invalid token. User not found.' });
        }

        if (user.banned) {
            return res.status(403).json({ error: 'Your account has been suspended.' });
        }

        req.user = user;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid or expired token.' });
    }
};

export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
    if (req.user?.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Admin access required.' });
    }
    next();
};

export const requireProfileSetup = (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user?.profileSetup) {
        return res.status(403).json({ error: 'Please complete your profile setup first.' });
    }
    next();
};
