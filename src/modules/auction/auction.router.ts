import { Router } from "express";
import { AuctionController } from "./auction.controller";
import { JwtMiddleware } from "../../middlewares/jwt.middleware";
import { RoleMiddleware } from "../../middlewares/role.middleware";
import { validateBody } from "../../middlewares/validate.middleware";
import { CreateAuctionDto } from "./dto/create-auction.dto";
import { UpdateAuctionDto } from "./dto/update-auction.dto"; // ✅ ADD: Import UpdateDto
import { RelistAuctionDto } from "./dto/relist-auction.dto";

export class AuctionRouter {
  router: Router;
  auctionController: AuctionController;
  jwtMiddleware: JwtMiddleware;
  roleMiddleware: RoleMiddleware;

  constructor() {
    this.router = Router();
    this.auctionController = new AuctionController();
    this.jwtMiddleware = new JwtMiddleware();
    this.roleMiddleware = new RoleMiddleware();
    this.initializeRoutes();
  }

  initializeRoutes = () => {
    const jwtSecret = process.env.JWT_SECRET!;
    const authChain = [this.jwtMiddleware.verifyToken(jwtSecret)];
    const adminChain = [
      this.jwtMiddleware.verifyToken(jwtSecret),
      this.roleMiddleware.isAdmin,
    ];

    /**
     * GET /auctions
     * Get all auctions (Public)
     */
    this.router.get("/", this.auctionController.getAll);

    /**
     * GET /auctions/admin/failed-payments
     * Get auctions with payment failures (Admin only)
     */
    this.router.get(
      "/admin/failed-payments",
      ...adminChain,
      this.auctionController.getFailedPayments
    );

    /**
     * GET /auctions/:id/bids
     * Get bid history for auction (Public)
     */
    this.router.get("/:id/bids", this.auctionController.getBidHistory);

    /**
     * GET /auctions/:id
     * Get auction by ID (Public)
     */
    this.router.get("/:id", this.auctionController.getById);

    /**
     * POST /auctions
     * Create auction (Admin only)
     */
    this.router.post(
      "/",
      ...adminChain,
      validateBody(CreateAuctionDto),
      this.auctionController.create
    );

    // ✅ NEW: PATCH /auctions/:id
    /**
     * PATCH /auctions/:id
     * Update auction (Admin only)
     */
    this.router.patch(
      "/:id",
      ...adminChain,
      validateBody(UpdateAuctionDto),
      this.auctionController.update
    );

    this.router.post(
      "/:id/end",
      ...adminChain,
      this.auctionController.endAuction
    );

    /**
     * POST /auctions/:id/buyout
     * Buy out auction (Authenticated)
     */
    this.router.post(
      "/:id/buyout",
      ...authChain,
      this.auctionController.buyOut
    );

    /**
     * POST /auctions/:id/relist
     * Re-list auction (Admin only)
     */
    this.router.post(
      "/:id/relist",
      ...adminChain,
      validateBody(RelistAuctionDto),
      this.auctionController.relist
    );

    /**
     * POST /auctions/:id/cancel
     * Cancel auction (Admin only)
     */
    this.router.post(
      "/:id/cancel",
      ...adminChain,
      this.auctionController.cancel
    );
  };

  getRouter = () => this.router;
}
