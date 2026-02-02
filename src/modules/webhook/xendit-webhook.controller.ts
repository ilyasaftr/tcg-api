import { NextFunction, Request, Response } from "express";
import { ApiError } from "../../utils/api-error";
import { PrismaService } from "../prisma/prisma.service";
import { EmailService } from "../mail/email.service";

type InvoiceCallbackPayload = {
  id?: string;
  external_id?: string;
  externalId?: string;
  status?: string;
  invoice_url?: string;
  invoiceUrl?: string;
  expiry_date?: string;
  expiryDate?: string;
  paid_at?: string;
  paidAt?: string;
};

export class XenditWebhookController {
  prisma: PrismaService;
  emailService: EmailService;

  constructor() {
    this.prisma = new PrismaService();
    this.emailService = new EmailService();
  }

  private verifyCallbackToken(req: Request) {
    const expected =
      process.env.XENDIT_CALLBACK_TOKEN || process.env.XENDIT_WEBHOOK_TOKEN;
    if (!expected) return;

    const header =
      (req.headers["x-callback-token"] as string | undefined) ||
      (req.headers["X-CALLBACK-TOKEN"] as string | undefined);
    if (!header || header !== expected) {
      throw new ApiError("Invalid webhook token", 401);
    }
  }

  private async cancelAndRestoreOrder(
    orderId: number,
    reason: string,
    paymentStatus: "EXPIRED" | "FAILED" = "EXPIRED"
  ) {
    const now = new Date();

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        orderItems: true,
        auctions: {
          include: {
            product: { select: { id: true, name: true } },
            variant: true,
          },
        },
      },
    });

    if (!order) return;

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: "CANCELLED",
          paymentStatus,
          cancellationReason: reason,
          cancelledAt: now,
        },
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          status: "CANCELLED",
          notes: `Auto-cancelled: ${reason}`,
          createdBy: "system",
        },
      });

      if (order.auctions && order.auctions.length > 0) {
        for (const auction of order.auctions) {
          await tx.auction.update({
            where: { id: auction.id },
            data: {
              status: "PAYMENT_FAILED",
              failureReason: "payment_expired",
              orderId: null,
            },
          });

          await tx.productVariant.update({
            where: { id: auction.variantId },
            data: { stock: { increment: auction.quantity } },
          });

          await tx.auctionFailure.create({
            data: {
              auctionId: auction.id,
              winnerId: order.userId,
              winningBid: auction.currentBid,
              paymentDeadline: order.paymentDeadline || now,
              reason: "payment_expired",
            },
          });
        }

        const stats = await tx.userAuctionStats.upsert({
          where: { userId: order.userId },
          create: {
            userId: order.userId,
            totalWon: 0,
            totalPaid: 0,
            totalFailed: 1,
            lastFailedAt: now,
          },
          update: {
            totalFailed: { increment: 1 },
            lastFailedAt: now,
          },
        });

        if (stats.totalFailed >= 3) {
          const banDuration = 30 * 24 * 60 * 60 * 1000;
          const bannedUntil = new Date(now.getTime() + banDuration);
          await tx.userAuctionStats.update({
            where: { userId: order.userId },
            data: { bannedUntil },
          });

          try {
            await this.emailService.sendUserBanned(order.user.email, {
              userName: order.user.name,
              failureCount: stats.totalFailed,
              bannedUntil,
            });
          } catch {
            // ignore
          }
        }
      } else {
        for (const item of order.orderItems) {
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: { stock: { increment: item.quantity } },
          });
        }
      }
    });
  }

  handleInvoice = async (req: Request, res: Response, next: NextFunction) => {
    try {
      this.verifyCallbackToken(req);

      const payload = req.body as InvoiceCallbackPayload;
      const externalId = payload.external_id || payload.externalId;
      const status = (payload.status || "").toUpperCase();

      if (!externalId) {
        throw new ApiError("Missing external_id", 400);
      }

      const order = await this.prisma.order.findFirst({
        where: { orderNumber: externalId },
        select: { id: true, status: true, paymentStatus: true },
      });

      if (!order) {
        return res.status(200).json({ success: true });
      }

      if (status === "PAID" || status === "SETTLED") {
        const paidAt = payload.paid_at || payload.paidAt;
        const now = new Date();
        await this.prisma.$transaction(async (tx) => {
          await tx.order.update({
            where: { id: order.id },
            data: {
              paymentStatus: "PAID",
              status: "CONFIRMED",
              paidAt: paidAt ? new Date(paidAt) : now,
              confirmedAt: now,
              xenditInvoiceId: payload.id,
              xenditInvoiceUrl: payload.invoice_url || payload.invoiceUrl,
              xenditInvoiceStatus: status,
            },
          });
          await tx.orderStatusHistory.create({
            data: {
              orderId: order.id,
              status: "CONFIRMED",
              notes: "Payment confirmed (Xendit)",
              createdBy: "system",
            },
          });
        });

        return res.status(200).json({ success: true });
      }

      if (status === "EXPIRED") {
        await this.cancelAndRestoreOrder(order.id, "Payment expired (Xendit)", "EXPIRED");
        return res.status(200).json({ success: true });
      }

      if (status === "FAILED") {
        await this.cancelAndRestoreOrder(order.id, "Payment failed (Xendit)", "FAILED");
        return res.status(200).json({ success: true });
      }

      // For other statuses, just persist latest invoice status if provided.
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          xenditInvoiceId: payload.id,
          xenditInvoiceUrl: payload.invoice_url || payload.invoiceUrl,
          xenditInvoiceStatus: status || payload.status,
        },
      });

      return res.status(200).json({ success: true });
    } catch (error) {
      next(error);
    }
  };
}
