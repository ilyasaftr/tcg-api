import { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/api-error";
import { captureSentryException } from "../config/sentry";

export const errorMiddleware = (
  err: ApiError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  captureSentryException(err, {
    method: req.method,
    path: req.path,
    status: err.status || 500,
  });

  const status = err.status || 500;
  const message = err.message || "something went wrong";
  res.status(status).send({ message });
};
