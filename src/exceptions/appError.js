class AppError extends Error {
  constructor(message, statusCode = 500, errorCode = 'INTERNAL_ERROR') {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

class UnauthorizedException extends AppError {
  constructor(message = 'Unauthorized access', errorCode = 'UNAUTHORIZED') {
    super(message, 401, errorCode);
    this.name = 'UnauthorizedException';
  }
}

class ForbiddenException extends AppError {
  constructor(message = 'Forbidden access', errorCode = 'FORBIDDEN') {
    super(message, 403, errorCode);
    this.name = 'ForbiddenException';
  }
}

class NotFoundException extends AppError {
  constructor(message = 'Resource not found', errorCode = 'NOT_FOUND') {
    super(message, 404, errorCode);
    this.name = 'NotFoundException';
  }
}

class BadRequestException extends AppError {
  constructor(message = 'Bad request', errorCode = 'BAD_REQUEST') {
    super(message, 400, errorCode);
    this.name = 'BadRequestException';
  }
}

module.exports = {
  AppError,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
};

