import { MailService } from "./mail.service";

export class EmailService {
  mailService: MailService;
  adminEmail: string;

  constructor() {
    this.mailService = new MailService();
    this.adminEmail = process.env.ADMIN_EMAIL || "admin@tcgstore.com";
  }

  // =====================================
  // ORDER EMAILS
  // =====================================

  /**
   * Send order created email to customer
   */
  sendOrderCreated = async (to: string, orderData: any) => {
    try {
      await this.mailService.sendMail(
        to,
        `Order Confirmation - ${orderData.orderNumber}`,
        "order-created",
        {
          customerName: orderData.customerName,
          orderNumber: orderData.orderNumber,
          total: orderData.total.toLocaleString("id-ID"),
          itemCount: orderData.itemCount,
          items: orderData.items,
          year: new Date().getFullYear(),
        }
      );
      console.log(`✅ Order created email sent to ${to}`);
    } catch (error) {
      console.error("❌ Failed to send order created email:", error);
    }
  };

  /**
   * Send payment confirmed email to customer
   */
  sendPaymentConfirmed = async (to: string, orderData: any) => {
    try {
      await this.mailService.sendMail(
        to,
        `Payment Confirmed - ${orderData.orderNumber}`,
        "payment-confirmed",
        {
          customerName: orderData.customerName,
          orderNumber: orderData.orderNumber,
          total: orderData.total.toLocaleString("id-ID"),
          year: new Date().getFullYear(),
        }
      );
      console.log(`✅ Payment confirmed email sent to ${to}`);
    } catch (error) {
      console.error("❌ Failed to send payment confirmed email:", error);
    }
  };

  /**
   * Send payment rejected email to customer
   */
  sendPaymentRejected = async (to: string, orderData: any) => {
    try {
      await this.mailService.sendMail(
        to,
        `Payment Rejected - ${orderData.orderNumber}`,
        "payment-rejected",
        {
          customerName: orderData.customerName,
          orderNumber: orderData.orderNumber,
          reason: orderData.reason,
          year: new Date().getFullYear(),
        }
      );
      console.log(`✅ Payment rejected email sent to ${to}`);
    } catch (error) {
      console.error("❌ Failed to send payment rejected email:", error);
    }
  };

  /**
   * Send order shipped email to customer
   */
  sendOrderShipped = async (to: string, orderData: any) => {
    try {
      await this.mailService.sendMail(
        to,
        `Order Shipped - ${orderData.orderNumber}`,
        "order-shipped",
        {
          customerName: orderData.customerName,
          orderNumber: orderData.orderNumber,
          trackingNumber: orderData.trackingNumber,
          courier: orderData.courier,
          estimatedDelivery: orderData.estimatedDelivery,
          year: new Date().getFullYear(),
        }
      );
      console.log(`✅ Order shipped email sent to ${to}`);
    } catch (error) {
      console.error("❌ Failed to send order shipped email:", error);
    }
  };

  /**
   * Send order completed email to customer (manual confirm)
   */
  sendOrderCompleted = async (to: string, orderData: any) => {
    try {
      await this.mailService.sendMail(
        to,
        `Order Completed - ${orderData.orderNumber}`,
        "order-completed",
        {
          customerName: orderData.customerName,
          orderNumber: orderData.orderNumber,
          year: new Date().getFullYear(),
        }
      );
      console.log(`✅ Order completed email sent to ${to}`);
    } catch (error) {
      console.error("❌ Failed to send order completed email:", error);
    }
  };

  /**
   * Send order auto-completed email to customer (auto after 7 days)
   */
  sendOrderAutoCompleted = async (to: string, orderData: any) => {
    try {
      await this.mailService.sendMail(
        to,
        `Order Auto-Completed - ${orderData.orderNumber}`,
        "order-auto-completed",
        {
          customerName: orderData.customerName,
          orderNumber: orderData.orderNumber,
          year: new Date().getFullYear(),
        }
      );
      console.log(`✅ Order auto-completed email sent to ${to}`);
    } catch (error) {
      console.error("❌ Failed to send order auto-completed email:", error);
    }
  };

  /**
   * Send order cancelled email to customer
   */
  sendOrderCancelled = async (to: string, orderData: any) => {
    try {
      await this.mailService.sendMail(
        to,
        `Order Cancelled - ${orderData.orderNumber}`,
        "order-cancelled",
        {
          customerName: orderData.customerName,
          orderNumber: orderData.orderNumber,
          reason: orderData.reason,
          year: new Date().getFullYear(),
        }
      );
      console.log(`✅ Order cancelled email sent to ${to}`);
    } catch (error) {
      console.error("❌ Failed to send order cancelled email:", error);
    }
  };

  // =====================================
  // AUCTION EMAILS
  // =====================================

  /**
   * Send auction won notification
   */
  sendAuctionWon = async (to: string, data: any) => {
    try {
      await this.mailService.sendMail(
        to,
        `🎉 Congratulations! You won the auction`,
        "auction-won",
        {
          userName: data.userName,
          productName: data.productName,
          winningBid: data.winningBid.toLocaleString("id-ID"),
          paymentDeadline: new Date(data.paymentDeadline).toLocaleString(
            "id-ID",
            {
              dateStyle: "full",
              timeStyle: "short",
            }
          ),
          auctionUrl: data.auctionUrl || `${process.env.FRONTEND_URL}/auctions/won`,
          year: new Date().getFullYear(),
        }
      );
      console.log(`✅ Auction won email sent to ${to}`);
    } catch (error) {
      console.error("❌ Failed to send auction won email:", error);
    }
  };

  /**
   * ✅ UPDATED: Send auction ended (not won) notification
   */
  sendAuctionEndedNotWon = async (to: string, data: any) => {
    try {
      await this.mailService.sendMail(
        to,
        `Auction Ended - ${data.productName}`,
        "auction-ended-not-won",
        {
          userName: data.userName,
          productName: data.productName,
          finalPrice: data.finalPrice.toLocaleString("id-ID"),
          year: new Date().getFullYear(),
        }
      );
      console.log(`✅ Auction ended (not won) email sent to ${to}`);
    } catch (error) {
      console.error("❌ Failed to send auction ended email:", error);
    }
  };

  /**
   * ✅ UPDATED: Send outbid notification (renamed from sendAuctionOutbid)
   */
  sendOutbidNotification = async (to: string, data: any) => {
    try {
      await this.mailService.sendMail(
        to,
        `⚠️ You've been outbid on ${data.productName}`,
        "auction-outbid",
        {
          userName: data.userName,
          productName: data.productName,
          yourBid: data.yourBid.toLocaleString("id-ID"),
          newHighestBid: data.newHighestBid.toLocaleString("id-ID"),
          auctionUrl: data.auctionUrl,
          year: new Date().getFullYear(),
        }
      );
      console.log(`✅ Outbid notification sent to ${to}`);
    } catch (error) {
      console.error("❌ Failed to send outbid notification:", error);
    }
  };

  /**
   * ✅ NEW: Send payment deadline exceeded notification
   */
  sendPaymentDeadlineExceeded = async (to: string, data: any) => {
    try {
      // Handle both single auction and multiple auctions
      const subject = data.orderNumber
        ? `⚠️ Payment Deadline Exceeded - Order ${data.orderNumber}`
        : `⚠️ Payment Deadline Exceeded - ${data.productName || "Auction"}`;

      const templateData: any = {
        userName: data.userName,
        year: new Date().getFullYear(),
      };

      // For order-based payment failure
      if (data.orderNumber) {
        templateData.orderNumber = data.orderNumber;
        templateData.itemCount = data.itemCount || 1;
        templateData.paymentDeadline = new Date(data.paymentDeadline).toLocaleString(
          "id-ID",
          {
            dateStyle: "full",
            timeStyle: "short",
          }
        );
      }
      // For single auction payment failure
      else {
        templateData.productName = data.productName;
        templateData.winningBid = data.winningBid.toLocaleString("id-ID");
        templateData.paymentDeadline = new Date(data.paymentDeadline).toLocaleString(
          "id-ID",
          {
            dateStyle: "full",
            timeStyle: "short",
          }
        );
      }

      await this.mailService.sendMail(
        to,
        subject,
        "payment-deadline-exceeded",
        templateData
      );
      console.log(`✅ Payment deadline exceeded email sent to ${to}`);
    } catch (error) {
      console.error("❌ Failed to send payment deadline exceeded email:", error);
    }
  };

  /**
   * ✅ NEW: Send user banned notification
   */
  sendUserBanned = async (to: string, data: any) => {
    try {
      await this.mailService.sendMail(
        to,
        `⛔ Account Temporarily Banned from Auctions`,
        "user-banned",
        {
          userName: data.userName,
          failureCount: data.failureCount,
          bannedUntil: new Date(data.bannedUntil).toLocaleString("id-ID", {
            dateStyle: "full",
            timeStyle: "short",
          }),
          year: new Date().getFullYear(),
        }
      );
      console.log(`✅ User banned notification sent to ${to}`);
    } catch (error) {
      console.error("❌ Failed to send user banned email:", error);
    }
  };

  /**
   * Send auction re-listed notification
   */
  sendAuctionRelisted = async (to: string, data: any) => {
    try {
      await this.mailService.sendMail(
        to,
        `🔄 ${data.productName} has been re-listed!`,
        "auction-relisted",
        {
          userName: data.userName,
          productName: data.productName,
          startPrice: data.startPrice.toLocaleString("id-ID"),
          buyOutPrice: data.buyOutPrice.toLocaleString("id-ID"),
          auctionUrl: data.auctionUrl,
          year: new Date().getFullYear(),
        }
      );
      console.log(`✅ Auction relisted email sent to ${to}`);
    } catch (error) {
      console.error("❌ Failed to send auction relisted email:", error);
    }
  };

  /**
   * Send auction cancelled notification
   */
  sendAuctionCancelled = async (to: string, data: any) => {
    try {
      await this.mailService.sendMail(
        to,
        `Auction Cancelled - ${data.productName}`,
        "auction-cancelled",
        {
          userName: data.userName,
          productName: data.productName,
          reason: data.reason,
          year: new Date().getFullYear(),
        }
      );
      console.log(`✅ Auction cancelled email sent to ${to}`);
    } catch (error) {
      console.error("❌ Failed to send auction cancelled email:", error);
    }
  };

  /**
   * Send payment failed notification to admin
   */
  sendAuctionPaymentFailedAdmin = async (data: any) => {
    try {
      await this.mailService.sendMail(
        this.adminEmail,
        `[ACTION REQUIRED] Auction Payment Failed - ID ${data.auctionId}`,
        "auction-payment-failed-admin",
        {
          auctionId: data.auctionId,
          productName: data.productName,
          winnerName: data.winnerName,
          winningBid: data.winningBid.toLocaleString("id-ID"),
          adminUrl: `${process.env.ADMIN_URL || "http://localhost:3000/admin"
            }/auctions/failed-payments`,
          year: new Date().getFullYear(),
        }
      );
      console.log(`✅ Payment failed admin notification sent`);
    } catch (error) {
      console.error("❌ Failed to send payment failed admin email:", error);
    }
  };

  // =====================================
  // LEGACY ALIASES (for backward compatibility)
  // =====================================

  /**
   * @deprecated Use sendAuctionEndedNotWon instead
   */
  sendAuctionLost = async (to: string, data: any) => {
    return this.sendAuctionEndedNotWon(to, data);
  };

  /**
   * @deprecated Use sendOutbidNotification instead
   */
  sendAuctionOutbid = async (to: string, data: any) => {
    return this.sendOutbidNotification(to, data);
  };

  /**
   * @deprecated Use sendPaymentDeadlineExceeded instead
   */
  sendAuctionPaymentFailed = async (to: string, data: any) => {
    return this.sendPaymentDeadlineExceeded(to, data);
  };

  /**
   * @deprecated Use sendUserBanned instead
   */
  sendAuctionBanned = async (to: string, data: any) => {
    return this.sendUserBanned(to, data);
  };
}