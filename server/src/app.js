import 'dotenv/config';
import fs from 'node:fs';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import routes from './routes.js';
import extra, { openapi } from './extra.js';
import more from './more.js';
import swaggerUi from 'swagger-ui-express';
import { csrf } from './lib.js';

fs.mkdirSync('uploads', { recursive: true });
const app = express();
app.set('trust proxy', 1);
app.use(helmet(), compression(), morgan('tiny'), cors({ origin: process.env.CLIENT_URL, credentials: true }), express.json({ limit: '200kb' }), cookieParser());
app.use('/api', rateLimit({ windowMs: 60e3, limit: 200 }), csrf);
app.use('/api/auth', rateLimit({ windowMs: 15 * 60e3, limit: 30 }));
app.get('/api/health', (q, s) => s.json({ success: true, message: 'ok', data: {} }));
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi));
app.use('/api', extra, more, routes);
// Evidence files are NOT served statically; add an authorised download route for complaint owners/admins.
app.use((e, req, res, next) => {
  const code = e.name === 'ZodError' ? 400 : e.code && Number.isInteger(e.code) && e.code < 600 ? e.code : e.code === 11000 ? 409 : 500;
  if (code === 500) console.error(e);
  res.status(code).json({ success: false, message: code === 500 ? 'Something went wrong' : e.name === 'ZodError' ? e.issues.map((i) => i.message).join('; ') : e.message, data: null });
});
export default app;
