import { Request, Response, NextFunction } from "express";
import { LocationsJsonService } from "./locations.service";
import { ApiError } from "../../utils/api-error";

export class LocationsController {
  private service: LocationsJsonService;

  constructor() {
    this.service = new LocationsJsonService();
  }

  /**
   * GET /locations/search?q=...&limit=20&offset=0
   */
  search = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const q = (req.query.q as string | undefined) || "";
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

      if (!q.trim()) {
        throw new ApiError("q is required", 400);
      }

      const data = await this.service.search({ q, limit, offset });
      res.status(200).json({ success: true, ...data });
    } catch (error) {
      next(error);
    }
  };
}
