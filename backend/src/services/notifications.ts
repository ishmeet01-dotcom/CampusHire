import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const createNotification = async (
    userId: string,
    type: any,
    title: string,
    message: string,
    link?: string,
    io?: any
) => {
    const notification = await prisma.notification.create({
        data: { userId, type, title, message, link },
    });

    // Emit real-time notification via Socket.IO
    if (io) {
        io.to(`user_${userId}`).emit('notification', notification);
    }

    return notification;
};
