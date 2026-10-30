import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Server, createServer } from 'node:http';
import type { EnvVars } from '../../config/env';
import { EmailWorker } from './email.worker';

/**
 * GET /health on WORKER_HEALTH_PORT for the container healthcheck: 200 while the email worker runs. The port is
 * never published; only Docker's healthcheck inside the container calls it.
 */
@Injectable()
export class WorkerHealthService implements OnApplicationBootstrap, OnApplicationShutdown {
  private server?: Server;

  constructor(
    private readonly email: EmailWorker,
    private readonly config: ConfigService<EnvVars, true>,
  ) {}

  onApplicationBootstrap(): void {
    this.server = createServer((req, res) => {
      if (req.url !== '/health') return void res.writeHead(404).end();
      const ok = this.email.isRunning();
      res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: ok ? 'ok' : 'down' }));
    }).listen(this.config.get('WORKER_HEALTH_PORT', { infer: true }), '0.0.0.0');
  }

  onApplicationShutdown(): Promise<void> {
    return new Promise((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}
