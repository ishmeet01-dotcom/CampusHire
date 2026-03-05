import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, AuthRequest } from '../middleware/auth';
import { createNotification } from '../services/notifications';
import crypto from 'crypto';

const router = Router();
const prisma = new PrismaClient();

// Create Razorpay order
router.post('/create-order', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const { projectId, amount } = req.body;

        const project = await prisma.project.findUnique({ where: { id: projectId } });
        if (!project) return res.status(404).json({ error: 'Project not found' });
        if (project.buyerId !== req.user.id) return res.status(403).json({ error: 'Only the buyer can make payments' });

        // Create Razorpay order (mock for now - replace with actual Razorpay SDK)
        const orderId = 'order_' + crypto.randomBytes(12).toString('hex');

        // Create transaction record
        const transaction = await prisma.transaction.create({
            data: {
                amount: parseFloat(amount),
                razorpayOrderId: orderId,
                status: 'PENDING',
                projectId,
                buyerId: req.user.id,
                helperId: project.helperId,
            },
        });

        res.json({
            orderId,
            amount: parseFloat(amount) * 100, // Amount in paise
            currency: 'INR',
            transactionId: transaction.id,
            key: process.env.RAZORPAY_KEY_ID,
        });
    } catch (error) {
        console.error('Payment order error:', error);
        res.status(500).json({ error: 'Failed to create payment order' });
    }
});

// Verify payment
router.post('/verify', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const { razorpayOrderId, razorpayPaymentId, razorpaySignature, transactionId } = req.body;

        // Verify signature (mock verification - replace with actual Razorpay verification)
        const expectedSig = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
            .update(razorpayOrderId + '|' + razorpayPaymentId)
            .digest('hex');

        // For development, accept any signature
        const isValid = process.env.NODE_ENV === 'development' ? true : expectedSig === razorpaySignature;

        if (!isValid) {
            return res.status(400).json({ error: 'Invalid payment signature' });
        }

        // Update transaction
        const transaction = await prisma.transaction.update({
            where: { id: transactionId },
            data: {
                razorpayPaymentId,
                razorpaySignature,
                status: 'CAPTURED',
            },
            include: { project: true },
        });

        // Create escrow record
        await prisma.escrow.create({
            data: {
                transactionId: transaction.id,
                status: 'HELD',
            },
        });

        // Notify helper
        const io = req.app.get('io');
        if (transaction.helperId) {
            await createNotification(
                transaction.helperId,
                'PAYMENT_RECEIVED',
                'Payment Received',
                `Payment of ₹${transaction.amount} for "${transaction.project.title}" is now in escrow`,
                `/escrow`,
                io
            );
        }

        res.json({ message: 'Payment verified and held in escrow', transaction });
    } catch (error) {
        console.error('Payment verify error:', error);
        res.status(500).json({ error: 'Failed to verify payment' });
    }
});

// Razorpay webhook
router.post('/webhook', async (req: Request, res: Response) => {
    try {
        const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
        const signature = req.headers['x-razorpay-signature'] as string;

        // Verify webhook signature
        if (webhookSecret && signature) {
            const expectedSig = crypto
                .createHmac('sha256', webhookSecret)
                .update(JSON.stringify(req.body))
                .digest('hex');

            if (expectedSig !== signature) {
                return res.status(400).json({ error: 'Invalid webhook signature' });
            }
        }

        const event = req.body.event;
        const payload = req.body.payload;

        switch (event) {
            case 'payment.captured':
                // Payment successful
                console.log('Payment captured:', payload.payment.entity.id);
                break;
            case 'payment.failed':
                // Payment failed
                console.log('Payment failed:', payload.payment.entity.id);
                break;
            case 'refund.created':
                // Refund initiated
                console.log('Refund created:', payload.refund.entity.id);
                break;
        }

        res.json({ status: 'ok' });
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

export default router;
