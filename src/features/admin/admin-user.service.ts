import { Role } from "../../generated/prisma";
import { PrismaService } from "../../modules/prisma/prisma.service";
import { ApiError } from "../../utils/api-error";
import { UpdateUserDTO } from "./dto/update-user.dto";

export class AdminUserService {
  private prisma: PrismaService;

  constructor() {
    this.prisma = new PrismaService();
  }

  getAll = async (filters?: {
    search?: string;
    role?: Role;
    isActive?: boolean;
    isVerified?: boolean;
    page?: number;
    limit?: number;
  }) => {
    const { search, role, isActive, isVerified, page = 1, limit = 50 } = filters || {};

    const where: any = {};

    if (role) where.role = role;
    if (typeof isActive === "boolean") where.isActive = isActive;
    if (typeof isVerified === "boolean") where.isVerified = isVerified;

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ];
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          isVerified: true,
          lastLogin: true,
          createdAt: true,
          _count: {
            select: {
              orders: true,
              addresses: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    const transformed = users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      isActive: u.isActive,
      isVerified: u.isVerified,
      lastLogin: u.lastLogin?.toISOString() || null,
      createdAt: u.createdAt.toISOString(),
      counts: {
        orders: u._count.orders,
        addresses: u._count.addresses,
      },
    }));

    const totalPages = Math.ceil(total / limit) || 1;
    return {
      users: transformed,
      pagination: {
        total,
        page,
        limit,
        totalPages,
      },
    };
  };

  getById = async (id: number) => {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        isVerified: true,
        lastLogin: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            orders: true,
            addresses: true,
            wishlist: true,
            bids: true,
          },
        },
      },
    });

    if (!user) throw new ApiError("User not found", 404);

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      isVerified: user.isVerified,
      lastLogin: user.lastLogin?.toISOString() || null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      counts: user._count,
    };
  };

  updateById = async (args: { id: number; dto: UpdateUserDTO; adminId: number }) => {
    const { id, dto, adminId } = args;

    if (id === adminId && (dto.role || typeof dto.isActive === "boolean")) {
      throw new ApiError("You cannot change your own role or active status", 400);
    }

    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new ApiError("User not found", 404);

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.role !== undefined ? { role: dto.role } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.isVerified !== undefined ? { isVerified: dto.isVerified } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        isVerified: true,
        lastLogin: true,
        updatedAt: true,
      },
    });

    return {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      role: updated.role,
      isActive: updated.isActive,
      isVerified: updated.isVerified,
      lastLogin: updated.lastLogin?.toISOString() || null,
      updatedAt: updated.updatedAt.toISOString(),
    };
  };
}

