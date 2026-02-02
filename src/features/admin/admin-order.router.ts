import { Router } from "express";
import { AdminOrderController } from "./admin-order.controller";
import { ShipOrderDTO } from "./dto/ship-order.dto";
import { JwtMiddleware } from "../../middlewares/jwt.middleware";
import { RoleMiddleware } from "../../middlewares/role.middleware";
import { validateBody } from "../../middlewares/validate.middleware";

export class AdminOrderRouter {
  private router: Router;
  private adminOrderController: AdminOrderController;
  private jwtMiddleware: JwtMiddleware;
  private roleMiddleware: RoleMiddleware;

  constructor() {
    this.router = Router();
    this.adminOrderController = new AdminOrderController();
    this.jwtMiddleware = new JwtMiddleware();
    this.roleMiddleware = new RoleMiddleware();
    this.initializeRoutes();
  }

  private initializeRoutes = () => {
    console.log("🚀 Initializing Admin Order Routes...");

    const authChain = [
      this.jwtMiddleware.verifyToken(process.env.JWT_SECRET!),
      this.roleMiddleware.isAdmin,
    ];

    // ⭐⭐⭐ CRITICAL: SPECIFIC ROUTES MUST COME FIRST ⭐⭐⭐

    // 1. GET /admin/orders/statistics (SPECIFIC - FIRST!)
    this.router.get(
      "/statistics",
      ...authChain,
      this.adminOrderController.getStatistics
    );
    console.log("✅ Registered: GET /admin/orders/statistics");

    // ⭐ 2. GET /admin/orders/revenue (NEW!)
    this.router.get(
      "/revenue",
      ...authChain,
      this.adminOrderController.getRevenueStatistics
    );
    console.log("✅ Registered: GET /admin/orders/revenue");

    // ⭐ 3. GET /admin/orders/dashboard (NEW!)
    this.router.get(
      "/dashboard",
      ...authChain,
      this.adminOrderController.getDashboardStatistics
    );
    console.log("✅ Registered: GET /admin/orders/dashboard");

    // 4. GET /admin/orders (ROOT - List all)
    this.router.get("/", ...authChain, this.adminOrderController.getAll);
    console.log("✅ Registered: GET /admin/orders");


    // 8. POST /admin/orders/:orderNumber/process (SPECIFIC SUFFIX)
    this.router.post(
      "/:orderNumber/process",
      ...authChain,
      this.adminOrderController.processOrder
    );
    console.log("✅ Registered: POST /admin/orders/:orderNumber/process");

    // 9. POST /admin/orders/:orderNumber/ship (SPECIFIC SUFFIX)
    this.router.post(
      "/:orderNumber/ship",
      ...authChain,
      validateBody(ShipOrderDTO),
      this.adminOrderController.shipOrder
    );
    console.log("✅ Registered: POST /admin/orders/:orderNumber/ship");

    // 10. GET /admin/orders/:orderNumber (DYNAMIC - LAST!)
    this.router.get(
      "/:orderNumber",
      ...authChain,
      this.adminOrderController.getByOrderNumber
    );
    console.log("✅ Registered: GET /admin/orders/:orderNumber");

    console.log("✅ Admin Order Routes Initialized Successfully!");
  };

  getRouter = () => this.router;
}
