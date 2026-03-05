import { Server as SocketIOServer, Socket } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();

export const setupSocket = (io: SocketIOServer) => {
    // Authentication middleware for socket connections
    io.use(async (socket: Socket, next) => {
        try {
            const token = socket.handshake.auth?.token;
            if (!token) {
                return next(new Error('Authentication required'));
            }

            const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string };
            const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
            if (!user) {
                return next(new Error('User not found'));
            }

            (socket as any).userId = user.id;
            (socket as any).user = user;
            next();
        } catch (error) {
            next(new Error('Invalid token'));
        }
    });

    io.on('connection', (socket: Socket) => {
        const userId = (socket as any).userId;
        console.log(`User connected: ${userId}`);

        // Join personal room for notifications
        socket.join(`user_${userId}`);

        // Join a chat room
        socket.on('join_chat', (data: { recipientId: string; projectId?: string }) => {
            const roomId = [userId, data.recipientId].sort().join('_');
            socket.join(`chat_${roomId}`);
            console.log(`User ${userId} joined chat room: ${roomId}`);
        });

        // Send a message
        socket.on('send_message', async (data: { recipientId: string; content: string; projectId?: string }) => {
            try {
                const message = await prisma.message.create({
                    data: {
                        senderId: userId,
                        receiverId: data.recipientId,
                        content: data.content,
                        projectId: data.projectId || null,
                    },
                    include: {
                        sender: { select: { id: true, name: true, avatar: true } },
                    },
                });

                const roomId = [userId, data.recipientId].sort().join('_');
                io.to(`chat_${roomId}`).emit('new_message', message);

                // Notify recipient
                io.to(`user_${data.recipientId}`).emit('notification', {
                    type: 'NEW_MESSAGE',
                    title: 'New Message',
                    message: `${(socket as any).user.name} sent you a message`,
                    link: '/chat',
                });
            } catch (error) {
                console.error('Error sending message:', error);
                socket.emit('error', { message: 'Failed to send message' });
            }
        });

        // Typing indicator
        socket.on('typing', (data: { recipientId: string }) => {
            const roomId = [userId, data.recipientId].sort().join('_');
            socket.to(`chat_${roomId}`).emit('user_typing', { userId });
        });

        socket.on('stop_typing', (data: { recipientId: string }) => {
            const roomId = [userId, data.recipientId].sort().join('_');
            socket.to(`chat_${roomId}`).emit('user_stop_typing', { userId });
        });

        // Mark messages as read
        socket.on('mark_read', async (data: { senderId: string }) => {
            await prisma.message.updateMany({
                where: { senderId: data.senderId, receiverId: userId, read: false },
                data: { read: true },
            });
        });

        socket.on('disconnect', () => {
            console.log(`User disconnected: ${userId}`);
        });
    });
};
