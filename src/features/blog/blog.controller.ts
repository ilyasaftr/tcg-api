import { Request, Response, NextFunction } from "express";
import { BlogService } from "./blog.service";
import { ApiError } from "../../utils/api-error";

export class BlogController {
  private blogService: BlogService;

  constructor() {
    this.blogService = new BlogService();
  }

  // =====================================
  // BLOG POST ENDPOINTS
  // =====================================

  /**
   * GET /blog/posts
   * Get all blog posts
   */
  getAllPosts = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const isAdmin = res.locals.user?.role === "ADMIN";
      const rawPage = req.query.page;
      const rawLimit = req.query.limit ?? req.query.take;
      const rawSkip = req.query.skip;
      const rawCategory = req.query.category;
      const rawTag = req.query.tag;
      const rawSearch = req.query.search;

      const hasPagination =
        rawPage !== undefined || rawLimit !== undefined || rawSkip !== undefined;
      const hasFilters =
        rawCategory !== undefined || rawTag !== undefined || rawSearch !== undefined;

      const page = rawPage !== undefined ? Number(rawPage) : undefined;
      const limit = rawLimit !== undefined ? Number(rawLimit) : undefined;
      const skip = rawSkip !== undefined ? Number(rawSkip) : undefined;
      const category =
        typeof rawCategory === "string" && rawCategory.trim()
          ? rawCategory.trim()
          : undefined;
      const tag =
        typeof rawTag === "string" && rawTag.trim() ? rawTag.trim() : undefined;
      const search =
        typeof rawSearch === "string" && rawSearch.trim()
          ? rawSearch.trim()
          : undefined;

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

      if (hasPagination || hasFilters) {
        const result = await this.blogService.getAllPostsPaginated(isAdmin, {
          page,
          limit,
          skip,
          category,
          tag,
          search,
        });

        res.status(200).json({
          success: true,
          data: result.posts,
          pagination: result.pagination,
        });
        return;
      }

      const posts = await this.blogService.getAllPosts(isAdmin, {
        category,
        tag,
        search,
      });

      res.status(200).json({
        success: true,
        data: posts,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /blog/posts/:slug
   * Get single blog post by slug
   */
  getPostBySlug = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { slug } = req.params;
      const isAdmin = res.locals.user?.role === "ADMIN";
      const post = await this.blogService.getPostBySlug(slug, isAdmin);
      res.status(200).json({
        success: true,
        data: post,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /blog/posts
   * Create blog post (Admin only)
   */
  createPost = async (req: Request, res: Response, next: NextFunction) => {
    try {
      // ✅ VALIDATION
      if (!res.locals.user || !res.locals.user.id) {
        throw new ApiError("Unauthorized - User not found in token", 401);
      }

      const userId = res.locals.user.id; // ✅ UBAH DARI userId KE id
      const coverImage = req.file;
      const post = await this.blogService.createPost(userId, req.body, coverImage);
      
      res.status(201).json({
        success: true,
        message: "Blog post created successfully",
        data: post,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * PATCH /blog/posts/:slug
   * Update blog post (Admin only)
   */
  updatePost = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { slug } = req.params;
      const coverImage = req.file;
      const post = await this.blogService.updatePost(slug, req.body, coverImage);
      res.status(200).json({
        success: true,
        message: "Blog post updated successfully",
        data: post,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * DELETE /blog/posts/:slug
   * Delete blog post (Admin only)
   */
  deletePost = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { slug } = req.params;
      const result = await this.blogService.deletePost(slug);
      res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      next(error);
    }
  };

  // =====================================
  // COMMENT ENDPOINTS
  // =====================================

  /**
   * GET /blog/posts/:postId/comments
   * Get all comments for a post
   */
  getComments = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const postId = parseInt(req.params.postId);
      if (isNaN(postId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid post ID",
        });
      }

      const comments = await this.blogService.getComments(postId);
      res.status(200).json({
        success: true,
        data: comments,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /blog/posts/:postId/comments
   * Create comment (Authenticated users)
   */
  createComment = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const postId = parseInt(req.params.postId);
      if (isNaN(postId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid post ID",
        });
      }

      // ✅ VALIDATION
      if (!res.locals.user || !res.locals.user.id) {
        throw new ApiError("Unauthorized - User not found in token", 401);
      }

      const userId = res.locals.user.id; // ✅ UBAH DARI userId KE id
      const comment = await this.blogService.createComment(postId, userId, req.body);
      res.status(201).json({
        success: true,
        message: "Comment added successfully",
        data: comment,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * PATCH /blog/comments/:commentId
   * Update comment (Owner only)
   */
  updateComment = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const commentId = parseInt(req.params.commentId);
      if (isNaN(commentId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid comment ID",
        });
      }

      // ✅ VALIDATION
      if (!res.locals.user || !res.locals.user.id) {
        throw new ApiError("Unauthorized - User not found in token", 401);
      }

      const userId = res.locals.user.id; // ✅ UBAH DARI userId KE id
      const comment = await this.blogService.updateComment(commentId, userId, req.body);
      res.status(200).json({
        success: true,
        message: "Comment updated successfully",
        data: comment,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * DELETE /blog/comments/:commentId
   * Delete comment (Owner or Admin)
   */
  deleteComment = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const commentId = parseInt(req.params.commentId);
      if (isNaN(commentId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid comment ID",
        });
      }

      // ✅ VALIDATION
      if (!res.locals.user || !res.locals.user.id) {
        throw new ApiError("Unauthorized - User not found in token", 401);
      }

      const userId = res.locals.user.id; // ✅ UBAH DARI userId KE id
      const isAdmin = res.locals.user.role === "ADMIN";
      const result = await this.blogService.deleteComment(commentId, userId, isAdmin);
      res.status(200).json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      next(error);
    }
  };
}
