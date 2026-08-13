/**
 * States for the Circuit Breaker
 */
export enum CircuitState {
  CLOSED = 'CLOSED',       // Normal functionality
  OPEN = 'OPEN',           // Blocking requests state (failed request threshold reached)
  HALF_OPEN = 'HALF_OPEN', // Allow one (1) request - on success set to closed, otherwise open
}

/**
 * Parameters for initializing a CircuitBreaker instance
 */
export interface CircuitBreakerOptions {
  maxFailures: number;
  timeoutMs: number;  // Duration in ms to remain in open state before returning to half_open
}

/**
 * Implements the Circuit Breaker to prevent repeating failures
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private numFailures: number = 0;
  private nextAttemptTime: number = 0;
  private readonly maxFailures: number;
  private readonly timeoutMs: number;

  constructor(options: CircuitBreakerOptions) {
    this.maxFailures = options.maxFailures;
    this.timeoutMs = options.timeoutMs;
  }

  // Returns current state of the CircuitBreaker
  public getState(): CircuitState {
    return this.state;
  }

  /**
   * Evaluate whether a request should proceed. 
   */
  public canAttempt(): boolean {
    if (this.state === CircuitState.CLOSED) return true;
    if (this.state === CircuitState.HALF_OPEN) return true;
    // Check if cooldown timer has finished (in OPEN state) to transition to HAlF_OPEN
    if (Date.now() >= this.nextAttemptTime) {
      this.state = CircuitState.HALF_OPEN;
      return true;
    }
    return false;
  }

  // Log successful attempt, reset numFailures, and set circuit state to OPEN
  public logSuccess(): void {
    this.numFailures = 0;
    if (this.state === CircuitState.HALF_OPEN) this.state = CircuitState.CLOSED;
  }

  /** Log unsuccessful attempt, set circuit state to OPEN if failure
   *  limit exceeded or if in HALF_OPEN state.
  */ 
  public logFailure(): void {
    this.numFailures++;
    if (this.state === CircuitState.HALF_OPEN || this.numFailures >= this.maxFailures) {
      this.nextAttemptTime = Date.now() + this.timeoutMs;
      this.state = CircuitState.OPEN;
    }
  }
}