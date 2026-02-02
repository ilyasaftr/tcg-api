import { Router } from "express";
import { XenditWebhookController } from "./xendit-webhook.controller";

export class XenditWebhookRouter {
  router: Router;
  controller: XenditWebhookController;

  constructor() {
    this.router = Router();
    this.controller = new XenditWebhookController();
    this.initializeRoutes();
  }

  private initializeRoutes() {
    // Invoice callback
    this.router.post("/invoice", this.controller.handleInvoice);
  }

  getRouter = () => this.router;
}

