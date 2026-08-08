import express, { Request, Response } from 'express';
import { createRateLimiter } from './limiter';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const rateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 60-second window bucket
  maxRequests: 10,     // 10 allowed requests
  maxStrikes: 5,
  strikeWindowTime: 60,
  penaltyDuration: 3600,
});

app.use('/', rateLimiter);

app.get('/test', (req: Request, res: Response) => {
  res.json({ status: 'success',
    data: 'Request processed successfully.',
    timestamp: new Date().toISOString(),
  });
});

app.use((err: Error, req: Request, res: Response, next: express.NextFunction) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});