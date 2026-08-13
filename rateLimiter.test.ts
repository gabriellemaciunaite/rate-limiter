import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from './app';
import { redis, breaker } from './limiter';
import { CircuitState } from './circuit-breaker';

// Mock ioredis module including defineCommand and all Redis methods called by limiter.ts
vi.mock('ioredis', () => {
  class MockRedis {
    status = 'ready';
    
    // Core Redis methods used in limiter.ts
    get = vi.fn().mockResolvedValue(null);
    set = vi.fn().mockResolvedValue('OK');
    incr = vi.fn().mockResolvedValue(1);
    expire = vi.fn().mockResolvedValue(1);
    on = vi.fn();
    disconnect = vi.fn();

    // Custom Lua script command registered via defineCommand
    defineCommand = vi.fn().mockImplementation((name: string) => {
      // Return default allowed tuple [isAllowed, estimatedCount]
      (this as any)[name] = vi.fn().mockResolvedValue([1, 1]);
    });
  }

  return {
    Redis: MockRedis,
    default: MockRedis,
  };
});

describe('Rate Limiter Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset CircuitBreaker internal state and failure counter before each test
    if (breaker) {
      (breaker as any).state = CircuitState.CLOSED;
      (breaker as any).failureCount = 0;
    }
  });

  // ==========================================
  // TEST 1: Rate Limiter Enforces Request Limit
  // ==========================================
  it('should allow 5 requests and return a 429 status code on the 6th request', async () => {
    const luaSpy = vi.spyOn(redis, 'slidingWindowCounter')
      .mockResolvedValueOnce([1, 1])
      .mockResolvedValueOnce([1, 2]) 
      .mockResolvedValueOnce([1, 3])
      .mockResolvedValueOnce([1, 4]) 
      .mockResolvedValueOnce([1, 5]) 
      .mockResolvedValueOnce([0, 6]); //requests > maxRequests (isAllowed = 0)

    // Send first 5 allowed requests
    for (let i = 0; i < 5; i++) {
      const res = await request(app).get('/test');
      expect(res.status).toBe(200);
    }
    // Send 6th request
    const response = await request(app).get('/test');
    // Assertions
    expect(response.status).toBe(429);
    expect(response.body.error).toBe('Too Many Requests');
    expect(luaSpy).toHaveBeenCalledTimes(6);
  });

  // ==========================================
  // TEST 2: Circuit Breaker State Transition
  // ==========================================
  it('should transition CircuitBreaker state to OPEN when Redis failures hit maxFailures', async () => {
    expect(breaker.getState()).toBe(CircuitState.CLOSED);

    // Trip circuit breaker by simulating 3 Redis failures (>= maxFailures)
    breaker.logFailure();
    breaker.logFailure();
    breaker.logFailure();

    expect(breaker.getState()).toBe(CircuitState.OPEN);
    expect(breaker.canAttempt()).toBe(false);
  });

  // ==========================================
  // TEST 3: In-Memory Fallback During Open State
  // ==========================================
  it('should skip Redis execution and fall back to local memory when CircuitBreaker is OPEN', async () => {
    // Force breaker into OPEN state
    breaker.logFailure();
    breaker.logFailure();
    breaker.logFailure();

    expect(breaker.canAttempt()).toBe(false);

    const luaSpy = vi.spyOn(redis, 'slidingWindowCounter');
    const getSpy = vi.spyOn(redis, 'get');
    // Request should still pass via in-memory fallback
    const response = await request(app).get('/test');

    expect(response.status).toBe(200);

    // Verify Redis calls were skipped because breaker was OPEN
    expect(luaSpy).not.toHaveBeenCalled();
    expect(getSpy).not.toHaveBeenCalled();
  });
});