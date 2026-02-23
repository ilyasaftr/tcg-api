import { PrismaService } from "../prisma/prisma.service";
import { CloudinaryService } from "../cloudinary/cloudinary.service";
import { ApiError } from "../../utils/api-error";
import { CreateCardSetDTO } from "./dto/create-card-set.dto";
import { UpdateCardSetDTO } from "./dto/update-card-set.dto";
import { generateSlug } from "../../utils/generate-slug";

export class CardSetService {
  private prisma: PrismaService;
  private cloudinary: CloudinaryService;

  constructor() {
    this.prisma = new PrismaService();
    this.cloudinary = new CloudinaryService();
  }

  // ⭐ EXISTING: Get all sets with optional game/language filters
  getAll = async (filters?: { gameId?: number; languageId?: number }) => {
    const where: any = { isActive: true };

    if (filters?.gameId) {
      where.gameId = filters.gameId;
    }

    if (filters?.languageId) {
      where.languageId = filters.languageId;
    }

    return await this.prisma.set.findMany({
      where,
      include: {
        game: { select: { id: true, name: true } },
        language: { select: { id: true, name: true, code: true } },
      },
      orderBy: [{ releaseDate: "desc" }, { name: "asc" }],
    });
  };

  getAllPaginated = async (
    filters?: { gameId?: number; languageId?: number },
    pagination?: { page?: number; limit?: number; skip?: number }
  ) => {
    const where: any = { isActive: true };

    if (filters?.gameId) where.gameId = filters.gameId;
    if (filters?.languageId) where.languageId = filters.languageId;

    const limit = pagination?.limit ?? 20;
    const skip =
      pagination?.page !== undefined ? (pagination.page - 1) * limit : 0;
    const effectiveSkip =
      pagination?.page !== undefined ? skip : (pagination?.skip ?? 0);
    const page =
      pagination?.page !== undefined
        ? pagination.page
        : Math.floor(effectiveSkip / limit) + 1;

    const [sets, total] = await this.prisma.$transaction([
      this.prisma.set.findMany({
        where,
        include: {
          game: { select: { id: true, name: true } },
          language: { select: { id: true, name: true, code: true } },
        },
        orderBy: [{ releaseDate: "desc" }, { name: "asc" }],
        skip: effectiveSkip,
        take: limit,
      }),
      this.prisma.set.count({ where }),
    ]);

    return {
      sets,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  };

  // ⭐ NEW: Get sets by game (with optional language filter)
  getByGame = async (gameId: number, languageId?: number) => {
    const where: any = {
      gameId,
      isActive: true,
    };

    if (languageId) {
      where.languageId = languageId;
    }

    return await this.prisma.set.findMany({
      where,
      include: {
        game: { select: { id: true, name: true, slug: true } },
        language: { select: { id: true, name: true, code: true } },
        _count: { select: { products: true } },
      },
      orderBy: [{ releaseDate: "desc" }, { name: "asc" }],
    });
  };

  // ⭐ NEW: Get sets grouped by language (for game detail page)
  getGroupedByLanguage = async (gameId: number) => {
    const sets = await this.prisma.set.findMany({
      where: {
        gameId,
        isActive: true,
      },
      include: {
        game: { select: { id: true, name: true, slug: true } },
        language: { select: { id: true, name: true, code: true } },
        _count: { select: { products: true } },
      },
      orderBy: [{ releaseDate: "desc" }, { name: "asc" }],
    });

    // Group by language name
    const grouped: Record<string, typeof sets> = {};

    sets.forEach((set) => {
      const langName = set.language.name;
      if (!grouped[langName]) {
        grouped[langName] = [];
      }
      grouped[langName].push(set);
    });

    return grouped;
  };

  // ⭐ EXISTING: Get by slug
  getBySlug = async (slug: string) => {
    const set = await this.prisma.set.findFirst({
      where: {
        slug: slug,
        isActive: true,
      },
      include: {
        game: true,
        language: true,
        _count: { select: { products: true } },
      },
    });

    if (!set) {
      throw new ApiError("Card set not found", 404);
    }

    return set;
  };

  // ⭐ EXISTING: Create (unchanged)
  create = async (body: CreateCardSetDTO, thumbnail?: Express.Multer.File) => {
    const game = await this.prisma.game.findFirst({
      where: { id: body.gameId, isActive: true },
    });

    if (!game) {
      throw new ApiError("Game not found", 404);
    }

    const language = await this.prisma.language.findFirst({
      where: { id: body.languageId, isActive: true },
    });

    if (!language) {
      throw new ApiError("Card language not found", 404);
    }

    const existingSet = await this.prisma.set.findFirst({
      where: {
        gameId: body.gameId,
        languageId: body.languageId,
        name: body.name,
        isActive: true,
      },
    });

    if (existingSet) {
      throw new ApiError(
        "Set with this game, language, and name already exists",
        400
      );
    }

    let slug = generateSlug(body.name);
    let slugExists = await this.prisma.set.findFirst({
      where: { slug: slug, isActive: true },
    });
    let counter = 1;

    while (slugExists) {
      slug = `${generateSlug(body.name)}-${counter}`;
      slugExists = await this.prisma.set.findFirst({
        where: { slug: slug, isActive: true },
      });
      counter++;
    }

    let thumbnailUrl: string | undefined;

    if (thumbnail) {
      const { secure_url } = await this.cloudinary.upload(
        thumbnail,
        "sets/thumbnails"
      );
      thumbnailUrl = secure_url;
    }

    return await this.prisma.set.create({
      data: {
        gameId: body.gameId,
        languageId: body.languageId,
        name: body.name,
        slug: slug,
        code: body.code,
        releaseDate: body.releaseDate ? new Date(body.releaseDate) : null,
        thumbnail: thumbnailUrl,
        isActive: true,
      },
      include: {
        game: true,
        language: true,
      },
    });
  };

  // ⭐ EXISTING: Update (unchanged)
  update = async (
    slug: string,
    body: UpdateCardSetDTO,
    thumbnail?: Express.Multer.File
  ) => {
    const set = await this.prisma.set.findFirst({
      where: { slug: slug, isActive: true },
    });

    if (!set) {
      throw new ApiError("Card set not found", 404);
    }

    if (body.gameId) {
      const game = await this.prisma.game.findFirst({
        where: { id: body.gameId, isActive: true },
      });
      if (!game) {
        throw new ApiError("Game not found", 404);
      }
    }

    if (body.languageId) {
      const language = await this.prisma.language.findFirst({
        where: { id: body.languageId, isActive: true },
      });
      if (!language) {
        throw new ApiError("Card language not found", 404);
      }
    }

    if (body.gameId || body.languageId || body.name) {
      const existingSet = await this.prisma.set.findFirst({
        where: {
          gameId: body.gameId ?? set.gameId,
          languageId: body.languageId ?? set.languageId,
          name: body.name ?? set.name,
          isActive: true,
          NOT: { id: set.id },
        },
      });

      if (existingSet) {
        throw new ApiError(
          "Set with this game, language, and name already exists",
          400
        );
      }
    }

    let newSlug = slug;
    if (body.name && body.name !== set.name) {
      newSlug = generateSlug(body.name);
      let slugExists = await this.prisma.set.findFirst({
        where: { slug: newSlug, isActive: true, NOT: { id: set.id } },
      });

      let counter = 1;
      while (slugExists) {
        newSlug = `${generateSlug(body.name)}-${counter}`;
        slugExists = await this.prisma.set.findFirst({
          where: { slug: newSlug, isActive: true, NOT: { id: set.id } },
        });
        counter++;
      }
    }

    let thumbnailUrl = set.thumbnail;

    if (thumbnail) {
      if (set.thumbnail) {
        await this.cloudinary.remove(set.thumbnail);
      }
      const { secure_url } = await this.cloudinary.upload(
        thumbnail,
        "sets/thumbnails"
      );
      thumbnailUrl = secure_url;
    }

    return await this.prisma.set.update({
      where: { id: set.id },
      data: {
        gameId: body.gameId,
        languageId: body.languageId,
        name: body.name,
        slug: newSlug,
        code: body.code,
        releaseDate: body.releaseDate ? new Date(body.releaseDate) : undefined,
        thumbnail: thumbnailUrl,
        isActive: body.isActive,
      },
      include: {
        game: true,
        language: true,
      },
    });
  };

  // ⭐ EXISTING: Delete (unchanged)
  delete = async (slug: string) => {
    const set = await this.prisma.set.findFirst({
      where: { slug: slug, isActive: true },
    });

    if (!set) {
      throw new ApiError("Card set not found", 404);
    }

    const productCount = await this.prisma.product.count({
      where: { setId: set.id },
    });

    if (productCount > 0) {
      throw new ApiError("Cannot delete set with existing products", 400);
    }

    await this.prisma.set.update({
      where: { id: set.id },
      data: { isActive: false },
    });

    return { message: "Card set deleted successfully" };
  };
}
