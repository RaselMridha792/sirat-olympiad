import { Inject, Injectable } from '@nestjs/common';
import type { AnswerList, ExamEvent } from '@sirat/shared';
import type Redis from 'ioredis';
import { withTimeout } from '../../common/with-timeout';
import { REDIS_CACHE } from '../../redis/redis.module';

/** Minimum time between two stored checkpoints of one attempt (EXAM-PLAN 3.4). A provider, so tests can shorten it. */
export const CHECKPOINT_MIN_INTERVAL_MS = Symbol('CHECKPOINT_MIN_INTERVAL_MS');
export const DEFAULT_CHECKPOINT_MIN_INTERVAL_MS = 20_000;

/** Kept two hours past ends_at + grace, so the server finalize can still read the last checkpoint. */
const KEEP_AFTER_MS = 2 * 60 * 60 * 1000;
const REDIS_TIMEOUT_MS = 300;

const keys = {
  meta: (id: string) => `exam:att:${id}`,
  checkpoint: (id: string) => `exam:ckpt:${id}`,
};

/** What the checkpoint path needs to know about an attempt without reading Postgres. */
export interface AttemptMeta {
  attemptId: string;
  userId: string;
  examId: string;
  endsAt: number; // ms
  graceSeconds: number;
  optionCounts: number[];
  submitted: boolean;
}

export interface StoredCheckpoint {
  seq: number | null;
  answers: AnswerList | null;
  violationCount: number;
  events: ExamEvent[];
}

export type CheckpointOutcome =
  | { kind: 'saved' | 'stale'; savedSeq: number | null; violationCount: number }
  | { kind: 'throttled'; savedSeq: number | null; violationCount: number; retryAfterMs: number };

/**
 * One atomic step per checkpoint. The answers are stored only if `seq` is newer and the last stored checkpoint is at
 * least the minimum interval old (otherwise 'throttled'). The violation count only ever goes up and is kept even when
 * the answers are refused, so a violation is never lost on the server (EXAM-PLAN 3.15); the events list is kept when
 * it is at least as long as the stored one.
 * KEYS[1] checkpoint hash; ARGV: seq, answers JSON, now ms, min interval ms, ttl ms, violation count, events JSON,
 * event count.
 */
const CHECKPOINT_SCRIPT = `
local seq = tonumber(ARGV[1])
local now = tonumber(ARGV[3])
local minInterval = tonumber(ARGV[4])
local ttl = tonumber(ARGV[5])
local vc = tonumber(ARGV[6])
local evn = tonumber(ARGV[8])
local cur = redis.call('HMGET', KEYS[1], 'seq', 'at', 'vc', 'evn')
local curSeq = tonumber(cur[1])
local at = tonumber(cur[2]) or 0
local curVc = tonumber(cur[3]) or 0
local curEvn = tonumber(cur[4]) or -1
if vc > curVc then
  redis.call('HSET', KEYS[1], 'vc', vc)
  curVc = vc
end
if evn >= curEvn then
  redis.call('HSET', KEYS[1], 'ev', ARGV[7], 'evn', evn)
end
redis.call('PEXPIRE', KEYS[1], ttl)
if at > 0 and now - at < minInterval then
  return {'throttled', curSeq or -1, curVc, minInterval - (now - at)}
end
if curSeq ~= nil and seq <= curSeq then
  return {'stale', curSeq, curVc, 0}
end
redis.call('HSET', KEYS[1], 'seq', seq, 'data', ARGV[2], 'at', now)
return {'saved', seq, curVc, 0}
`;

/** Attempt metadata and checkpoints in the cache Redis. No database read or write on the checkpoint path. */
@Injectable()
export class AttemptStore {
  constructor(
    @Inject(REDIS_CACHE) private readonly redis: Redis,
    @Inject(CHECKPOINT_MIN_INTERVAL_MS) private readonly minIntervalMs: number,
  ) {}

  /** Undefined when Redis has no copy or does not answer (the caller reads Postgres). */
  async meta(attemptId: string): Promise<AttemptMeta | undefined> {
    try {
      const raw = await withTimeout(this.redis.get(keys.meta(attemptId)), REDIS_TIMEOUT_MS);
      return raw ? (JSON.parse(raw) as AttemptMeta) : undefined;
    } catch {
      return undefined;
    }
  }

  async setMeta(meta: AttemptMeta): Promise<void> {
    const ttl = ttlMs(meta);
    if (ttl <= 0) return;
    await withTimeout(
      this.redis.set(keys.meta(meta.attemptId), JSON.stringify(meta), 'PX', ttl),
      REDIS_TIMEOUT_MS,
    ).catch(() => undefined);
  }

  /** Best effort: Postgres stays the source of truth for "submitted". */
  async markSubmitted(meta: AttemptMeta): Promise<void> {
    await this.setMeta({ ...meta, submitted: true });
  }

  /** Throws when Redis does not answer: the caller answers 503 and the client keeps its local copy. */
  async saveCheckpoint(
    meta: AttemptMeta,
    body: { seq: number; answers: AnswerList; violationCount: number; events: ExamEvent[] },
    now: number,
  ): Promise<CheckpointOutcome> {
    const reply = (await withTimeout(
      this.redis.eval(
        CHECKPOINT_SCRIPT,
        1,
        keys.checkpoint(meta.attemptId),
        body.seq,
        JSON.stringify(body.answers),
        now,
        this.minIntervalMs,
        Math.max(1, ttlMs(meta, now)),
        body.violationCount,
        JSON.stringify(body.events),
        body.events.length,
      ),
      REDIS_TIMEOUT_MS,
    )) as [string, number, number, number];
    const [kind, seq, violationCount, retryAfterMs] = reply;
    const savedSeq = seq < 0 ? null : seq;
    if (kind === 'throttled') return { kind, savedSeq, violationCount, retryAfterMs };
    return { kind: kind === 'saved' ? 'saved' : 'stale', savedSeq, violationCount };
  }

  /** The last checkpoint; null when there is none or Redis does not answer. */
  async readCheckpoint(attemptId: string): Promise<StoredCheckpoint | null> {
    try {
      const [seq, data, vc, ev] = await withTimeout(
        this.redis.hmget(keys.checkpoint(attemptId), 'seq', 'data', 'vc', 'ev'),
        REDIS_TIMEOUT_MS,
      );
      if (seq === null && vc === null) return null;
      return {
        seq: seq === null ? null : Number(seq),
        answers: data ? (JSON.parse(data) as AnswerList) : null,
        violationCount: vc === null ? 0 : Number(vc),
        events: ev ? (JSON.parse(ev) as ExamEvent[]) : [],
      };
    } catch {
      return null;
    }
  }
}

function ttlMs(meta: AttemptMeta, now = Date.now()): number {
  return meta.endsAt + meta.graceSeconds * 1000 + KEEP_AFTER_MS - now;
}
