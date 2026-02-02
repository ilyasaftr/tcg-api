import * as cron from "node-cron";
import { PrismaService } from "../prisma/prisma.service";
import { AuctionService } from "../auction/auction.service";
import { AuctionStatsService } from "../auction-stats/auction-stats.service";
import { EmailService } from "../mail/email.service";
import { OrderService } from "../../features/order/order.service";
import { XenditInvoiceService } from "../../services/xendit-invoice.service";

export class CronService {
  prisma: PrismaService;
  orderService: OrderService;
  auctionService: AuctionService;
  auctionStatsService: AuctionStatsService;
  emailService: EmailService;
  xenditInvoice: XenditInvoiceService;

  constructor() {
    this.prisma = new PrismaService();
    this.orderService = new OrderService();
    this.auctionService = new AuctionService();
    this.auctionStatsService = new AuctionStatsService();
    this.emailService = new EmailService();
    this.xenditInvoice = new XenditInvoiceService();
  }

  /**
   * Start all cron jobs
   */
  start = () => {
    console.log("🕐 Starting cron jobs...");

    // Auto-complete orders shipped 7+ days ago (Daily at 2:00 AM)
    cron.schedule("0 2 * * *", async () => {
      console.log("🕐 [CRON] Auto-completing shipped orders...");
      try {
        const result = await this.orderService.autoCompleteOrders();
        console.log(`✅ [CRON] Order auto-completion completed: ${result.message}`);
      } catch (error) {
        console.error("❌ [CRON] Order auto-completion failed:", error);
      }
    });

    // ✅ Auto-end auctions (Every 5 minutes)
    cron.schedule("*/5 * * * *", async () => {
      console.log("\n🕐 [CRON] Checking for auctions to end...");
      try {
        const result = await this.autoEndAuctions();
        console.log(`✅ [CRON] Auction auto-end completed: ${result.message}`);
      } catch (error) {
        console.error("❌ [CRON] Auction auto-end failed:", error);
      }
    });

    // Detect payment failures (Every hour)
    cron.schedule("0 * * * *", async () => {
      console.log("\n🕐 [CRON] Detecting payment failures...");
      try {
        const result = await this.auctionStatsService.detectPaymentFailures();
        console.log(`✅ [CRON] Payment failure detection completed: ${result.message}`);
      } catch (error) {
        console.error("❌ [CRON] Payment failure detection failed:", error);
      }
    });

    // Auto-cancel unpaid auction orders (Every 10 minutes)
    cron.schedule("*/10 * * * *", async () => {
      console.log("\n🕐 [CRON] Checking for unpaid auction orders...");
      try {
        const result = await this.autoCancelUnpaidAuctionOrders();
        console.log(`✅ [CRON] Unpaid auction orders check completed: ${result.message}`);
      } catch (error) {
        console.error("❌ [CRON] Unpaid auction orders check failed:", error);
      }
    });

    // Xendit invoice reconciliation (Every 5 minutes)
    cron.schedule("*/5 * * * *", async () => {
      console.log("\n🕐 [CRON] Reconciling Xendit invoices...");
      try {
        const result = await this.reconcileXenditInvoices();
        console.log(`✅ [CRON] Xendit invoice reconciliation: ${result.message}`);
      } catch (error) {
        console.error("❌ [CRON] Xendit invoice reconciliation failed:", error);
      }
    });

    console.log("✅ Cron jobs started successfully");
    console.log("📅 Schedule:");
    console.log("   - Auto-complete orders: Daily at 2:00 AM");
    console.log("   - Auto-end auctions: Every 5 minutes");
    console.log("   - Detect payment failures: Every hour");
    console.log("   - Auto-cancel unpaid auction orders: Every 10 minutes");
    console.log("   - Reconcile Xendit invoices: Every 5 minutes");
  };

  private cancelAndRestoreOrder = async (
    orderId: number,
    reason: string,
    paymentStatus: "EXPIRED" | "FAILED" = "EXPIRED"
  ) => {
    const now = new Date();
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        orderItems: true,
        auctions: { include: { variant: true } },
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
      } else {
        for (const item of order.orderItems) {
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: { stock: { increment: item.quantity } },
          });
        }
      }
    });
  };

  reconcileXenditInvoices = async () => {
    const orders = await this.prisma.order.findMany({
      where: {
        paymentMethod: "XENDIT_INVOICE",
        paymentStatus: "UNPAID",
        status: { in: ["PENDING", "WAITING_FOR_CONFIRMATION"] },
        xenditInvoiceId: { not: null },
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        orderItems: true,
        auctions: { include: { variant: true } },
      },
      take: 50,
      orderBy: { createdAt: "desc" },
    });

    let updated = 0;
    for (const order of orders) {
      try {
        const invoice = await this.xenditInvoice.getInvoiceById(
          (order as any).xenditInvoiceId
        );
        const status = String(invoice.status || "PENDING").toUpperCase();

        if (status === "PAID" || status === "SETTLED") {
          await this.prisma.$transaction(async (tx) => {
            await tx.order.update({
              where: { id: order.id },
              data: {
                paymentStatus: "PAID",
                status: "CONFIRMED",
                paidAt: invoice.paidAt ? new Date(invoice.paidAt) : new Date(),
                confirmedAt: new Date(),
                xenditInvoiceStatus: status,
                xenditInvoiceUrl: invoice.invoiceUrl,
              },
            });
            await tx.orderStatusHistory.create({
              data: {
                orderId: order.id,
                status: "CONFIRMED",
                notes: "Payment confirmed (Xendit reconciliation)",
                createdBy: "system",
              },
            });
          });
          updated += 1;
          continue;
        }

        if (status === "EXPIRED" || status === "FAILED") {
          await this.cancelAndRestoreOrder(
            order.id,
            status === "FAILED"
              ? "Payment failed (Xendit reconciliation)"
              : "Payment expired (Xendit reconciliation)",
            status === "FAILED" ? "FAILED" : "EXPIRED"
          );
          updated += 1;
          continue;
        }

        await this.prisma.order.update({
          where: { id: order.id },
          data: {
            xenditInvoiceStatus: status,
            xenditInvoiceUrl: invoice.invoiceUrl,
          },
        });
      } catch (error) {
        console.error(
          `❌ [CRON] Failed to reconcile invoice for order ${order.orderNumber}:`,
          (error as any)?.message || error
        );
      }
    }

    return { message: `Updated ${updated} order(s)`, count: updated };
  };

  /**
   * ✅ Auto-end auctions (24 hours after last bid)
   * 
   * Logic: Auction ends when lastBidTime + 24h <= now
   * This is equivalent to: lastBidTime <= (now - 24h)
   */
  autoEndAuctions = async () => {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    console.log(`🔍 Checking for auctions to end:`);
    console.log(`   Current time: ${now.toISOString()}`);
    console.log(`   Looking for auctions with lastBidTime <= ${twentyFourHoursAgo.toISOString()}`);

    // ✅ Find active auctions where 24 hours have passed since last bid
    const auctionsToEnd = await this.prisma.auction.findMany({
      where: {
        status: "ACTIVE",
        lastBidTime: {
          not: null,  // Only auctions that have received bids
          lte: twentyFourHoursAgo, // lastBidTime <= 24 hours ago
        },
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
          },
        },
        variant: true,
        bids: {
          orderBy: {
            bidAmount: "desc",
          },
          take: 1,
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
      },
    });

    console.log(`⚠️ Found ${auctionsToEnd.length} auctions to end`);

    if (auctionsToEnd.length === 0) {
      return {
        message: "No auctions to end",
        count: 0,
        auctions: [],
      };
    }

    const endedAuctions: number[] = [];

    for (const auction of auctionsToEnd) {
      try {
        console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`🏁 Ending Auction ID: ${auction.id}`);
        console.log(`   Product: ${auction.product.name}`);
        console.log(`   Last Bid: ${auction.lastBidTime?.toISOString()}`);
        console.log(`   Current Bid: Rp ${Number(auction.currentBid).toLocaleString("id-ID")}`);

        // Determine winner (highest bidder)
        const winner = auction.bids[0];

        if (!winner) {
          // ❌ No bids - This shouldn't happen since we filter lastBidTime not null
          // But handle it anyway by canceling
          console.log(`❌ ERROR: Auction ${auction.id} has lastBidTime but no bids!`);

          await this.prisma.$transaction(async (tx) => {
            await tx.auction.update({
              where: { id: auction.id },
              data: {
                status: "CANCELLED",
                endTime: now,
                failureReason: "no_bids_found",
              },
            });

            // ✅ RESTORE STOCK
            await tx.productVariant.update({
              where: { id: auction.variantId },
              data: {
                stock: { increment: auction.quantity },
              },
            });
          });

          console.log(`   ✅ Auction cancelled and stock restored (+${auction.quantity})`);
          continue;
        }

        // ✅ Set winner and payment deadline (48 hours from NOW)
        const paymentDeadline = new Date(now.getTime() + 48 * 60 * 60 * 1000);

        console.log(`   🏆 Winner: ${winner.user.name} (${winner.user.email})`);
        console.log(`   💰 Winning Bid: Rp ${Number(winner.bidAmount).toLocaleString("id-ID")}`);
        console.log(`   ⏰ Payment Deadline: ${paymentDeadline.toISOString()}`);

        // Update auction to ENDED status
        await this.prisma.auction.update({
          where: { id: auction.id },
          data: {
            status: "ENDED",
            endTime: now,
            winnerId: winner.userId,
            paymentDeadline: paymentDeadline, // ✅ Set payment deadline HERE, not during bidding!
          },
        });

        // Update user stats
        await this.auctionStatsService.incrementWon(winner.userId);

        // Send email to winner
        try {
          await this.emailService.sendAuctionWon(winner.user.email, {
            userName: winner.user.name,
            productName: auction.product.name,
            winningBid: Number(auction.currentBid),
            paymentDeadline: paymentDeadline,
            auctionUrl: `${process.env.FRONTEND_URL}/auctions/${auction.id}`,
          });
          console.log(`   ✅ Winner notification sent to ${winner.user.email}`);
        } catch (emailError) {
          console.error(`   ⚠️ Failed to send winner email:`, emailError);
        }

        // Send notification to other bidders
        const allBidders = await this.prisma.bid.findMany({
          where: { auctionId: auction.id },
          distinct: ["userId"],
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        });

        const otherBidders = allBidders.filter((bid) => bid.userId !== winner.userId);
        let notifiedCount = 0;

        for (const bid of otherBidders) {
          try {
            await this.emailService.sendAuctionEndedNotWon(bid.user.email, {
              userName: bid.user.name,
              productName: auction.product.name,
              finalPrice: Number(winner.bidAmount),
            });
            notifiedCount++;
          } catch (emailError) {
            console.error(`   ⚠️ Failed to send email to ${bid.user.email}`);
          }
        }

        if (otherBidders.length > 0) {
          console.log(`   ✅ Notified ${notifiedCount}/${otherBidders.length} other bidders`);
        }

        console.log(`✅ Auction ${auction.id} ended successfully`);
        endedAuctions.push(auction.id);

      } catch (error) {
        console.error(`❌ Failed to end auction ${auction.id}:`, error);
      }
    }

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📊 Summary: Successfully ended ${endedAuctions.length}/${auctionsToEnd.length} auctions`);

    return {
      message: `Ended ${endedAuctions.length} auctions`,
      count: endedAuctions.length,
      auctions: endedAuctions,
    };
  };

  /**
   * Auto-cancel unpaid auction orders
   * Runs every 10 minutes to check for expired payment deadlines
   */
  autoCancelUnpaidAuctionOrders = async () => {
    const now = new Date();

    console.log(`🔍 Checking for unpaid auction orders (deadline before ${now.toISOString()})...`);

    // Find orders with:
    // 1. paymentDeadline has passed
    // 2. Status is PENDING or WAITING_FOR_CONFIRMATION
    // 3. Has linked auctions
    const expiredOrders = await this.prisma.order.findMany({
      where: {
        paymentDeadline: {
          not: null,
          lte: now,
        },
        status: {
          in: ["PENDING", "WAITING_FOR_CONFIRMATION"],
        },
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        auctions: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
              },
            },
            variant: true,
          },
        },
      },
    });

    // Filter only orders that have linked auctions
    const auctionOrders = expiredOrders.filter((order) => order.auctions && order.auctions.length > 0);

    console.log(`⚠️ Found ${auctionOrders.length} unpaid auction orders`);

    if (auctionOrders.length === 0) {
      return {
        message: "No unpaid auction orders to cancel",
        count: 0,
        orders: [],
      };
    }

    const cancelledOrders: string[] = [];

    for (const order of auctionOrders) {
      try {
        console.log(`\n❌ Cancelling order ${order.orderNumber} (payment deadline exceeded)`);

        await this.prisma.$transaction(async (tx) => {
          // 1. Cancel order
          await tx.order.update({
            where: { id: order.id },
            data: {
              status: "CANCELLED",
              cancellationReason: "Payment deadline exceeded",
              cancelledAt: now,
            },
          });

          // 2. Add order status history
          await tx.orderStatusHistory.create({
            data: {
              orderId: order.id,
              status: "CANCELLED",
              notes: "Auto-cancelled: Payment deadline exceeded",
              createdBy: "system",
            },
          });

          // 3. Update auctions to PAYMENT_FAILED and restore stock
          for (const auction of order.auctions) {
            await tx.auction.update({
              where: { id: auction.id },
              data: {
                status: "PAYMENT_FAILED",
                failureReason: "payment_deadline_exceeded",
                orderId: null, // Unlink from order
              },
            });

            // ✅ RESTORE STOCK
            await tx.productVariant.update({
              where: { id: auction.variantId },
              data: {
                stock: { increment: auction.quantity },
              },
            });

            console.log(`   ✅ Stock restored for auction ${auction.id}: +${auction.quantity}`);

            // 4. Record failure
            await tx.auctionFailure.create({
              data: {
                auctionId: auction.id,
                winnerId: order.userId,
                winningBid: auction.currentBid,
                paymentDeadline: order.paymentDeadline!,
                reason: "payment_deadline_exceeded",
              },
            });
          }

          // 5. Update user stats (increment totalFailed)
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

          // 6. Check if user should be banned (3+ failures)
          if (stats.totalFailed >= 3) {
            const banDuration = 30 * 24 * 60 * 60 * 1000; // 30 days
            const bannedUntil = new Date(now.getTime() + banDuration);

            await tx.userAuctionStats.update({
              where: { userId: order.userId },
              data: { bannedUntil },
            });

            console.log(`   ⚠️ User ${order.userId} banned until ${bannedUntil.toISOString()}`);

            // Send ban email
            try {
              await this.emailService.sendUserBanned(order.user.email, {
                userName: order.user.name,
                failureCount: stats.totalFailed,
                bannedUntil: bannedUntil,
              });
            } catch (emailError) {
              console.error(`   ⚠️ Failed to send ban email`);
            }
          }
        });

        // Send payment failure email to user
        try {
          await this.emailService.sendPaymentDeadlineExceeded(order.user.email, {
            userName: order.user.name,
            orderNumber: order.orderNumber,
            paymentDeadline: order.paymentDeadline!,
            itemCount: order.auctions.length,
          });
          console.log(`   ✅ Payment failure email sent to ${order.user.email}`);
        } catch (emailError) {
          console.error(`   ⚠️ Failed to send payment failure email`);
        }

        console.log(`✅ Order ${order.orderNumber} cancelled and auctions restored`);
        cancelledOrders.push(order.orderNumber);

      } catch (error) {
        console.error(`❌ Failed to cancel order ${order.orderNumber}:`, error);
      }
    }

    return {
      message: `Cancelled ${cancelledOrders.length} unpaid auction orders`,
      count: cancelledOrders.length,
      orders: cancelledOrders,
    };
  };
}
