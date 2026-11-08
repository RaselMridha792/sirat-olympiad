import type { PrismaClient } from '@prisma/client';
import { DemoRunner } from './demo-runner';

describe('DemoRunner.load', () => {
  it('stops before publishing results when a removal took the batch meanwhile (A2: the abandoned-job rule)', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({ status: 'loading' }) // at the start
      .mockResolvedValueOnce({ status: 'clearing' }); // after the generators: an abandoned-batch removal began
    const $queryRaw = jest.fn();
    const updateMany = jest.fn();
    const prisma = {
      demoBatch: { findUnique, updateMany },
      demoRecord: { findFirst: jest.fn().mockResolvedValue({ rowId: 'u1' }) }, // the generators committed before
      $queryRaw,
      $transaction: jest.fn(),
    } as unknown as PrismaClient;
    await expect(new DemoRunner({ prisma, cache: null }).load('b1', 'hash')).resolves.toBeNull();
    expect($queryRaw).not.toHaveBeenCalled(); // no results query, no counts
    expect(updateMany).not.toHaveBeenCalled(); // never marked 'loaded'
  });
});
