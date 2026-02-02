export class ApiError extends Error {
  status: number;
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.status = statusCode;
    this.statusCode = statusCode;
  }
}
