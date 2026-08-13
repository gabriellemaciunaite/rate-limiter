import express, { Request, Response } from 'express';
import { createRateLimiter } from './limiter';

const app = express();

// Parse incoming JSON payloads
app.use(express.json());

// Initialize sliding window counter with rules
const rateLimiter = createRateLimiter({
  windowMs: 60 * 1000,   // 60-second window
  maxRequests: 5,        // Allow up to 5 requests per window before rate-limiting
  maxStrikes: 20,        // Max strikes before temporarily banning User IP
  strikeWindowTime: 60,  // 60-second timeframe
  penaltyDuration: 1800, // Ban duration in seconds (30 minutes)
});

// Use rate limiting middleware on all routes
app.use('/', rateLimiter);

// Rate limiter validation endpoint
app.get('/rate-limiter', (req: Request, res: Response) => {
  res.json({
    status: 'success',
    data: 'Request processed successfully.',
    timestamp: new Date().toISOString(),
  });
});

// Error handler for uncaught exceptions
app.use((err: Error, req: Request, res: Response, next: express.NextFunction) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: 'Internal Server Error' });
});

export default app;