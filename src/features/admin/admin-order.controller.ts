import { Request, Response, NextFunction } from "express";
import { AdminOrderService } from "./admin-order.service";
import { RevenueQueryDTO, RevenueGroupBy } from "./dto/revenue-query.dto";

export class AdminOrderController {
  private adminOrderService: AdminOrderService;

  constructor() {
    this.adminOrderService = new AdminOrderService();
  }

  // ========================================
  // GET ALL ORDERS WITH FILTERS
  // ========================================
  getAll = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status, search, page, limit } = req.query;

      console.log("📋 Fetching orders with filters:", {
        status,
        search,
        page,
        limit,
      });

      const result = await this.adminOrderService.getAll({
        status: status as any,
        search: search as string,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });

      res.status(200).json({
        success: true,
        data: result.orders,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  };

  // ========================================
  // GET ORDER BY ORDER NUMBER
  // ========================================
  getByOrderNumber = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { orderNumber } = req.params;

      console.log("📦 Fetching order:", orderNumber);

      const order = await this.adminOrderService.getByOrderNumber(orderNumber);

      res.status(200).json({
        success: true,
        data: order,
      });
    } catch (error) {
      next(error);
    }
  };



  // ========================================
  // PROCESS ORDER
  // ========================================
  processOrder = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orderNumber } = req.params;
      const { notes } = req.body;

      console.log("⚙️ Processing order:", orderNumber);

      const order = await this.adminOrderService.processOrder(
        orderNumber,
        notes
      );

      res.status(200).json({
        success: true,
        message: "Order status updated to processing",
        data: order,
      });
    } catch (error) {
      next(error);
    }
  };

  // ========================================
  // SHIP ORDER
  // ========================================
  shipOrder = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orderNumber } = req.params;

      console.log("🚚 Shipping order:", orderNumber);

      const order = await this.adminOrderService.shipOrder(
        orderNumber,
        req.body
      );

      res.status(200).json({
        success: true,
        message: "Order shipped successfully",
        data: order,
      });
    } catch (error) {
      next(error);
    }
  };

  // ========================================
  // ⭐ GET ORDER STATISTICS
  // ========================================
  getStatistics = async (req: Request, res: Response, next: NextFunction) => {
    try {
      console.log("📊 Admin requesting order statistics");

      const statistics = await this.adminOrderService.getStatistics();

      res.status(200).json({
        success: true,
        data: statistics,
      });
    } catch (error) {
      console.error("❌ Error getting statistics:", error);
      next(error);
    }
  };

  // ========================================
  // ⭐ GET REVENUE STATISTICS (NEW!)
  // ========================================
  getRevenueStatistics = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      console.log("💰 Admin requesting revenue statistics");
      console.log("Query params:", req.query);

      const query: RevenueQueryDTO = {
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
        groupBy: req.query.groupBy as RevenueGroupBy,
        compareWithPrevious: req.query.compareWithPrevious === "true",
        topProductsLimit: req.query.topProductsLimit
          ? Number(req.query.topProductsLimit)
          : 10,
      };

      const statistics = await this.adminOrderService.getRevenueStatistics(
        query
      );

      res.status(200).json({
        success: true,
        data: statistics,
      });
    } catch (error) {
      console.error("❌ Error getting revenue statistics:", error);
      next(error);
    }
  };

  // ========================================
  // ⭐ GET DASHBOARD STATISTICS (NEW!)
  // ========================================
  getDashboardStatistics = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      console.log("📊 Admin requesting dashboard statistics");

      const statistics = await this.adminOrderService.getDashboardStatistics();

      res.status(200).json({
        success: true,
        data: statistics,
      });
    } catch (error) {
      console.error("❌ Error getting dashboard statistics:", error);
      next(error);
    }
  };
}