import { Request, Response, NextFunction } from "express";
import { CardSetService } from "./card-set.service";
import { ApiError } from "../../utils/api-error";

export class CardSetController {
  private cardSetService: CardSetService;

  constructor() {
    this.cardSetService = new CardSetService();
  }

  // ⭐ EXISTING: Get all sets (with optional game/language filters)
  getAll = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawPage = req.query.page;
      const rawLimit = req.query.limit ?? req.query.take;
      const rawSkip = req.query.skip;

      const hasPagination =
        rawPage !== undefined || rawLimit !== undefined || rawSkip !== undefined;

      const page = rawPage !== undefined ? Number(rawPage) : undefined;
      const limit = rawLimit !== undefined ? Number(rawLimit) : undefined;
      const skip = rawSkip !== undefined ? Number(rawSkip) : undefined;

      if (page !== undefined && (!Number.isFinite(page) || page < 1)) {
        throw new ApiError("Invalid `page` query param", 400);
      }
      if (
        limit !== undefined &&
        (!Number.isFinite(limit) || limit < 1 || limit > 100)
      ) {
        throw new ApiError("Invalid `limit` query param", 400);
      }
      if (skip !== undefined && (!Number.isFinite(skip) || skip < 0)) {
        throw new ApiError("Invalid `skip` query param", 400);
      }

      const filters = {
        gameId: req.query.gameId ? Number(req.query.gameId) : undefined,
        languageId: req.query.languageId
          ? Number(req.query.languageId)
          : undefined,
      };

      if (hasPagination) {
        const result = await this.cardSetService.getAllPaginated(filters, {
          page,
          limit,
          skip,
        });
        res.status(200).json({
          success: true,
          data: result.sets,
          pagination: result.pagination,
        });
        return;
      }

      const sets = await this.cardSetService.getAll(filters);
      res.status(200).json(sets);
    } catch (error) {
      next(error);
    }
  };

  // ⭐ NEW: Get sets by game
  getByGame = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const gameId = req.query.gameId ? Number(req.query.gameId) : undefined;
      const languageId = req.query.languageId
        ? Number(req.query.languageId)
        : undefined;

      if (!gameId) {
        throw new ApiError("gameId query parameter is required", 400);
      }

      const sets = await this.cardSetService.getByGame(gameId, languageId);
      res.status(200).json(sets);
    } catch (error) {
      next(error);
    }
  };

  // ⭐ NEW: Get sets grouped by language
  getGroupedByLanguage = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const gameId = req.query.gameId ? Number(req.query.gameId) : undefined;

      if (!gameId) {
        throw new ApiError("gameId query parameter is required", 400);
      }

      const grouped = await this.cardSetService.getGroupedByLanguage(gameId);
      res.status(200).json(grouped);
    } catch (error) {
      next(error);
    }
  };

  // ⭐ EXISTING: Get by slug
  getBySlug = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { slug } = req.params;
      const set = await this.cardSetService.getBySlug(slug);
      res.status(200).json(set);
    } catch (error) {
      next(error);
    }
  };

  // ⭐ EXISTING: Create (unchanged)
  create = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const thumbnail = req.file;
      const set = await this.cardSetService.create(req.body, thumbnail);
      res.status(201).json(set);
    } catch (error) {
      next(error);
    }
  };

  // ⭐ EXISTING: Update (unchanged)
  update = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { slug } = req.params;
      const thumbnail = req.file;
      const set = await this.cardSetService.update(slug, req.body, thumbnail);
      res.status(200).json(set);
    } catch (error) {
      next(error);
    }
  };

  // ⭐ EXISTING: Delete (unchanged)
  delete = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { slug } = req.params;
      const result = await this.cardSetService.delete(slug);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}
