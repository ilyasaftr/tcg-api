import { Router } from "express";
import { AuthController } from "./auth.controller";
import { validateBody } from "../../middlewares/validate.middleware";
import { RegisterDTO } from "./dto/register.dto";
import { LoginDTO } from "./dto/login.dto";
import { ForgotPasswordDTO } from "./dto/forgot-password.dto";
import { ResetPasswordDTO } from "./dto/reset-password.dto";
import { JwtMiddleware } from "../../middlewares/jwt.middleware";
import { ResendVerificationDTO } from "./dto/resend-verification.dto";
import { UpdateEmailDTO } from "./dto/update-email.dto";

export class AuthRouter {
  private authController: AuthController;
  private router: Router;
  private jwtMiddleware: JwtMiddleware;

  constructor() {
    this.router = Router();
    this.authController = new AuthController();
    this.jwtMiddleware = new JwtMiddleware();
    this.initializeRoutes();
  }

  private initializeRoutes = () => {
    // Register route
    this.router.post(
      "/register",
      validateBody(RegisterDTO),
      this.authController.register
    );

    // Login route
    this.router.post(
      "/login",
      validateBody(LoginDTO),
      this.authController.login
    );

    // Password reset routes
    this.router.post(
      "/forgot-password",
      validateBody(ForgotPasswordDTO),
      this.authController.forgotPassword
    );

    this.router.patch(
      "/reset-password",
      this.jwtMiddleware.verifyToken(process.env.JWT_SECRET_RESET!),
      validateBody(ResetPasswordDTO),
      this.authController.resetPassword
    );

    // User info route
    this.router.get(
      "/profile",
      this.jwtMiddleware.verifyToken(process.env.JWT_SECRET!),
      this.authController.getCurrentUser
    );

    // Verify email route (for both register & update email)
    this.router.post(
      "/verify-email",
      this.authController.verifyEmailAndSetPassword
    );

    // Resend verification route
    this.router.post(
      "/resend-verification",
      validateBody(ResendVerificationDTO),
      this.authController.resendVerification
    );

    // Email update routes
    this.router.patch(
      "/update-email",
      this.jwtMiddleware.verifyToken(process.env.JWT_SECRET!),
      validateBody(UpdateEmailDTO),
      this.authController.updateEmail
    );

    // Resend email verification route
    this.router.post(
      "/resend-email-verification",
      this.jwtMiddleware.verifyToken(process.env.JWT_SECRET!),
      this.authController.resendEmailVerification
    );
  };

  getRouter = () => {
    return this.router;
  };
}