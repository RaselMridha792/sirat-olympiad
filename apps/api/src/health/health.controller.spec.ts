import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('liveness returns ok without touching dependencies', () => {
    const c = new HealthController({} as never, {} as never);
    expect(c.health()).toEqual({ status: 'ok' });
  });
});
