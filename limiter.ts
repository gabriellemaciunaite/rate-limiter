import { Request, Response, NextFunction } from 'express';
import { Redis } from 'ioredis';

declare module 'ioredis' {
  interface Redis {
    slidingWindowCounter(
      currentKey: string,
      prevKey: string,
      prevWeight: number,
      limit: number,
      ttlSeconds: number
    ): Promise<[number, number]>;
  }
}

export const redis = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT) || 6379,
  connectTimeout: 2000,
  maxRetriesPerRequest: 1,
});
redis.on('error', (err: Error) => console.error('Redis Error:', err.message));

const SLIDING_WINDOW_COUNTER_LUA = `
  local currentKey = KEYS[1]
  local prevKey = KEYS[2]
  local prevWeight = tonumber(ARGV[1])
  local limit = tonumber(ARGV[2])
  local ttl = tonumber(ARGV[3])

  local currentCount = tonumber(redis.call('GET', currentKey) or "0")
  local prevCount = tonumber(redis.call('GET', prevKey) or "0")
  local estimatedReq = (prevCount * prevWeight) + currentCount
  if estimatedReq >= limit then
    return {0, math.floor(estimatedReq)}
  end

  currentCount = redis.call('INCR', currentKey)
  if currentCount == 1 then
    redis.call('EXPIRE', currentKey, ttl * 2)
  end
  return {1, math.floor(estimatedReq) + 1}
`;

redis.defineCommand('slidingWindowCounter', {
  lua: SLIDING_WINDOW_COUNTER_LUA,
  numberOfKeys: 2,
});





export interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
}

export function createRateLimiter(options: RateLimiterOptions) {
  const windowSeconds = Math.ceil(options.windowMs / 1000);
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const clientIdentifier = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const currentBucket = Math.floor(now / options.windowMs) * windowSeconds;
    const prevBucket = currentBucket - windowSeconds;

    const currentKey = `ratelimit:${clientIdentifier}:${currentBucket}`;
    const prevKey = `ratelimit:${clientIdentifier}:${prevBucket}`;
    const prevWeight = 1 - ((now % options.windowMs) / options.windowMs);
    try {
      const [isAllowed, estimatedCount] = await redis.slidingWindowCounter(
        currentKey,
        prevKey,
        prevWeight,
        options.maxRequests,
        windowSeconds
      );

      const remaining = Math.max(0, options.maxRequests - estimatedCount);
      const reset = currentBucket + windowSeconds;
      res.setHeader('X-RateLimit-Limit', options.maxRequests);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', reset);

      if (isAllowed === 0) {
        res.status(429).json({
          error: 'Too Many Requests',
          message: `Exceeded maximum requests within this window. ${options.maxRequests} requests allowed.`,
        });
        return;
      }
      next();
    } catch (error: Error) {
      console.error('Redis dropped connection:', error.message);
      next();
    }
  };
}