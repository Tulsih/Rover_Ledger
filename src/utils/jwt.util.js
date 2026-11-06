const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const { env } = require("../configs/env");
const { errorConstants } = require("../constants/errorConstants");
const { UnauthorizedException } = require("../exceptions/appError");

function getSecret() {
  if (!env.jwtSecret && !env.jwtAccessSecret) {
    throw new Error("JWT_SECRET is required");
  }

  return env.jwtAccessSecret || env.jwtSecret;
}

function getRefreshSecret() {
  return env.jwtRefreshSecret || getSecret();
}

function getBaseOptions() {
  const options = {};

  if (env.jwtIssuer) {
    options.issuer = env.jwtIssuer;
  }

  if (env.jwtAudience) {
    options.audience = env.jwtAudience;
  }

  return options;
}

class JwtUtils {
  static generateAccessToken(payload, options = {}) {
    return jwt.sign(
      {
        ...payload,
        tokenType: "access",
        jti: crypto.randomUUID(),
      },
      getSecret(),
      {
        ...getBaseOptions(),
        expiresIn: env.jwtAccessExpiresIn,
        ...options,
      }
    );
  }

  static generateRefreshToken(payload, options = {}) {
    return jwt.sign(
      {
        ...payload,
        tokenType: "refresh",
        jti: crypto.randomUUID(),
      },
      getRefreshSecret(),
      {
        ...getBaseOptions(),
        expiresIn: env.jwtRefreshExpiresIn,
        ...options,
      }
    );
  }

  static verifyAccessToken(token) {
    try {
      const payload = jwt.verify(token, getSecret(), getBaseOptions());
      if (payload.tokenType && payload.tokenType !== "access") {
        throw new UnauthorizedException(errorConstants.INVALID_TOKEN);
      }
      return payload;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      if (error.name === "TokenExpiredError") {
        const expiredErr = new UnauthorizedException(errorConstants.TOKEN_EXPIRED, "TOKEN_EXPIRED");
        expiredErr.name = "TokenExpiredError";
        throw expiredErr;
      }
      throw new UnauthorizedException(errorConstants.INVALID_TOKEN);
    }
  }

  static verifyRefreshToken(token) {
    try {
      const payload = jwt.verify(token, getRefreshSecret(), getBaseOptions());

      if (payload.tokenType !== "refresh") {
        throw new UnauthorizedException(errorConstants.INVALID_REFRESH_TOKEN);
      }

      return payload;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      if (error.name === "TokenExpiredError") {
        const expiredErr = new UnauthorizedException(errorConstants.REFRESH_TOKEN_EXPIRED, "REFRESH_TOKEN_EXPIRED");
        expiredErr.name = "TokenExpiredError";
        throw expiredErr;
      }

      throw new UnauthorizedException(errorConstants.INVALID_REFRESH_TOKEN);
    }
  }

  static getBearerToken(authorizationHeader) {
    if (!authorizationHeader) {
      throw new UnauthorizedException(errorConstants.MISSING_AUTH_HEADER);
    }

    const [scheme, token] = authorizationHeader.split(" ");

    if (scheme !== "Bearer" || !token) {
      throw new UnauthorizedException(errorConstants.INVALID_TOKEN);
    }

    return token;
  }

  /**
   * Generates SHA-256 hash of a token for secure database storage
   */
  static hashToken(token) {
    return crypto.createHash("sha256").update(String(token).trim()).digest("hex");
  }

  /**
   * Helper to parse time string (e.g. '15m', '7d', '1h', '900s') into seconds
   */
  static parseExpiresInSeconds(durationStr) {
    if (typeof durationStr === "number") return durationStr;
    const match = String(durationStr).match(/^(\d+)([smhd])$/);
    if (!match) return 900;
    const val = parseInt(match[1], 10);
    const unit = match[2];
    switch (unit) {
      case "s": return val;
      case "m": return val * 60;
      case "h": return val * 3600;
      case "d": return val * 86400;
      default: return 900;
    }
  }

  // Backward compatibility alias methods
  static generateToken(payload, options = {}) {
    return JwtUtils.generateAccessToken(payload, options);
  }

  static verifyToken(token) {
    return JwtUtils.verifyAccessToken(token);
  }
}

// Attach duration constants to JwtUtils class
JwtUtils.JWT_ACCESS_EXPIRES_IN = env.jwtAccessExpiresIn;
JwtUtils.JWT_REFRESH_EXPIRES_IN = env.jwtRefreshExpiresIn;

// Destructuring & backward compatibility exports
module.exports = JwtUtils;
module.exports.generateAccessToken = JwtUtils.generateAccessToken;
module.exports.generateRefreshToken = JwtUtils.generateRefreshToken;
module.exports.verifyAccessToken = JwtUtils.verifyAccessToken;
module.exports.verifyRefreshToken = JwtUtils.verifyRefreshToken;
module.exports.getBearerToken = JwtUtils.getBearerToken;
module.exports.hashToken = JwtUtils.hashToken;
module.exports.parseExpiresInSeconds = JwtUtils.parseExpiresInSeconds;
module.exports.generateToken = JwtUtils.generateToken;
module.exports.verifyToken = JwtUtils.verifyToken;
module.exports.JWT_ACCESS_EXPIRES_IN = JwtUtils.JWT_ACCESS_EXPIRES_IN;
module.exports.JWT_REFRESH_EXPIRES_IN = JwtUtils.JWT_REFRESH_EXPIRES_IN;
