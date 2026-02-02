import { Router } from "express";
import { LocationsController } from "./locations.controller";

export class LocationsRouter {
  private router: Router;
  private controller: LocationsController;

  constructor() {
    this.router = Router();
    this.controller = new LocationsController();
    this.initializeRoutes();
  }

  private initializeRoutes = () => {
    this.router.get("/search", this.controller.search);
  };

  getRouter = () => this.router;
}

