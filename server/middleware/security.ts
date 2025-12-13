import { Request, Response, NextFunction } from "express";

const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 100;
const RATE_LIMIT_MAX_AUTH_REQUESTS = 10;

function getClientIP(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket.remoteAddress || "unknown";
}

export function rateLimiter(maxRequests: number = RATE_LIMIT_MAX_REQUESTS) {
  return (req: Request, res: Response, next: NextFunction) => {
    const clientIP = getClientIP(req);
    const now = Date.now();
    const key = `${clientIP}:${req.path}`;

    const record = rateLimitStore.get(key);

    if (!record || now > record.resetTime) {
      rateLimitStore.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
      return next();
    }

    if (record.count >= maxRequests) {
      res.setHeader("Retry-After", Math.ceil((record.resetTime - now) / 1000));
      return res.status(429).json({
        message: "Too many requests. Please try again later.",
        retryAfter: Math.ceil((record.resetTime - now) / 1000),
      });
    }

    record.count++;
    next();
  };
}

export function authRateLimiter() {
  return rateLimiter(RATE_LIMIT_MAX_AUTH_REQUESTS);
}

export function securityHeaders() {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self';"
    );
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.removeHeader("X-Powered-By");
    next();
  };
}

const DANGEROUS_PATTERNS = [
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  /javascript:/gi,
  /on\w+\s*=/gi,
  /data:\s*text\/html/gi,
];

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") {
    let sanitized = value;
    for (const pattern of DANGEROUS_PATTERNS) {
      sanitized = sanitized.replace(pattern, "");
    }
    sanitized = sanitized
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#x27;");
    return sanitized;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value && typeof value === "object") {
    const sanitizedObj: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      sanitizedObj[key] = sanitizeValue(val);
    }
    return sanitizedObj;
  }
  return value;
}

export function inputSanitizer() {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.body && typeof req.body === "object") {
      req.body = sanitizeValue(req.body);
    }
    if (req.query && typeof req.query === "object") {
      req.query = sanitizeValue(req.query) as typeof req.query;
    }
    next();
  };
}

export function corsMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const configuredOrigins = process.env.CORS_ORIGINS?.split(",") || [];
    const allowedOrigins = [
      process.env.APP_URL || "",
      process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "",
      "http://localhost:5000",
      "http://localhost:5173",
      "http://0.0.0.0:5000",
      ...configuredOrigins,
    ].filter(Boolean);

    const origin = req.headers.origin;

    if (!origin || allowedOrigins.includes(origin) || allowedOrigins.some(o => origin.endsWith('.replit.dev'))) {
      res.setHeader("Access-Control-Allow-Origin", origin || "*");
    }

    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Max-Age", "86400");

    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }

    next();
  };
}

setInterval(() => {
  const now = Date.now();
  const entries = Array.from(rateLimitStore.entries());
  for (const [key, record] of entries) {
    if (now > record.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 60 * 1000);
