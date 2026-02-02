import { Request, Response } from "express";
import { AuthService } from "./auth.service";
import { TurnstileService } from "./turnstile.service";

export class AuthController {
  private authService: AuthService;
  private turnstileService: TurnstileService;

  constructor() {
    this.authService = new AuthService();
    this.turnstileService = new TurnstileService();
  }

  private getClientIp = (req: Request) => {
    const cfIp = req.headers["cf-connecting-ip"];
    if (typeof cfIp === "string" && cfIp.trim()) return cfIp.trim();

    const xff = req.headers["x-forwarded-for"];
    if (typeof xff === "string" && xff.trim()) return xff.split(",")[0].trim();

    return req.ip;
  };

  register = async (req: Request, res: Response) => {
    try {
      await this.turnstileService.verify({
        token: (req.body as any).turnstileToken,
        ip: this.getClientIp(req),
      });
      const result = await this.authService.register(req.body);
      res.status(201).json(result);
    } catch (err: any) {
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message || "Something went wrong",
      });
    }
  };

  login = async (req: Request, res: Response) => {
    try {
      await this.turnstileService.verify({
        token: (req.body as any).turnstileToken,
        ip: this.getClientIp(req),
      });
      const result = await this.authService.login(req.body);
      res.status(200).send(result);
    } catch (err: any) {
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message || "Something went wrong",
      });
    }
  };

  forgotPassword = async (req: Request, res: Response) => {
    try {
      await this.turnstileService.verify({
        token: (req.body as any).turnstileToken,
        ip: this.getClientIp(req),
      });
      const result = await this.authService.forgotPassword(req.body);
      res.status(200).send(result);
    } catch (err: any) {
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message || "Something went wrong",
      });
    }
  };

  resetPassword = async (req: Request, res: Response) => {
    try {
      const authUserId = res.locals.user.id;
      const result = await this.authService.resetPassword(req.body, authUserId);
      res.status(200).send(result);
    } catch (err: any) {
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message || "Something went wrong",
      });
    }
  };

  getCurrentUser = async (req: Request, res: Response) => {
    try {
      const userId = res.locals.user.id;
      const user = await this.authService.getCurrentUser(userId);
      res.status(200).json(user);
    } catch (err: any) {
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message || "Something went wrong",
      });
    }
  };

  verifyEmailAndSetPassword = async (req: Request, res: Response) => {
    try {
      const { token, password } = req.body;
      const result = await this.authService.verifyEmailAndSetPassword(
        token,
        password
      );
      res.status(200).send(result);
    } catch (err: any) {
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message || "Something went wrong",
      });
    }
  };

  resendVerification = async (req: Request, res: Response) => {
    try {
      const result = await this.authService.resendVerification(req.body);
      res.status(200).send(result);
    } catch (err: any) {
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message || "Something went wrong",
      });
    }
  };

  updateEmail = async (req: Request, res: Response) => {
    try {
      const userId = res.locals.user.id;
      const result = await this.authService.updateEmail(userId, req.body);
      res.status(200).json(result);
    } catch (err: any) {
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message || "Something went wrong",
      });
    }
  };

  resendEmailVerification = async (req: Request, res: Response) => {
    try {
      const userId = res.locals.user.id;
      const result = await this.authService.resendEmailVerification(userId);
      res.status(200).json(result);
    } catch (err: any) {
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message || "Something went wrong",
      });
    }
  };
}
