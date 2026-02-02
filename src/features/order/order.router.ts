import { Router } from "express";
import { OrderController } from "./order.controller";
import { JwtMiddleware } from "../../middlewares/jwt.middleware";
import { CreateOrderDto } from "./dto/create-order.dto";
import { CancelOrderDto } from "./dto/cancel-order.dto";
import { validateBody } from "../../middlewares/validate.middleware";
import { PreviewAuctionCheckoutDto } from "../../modules/auction/dto/preview-auction-checkout.dto";
import { CheckoutAuctionsDto } from "../../modules/auction/dto/checkout-auctions.dto";

export class OrderRouter {
  router: Router;
  orderController: OrderController;
  jwtMiddleware: JwtMiddleware;

  constructor() {
    this.router = Router();
    this.orderController = new OrderController();
    this.jwtMiddleware = new JwtMiddleware();
    this.initializeRoutes();
  }

  initializeRoutes = () => {
    const jwtSecret = process.env.JWT_SECRET!;

    /**
     * POST /orders/checkout
     * Create order from cart
     */
    this.router.post(
      "/checkout",
      this.jwtMiddleware.verifyToken(jwtSecret),
      validateBody(CreateOrderDto),
      this.orderController.create
    );

    /**
     * ✅ NEW: POST /orders/checkout-auctions/preview
     * Preview auction checkout (calculate shipping)
     */
    this.router.post(
      "/checkout-auctions/preview",
      this.jwtMiddleware.verifyToken(jwtSecret),
      validateBody(PreviewAuctionCheckoutDto),
      this.orderController.previewAuctionCheckout
    );

    /**
     * ✅ NEW: POST /orders/checkout-auctions
     * Create order from auctions
     */
    this.router.post(
      "/checkout-auctions",
      this.jwtMiddleware.verifyToken(jwtSecret),
      validateBody(CheckoutAuctionsDto),
      this.orderController.createFromAuctions
    );

    /**
     * GET /orders
     * Get all orders for user
     */
    this.router.get(
      "/",
      this.jwtMiddleware.verifyToken(jwtSecret),
      this.orderController.getAll
    );

    /**
     * GET /orders/:orderNumber
     * Get order detail
     */
    this.router.get(
      "/:orderNumber",
      this.jwtMiddleware.verifyToken(jwtSecret),
      this.orderController.getById
    );

    /**
     * POST /orders/:orderNumber/cancel
     * Cancel order
     */
    this.router.post(
      "/:orderNumber/cancel",
      this.jwtMiddleware.verifyToken(jwtSecret),
      validateBody(CancelOrderDto),
      this.orderController.cancel
    );

    /**
     * POST /orders/:orderNumber/confirm-receipt
     * Customer confirms receipt of order
     */
    this.router.post(
      "/:orderNumber/confirm-receipt",
      this.jwtMiddleware.verifyToken(jwtSecret),
      this.orderController.confirmReceipt
    );
  };

  getRouter = () => this.router;
}
