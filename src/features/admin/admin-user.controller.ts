import { NextFunction, Request, Response } from "express";
import { Role } from "../../generated/prisma";
import { AdminUserService } from "./admin-user.service";
import { UpdateUserDTO } from "./dto/update-user.dto";

export class AdminUserController {
  private adminUserService: AdminUserService;

  constructor() {
    this.adminUserService = new AdminUserService();
  }

  getAll = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { search, role, isActive, isVerified, page, limit } = req.query;

      const result = await this.adminUserService.getAll({
        search: search as string,
        role: role ? (role as Role) : undefined,
        isActive: typeof isActive === "string" ? isActive === "true" : undefined,
        isVerified: typeof isVerified === "string" ? isVerified === "true" : undefined,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });

      res.status(200).json({
        success: true,
        data: result.users,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Number(req.params.id);
      const user = await this.adminUserService.getById(id);
      res.status(200).json({ success: true, data: user });
    } catch (error) {
      next(error);
    }
  };

  updateById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Number(req.params.id);
      const dto = req.body as UpdateUserDTO;
      const adminId = Number(res.locals.user?.id);

      const updated = await this.adminUserService.updateById({ id, dto, adminId });
      res.status(200).json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  };
}

