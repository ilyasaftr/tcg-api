import { ApiError } from "../../utils/api-error";
import { CreateBlogPostDTO } from "./dto/create-blog-post.dto";
import { UpdateBlogPostDTO } from "./dto/update-blog-post.dto";
import { CreateCommentDTO } from "./dto/create-comment.dto";
import { UpdateCommentDTO } from "./dto/update-comment.dto";
import { generateSlug } from "../../utils/generate-slug";
import { PrismaService } from "../../modules/prisma/prisma.service";
import { CloudinaryService } from "../../modules/cloudinary/cloudinary.service";

export class BlogService {
  private prisma: PrismaService;
  private cloudinary: CloudinaryService;

  constructor() {
    this.prisma = new PrismaService();
    this.cloudinary = new CloudinaryService();
  }

  /**
   * Get all blog posts (published only for public)
   */
  getAllPosts = async (
    isAdmin: boolean = false,
    filters?: { category?: string; tag?: string; search?: string }
  ) => {
    const where = this.buildPostWhere(isAdmin, filters);
    return await this.prisma.blogPost.findMany({
      where,
      include: {
        author: {
          select: {
            id: true,
            name: true,
            pictureProfile: true,
          },
        },
        _count: {
          select: { comments: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  };

  getAllPostsPaginated = async (
    isAdmin: boolean = false,
    params?: {
      page?: number;
      limit?: number;
      skip?: number;
      category?: string;
      tag?: string;
      search?: string;
    }
  ) => {
    const where = this.buildPostWhere(isAdmin, params);
    const limit = params?.limit ?? 20;
    const skip =
      params?.page !== undefined ? (params.page - 1) * limit : 0;
    const effectiveSkip =
      params?.page !== undefined ? skip : (params?.skip ?? 0);
    const page =
      params?.page !== undefined
        ? params.page
        : Math.floor(effectiveSkip / limit) + 1;

    const [posts, total] = await this.prisma.$transaction([
      this.prisma.blogPost.findMany({
        where,
        include: {
          author: {
            select: {
              id: true,
              name: true,
              pictureProfile: true,
            },
          },
          _count: {
            select: { comments: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: effectiveSkip,
        take: limit,
      }),
      this.prisma.blogPost.count({ where }),
    ]);

    return {
      posts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  };

  private buildPostWhere(
    isAdmin: boolean,
    filters?: { category?: string; tag?: string; search?: string }
  ) {
    const whereParts: any[] = [];

    if (!isAdmin) whereParts.push({ published: true });
    if (filters?.category) whereParts.push({ category: filters.category });
    if (filters?.tag) whereParts.push({ tags: { has: filters.tag } });

    if (filters?.search) {
      const q = filters.search;
      whereParts.push({
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { excerpt: { contains: q, mode: "insensitive" } },
          { content: { contains: q, mode: "insensitive" } },
          { category: { contains: q, mode: "insensitive" } },
        ],
      });
    }

    if (whereParts.length === 0) return {};
    if (whereParts.length === 1) return whereParts[0];
    return { AND: whereParts };
  }

  /**
   * Get single blog post by slug
   */
  getPostBySlug = async (slug: string, isAdmin: boolean = false) => {
    const post = await this.prisma.blogPost.findFirst({
      where: {
        slug: slug,
        ...(isAdmin ? {} : { published: true }),
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            pictureProfile: true,
          },
        },
        _count: {
          select: { comments: true },
        },
      },
    });

    if (!post) {
      throw new ApiError("Blog post not found", 404);
    }

    // Increment view count
    await this.prisma.blogPost.update({
      where: { id: post.id },
      data: { viewCount: { increment: 1 } },
    });

    return post;
  };

  /**
   * Create new blog post (Admin only)
   */
  createPost = async (
    userId: number,
    body: CreateBlogPostDTO,
    coverImage?: Express.Multer.File
  ) => {
    // Generate unique slug
    let slug = generateSlug(body.title);
    let slugExists = await this.prisma.blogPost.findUnique({
      where: { slug: slug },
    });
    let counter = 1;

    while (slugExists) {
      slug = `${generateSlug(body.title)}-${counter}`;
      slugExists = await this.prisma.blogPost.findUnique({
        where: { slug: slug },
      });
      counter++;
    }

    // Upload cover image if provided
    let coverImageUrl: string | undefined;
    if (coverImage) {
      const { secure_url } = await this.cloudinary.upload(
        coverImage,
        "blog/covers"
      );
      coverImageUrl = secure_url;
    }

    // Create blog post
    return await this.prisma.blogPost.create({
      data: {
        title: body.title,
        slug: slug,
        excerpt: body.excerpt,
        content: body.content,
        coverImage: coverImageUrl,
        authorId: userId,
        category: body.category,
        tags: body.tags || [],
        published: body.published || false,
        publishedAt:
          body.published && body.publishedAt
            ? new Date(body.publishedAt)
            : body.published
            ? new Date()
            : null,
        metaTitle: body.metaTitle,
        metaDescription: body.metaDescription,
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            pictureProfile: true,
          },
        },
      },
    });
  };

  /**
   * Update blog post (Admin only)
   */
  updatePost = async (
    slug: string,
    body: UpdateBlogPostDTO,
    coverImage?: Express.Multer.File
  ) => {
    const post = await this.prisma.blogPost.findUnique({
      where: { slug: slug },
    });

    if (!post) {
      throw new ApiError("Blog post not found", 404);
    }

    // Generate new slug if title changed
    let newSlug = slug;
    if (body.title && body.title !== post.title) {
      newSlug = generateSlug(body.title);
      let slugExists = await this.prisma.blogPost.findFirst({
        where: {
          slug: newSlug,
          NOT: { id: post.id },
        },
      });

      let counter = 1;
      while (slugExists) {
        newSlug = `${generateSlug(body.title)}-${counter}`;
        slugExists = await this.prisma.blogPost.findFirst({
          where: {
            slug: newSlug,
            NOT: { id: post.id },
          },
        });
        counter++;
      }
    }

    // Handle cover image upload
    let coverImageUrl = post.coverImage;
    if (coverImage) {
      // Remove old image if exists
      if (post.coverImage) {
        await this.cloudinary.remove(post.coverImage);
      }

      const { secure_url } = await this.cloudinary.upload(
        coverImage,
        "blog/covers"
      );
      coverImageUrl = secure_url;
    }

    // Update published date if publishing for first time
    let publishedAt = post.publishedAt;
    if (body.published && !post.published) {
      publishedAt = body.publishedAt ? new Date(body.publishedAt) : new Date();
    }

    return await this.prisma.blogPost.update({
      where: { id: post.id },
      data: {
        title: body.title,
        slug: newSlug,
        excerpt: body.excerpt,
        content: body.content,
        coverImage: coverImageUrl,
        category: body.category,
        tags: body.tags,
        published: body.published,
        publishedAt: publishedAt,
        metaTitle: body.metaTitle,
        metaDescription: body.metaDescription,
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            pictureProfile: true,
          },
        },
      },
    });
  };

  /**
   * Delete blog post (Admin only)
   */
  deletePost = async (slug: string) => {
    const post = await this.prisma.blogPost.findUnique({
      where: { slug: slug },
    });

    if (!post) {
      throw new ApiError("Blog post not found", 404);
    }

    // Delete cover image if exists
    if (post.coverImage) {
      await this.cloudinary.remove(post.coverImage);
    }

    // Delete post (cascade will delete comments)
    await this.prisma.blogPost.delete({
      where: { id: post.id },
    });

    return { message: "Blog post deleted successfully" };
  };

  // =====================================
  // COMMENT METHODS
  // =====================================

  /**
   * Get all comments for a post
   */
  getComments = async (postId: number) => {
    // Get top-level comments only (parentId is null)
    const comments = await this.prisma.blogComment.findMany({
      where: {
        postId: postId,
        parentId: null,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            pictureProfile: true,
          },
        },
        replies: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                pictureProfile: true,
              },
            },
            replies: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    pictureProfile: true,
                  },
                },
              },
              orderBy: { createdAt: "asc" },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return comments;
  };

  /**
   * Create comment (User)
   */
  createComment = async (
    postId: number,
    userId: number,
    body: CreateCommentDTO
  ) => {
    // Check if post exists and is published
    const post = await this.prisma.blogPost.findFirst({
      where: {
        id: postId,
        published: true,
      },
    });

    if (!post) {
      throw new ApiError("Blog post not found or not published", 404);
    }

    // If replying to a comment, check parent exists
    if (body.parentId) {
      const parentComment = await this.prisma.blogComment.findFirst({
        where: {
          id: body.parentId,
          postId: postId,
        },
      });

      if (!parentComment) {
        throw new ApiError("Parent comment not found", 404);
      }
    }

    // Create comment
    const comment = await this.prisma.blogComment.create({
      data: {
        postId: postId,
        userId: userId,
        content: body.content,
        parentId: body.parentId || null,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            pictureProfile: true,
          },
        },
      },
    });

    // Increment comment count on post
    await this.prisma.blogPost.update({
      where: { id: postId },
      data: { commentCount: { increment: 1 } },
    });

    return comment;
  };

  /**
   * Update comment (Owner only)
   */
  updateComment = async (
    commentId: number,
    userId: number,
    body: UpdateCommentDTO
  ) => {
    const comment = await this.prisma.blogComment.findUnique({
      where: { id: commentId },
    });

    if (!comment) {
      throw new ApiError("Comment not found", 404);
    }

    // Check ownership
    if (comment.userId !== userId) {
      throw new ApiError("You can only edit your own comments", 403);
    }

    return await this.prisma.blogComment.update({
      where: { id: commentId },
      data: {
        content: body.content,
        isEdited: true,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            pictureProfile: true,
          },
        },
      },
    });
  };

  /**
   * Delete comment (Owner or Admin)
   */
  deleteComment = async (
    commentId: number,
    userId: number,
    isAdmin: boolean
  ) => {
    const comment = await this.prisma.blogComment.findUnique({
      where: { id: commentId },
      include: {
        _count: {
          select: { replies: true },
        },
      },
    });

    if (!comment) {
      throw new ApiError("Comment not found", 404);
    }

    // Check permission (owner or admin)
    if (!isAdmin && comment.userId !== userId) {
      throw new ApiError("You can only delete your own comments", 403);
    }

    // Calculate total comments to decrement (comment + all nested replies)
    const totalToDelete = 1 + comment._count.replies;

    // Delete comment (cascade will delete replies)
    await this.prisma.blogComment.delete({
      where: { id: commentId },
    });

    // Decrement comment count on post
    await this.prisma.blogPost.update({
      where: { id: comment.postId },
      data: { commentCount: { decrement: totalToDelete } },
    });

    return { message: "Comment deleted successfully" };
  };
}
