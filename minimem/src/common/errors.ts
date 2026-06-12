// ============================================================
// MiniMem — 错误类型定义
// ============================================================

export class MiniMemError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    statusCode: number = 500,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'MiniMemError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

// ── 具体错误类 ──

export class NotFoundError extends MiniMemError {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`, 'NOT_FOUND', 404, { entity, id });
    this.name = 'NotFoundError';
  }
}

export class DuplicateError extends MiniMemError {
  constructor(entity: string, key: string) {
    super(`${entity} already exists: ${key}`, 'DUPLICATE', 409, { entity, key });
    this.name = 'DuplicateError';
  }
}

export class ValidationError extends MiniMemError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends MiniMemError {
  constructor(message: string = 'Authentication required') {
    super(message, 'AUTH_ERROR', 401);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends MiniMemError {
  constructor(message: string = 'Insufficient permissions') {
    super(message, 'FORBIDDEN', 403);
    this.name = 'AuthorizationError';
  }
}

export class RateLimitError extends MiniMemError {
  constructor(limit: number, window: string) {
    super(
      `Rate limit exceeded: ${limit} per ${window}`,
      'RATE_LIMIT',
      429,
      { limit, window },
    );
    this.name = 'RateLimitError';
  }
}

export class LLMError extends MiniMemError {
  constructor(message: string, provider?: string) {
    super(message, 'LLM_ERROR', 502, { provider });
    this.name = 'LLMError';
  }
}

export class StorageError extends MiniMemError {
  constructor(message: string, operation?: string) {
    super(message, 'STORAGE_ERROR', 500, { operation });
    this.name = 'StorageError';
  }
}

export class DreamError extends MiniMemError {
  constructor(message: string, phase?: number) {
    super(message, 'DREAM_ERROR', 500, { phase });
    this.name = 'DreamError';
  }
}
