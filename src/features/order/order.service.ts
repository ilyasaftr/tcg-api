import { ApiError } from "../../utils/api-error";
import { generateOrderNumber } from "../../utils/order-number.util";
import { CreateOrderDto } from "./dto/create-order.dto";
import { CancelOrderDto } from "./dto/cancel-order.dto";
import { PrismaService } from "../../modules/prisma/prisma.service";
import { RajaOngkirService } from "../../modules/rajaongkir/rajaongkir.service";
import { EmailService } from "../../modules/mail/email.service";
import { PreviewAuctionCheckoutDto } from "../../modules/auction/dto/preview-auction-checkout.dto";
import { CheckoutAuctionsDto } from "../../modules/auction/dto/checkout-auctions.dto";
import { BisteshipService } from "../../services/biteship.service";
import { ShippingCalculatorService } from "../../services/shipping-calculator.service";
import { Prisma } from "../../generated/prisma";
import { XenditInvoiceService } from "../../services/xendit-invoice.service";

export class OrderService {
  prisma: PrismaService;
  packagingFee: number;
  rajaOngkirService: RajaOngkirService;
  biteship: BisteshipService;
  shippingCalculator: ShippingCalculatorService;
  emailService: EmailService;
  xenditInvoice: XenditInvoiceService;

  constructor() {
    this.prisma = new PrismaService();
    this.packagingFee = parseInt(process.env.PACKAGING_FEE || "2500");
    this.rajaOngkirService = new RajaOngkirService();
    this.biteship = new BisteshipService();
    this.shippingCalculator = new ShippingCalculatorService();
    this.emailService = new EmailService();
    this.xenditInvoice = new XenditInvoiceService();
  }

  private isOrderNumberCollision(error: unknown) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
    if (error.code !== "P2002") return false;
    const target = (error.meta as { target?: unknown } | undefined)?.target;
    if (Array.isArray(target)) return target.includes("orderNumber");
    return target === "orderNumber";
  }

  /**
   * Create order from cart (Checkout)
   */
  create = async (userId: number, data: CreateOrderDto) => {
    // 1. Get user's cart with items
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
      include: {
        cartItems: {
          include: {
            product: {
              include: {
                images: {
                  where: { isMain: true },
                  take: 1,
                },
              },
            },
            variant: {
              include: {
                rarity: true,
                condition: true,
              },
            },
          },
        },
      },
    });

    if (!cart || cart.cartItems.length === 0) {
      throw new ApiError("Cart is empty", 400);
    }

    // 2. Get user info for email
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    if (!user) {
      throw new ApiError("User not found", 404);
    }

    // 3. Validate address belongs to user
    const address = await this.prisma.address.findFirst({
      where: {
        id: data.addressId,
        userId,
      },
    });

    if (!address) {
      throw new ApiError("Address not found", 404);
    }

    // 4. Validate stock availability
    for (const item of cart.cartItems) {
      if (item.variant.stock < item.quantity) {
        throw new ApiError(
          `Insufficient stock for ${item.product.name}. Available: ${item.variant.stock}, Requested: ${item.quantity}`,
          400
        );
      }
    }

    // 5. Calculate totals
    const subtotal = cart.cartItems.reduce((sum, item) => {
      return sum + Number(item.variant.price) * item.quantity;
    }, 0);

    const totalWeight = cart.cartItems.reduce((sum, item) => {
      const weight = item.variant.weight || item.product.weight;
      return sum + weight * item.quantity;
    }, 0);

    console.log("🔍 Verifying shipping cost (RajaOngkir → Biteship fallback)...");
    const shippingOptions = await this.shippingCalculator.calculateShippingOptions({
      address: {
        postalCode: address.postalCode,
        cityName: address.cityName,
        provinceName: address.provinceName,
        districtName: (address as any).districtName,
        subdistrictName: (address as any).subdistrictName,
      },
      weight: totalWeight,
      courier: data.courierCode,
    });

    const selectedShipping = shippingOptions.find(
      (option) =>
        option.code.toLowerCase() === data.courierCode.toLowerCase() &&
        option.service === data.courierService
    );

    if (!selectedShipping) {
      throw new ApiError("Invalid shipping service selected", 400);
    }

    if (selectedShipping.cost !== data.shippingCost) {
      throw new ApiError(
        `Shipping cost mismatch. Expected: ${selectedShipping.cost}, Received: ${data.shippingCost}`,
        400
      );
    }

    const total = subtotal + data.shippingCost + this.packagingFee;

    // 6. Create order with transaction (+ retry on unique orderNumber collision)
    const order = await (async () => {
      for (let attempt = 1; attempt <= 5; attempt++) {
        const orderNumber = await generateOrderNumber();
        const invoiceDurationSeconds = Number.parseInt(
          process.env.XENDIT_INVOICE_DURATION_SECONDS || String(24 * 60 * 60),
          10
        );
        const invoice = await this.xenditInvoice.createInvoice({
          externalId: orderNumber,
          amount: Number(total),
          payerEmail: user.email,
          description: `TCG Store order ${orderNumber}`,
          invoiceDurationSeconds,
          successRedirectUrl: `${process.env.FRONTEND_URL || ""}/orders/${orderNumber}`,
          failureRedirectUrl: `${process.env.FRONTEND_URL || ""}/orders/${orderNumber}`,
          items: cart.cartItems.map((item) => ({
            name: item.product.name,
            quantity: item.quantity,
            price: Number(item.variant.price),
            category: item.product.productType,
            url: `${process.env.FRONTEND_URL || ""}/products/${item.product.slug}`,
          })),
          metadata: { orderNumber },
        });
        const paymentDeadline = new Date(
          Date.now() + invoiceDurationSeconds * 1000
        );

        console.log("📦 Creating order:", orderNumber);

        try {
          return await this.prisma.$transaction(async (tx) => {
            const newOrder = await tx.order.create({
              data: {
                orderNumber,
                userId,
                addressId: data.addressId,
                courier: data.courier,
                courierCode: data.courierCode,
                courierService: data.courierService,
                courierServiceName: data.courierServiceName,
                estimatedDelivery: data.estimatedDelivery || selectedShipping.etd,
                weight: totalWeight,
                paymentMethod: "XENDIT_INVOICE",
                paymentStatus: "UNPAID",
                xenditInvoiceId: invoice.id,
                xenditInvoiceUrl: invoice.invoiceUrl,
                xenditInvoiceStatus: String(invoice.status || "PENDING"),
                subtotal,
                shippingCost: data.shippingCost,
                packagingFee: this.packagingFee,
                adminFee: 0,
                discount: 0,
                total,
                status: "PENDING",
                notes: data.notes,
                paymentDeadline,
              },
            });

            for (const item of cart.cartItems) {
              await tx.orderItem.create({
                data: {
                  orderId: newOrder.id,
                  productId: item.productId,
                  variantId: item.variantId,
                  quantity: item.quantity,
                  price: item.variant.price,
                  subtotal: Number(item.variant.price) * item.quantity,
                  sourceType: "REGULAR", // ✅ Regular order
                },
              });

              await tx.productVariant.update({
                where: { id: item.variantId },
                data: { stock: { decrement: item.quantity } },
              });
            }

            await tx.orderStatusHistory.create({
              data: {
                orderId: newOrder.id,
                status: "PENDING",
                notes: "Order created",
                createdBy: `user-${userId}`,
              },
            });

            await tx.cartItem.deleteMany({
              where: { cartId: cart.id },
            });

            return newOrder;
          });
        } catch (error) {
          if (this.isOrderNumberCollision(error) && attempt < 5) {
            console.warn(
              `⚠️ Order number collision (attempt ${attempt}); retrying...`
            );
            continue;
          }
          throw error;
        }
      }

      throw new ApiError("Failed to generate unique order number", 500);
    })();

    console.log("✅ Order created successfully:", order.orderNumber);

    // Send email notification
    try {
      await this.emailService.sendOrderCreated(user.email, {
        customerName: user.name,
        orderNumber: order.orderNumber,
        total: Number(total),
        itemCount: cart.cartItems.length,
        items: cart.cartItems.map((item) => ({
          name: item.product.name,
          quantity: item.quantity,
          price: Number(item.variant.price),
        })),
      });
      console.log("✅ Order confirmation email sent to customer");
    } catch (emailError) {
      console.error("❌ Failed to send order confirmation email:", emailError);
    }

    return await this.getById(userId, order.orderNumber);
  };

  /**
   * ✅ NEW: Preview auction checkout (calculate shipping options)
   */
  previewAuctionCheckout = async (
    userId: number,
    data: PreviewAuctionCheckoutDto
  ) => {
    // 1. Validate auctions belong to user and are eligible
    const auctions = await this.prisma.auction.findMany({
      where: {
        id: { in: data.auctionIds },
        winnerId: userId,
        status: "ENDED",
        orderId: null, // Not already linked to an order
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            thumbnail: true,
            weight: true,
          },
        },
        variant: {
          select: {
            id: true,
            weight: true,
            rarity: {
              select: { name: true },
            },
            condition: {
              select: { name: true },
            },
          },
        },
      },
    });

    if (auctions.length === 0) {
      throw new ApiError("No valid auctions found", 404);
    }

    if (auctions.length !== data.auctionIds.length) {
      throw new ApiError("Some auctions are not available for checkout", 400);
    }

    console.log(`📊 Previewing checkout for ${auctions.length} auctions`);

    // 2. Validate address belongs to user
    const address = await this.prisma.address.findFirst({
      where: {
        id: data.addressId,
        userId,
      },
    });

    if (!address) {
      throw new ApiError("Address not found", 404);
    }

    // 3. Calculate totals
    const subtotal = auctions.reduce(
      (sum, auction) => sum + Number(auction.currentBid),
      0
    );

    // Calculate total weight
    const totalWeight = auctions.reduce((sum, auction) => {
      const weight = auction.variant.weight || auction.product.weight;
      return sum + weight * auction.quantity;
    }, 0);

    console.log(`   Subtotal: Rp ${subtotal.toLocaleString("id-ID")}`);
    console.log(`   Total weight: ${totalWeight}g`);

    // 4. Find earliest payment deadline
    const earliestDeadline = auctions.reduce((earliest, auction) => {
      if (!auction.paymentDeadline) return earliest;
      return !earliest || auction.paymentDeadline < earliest
        ? auction.paymentDeadline
        : earliest;
    }, null as Date | null);

    if (!earliestDeadline) {
      throw new ApiError("Payment deadline not set for auctions", 400);
    }

    console.log(`   Payment deadline: ${earliestDeadline.toISOString()}`);

    console.log("🚚 Calculating shipping options...");
    const shippingOptions = await this.shippingCalculator.calculateShippingOptions({
      address: {
        postalCode: address.postalCode,
        cityName: address.cityName,
        provinceName: address.provinceName,
        districtName: (address as any).districtName,
        subdistrictName: (address as any).subdistrictName,
      },
      weight: totalWeight,
      courier: data.courier,
    });

    console.log(`✅ Found ${shippingOptions.length} shipping options`);

    // ⭐ FIX: Proper mapping dari RajaOngkir response
    const optionsWithTotal = shippingOptions.map((option) => ({
      code: option.code, // "jne", "tiki", "pos"
      courier: option.name, // ⭐ "JNE", "TIKI", "POS Indonesia"
      service: option.service, // "REG", "YES", "OKE"
      description: option.description, // "Layanan Reguler"
      cost: option.cost, // 25000
      etd: option.etd, // "2-3 hari"
      subtotal,
      packagingFee: this.packagingFee,
      total: subtotal + option.cost + this.packagingFee,
    }));

    return {
      auctions: auctions.map((auction) => ({
        id: auction.id,
        product: auction.product,
        variant: auction.variant,
        quantity: auction.quantity,
        winningBid: Number(auction.currentBid),
        paymentDeadline: auction.paymentDeadline,
      })),
      subtotal,
      totalWeight,
      packagingFee: this.packagingFee,
      paymentDeadline: earliestDeadline,
      address: {
        id: address.id,
        label: address.label,
        recipientName: address.recipientName,
        phoneNumber: address.phoneNumber,
        street: address.street,
        cityName: address.cityName,
        provinceName: address.provinceName,
        postalCode: address.postalCode,
      },
      shippingOptions: optionsWithTotal,
    };
  };

  /**
   * ✅ NEW: Create order from auctions (Batch checkout)
   */
  createFromAuctions = async (userId: number, data: CheckoutAuctionsDto) => {
    // 1. Validate auctions belong to user and are eligible
    const auctions = await this.prisma.auction.findMany({
      where: {
        id: { in: data.auctionIds },
        winnerId: userId,
        status: "ENDED",
        orderId: null,
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            thumbnail: true,
            weight: true,
          },
        },
        variant: {
          select: {
            id: true,
            price: true,
            weight: true,
            rarity: {
              select: { name: true },
            },
            condition: {
              select: { name: true },
            },
          },
        },
      },
    });

    if (auctions.length === 0) {
      throw new ApiError("No valid auctions found", 404);
    }

    if (auctions.length !== data.auctionIds.length) {
      throw new ApiError("Some auctions are not available for checkout", 400);
    }

    // 2. Get user info for email
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    if (!user) {
      throw new ApiError("User not found", 404);
    }

    // 3. Validate address belongs to user
    const address = await this.prisma.address.findFirst({
      where: {
        id: data.addressId,
        userId,
      },
    });

    if (!address) {
      throw new ApiError("Address not found", 404);
    }

    // 4. Calculate totals
    const subtotal = auctions.reduce(
      (sum, auction) => sum + Number(auction.currentBid),
      0
    );

    const totalWeight = auctions.reduce((sum, auction) => {
      const weight = auction.variant.weight || auction.product.weight;
      return sum + weight * auction.quantity;
    }, 0);

    console.log("🔍 Verifying shipping cost (RajaOngkir → Biteship fallback)...");
    const shippingOptions = await this.shippingCalculator.calculateShippingOptions({
      address: {
        postalCode: address.postalCode,
        cityName: address.cityName,
        provinceName: address.provinceName,
        districtName: (address as any).districtName,
        subdistrictName: (address as any).subdistrictName,
      },
      weight: totalWeight,
      courier: data.courierCode,
    });

    const selectedShipping = shippingOptions.find(
      (option) =>
        option.code.toLowerCase() === data.courierCode.toLowerCase() &&
        option.service === data.courierService
    );

    if (!selectedShipping) {
      throw new ApiError("Invalid shipping service selected", 400);
    }

    if (selectedShipping.cost !== data.shippingCost) {
      throw new ApiError(
        `Shipping cost mismatch. Expected: ${selectedShipping.cost}, Received: ${data.shippingCost}`,
        400
      );
    }

    const total = subtotal + data.shippingCost + this.packagingFee;

    // 6. Find earliest payment deadline
    const earliestDeadline = auctions.reduce((earliest, auction) => {
      if (!auction.paymentDeadline) return earliest;
      return !earliest || auction.paymentDeadline < earliest
        ? auction.paymentDeadline
        : earliest;
    }, null as Date | null);

    if (!earliestDeadline) {
      throw new ApiError("Payment deadline not set for auctions", 400);
    }

    console.log(`   Auctions: ${data.auctionIds.join(", ")}`);
    console.log(`   Total: Rp ${total.toLocaleString("id-ID")}`);

    // 8. Create order with transaction
    const order = await (async () => {
      for (let attempt = 1; attempt <= 5; attempt++) {
        const orderNumber = await generateOrderNumber();
        const invoiceDurationSeconds = Math.max(
          60,
          Math.floor((earliestDeadline.getTime() - Date.now()) / 1000)
        );
        const invoice = await this.xenditInvoice.createInvoice({
          externalId: orderNumber,
          amount: Number(total),
          payerEmail: user.email,
          description: `TCG Store auction order ${orderNumber}`,
          invoiceDurationSeconds,
          successRedirectUrl: `${process.env.FRONTEND_URL || ""}/orders/${orderNumber}`,
          failureRedirectUrl: `${process.env.FRONTEND_URL || ""}/orders/${orderNumber}`,
          items: auctions.map((auction) => ({
            name: auction.product.name,
            quantity: auction.quantity,
            price: Number(auction.currentBid),
            url: `${process.env.FRONTEND_URL || ""}/auctions/${auction.id}`,
          })),
          metadata: { orderNumber, auctionIds: data.auctionIds },
        });

        console.log("📦 Creating order from auctions:", orderNumber);

        try {
          return await this.prisma.$transaction(async (tx) => {
            const newOrder = await tx.order.create({
              data: {
                orderNumber,
                userId,
                addressId: data.addressId,
                courier: data.courier,
                courierCode: data.courierCode,
                courierService: data.courierService,
                courierServiceName: data.courierServiceName,
                estimatedDelivery: data.estimatedDelivery || selectedShipping.etd,
                weight: totalWeight,
                paymentMethod: "XENDIT_INVOICE",
                paymentStatus: "UNPAID",
                xenditInvoiceId: invoice.id,
                xenditInvoiceUrl: invoice.invoiceUrl,
                xenditInvoiceStatus: String(invoice.status || "PENDING"),
                subtotal,
                shippingCost: data.shippingCost,
                packagingFee: this.packagingFee,
                adminFee: 0,
                discount: 0,
                total,
                status: "PENDING",
                notes: data.notes,
                paymentDeadline: earliestDeadline, // ✅ NEW
              },
            });

            // Create OrderItems (one per auction)
            for (const auction of auctions) {
              await tx.orderItem.create({
                data: {
                  orderId: newOrder.id,
                  productId: auction.product.id,
                  variantId: auction.variant.id,
                  quantity: auction.quantity,
                  price: auction.currentBid,
                  subtotal: Number(auction.currentBid) * auction.quantity,
                  sourceType: "AUCTION", // ✅ NEW
                  sourceId: auction.id, // ✅ NEW
                },
              });
            }

            // Link auctions to order
            await tx.auction.updateMany({
              where: {
                id: { in: data.auctionIds },
              },
              data: {
                orderId: newOrder.id,
              },
            });

            // Create status history
            await tx.orderStatusHistory.create({
              data: {
                orderId: newOrder.id,
                status: "PENDING",
                notes: `Order created from ${auctions.length} auction(s)`,
                createdBy: `user-${userId}`,
              },
            });

            return newOrder;
          });
        } catch (error) {
          if (this.isOrderNumberCollision(error) && attempt < 5) {
            console.warn(
              `⚠️ Order number collision (attempt ${attempt}); retrying...`
            );
            continue;
          }
          throw error;
        }
      }

      throw new ApiError("Failed to generate unique order number", 500);
    })();

    console.log("✅ Order created successfully:", order.orderNumber);

    // Send email notification
    try {
      await this.emailService.sendOrderCreated(user.email, {
        customerName: user.name,
        orderNumber: order.orderNumber,
        total: Number(total),
        itemCount: auctions.length,
        items: auctions.map((auction) => ({
          name: auction.product.name,
          quantity: auction.quantity,
          price: Number(auction.currentBid),
        })),
      });
      console.log("✅ Order confirmation email sent to customer");
    } catch (emailError) {
      console.error("❌ Failed to send order confirmation email:", emailError);
    }

    return await this.getById(userId, order.orderNumber);
  };

  /**
   * Get all orders for user
   */
  getAll = async (userId: number) => {
    const orders = await this.prisma.order.findMany({
      where: { userId },
      include: {
        address: true,
        orderItems: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                slug: true,
                thumbnail: true,
                productType: true,
              },
            },
            variant: {
              select: {
                id: true,
                price: true,
                sku: true,
                rarity: {
                  select: {
                    name: true,
                    shortName: true,
                  },
                },
                condition: {
                  select: {
                    name: true,
                    shortName: true,
                  },
                },
              },
            },
          },
        },
        _count: {
          select: { orderItems: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      xenditInvoiceUrl: (order as any).xenditInvoiceUrl,
      xenditInvoiceStatus: (order as any).xenditInvoiceStatus,
      paymentDeadline: order.paymentDeadline, // ✅ NEW
      total: Number(order.total),
      itemCount: order._count.orderItems,
      createdAt: order.createdAt,
      items: order.orderItems.map((item) => ({
        id: item.id,
        productName: item.product.name,
        productImage: item.product.thumbnail,
        quantity: item.quantity,
        price: Number(item.price),
        subtotal: Number(item.subtotal),
        sourceType: item.sourceType, // ✅ NEW
      })),
    }));
  };

  getAllPaginated = async (
    userId: number,
    pagination?: { page?: number; limit?: number; skip?: number }
  ) => {
    const limit = pagination?.limit ?? 20;
    const skip = pagination?.page !== undefined ? (pagination.page - 1) * limit : 0;
    const effectiveSkip =
      pagination?.page !== undefined ? skip : (pagination?.skip ?? 0);
    const page =
      pagination?.page !== undefined
        ? pagination.page
        : Math.floor(effectiveSkip / limit) + 1;

    const [orders, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where: { userId },
        include: {
          address: true,
          orderItems: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  thumbnail: true,
                  productType: true,
                },
              },
              variant: {
                select: {
                  id: true,
                  price: true,
                  sku: true,
                  rarity: {
                    select: {
                      name: true,
                      shortName: true,
                    },
                  },
                  condition: {
                    select: {
                      name: true,
                      shortName: true,
                    },
                  },
                },
              },
            },
          },
          _count: {
            select: { orderItems: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: effectiveSkip,
        take: limit,
      }),
      this.prisma.order.count({ where: { userId } }),
    ]);

    const transformedOrders = orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      xenditInvoiceUrl: (order as any).xenditInvoiceUrl,
      xenditInvoiceStatus: (order as any).xenditInvoiceStatus,
      paymentDeadline: order.paymentDeadline,
      total: Number(order.total),
      itemCount: order._count.orderItems,
      createdAt: order.createdAt,
      items: order.orderItems.map((item) => ({
        id: item.id,
        productName: item.product.name,
        productImage: item.product.thumbnail,
        quantity: item.quantity,
        price: Number(item.price),
        subtotal: Number(item.subtotal),
        sourceType: item.sourceType,
      })),
    }));

    return {
      orders: transformedOrders,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  };

  /**
   * Get order by order number
   */
  getById = async (userId: number, orderNumber: string) => {
    const order = await this.prisma.order.findFirst({
      where: {
        orderNumber,
        userId,
      },
      include: {
        address: true,
        orderItems: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                slug: true,
                thumbnail: true,
                productType: true,
              },
            },
            variant: {
              select: {
                id: true,
                price: true,
                sku: true,
                rarity: {
                  select: {
                    name: true,
                    shortName: true,
                  },
                },
                condition: {
                  select: {
                    name: true,
                    shortName: true,
                  },
                },
              },
            },
          },
        },
        statusHistory: {
          orderBy: { createdAt: "desc" },
        },
        auctions: {
          // ✅ NEW: Include linked auctions
          select: {
            id: true,
            productId: true,
            quantity: true,
            currentBid: true,
          },
        },
      },
    });

    if (!order) {
      throw new ApiError("Order not found", 404);
    }

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      xenditInvoiceUrl: (order as any).xenditInvoiceUrl,
      xenditInvoiceStatus: (order as any).xenditInvoiceStatus,
      paymentDeadline: order.paymentDeadline, // ✅ NEW
      subtotal: Number(order.subtotal),
      shippingCost: Number(order.shippingCost),
      packagingFee: Number(order.packagingFee),
      adminFee: Number(order.adminFee),
      discount: Number(order.discount),
      total: Number(order.total),
      courier: order.courier,
      courierService: order.courierService,
      courierServiceName: order.courierServiceName,
      trackingNumber: order.trackingNumber,
      estimatedDelivery: order.estimatedDelivery,
      weight: order.weight,
      paymentMethod: order.paymentMethod,
      address: {
        id: order.address.id,
        label: order.address.label,
        recipientName: order.address.recipientName,
        phoneNumber: order.address.phoneNumber,
        street: order.address.street,
        cityName: order.address.cityName,
        provinceName: order.address.provinceName,
        postalCode: order.address.postalCode,
      },
      items: order.orderItems.map((item) => ({
        id: item.id,
        productId: item.productId,
        variantId: item.variantId,
        productName: item.product.name,
        productSlug: item.product.slug || 'product-not-found',
        productImage: item.product.thumbnail,
        productType: item.product.productType,
        variantInfo: {
          rarity: item.variant.rarity?.name,
          condition: item.variant.condition?.name,
          sku: item.variant.sku,
        },
        quantity: item.quantity,
        price: Number(item.price),
        subtotal: Number(item.subtotal),
        sourceType: item.sourceType, // ✅ NEW
        sourceId: item.sourceId, // ✅ NEW
      })),
      auctions: order.auctions, // ✅ NEW
      notes: order.notes,
      adminNotes: order.adminNotes,
      cancellationReason: order.cancellationReason,
      statusHistory: order.statusHistory,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      paidAt: order.paidAt,
      confirmedAt: order.confirmedAt,
      processingAt: order.processingAt,
      shippedAt: order.shippedAt,
      deliveredAt: order.deliveredAt,
      completedAt: order.completedAt,
      cancelledAt: order.cancelledAt,
    };
  };



  /**
   * Cancel order (customer only - if status is PENDING) - UPDATED
   */
  cancel = async (
    userId: number,
    orderNumber: string,
    data: CancelOrderDto
  ) => {
    const order = await this.prisma.order.findFirst({
      where: {
        orderNumber,
        userId,
      },
      include: {
        orderItems: true,
        auctions: true, // ✅ Check if order has linked auctions
      },
    });

    if (!order) {
      throw new ApiError("Order not found", 404);
    }

    if (order.status !== "PENDING") {
      throw new ApiError(
        "Only pending orders can be cancelled by customer",
        400
      );
    }

    // ✅ CHECK: If order has auctions, CANNOT be cancelled by user
    if (order.auctions && order.auctions.length > 0) {
      throw new ApiError(
        "Auction orders cannot be cancelled. Please contact admin if you need assistance.",
        400
      );
    }

    console.log("🔄 Cancelling order:", orderNumber);

    // Regular order - restore stock
    await this.prisma.$transaction(async (tx) => {
      for (const item of order.orderItems) {
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: {
            stock: {
              increment: item.quantity,
            },
          },
        });
      }

      await tx.order.update({
        where: { id: order.id },
        data: {
          status: "CANCELLED",
          cancellationReason: data.reason,
          cancelledAt: new Date(),
        },
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          status: "CANCELLED",
          notes: `Cancelled by customer. Reason: ${data.reason}`,
          createdBy: `user-${userId}`,
        },
      });
    });

    console.log("✅ Order cancelled successfully");

    return { message: "Order cancelled successfully" };
  };

  /**
   * Customer confirms receipt of order
   */
  confirmReceipt = async (userId: number, orderNumber: string) => {
    const order = await this.prisma.order.findFirst({
      where: {
        orderNumber,
        userId,
      },
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

    if (!order) {
      throw new ApiError("Order not found", 404);
    }

    if (order.status !== "SHIPPED") {
      throw new ApiError("Only shipped orders can be confirmed", 400);
    }

    console.log("✅ Customer confirming receipt:", orderNumber);

    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id: order.id },
        data: {
          status: "COMPLETED",
          deliveredAt: new Date(),
          completedAt: new Date(),
        },
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          status: "COMPLETED",
          notes: "Order completed - confirmed by customer",
          createdBy: `user-${userId}`,
        },
      });

      return updated;
    });

    // Send email notification
    try {
      await this.emailService.sendOrderCompleted(order.user.email, {
        customerName: order.user.name,
        orderNumber: order.orderNumber,
      });
      console.log("✅ Order completed email sent to customer");
    } catch (emailError) {
      console.error("❌ Failed to send order completed email:", emailError);
    }

    return await this.getById(userId, orderNumber);
  };

  /**
   * Auto-complete orders shipped 7+ days ago (Cron job)
   */
  autoCompleteOrders = async () => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    console.log(
      `🔍 Checking for orders to auto-complete (shipped before ${sevenDaysAgo.toISOString()})...`
    );

    const ordersToComplete = await this.prisma.order.findMany({
      where: {
        status: "SHIPPED",
        shippedAt: {
          lte: sevenDaysAgo,
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
      },
    });

    console.log(`📦 Found ${ordersToComplete.length} orders to auto-complete`);

    for (const order of ordersToComplete) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.order.update({
            where: { id: order.id },
            data: {
              status: "COMPLETED",
              deliveredAt: new Date(),
              completedAt: new Date(),
            },
          });

          await tx.orderStatusHistory.create({
            data: {
              orderId: order.id,
              status: "COMPLETED",
              notes: "Auto-completed after 7 days of shipment",
              createdBy: "system",
            },
          });
        });

        // Send email notification
        try {
          await this.emailService.sendOrderAutoCompleted(order.user.email, {
            customerName: order.user.name,
            orderNumber: order.orderNumber,
          });
          console.log(`✅ Auto-completed email sent for ${order.orderNumber}`);
        } catch (emailError) {
          console.error(
            `❌ Failed to send auto-complete email for ${order.orderNumber}:`,
            emailError
          );
        }

        console.log(`✅ Auto-completed order: ${order.orderNumber}`);
      } catch (error) {
        console.error(
          `❌ Failed to auto-complete order ${order.orderNumber}:`,
          error
        );
      }
    }

    return {
      message: `Auto-completed ${ordersToComplete.length} orders`,
      count: ordersToComplete.length,
      orders: ordersToComplete.map((o) => o.orderNumber),
    };
  };

  /**
   * Get order count for user
   */
  count = async (userId: number) => {
    return await this.prisma.order.count({
      where: { userId },
    });
  };
}
