/**
 * Errors that are safe to show a caller. Anything else becomes a generic 500
 * so internals (stack traces, SQL, upstream bodies) never leak.
 */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const notFound = (what: string) => new ApiError(404, "not_found", `${what} not found`);
export const unauthorized = () => new ApiError(401, "unauthorized", "Missing or invalid API key");
export const conflict = (message: string) => new ApiError(409, "conflict", message);
export const validation = (fields: Record<string, string>) =>
  new ApiError(400, "validation", "Request failed validation", fields);
