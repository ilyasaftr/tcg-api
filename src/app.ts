import cors from "cors";
import express, { Express } from "express";
import "reflect-metadata";
import { PORT } from "./config/env";
import { initSentry, sentryErrorHandler, sentryRequestHandler } from "./config/sentry";
import { errorMiddleware } from "./middlewares/error.middleware";
import { AuthRouter } from "./modules/auth/auth.router";
import { ProfileRouter } from "./modules/profile/profile.router";
import { GameRouter } from "./modules/game/game.router";
import { CardLanguageRouter } from "./modules/card-language/card-language.router";
import { CardSetRouter } from "./modules/card-set/card-set.router";
import { CardRarityRouter } from "./modules/card-rarity/card-rarity.router";
import { CardConditionRouter } from "./modules/card-condition/card-condition.router";
import { SealedCategoryRouter } from "./modules/sealed-category/sealed-category.router";
import { AccessoryCategoryRouter } from "./modules/accesory-category/accessory-category.router";
import { ProductRouter } from "./modules/product/product.router";
import { CartRouter } from "./features/cart/cart.router";
import { WishlistRouter } from "./features/wishlist/wishlist.router";
import { AddressRouter } from "./features/address/address.router";
import { OrderRouter } from "./features/order/order.router";
import { AdminOrderRouter } from "./features/admin/admin-order.router";
import { AdminUserRouter } from "./features/admin/admin-user.router";
import { ShippingRouter } from "./features/shipping/shipping.router";
import { BlogRouter } from "./features/blog/blog.router";
import { RajaOngkirRouter } from "./modules/rajaongkir/rajaongkir.router";
import { ReviewRouter } from "./modules/review/review.router";
import { ComplaintRouter } from "./modules/complaint/complaint.router";
import { CronService } from "./modules/cron/cron.service";
import { CronRouter } from "./modules/cron/cron.router";
import { LocationsRouter } from "./modules/locations/locations.router";
// ⭐ NEW: Import Auction & Bid Routers
import { AuctionRouter } from "./modules/auction/auction.router";
import { BidRouter } from "./modules/bid/bid.router";
import { XenditWebhookRouter } from "./modules/webhook/xendit-webhook.router";

export class App {
  app: Express;
  private cronService: CronService;

  constructor() {
    this.app = express();
    this.cronService = new CronService();
    initSentry(this.app);
    this.configure();
    this.routes();
    this.handleError();
    this.startCronJobs();
  }

  private configure() {
    const sentryReq = sentryRequestHandler();
    if (sentryReq) this.app.use(sentryReq);

    this.app.use(cors());
    this.app.use(express.json());
  }

  private routes() {
    const authRouter = new AuthRouter();
    const profileRouter = new ProfileRouter();
    const gameRouter = new GameRouter();
    const cardLanguageRouter = new CardLanguageRouter();
    const cardSetRouter = new CardSetRouter();
    const cardRarityRouter = new CardRarityRouter();
    const cardConditionRouter = new CardConditionRouter();
    const sealedCategoryRouter = new SealedCategoryRouter();
    const accesoryCategoryRouter = new AccessoryCategoryRouter();
    const productRouter = new ProductRouter();
    const cartRouter = new CartRouter();
    const wishlistRouter = new WishlistRouter();
    const addressRouter = new AddressRouter();
    const orderRouter = new OrderRouter();
    const adminOrderRouter = new AdminOrderRouter();
    const adminUserRouter = new AdminUserRouter();
    const shippingRouter = new ShippingRouter();
    const blogRouter = new BlogRouter();
    const rajaOngkirRouter = new RajaOngkirRouter();
    const reviewRouter = new ReviewRouter();
    const complaintRouter = new ComplaintRouter();
    const cronRouter = new CronRouter();
    const locationsRouter = new LocationsRouter();
    // ⭐ NEW: Initialize Auction & Bid Routers
    const auctionRouter = new AuctionRouter();
    const bidRouter = new BidRouter();
    const xenditWebhookRouter = new XenditWebhookRouter();

    this.app.use("/auth", authRouter.getRouter());
    this.app.use("/profile", profileRouter.getRouter());
    this.app.use("/games", gameRouter.getRouter());
    this.app.use("/card-languages", cardLanguageRouter.getRouter());
    this.app.use("/card-sets", cardSetRouter.getRouter());
    this.app.use("/card-rarities", cardRarityRouter.getRouter());
    this.app.use("/card-conditions", cardConditionRouter.getRouter());
    this.app.use("/sealed-categories", sealedCategoryRouter.getRouter());
    this.app.use("/accessory-categories", accesoryCategoryRouter.getRouter());
    this.app.use("/products", productRouter.getRouter());
    this.app.use("/cart", cartRouter.getRouter());
    this.app.use("/wishlist", wishlistRouter.getRouter());
    this.app.use("/addresses", addressRouter.getRouter());
    this.app.use("/orders", orderRouter.getRouter());
    this.app.use("/admin/orders", adminOrderRouter.getRouter());
    this.app.use("/admin/users", adminUserRouter.getRouter());
    this.app.use("/shipping", shippingRouter.getRouter());
    this.app.use("/blog", blogRouter.getRouter());
    this.app.use("/rajaongkir", rajaOngkirRouter.getRouter());
    this.app.use("/locations", locationsRouter.getRouter());
    this.app.use("/reviews", reviewRouter.getRouter());
    this.app.use("/complaints", complaintRouter.getRouter());
    this.app.use("/cron", cronRouter.getRouter());
    this.app.use("/auctions", auctionRouter.getRouter());
    this.app.use("/bids", bidRouter.getRouter());
    this.app.use("/webhooks/xendit", xenditWebhookRouter.getRouter());
  }

  private handleError() {
    const sentryErr = sentryErrorHandler();
    if (sentryErr) this.app.use(sentryErr);
    this.app.use(errorMiddleware);
  }

  private startCronJobs() {
    this.cronService.start();
  }

  public start() {
    this.app.listen(PORT, () => {
      console.log(`Server is running on port: ${PORT}`);
    });
  }
}
