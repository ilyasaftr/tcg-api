import { OrderStatus } from "../../generated/prisma";
import { PrismaService } from "../../modules/prisma/prisma.service";
import { ApiError } from "../../utils/api-error";
import { ShipOrderDTO } from "./dto/ship-order.dto";
import { RevenueQueryDTO, RevenueGroupBy } from "./dto/revenue-query.dto";

export class AdminOrderService {
  private prisma: PrismaService;

  constructor() {
    this.prisma = new PrismaService();
  }

  // ========================================
  // GET ALL ORDERS WITH FILTERS
  // ========================================
  getAll = async (filters?: {
    status?: OrderStatus;
    search?: string;
    page?: number;
    limit?: number;
  }) => {
    const { status, search, page = 1, limit = 50 } = filters || {};

    const where: any = {};

    if (status) {
      where.status = status;
    }

    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: "insensitive" } },
        {
          user: {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
            ],
          },
        },
      ];
    }

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          _count: {
            select: {
              orderItems: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.order.count({ where }),
    ]);

    // Transform to match frontend expectations
    const transformedOrders = orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      customer: {
        id: order.user.id,
        name: order.user.name,
        email: order.user.email,
      },
      total: Number(order.total),
      itemCount: order._count.orderItems,
      createdAt: order.createdAt.toISOString(),
      paidAt: order.paidAt?.toISOString() || null,
      shippedAt: order.shippedAt?.toISOString() || null,
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

  // ========================================
  // GET ORDER BY ORDER NUMBER
  // ========================================
  getByOrderNumber = async (orderNumber: string) => {
    const order = await this.prisma.order.findUnique({
      where: { orderNumber },
      include: {
        address: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
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
          orderBy: {
            createdAt: "desc",
          },
        },
      },
    });

    if (!order) {
      throw new ApiError("Order not found", 404);
    }

    // Transform orderItems to match frontend format
    const items = order.orderItems.map((item) => ({
      id: item.id,
      productId: item.productId,
      variantId: item.variantId,
      productName: item.product.name,
      productSlug: item.product.slug,
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
    }));

    return {
      ...order,
      items,
      customer: order.user,
      subtotal: Number(order.subtotal),
      shippingCost: Number(order.shippingCost),
      packagingFee: Number(order.packagingFee),
      adminFee: Number(order.adminFee),
      discount: Number(order.discount),
      total: Number(order.total),
    };
  };


  // ========================================
  // PROCESS ORDER
  // ========================================
  processOrder = async (orderNumber: string, notes?: string) => {
    const order = await this.prisma.order.findUnique({
      where: { orderNumber },
    });

    if (!order) {
      throw new ApiError("Order not found", 404);
    }

    if (order.status !== "CONFIRMED") {
      throw new ApiError("Order must be confirmed first", 400);
    }

    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { orderNumber },
        data: {
          status: "PROCESSING",
          processingAt: new Date(),
        },
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          status: "PROCESSING",
          notes: notes || "Order is being processed",
          createdBy: "admin",
        },
      });

      return updated;
    });

    return updatedOrder;
  };

  // ========================================
  // SHIP ORDER
  // ========================================
  shipOrder = async (orderNumber: string, body: ShipOrderDTO) => {
    const order = await this.prisma.order.findUnique({
      where: { orderNumber },
    });

    if (!order) {
      throw new ApiError("Order not found", 404);
    }

    if (order.status !== "PROCESSING") {
      throw new ApiError("Order must be in processing status", 400);
    }

    const updatedOrder = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { orderNumber },
        data: {
          status: "SHIPPED",
          trackingNumber: body.trackingNumber,
          shippedAt: new Date(),
        },
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          status: "SHIPPED",
          notes: `Order shipped. Tracking: ${body.trackingNumber}. ${body.notes || ""}`,
          createdBy: "admin",
        },
      });

      return updated;
    });

    return updatedOrder;
  };

  // ========================================
  // ⭐ GET ORDER STATISTICS
  // ========================================
  getStatistics = async () => {
    console.log("📊 Calculating order statistics...");

    const statusCounts = await this.prisma.order.groupBy({
      by: ["status"],
      _count: {
        id: true,
      },
    });

    console.log("📈 Raw status counts from database:", statusCounts);

    const orderCounts = {
      total: 0,
      pending: 0,
      confirmed: 0,
      processing: 0,
      shipped: 0,
      completed: 0,
      cancelled: 0,
    };

    statusCounts.forEach((item) => {
      const count = item._count.id;
      orderCounts.total += count;

      switch (item.status) {
        case "PENDING":
          orderCounts.pending = count;
          break;
        case "CONFIRMED":
          orderCounts.confirmed = count;
          break;
        case "PROCESSING":
          orderCounts.processing = count;
          break;
        case "SHIPPED":
          orderCounts.shipped = count;
          break;
        case "COMPLETED":
          orderCounts.completed = count;
          break;
        case "CANCELLED":
          orderCounts.cancelled = count;
          break;
      }
    });

    console.log("✅ Order counts calculated:", orderCounts);

    const paidOrders = await this.prisma.order.findMany({
      where: {
        paymentStatus: "PAID",
        status: {
          in: ["CONFIRMED", "PROCESSING", "SHIPPED", "COMPLETED"],
        },
      },
      select: {
        total: true,
        createdAt: true,
      },
    });

    const totalRevenue = paidOrders.reduce(
      (sum, order) => sum + Number(order.total),
      0
    );

    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const thisMonthRevenue = paidOrders
      .filter((order) => new Date(order.createdAt) >= firstDayOfMonth)
      .reduce((sum, order) => sum + Number(order.total), 0);

    console.log("💰 Revenue calculated:", {
      total: totalRevenue,
      thisMonth: thisMonthRevenue,
    });

    const statistics = {
      orderCounts,
      revenue: {
        total: totalRevenue,
        thisMonth: thisMonthRevenue,
      },
    };

    console.log("📊 Final statistics:", statistics);

    return statistics;
  };

  // ========================================
  // ⭐ GET REVENUE STATISTICS (NEW!)
  // ========================================
  getRevenueStatistics = async (query: RevenueQueryDTO) => {
    console.log("💰 Calculating revenue statistics with query:", query);

    // 1. Parse dates or use defaults (current month)
    const now = new Date();
    const endDate = query.endDate ? new Date(query.endDate) : now;
    const startDate = query.startDate
      ? new Date(query.startDate)
      : new Date(now.getFullYear(), now.getMonth(), 1);

    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);

    console.log("📅 Date range:", {
      start: startDate.toISOString(),
      end: endDate.toISOString(),
    });

    // 2. Get current period revenue
    const currentPeriodOrders = await this.prisma.order.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        paymentStatus: "PAID",
        status: {
          in: ["CONFIRMED", "PROCESSING", "SHIPPED", "COMPLETED"],
        },
      },
      select: {
        id: true,
        total: true,
        createdAt: true,
        orderItems: {
          select: {
            productId: true,
            quantity: true,
            subtotal: true,
            product: {
              select: {
                id: true,
                name: true,
                thumbnail: true,
                productType: true,
              },
            },
          },
        },
      },
    });

    console.log(`📦 Found ${currentPeriodOrders.length} paid orders in current period`);

    // 3. Calculate current period metrics
    const currentRevenue = currentPeriodOrders.reduce(
      (sum, order) => sum + Number(order.total),
      0
    );

    const currentOrderCount = currentPeriodOrders.length;

    const averageOrderValue =
      currentOrderCount > 0 ? currentRevenue / currentOrderCount : 0;

    // 4. Previous period comparison (if requested)
    let previousRevenue = 0;
    let previousOrderCount = 0;
    let growthPercentage = 0;

    if (query.compareWithPrevious) {
      const periodDays = Math.ceil(
        (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      const prevEndDate = new Date(startDate);
      prevEndDate.setMilliseconds(-1);

      const prevStartDate = new Date(prevEndDate);
      prevStartDate.setDate(prevStartDate.getDate() - periodDays);

      console.log("📅 Previous period:", {
        start: prevStartDate.toISOString(),
        end: prevEndDate.toISOString(),
      });

      const previousPeriodOrders = await this.prisma.order.findMany({
        where: {
          createdAt: {
            gte: prevStartDate,
            lte: prevEndDate,
          },
          paymentStatus: "PAID",
          status: {
            in: ["CONFIRMED", "PROCESSING", "SHIPPED", "COMPLETED"],
          },
        },
        select: {
          total: true,
        },
      });

      previousRevenue = previousPeriodOrders.reduce(
        (sum, order) => sum + Number(order.total),
        0
      );
      previousOrderCount = previousPeriodOrders.length;

      if (previousRevenue > 0) {
        growthPercentage =
          ((currentRevenue - previousRevenue) / previousRevenue) * 100;
      } else if (currentRevenue > 0) {
        growthPercentage = 100;
      }

      console.log("📊 Comparison:", {
        current: currentRevenue,
        previous: previousRevenue,
        growth: `${growthPercentage.toFixed(2)}%`,
      });
    }

    // 5. Revenue breakdown by time
    let revenueBreakdown: any[] = [];

    if (query.groupBy) {
      revenueBreakdown = this.groupRevenueByPeriod(
        currentPeriodOrders,
        startDate,
        endDate,
        query.groupBy
      );
    }

    // 6. Top selling products
    const topProductsLimit = query.topProductsLimit || 10;
    const topProducts = this.calculateTopProducts(
      currentPeriodOrders,
      topProductsLimit
    );

    // 7. Revenue by product type
    const revenueByProductType = this.calculateRevenueByProductType(
      currentPeriodOrders
    );

    // 8. Return statistics
    return {
      period: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
      current: {
        revenue: Math.round(currentRevenue),
        orders: currentOrderCount,
        averageOrderValue: Math.round(averageOrderValue),
      },
      previous: query.compareWithPrevious
        ? {
          revenue: Math.round(previousRevenue),
          orders: previousOrderCount,
        }
        : null,
      growth: query.compareWithPrevious
        ? {
          percentage: Math.round(growthPercentage * 100) / 100,
          absolute: Math.round(currentRevenue - previousRevenue),
        }
        : null,
      breakdown: revenueBreakdown.length > 0 ? revenueBreakdown : null,
      topProducts,
      revenueByProductType,
    };
  };

  // ========================================
  // HELPER: Group revenue by period
  // ========================================
  groupRevenueByPeriod = (
    orders: any[],
    startDate: Date,
    endDate: Date,
    groupBy: RevenueGroupBy
  ) => {
    const grouped = new Map<string, { revenue: number; orders: number }>();

    orders.forEach((order) => {
      const date = new Date(order.createdAt);
      let key: string;

      if (groupBy === RevenueGroupBy.DAY) {
        key = date.toISOString().split("T")[0];
      } else if (groupBy === RevenueGroupBy.WEEK) {
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        key = weekStart.toISOString().split("T")[0];
      } else {
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      }

      if (!grouped.has(key)) {
        grouped.set(key, { revenue: 0, orders: 0 });
      }

      const current = grouped.get(key)!;
      current.revenue += Number(order.total);
      current.orders += 1;
    });

    return Array.from(grouped.entries())
      .map(([date, data]) => ({
        date,
        revenue: Math.round(data.revenue),
        orders: data.orders,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  };

  // ========================================
  // HELPER: Calculate top products
  // ========================================
  calculateTopProducts = (orders: any[], limit: number) => {
    interface ProductStat {
      id: number;
      name: string;
      thumbnail: string | null;
      productType: string;
      quantitySold: number;
      revenue: number;
    }

    const productStats = new Map<number, ProductStat>();

    orders.forEach((order) => {
      order.orderItems.forEach((item: any) => {
        if (!productStats.has(item.productId)) {
          productStats.set(item.productId, {
            id: item.product.id,
            name: item.product.name,
            thumbnail: item.product.thumbnail,
            productType: item.product.productType,
            quantitySold: 0,
            revenue: 0,
          });
        }

        const stats = productStats.get(item.productId)!;
        stats.quantitySold += item.quantity;
        stats.revenue += Number(item.subtotal);
      });
    });

    return Array.from(productStats.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, limit)
      .map((product) => ({
        ...product,
        revenue: Math.round(product.revenue),
      }));
  };

  // ========================================
  // HELPER: Calculate revenue by product type
  // ========================================
  calculateRevenueByProductType = (orders: any[]) => {
    interface TypeStat {
      revenue: number;
      orders: number;
      items: number;
    }

    const typeStats = new Map<string, TypeStat>();

    orders.forEach((order) => {
      order.orderItems.forEach((item: any) => {
        const type = item.product.productType;

        if (!typeStats.has(type)) {
          typeStats.set(type, { revenue: 0, orders: 0, items: 0 });
        }

        const stats = typeStats.get(type)!;
        stats.revenue += Number(item.subtotal);
        stats.items += item.quantity;
      });
    });

    orders.forEach((order) => {
      const types = new Set(
        order.orderItems.map((item: any) => item.product.productType)
      );
      types.forEach((type) => {
        const stats = typeStats.get(type as string)!;
        stats.orders += 1;
      });
    });

    return Array.from(typeStats.entries()).map(([type, data]) => ({
      productType: type,
      revenue: Math.round(data.revenue),
      orders: data.orders,
      itemsSold: data.items,
    }));
  };

  // ========================================
  // ⭐ GET DASHBOARD STATISTICS (NEW!)
  // ========================================
  getDashboardStatistics = async () => {
    console.log("📊 Calculating dashboard statistics...");

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalOrders,
      totalRevenue,
      todayOrders,
      todayRevenue,
      weekOrders,
      weekRevenue,
      monthOrders,
      monthRevenue,
      totalCustomers,
      monthCustomers,
      totalProducts,
      lowStockProducts,
    ] = await Promise.all([
      this.prisma.order.count(),

      this.prisma.order.aggregate({
        where: {
          paymentStatus: "PAID",
          status: { in: ["CONFIRMED", "PROCESSING", "SHIPPED", "COMPLETED"] },
        },
        _sum: { total: true },
      }),

      this.prisma.order.count({
        where: { createdAt: { gte: startOfToday } },
      }),

      this.prisma.order.aggregate({
        where: {
          createdAt: { gte: startOfToday },
          paymentStatus: "PAID",
          status: { in: ["CONFIRMED", "PROCESSING", "SHIPPED", "COMPLETED"] },
        },
        _sum: { total: true },
      }),

      this.prisma.order.count({
        where: { createdAt: { gte: startOfWeek } },
      }),

      this.prisma.order.aggregate({
        where: {
          createdAt: { gte: startOfWeek },
          paymentStatus: "PAID",
          status: { in: ["CONFIRMED", "PROCESSING", "SHIPPED", "COMPLETED"] },
        },
        _sum: { total: true },
      }),

      this.prisma.order.count({
        where: { createdAt: { gte: startOfMonth } },
      }),

      this.prisma.order.aggregate({
        where: {
          createdAt: { gte: startOfMonth },
          paymentStatus: "PAID",
          status: { in: ["CONFIRMED", "PROCESSING", "SHIPPED", "COMPLETED"] },
        },
        _sum: { total: true },
      }),

      this.prisma.user.count({
        where: { role: "USER" },
      }),

      this.prisma.user.count({
        where: {
          role: "USER",
          createdAt: { gte: startOfMonth },
        },
      }),

      this.prisma.product.count({
        where: { isActive: true },
      }),

      this.prisma.productVariant.count({
        where: {
          stock: { lt: 5 },
          isActive: true,
        },
      }),
    ]);

    return {
      orders: {
        total: totalOrders,
        today: todayOrders,
        thisWeek: weekOrders,
        thisMonth: monthOrders,
      },
      revenue: {
        total: Math.round(Number(totalRevenue._sum.total) || 0),
        today: Math.round(Number(todayRevenue._sum.total) || 0),
        thisWeek: Math.round(Number(weekRevenue._sum.total) || 0),
        thisMonth: Math.round(Number(monthRevenue._sum.total) || 0),
      },
      customers: {
        total: totalCustomers,
        newThisMonth: monthCustomers,
      },
      products: {
        total: totalProducts,
        lowStock: lowStockProducts,
      },
    };
  };
}