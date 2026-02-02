import { Router } from "express";
import { JwtMiddleware } from "../../middlewares/jwt.middleware";
import { RoleMiddleware } from "../../middlewares/role.middleware";
import { validateBody } from "../../middlewares/validate.middleware";
import { AdminUserController } from "./admin-user.controller";
import { UpdateUserDTO } from "./dto/update-user.dto";

export class AdminUserRouter {
  private router: Router;
  private adminUserController: AdminUserController;
  private jwtMiddleware: JwtMiddleware;
  private roleMiddleware: RoleMiddleware;

  constructor() {
    this.router = Router();
    this.adminUserController = new AdminUserController();
    this.jwtMiddleware = new JwtMiddleware();
    this.roleMiddleware = new RoleMiddleware();
    this.initializeRoutes();
  }

  private initializeRoutes = () => {
    const authChain = [
      this.jwtMiddleware.verifyToken(process.env.JWT_SECRET!),
      this.roleMiddleware.isAdmin,
    ];

    this.router.get("/", ...authChain, this.adminUserController.getAll);
    this.router.get("/:id", ...authChain, this.adminUserController.getById);
    this.router.patch(
      "/:id",
      ...authChain,
      validateBody(UpdateUserDTO),
      this.adminUserController.updateById
    );
  };

  getRouter = () => this.router;
}

