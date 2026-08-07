export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN', 
  HALF_OPEN = 'HALF_OPEN', 
}

export interface CircuitBreakerOptions {
  maxFailures: number;
  timeoutMs: number; 
}

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

  public getState(): CircuitState {
    return this.state;
  }

  public canAttempt(): boolean {
    if (this.state === CircuitState.CLOSED) return true;
    if (this.state === CircuitState.HALF_OPEN) return true;
    if (Date.now() >= this.nextAttemptTime) {
      this.state = CircuitState.HALF_OPEN;
      return true;
    }
    return false;
  }

  public logSuccess(): void {
    this.numFailures = 0;
    if (this.state === CircuitState.HALF_OPEN) this.state = CircuitState.CLOSED;
  }

  public logFailure(): void {
    this.numFailures++;
    if (this.state === CircuitState.HALF_OPEN || this.numFailures >= this.maxFailures) {
      this.nextAttemptTime = Date.now() + this.timeoutMs;
      this.state = CircuitState.OPEN;
    }
  }
}