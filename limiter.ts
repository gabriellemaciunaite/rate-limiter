import { Request, Response, NextFunction } from 'express';
import { Redis } from 'ioredis';
import { CircuitBreaker } from './circuit-breaker';

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
redis.on('error', (err: Error) => console.warn('[Redis Connection Warning]: Redis unavailable, using local memory fallback.'));

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


class FixedWindowLimiter {
  private map = new Map<string, number>();
  private readonly maxRequests: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    setInterval(() => { this.map = new Map<string, number>(); }, windowMs).unref();
  }
  public consume(key: string): boolean {
    const count = this.map.get(key) || 0;
    if (count >= this.maxRequests) return false;
    this.map.set(key, count + 1);
    return true;
  }
}





const breaker = new CircuitBreaker({
  maxFailures: 3,  
  timeoutMs: 10 * 1000,
});

export interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
  maxStrikes?: number;
  strikeWindowTime?: number; 
  penaltyDuration?: number;
}

export function createRateLimiter(options: RateLimiterOptions) {
  const windowSeconds = Math.ceil(options.windowMs / 1000);
  const localFallback = new FixedWindowLimiter(options.maxRequests, options.windowMs);
  const maxStrikes = options.maxStrikes ?? 5;
  const strikeWindowTime = options.strikeWindowTime ?? 60;
  const penaltyDuration = options.penaltyDuration ?? 3600;
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const clientIdentifier = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const runAlternative = () => {
      const isAllowed = localFallback.consume(clientIdentifier);
      if (!isAllowed) {
        res.status(429).json({
          error: 'Too Many Requests',
          message: `Exceeded maximum requests within this window. ${options.maxRequests} requests allowed.`,
        });
        return; 
      }
      next();
    };
    const currentBucket = Math.floor(now / options.windowMs) * windowSeconds;
    const prevBucket = currentBucket - windowSeconds;

    const currentKey = `ratelimit:${clientIdentifier}:${currentBucket}`;
    const prevKey = `ratelimit:${clientIdentifier}:${prevBucket}`;
    const prevWeight = 1 - ((now % options.windowMs) / options.windowMs);

    if (!breaker.canAttempt()) {
      console.warn('Falling back to alternative rate limiter');
      return runAlternative();
    }
    try {
      const isBanned = await redis.get(`blocklist:${clientIdentifier}`);
      if (isBanned) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'Your IP has been temporarily banned for API abuse.',
        });
        return;
      }
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
      breaker.logSuccess();

      if (isAllowed === 0) {
        const strikeKey = `strikes:${clientIdentifier}`;
        const strikes = await redis.incr(strikeKey);
        if (strikes === 1) await redis.expire(strikeKey, strikeWindowTime); 
        if (strikes >= maxStrikes) {
          console.warn(`Client IP ${clientIdentifier} banned for ${penaltyDuration}s for too many failed requests.`);
          await redis.set(`blocklist:${clientIdentifier}`, '1', 'EX', penaltyDuration); 
        }
        res.status(429).json({
          error: 'Too Many Requests',
          message: `Exceeded maximum requests within this window. ${options.maxRequests} requests allowed.`,
        });
        return;
      }
      next();
    } catch (error: Error) {
      console.warn('Falling back to alternative rate limiter:', error.message);
      breaker.logFailure();
      return runAlternative();
    }
  };
}