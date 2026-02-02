import { ApiError } from "../../utils/api-error";
import { JwtService } from "../jwt/jwt.service";
import { MailService } from "../mail/mail.service";
import { PasswordService } from "../password/password.service";
import { PrismaService } from "../prisma/prisma.service";
import { ForgotPasswordDTO } from "./dto/forgot-password.dto";
import { LoginDTO } from "./dto/login.dto";
import { RegisterDTO } from "./dto/register.dto";
import { ResetPasswordDTO } from "./dto/reset-password.dto";
import { ResendVerificationDTO } from "./dto/resend-verification.dto";
import { UpdateEmailDTO } from "./dto/update-email.dto";

export class AuthService {
  private prisma: PrismaService;
  private passwordService: PasswordService;
  private jwtService: JwtService;
  private mailService: MailService;

  constructor() {
    this.prisma = new PrismaService();
    this.passwordService = new PasswordService();
    this.jwtService = new JwtService();
    this.mailService = new MailService();
  }

  register = async (body: RegisterDTO) => {
    const user = await this.prisma.user.findFirst({
      where: { email: body.email },
    });

    if (user) {
      throw new ApiError("Email already used", 400);
    }

    const newUser = await this.prisma.user.create({
      data: {
        name: body.name,
        email: body.email,
        isVerified: false,
        role: "USER",
      },
    });

    const payload = { id: newUser.id };
    const token = this.jwtService.generateToken(
      payload,
      process.env.JWT_SECRET_VERIFY!,
      { expiresIn: "1h" }
    );

    const verificationLink = `${process.env.FRONTEND_URL}/auth/register/verify-email/${token}`;

    await this.mailService.sendMail(
      body.email,
      "Verify Your Email - TCG Store",
      "verify-email",
      {
        userName: newUser.name,
        verificationLink,
        currentYear: new Date().getFullYear(),
      }
    );

    return {
      success: true,
      message: "Registration success, please check your email for verification",
    };
  };

  login = async (body: LoginDTO) => {
    const user = await this.prisma.user.findFirst({
      where: { email: body.email },
    });

    if (!user) {
      throw new ApiError("Invalid Credentials", 400);
    }

    if (!user.isVerified || !user.password) {
      throw new ApiError("Please verify your email first", 400);
    }

    const isPasswordValid = await this.passwordService.comparePassword(
      body.password,
      user.password
    );

    if (!isPasswordValid) {
      throw new ApiError("Invalid Credentials", 400);
    }

    if (!user.isActive) {
      throw new ApiError("Your account has been deactivated", 400);
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    const payload = { id: user.id, role: user.role };

    const accessToken = this.jwtService.generateToken(
      payload,
      process.env.JWT_SECRET!,
      { expiresIn: "7d" }
    );

    const { password, ...userWithoutPassword } = user;

    return { ...userWithoutPassword, accessToken };
  };

  forgotPassword = async (body: ForgotPasswordDTO) => {
    const user = await this.prisma.user.findFirst({
      where: { email: body.email },
    });

    if (!user) {
      throw new ApiError("User not found", 404);
    }



    const payload = { id: user.id };

    const token = this.jwtService.generateToken(
      payload,
      process.env.JWT_SECRET_RESET!,
      { expiresIn: "15m" }
    );

    const resetLink = `${process.env.FRONTEND_URL}/auth/reset-password/${token}`;

    await this.mailService.sendMail(
      body.email,
      "Reset Your Password - TCG Store",
      "forgot-password",
      {
        name: user.name,
        resetLink: resetLink,
        expiryMinutes: "15",
        year: new Date().getFullYear(),
      }
    );

    return { message: "Password reset email sent successfully" };
  };

  resetPassword = async (body: ResetPasswordDTO, authUserId: number) => {
    const user = await this.prisma.user.findFirst({
      where: { id: authUserId },
    });

    if (!user) {
      throw new ApiError("User not found", 404);
    }

    const hashedPassword = await this.passwordService.hashPassword(
      body.password
    );

    await this.prisma.user.update({
      where: { id: authUserId },
      data: { password: hashedPassword },
    });

    return { message: "Password reset successfully" };
  };

  getCurrentUser = async (userId: number) => {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isVerified: true,
        pictureProfile: true,
        isActive: true,
        lastLogin: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new ApiError("User not found", 404);
    }

    return user;
  };

  verifyEmailAndSetPassword = async (token: string, password: string) => {
    const decoded = this.jwtService.verifyToken<{ id: number; newEmail?: string }>(
      token,
      process.env.JWT_SECRET_VERIFY!
    );

    const user = await this.prisma.user.findFirst({
      where: { id: decoded.id },
    });

    if (!user) {
      throw new ApiError("User not found", 400);
    }

    const hashedPassword = await this.passwordService.hashPassword(password);

    // Check if this is email update verification or initial registration
    if (decoded.newEmail && user.pendingEmail === decoded.newEmail) {
      // This is email update verification
      if (user.emailTokenExpiry && user.emailTokenExpiry < new Date()) {
        throw new ApiError("Verification token has expired", 400);
      }

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          email: user.pendingEmail,
          password: hashedPassword,
          pendingEmail: null,
          emailVerificationToken: null,
          emailTokenExpiry: null,
          isVerified: true,
        },
      });

      try {
        if (user.email) {
          await this.mailService.sendMail(
            user.email,
            "Email Address Changed - TCG Store",
            "email-changed-notification",
            {
              userName: user.name,
              newEmail: decoded.newEmail,
              currentYear: new Date().getFullYear(),
            }
          );
        }

        await this.mailService.sendMail(
          decoded.newEmail,
          "Email Address Successfully Updated - TCG Store",
          "email-update-success",
          {
            userName: user.name,
            currentYear: new Date().getFullYear(),
          }
        );
      } catch (emailError) {
        console.error("Failed to send email confirmation:", emailError);
      }

      return {
        message:
          "Email and password updated successfully. Please login with your new email.",
      };
    } else {
      // This is initial registration verification
      if (user.isVerified) {
        throw new ApiError("User already verified", 400);
      }

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          password: hashedPassword,
          isVerified: true,
        },
      });

      try {
        await this.mailService.sendMail(
          user.email,
          "Welcome to TCG Store!",
          "welcome",
          {
            name: user.name,
            year: new Date().getFullYear(),
          }
        );
      } catch (emailError) {
        console.error("Failed to send welcome email:", emailError);
      }

      return {
        message: "Email verified and password set successfully. Please login.",
      };
    }
  };

  resendVerification = async (body: ResendVerificationDTO) => {
    const user = await this.prisma.user.findFirst({
      where: { email: body.email },
    });

    if (!user) {
      throw new ApiError("User not found", 400);
    }

    if (user.isVerified) {
      throw new ApiError("User already verified", 400);
    }

    const payload = { id: user.id };
    const token = this.jwtService.generateToken(
      payload,
      process.env.JWT_SECRET_VERIFY!,
      { expiresIn: "1h" }
    );

    const verificationLink = `${process.env.FRONTEND_URL}/auth/register/verify-email/${token}`;

    await this.mailService.sendMail(
      user.email,
      "Verify Your Email - TCG Store",
      "verify-email",
      {
        userName: user.name,
        verificationLink,
        currentYear: new Date().getFullYear(),
      }
    );

    return { message: "Verification email resent successfully" };
  };



  updateEmail = async (userId: number, body: UpdateEmailDTO) => {
    const user = await this.prisma.user.findFirst({
      where: { id: userId },
    });

    if (!user) {
      throw new ApiError("User not found", 404);
    }

    if (!user.password) {
      throw new ApiError("Password required for email update", 400);
    }

    const isPasswordValid = await this.passwordService.comparePassword(
      body.password,
      user.password
    );

    if (!isPasswordValid) {
      throw new ApiError("Invalid password", 400);
    }

    const existingUser = await this.prisma.user.findFirst({
      where: {
        email: body.newEmail,
        id: { not: userId },
      },
    });

    if (existingUser) {
      throw new ApiError("Email already used by another account", 400);
    }

    if (user.email === body.newEmail) {
      throw new ApiError("New email must be different from current email", 400);
    }

    const payload = { id: userId, newEmail: body.newEmail };
    const token = this.jwtService.generateToken(
      payload,
      process.env.JWT_SECRET_VERIFY!,
      { expiresIn: "1h" }
    );

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        pendingEmail: body.newEmail,
        emailVerificationToken: token,
        emailTokenExpiry: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      },
    });

    const verificationLink = `${process.env.FRONTEND_URL}/auth/register/verify-email/${token}`;

    await this.mailService.sendMail(
      body.newEmail,
      "Verify Your New Email - TCG Store",
      "verify-new-email",
      {
        userName: user.name,
        newEmail: body.newEmail,
        verificationLink,
        currentYear: new Date().getFullYear(),
      }
    );

    return {
      success: true,
      message: "Verification email sent to your new email address",
    };
  };

  resendEmailVerification = async (userId: number) => {
    const user = await this.prisma.user.findFirst({
      where: { id: userId },
    });

    if (!user) {
      throw new ApiError("User not found", 404);
    }

    if (user.pendingEmail) {
      const payload = { id: userId, newEmail: user.pendingEmail };
      const token = this.jwtService.generateToken(
        payload,
        process.env.JWT_SECRET_VERIFY!,
        { expiresIn: "1h" }
      );

      await this.prisma.user.update({
        where: { id: userId },
        data: {
          emailVerificationToken: token,
          emailTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
        },
      });

      const verificationLink = `${process.env.FRONTEND_URL}/auth/register/verify-email/${token}`;

      await this.mailService.sendMail(
        user.pendingEmail,
        "Verify Your New Email - TCG Store",
        "verify-new-email",
        {
          userName: user.name,
          newEmail: user.pendingEmail,
          verificationLink,
          currentYear: new Date().getFullYear(),
        }
      );

      return { message: "Verification email resent to your new email address" };
    }

    if (!user.isVerified) {
      const payload = { id: user.id };
      const token = this.jwtService.generateToken(
        payload,
        process.env.JWT_SECRET_VERIFY!,
        { expiresIn: "1h" }
      );

      const verificationLink = `${process.env.FRONTEND_URL}/auth/register/verify-email/${token}`;

      await this.mailService.sendMail(
        user.email,
        "Verify Your Email - TCG Store",
        "verify-email",
        {
          userName: user.name,
          verificationLink,
          currentYear: new Date().getFullYear(),
        }
      );

      return {
        message: "Verification email resent to your current email address",
      };
    }

    throw new ApiError("Email is already verified", 400);
  };
}