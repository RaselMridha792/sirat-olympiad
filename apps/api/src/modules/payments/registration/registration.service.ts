import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  Prisma,
  PaymentStatus,
  RegistrationAttemptStatus,
  type Payment,
  type PendingRegistration,
} from '@prisma/client';
import {
  BD_DISTRICTS,
  EDUCATION_TYPES,
  PARTICIPANT_ID_SHOWN_HOURS,
  REGISTRATION_MESSAGES,
  type CheckoutGateway,
  type Paginated,
  type RegistrationErrorCode,
  type RegistrationState,
  type ResumeRegistrationResult,
} from '@sirat/shared';
import type Redis from 'ioredis';
import { withTimeout } from '../../../common/with-timeout';
import { PrismaService } from '../../../prisma/prisma.service';
import { REDIS_CACHE } from '../../../redis/redis.module';
import { SecurityAlerts } from '../../audit/security-alerts.service';
import { PasswordService } from '../../auth/password.service';
import {
  PAYMENT_GATEWAY,
  type PaymentGateway,
  type InitiateResult,
} from '../gateway/payment-gateway';
import { newInvoiceNumber } from '../invoice';
import { checkoutGateway, type PaymentConfig } from '../payment.config';
import { PAYMENT_CONFIG } from '../payments-boot-check';
import { isActive } from '../payment-state';
import { isWatched } from '../verify/payment-timing';
import { VerifyRequests } from '../verify/verify-requests';
import type { StartRegistrationDto } from './dto/start-registration.dto';
import { RegistrationGuards } from './registration-guards';
import {
  isRegistrationOpen,
  readRegistrationSettings,
  type RegistrationSettings,
} from './registration-settings';
import { hashResumeToken, newResumeToken } from './resume-cookie';

/** An error that also hands the controller a resume token to set, so the same browser can retry. */
export class StartFailure extends HttpException {
  constructor(
    status: number,
    code: RegistrationErrorCode,
    message: string,
    readonly token: string | null,
  ) {
    super({ code, message }, status);
  }
}

const error = (
  Exception: new (body: object) => HttpException,
  code: RegistrationErrorCode,
  message: string,
) => new Exception({ code, message });
const text = (code: RegistrationErrorCode, fallback: string) =>
  REGISTRATION_MESSAGES[code]?.en ?? fallback;

export type StartResponse = {
  paymentUrl: string;
  gateway: CheckoutGateway;
  invoiceNumber: string;
  amountMinor: number;
  currency: 'BDT';
};

export type CurrentRegistration = {
  state: RegistrationState;
  invoiceNumber: string | null;
  amountMinor: number | null;
  currency: string | null;
  expiresAt: string | null;
  canResume: boolean;
  canRetry: boolean;
  /** Only while completed, for PARTICIPANT_ID_SHOWN_HOURS (shared CurrentRegistration says why). */
  participantId: string | null;
};

export type RegistrationInfo = {
  open: boolean;
  opensAt: string | null;
  closesAt: string | null;
  fee: { amountMinor: number; currency: 'BDT' } | null;
  gradeLevels: { id: string; label: string }[];
  districts: readonly string[];
  educationTypes: readonly string[];
};

const INFO_CACHE_KEY = 'registration:info';
const INFO_CACHE_SECONDS = 30;
const INVOICE_ATTEMPTS = 3;

type EnabledConfig = Extract<PaymentConfig, { enabled: true }>;
type AttemptWithLatest = PendingRegistration & { payments: Payment[] };

/**
 * Registration and the start of a PayStation payment (docs/plans/PAYMENTS-PLAN.md 6.1, 6.7). Pay first, account
 * second: the form waits server-side in a registration attempt; the account is created when a payment is verified
 * paid (PR 3). Never trusts the browser for an amount, a role or a status. Never logs the form.
 */
@Injectable()
export class RegistrationService {
  private readonly logger = new Logger('Registration');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_CONFIG) private readonly config: PaymentConfig,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway | null,
    @Inject(REDIS_CACHE) private readonly redis: Redis,
    private readonly passwords: PasswordService,
    private readonly alerts: SecurityAlerts,
    private readonly guards: RegistrationGuards,
    private readonly verifies: VerifyRequests,
  ) {}

  // ───────────── public info (cached 30 s) ─────────────

  async info(now = new Date()): Promise<RegistrationInfo> {
    const cached = await this.cacheGet();
    if (cached) return cached;
    const settings = await readRegistrationSettings(this.prisma);
    const gradeLevels = await this.prisma.gradeLevel.findMany({
      orderBy: { sortOrder: 'asc' },
      select: { id: true, label: true },
    });
    const payable =
      this.config.enabled && settings.feeMinor !== null && settings.currency === 'BDT';
    const info: RegistrationInfo = {
      open: payable && isRegistrationOpen(settings, now),
      opensAt: settings.opensAt?.toISOString() ?? null,
      closesAt: settings.closesAt?.toISOString() ?? null,
      fee:
        payable && settings.feeMinor ? { amountMinor: settings.feeMinor, currency: 'BDT' } : null,
      gradeLevels,
      districts: BD_DISTRICTS,
      educationTypes: EDUCATION_TYPES,
    };
    await this.cacheSet(info);
    return info;
  }

  /** Called after any settings change (the admin settings endpoint, PR 3). */
  async invalidateInfo(): Promise<void> {
    try {
      await withTimeout(this.redis.del(INFO_CACHE_KEY), 300);
    } catch {
      this.logger.warn('could not invalidate the registration info cache');
    }
  }

  // ───────────── start ─────────────

  async start(
    dto: StartRegistrationDto,
    browserToken: string | null,
    now = new Date(),
  ): Promise<StartResponse & { token: string | null }> {
    const settings = await readRegistrationSettings(this.prisma);
    if (!isRegistrationOpen(settings, now))
      throw error(ForbiddenException, 'REGISTRATION_CLOSED', 'Registration is closed');
    const config = await this.payable(settings);

    // A repeated submit (double click, lost response) returns what the first one started.
    const replay = await this.prisma.pendingRegistration.findUnique({
      where: { startRequestId: dto.startRequestId },
      include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (replay) return this.replay(replay, dto.email, now);

    // The same browser with a payment in progress for this email resumes it instead of starting another.
    if (browserToken) {
      const mine = await this.attemptByToken(browserToken);
      const latest = mine?.payments[0];
      if (
        mine?.status === RegistrationAttemptStatus.open &&
        mine.email.toLowerCase() === dto.email &&
        latest?.status === PaymentStatus.pending &&
        latest.paymentUrl &&
        now < latest.expiresAt
      )
        return { ...this.response(latest), token: null };
    }

    if (!(await this.guards.allowAttempt(dto.email, dto.phone)))
      throw new HttpException(
        { code: 'TOO_MANY_ATTEMPTS', message: 'Too many attempts. Try again later.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    await this.assertNoAccount(dto.email, dto.phone);
    const grade = await this.prisma.gradeLevel.findUnique({
      where: { id: dto.gradeLevelId },
      select: { id: true },
    });
    if (!grade)
      throw error(BadRequestException, 'GRADE_LEVEL_UNKNOWN', 'Choose your class from the list');
    const referredById = dto.promoCode ? await this.referrer(dto.promoCode) : null;

    const passwordHash = await this.passwords.hash(dto.password);
    const token = newResumeToken();
    const { attempt, payment } = await this.createAttempt(dto, {
      passwordHash,
      referredById,
      token,
      settings,
      config,
      now,
    });
    const started = await this.initiate(attempt, payment, config, token);
    return { ...started, token };
  }

  // ───────────── the attempt of this browser (cookie) ─────────────

  async current(browserToken: string | null, now = new Date()): Promise<CurrentRegistration> {
    const attempt = browserToken ? await this.attemptByToken(browserToken) : null;
    if (!attempt || attempt.status === RegistrationAttemptStatus.abandoned)
      throw error(
        NotFoundException,
        'NO_REGISTRATION',
        'No registration in progress in this browser',
      );
    const latest = attempt.payments[0] ?? null;
    const settings = await readRegistrationSettings(this.prisma);
    return {
      state: stateOf(attempt, latest, now),
      invoiceNumber: latest?.invoiceNumber ?? null,
      amountMinor: latest?.amountMinor ?? null,
      currency: latest?.currency ?? null,
      expiresAt: latest?.expiresAt.toISOString() ?? null,
      canResume: usable(attempt) && canResume(latest, now),
      canRetry:
        usable(attempt) &&
        !!latest &&
        (latest.status === PaymentStatus.failed || latest.status === PaymentStatus.expired) &&
        isRegistrationOpen(settings, now),
      participantId: await this.newParticipantId(attempt, now),
    };
  }

  /**
   * The participant ID for the result page: only for a completed attempt, and only for PARTICIPANT_ID_SHOWN_HOURS after
   * it completed (the cookie can outlive the visit on a shared computer; the email and the dashboard keep the ID).
   */
  private async newParticipantId(attempt: PendingRegistration, now: Date): Promise<string | null> {
    if (
      attempt.status !== RegistrationAttemptStatus.completed ||
      !attempt.userId ||
      !attempt.completedAt
    )
      return null;
    if (now.getTime() - attempt.completedAt.getTime() > PARTICIPANT_ID_SHOWN_HOURS * 3_600_000)
      return null;
    const registration = await this.prisma.registration.findUnique({
      where: { userId: attempt.userId },
      select: { participantId: true },
    });
    return registration?.participantId ?? null;
  }

  async resume(browserToken: string | null, now = new Date()): Promise<ResumeRegistrationResult> {
    const attempt = browserToken ? await this.attemptByToken(browserToken) : null;
    if (!attempt || attempt.status === RegistrationAttemptStatus.abandoned)
      throw error(
        NotFoundException,
        'NO_REGISTRATION',
        'No registration in progress in this browser',
      );
    if (scrubbed(attempt)) await this.startOver(attempt);
    const latest = attempt.payments[0] ?? null;
    if (attempt.status !== RegistrationAttemptStatus.open || !canResume(latest, now))
      throw error(ConflictException, 'NOTHING_TO_RESUME', 'There is no payment to continue');
    return { paymentUrl: latest?.paymentUrl as string, gateway: checkoutGateway(this.config) };
  }

  /**
   * "Check my payment status": asks the worker to ask PayStation about this browser's latest payment, at most once
   * per 10 s. The page then polls `current`; this answer only says whether a check was asked for.
   */
  async recheck(browserToken: string | null, now = new Date()): Promise<{ requested: boolean }> {
    const attempt = browserToken ? await this.attemptByToken(browserToken) : null;
    if (!attempt || attempt.status === RegistrationAttemptStatus.abandoned)
      throw error(
        NotFoundException,
        'NO_REGISTRATION',
        'No registration in progress in this browser',
      );
    const latest = attempt.payments[0];
    if (!latest || !isWatched(latest, now)) return { requested: false };
    return { requested: (await this.verifies.request(latest.id, 'recheck')) === 'requested' };
  }

  /** A new payment (new invoice) for the same attempt, after the last one failed or expired. */
  async retry(browserToken: string | null, now = new Date()): Promise<StartResponse> {
    const attempt = browserToken ? await this.attemptByToken(browserToken) : null;
    if (!attempt || attempt.status !== RegistrationAttemptStatus.open)
      throw error(
        NotFoundException,
        'NO_REGISTRATION',
        'No registration in progress in this browser',
      );
    if (scrubbed(attempt)) await this.startOver(attempt);
    const latest = attempt.payments[0];
    if (latest && isActive(latest.status))
      throw error(ConflictException, 'RETRY_NOT_ALLOWED', 'A payment is still in progress');
    const settings = await readRegistrationSettings(this.prisma);
    if (!isRegistrationOpen(settings, now))
      throw error(ForbiddenException, 'REGISTRATION_CLOSED', 'Registration is closed');
    const config = await this.payable(settings);
    if (!(await this.guards.allowAttempt(attempt.email.toLowerCase(), attempt.phone)))
      throw new HttpException(
        { code: 'TOO_MANY_ATTEMPTS', message: 'Too many attempts. Try again later.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    await this.assertNoAccount(attempt.email.toLowerCase(), attempt.phone);

    const payment = await this.withFreshInvoice((invoiceNumber) =>
      this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM pending_registrations WHERE id = ${attempt.id}::uuid FOR UPDATE`;
        const active = await tx.payment.findFirst({
          where: {
            pendingRegistrationId: attempt.id,
            status: { in: [PaymentStatus.initiated, PaymentStatus.pending] },
          },
          select: { id: true },
        });
        if (active)
          throw error(ConflictException, 'RETRY_NOT_ALLOWED', 'A payment is still in progress');
        return tx.payment.create({
          data: this.paymentRow(attempt.id, invoiceNumber, settings, config, now),
        });
      }),
    );
    return this.initiate(attempt, payment, config, null);
  }

  /** Gives up the attempt (only while no payment is active). */
  async cancel(browserToken: string | null): Promise<void> {
    const attempt = browserToken ? await this.attemptByToken(browserToken) : null;
    if (!attempt || attempt.status !== RegistrationAttemptStatus.open)
      throw error(
        NotFoundException,
        'NO_REGISTRATION',
        'No registration in progress in this browser',
      );
    const cancelled = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM pending_registrations WHERE id = ${attempt.id}::uuid FOR UPDATE`;
      const active = await tx.payment.count({
        where: {
          pendingRegistrationId: attempt.id,
          status: { in: [PaymentStatus.initiated, PaymentStatus.pending] },
        },
      });
      if (active > 0) return false;
      await tx.pendingRegistration.update({
        where: { id: attempt.id },
        data: { status: RegistrationAttemptStatus.abandoned },
      });
      return true;
    });
    if (!cancelled)
      throw error(
        ConflictException,
        'CANNOT_CANCEL',
        'A payment is still in progress; it cannot be cancelled now',
      );
  }

  // ───────────── logged-in student ─────────────

  async me(userId: string) {
    const registration = await this.prisma.registration.findUnique({
      where: { userId },
      select: {
        createdAt: true,
        participantId: true,
        user: { select: { category: true, gradeLevel: { select: { label: true } } } },
        payment: {
          select: {
            invoiceNumber: true,
            amountMinor: true,
            currency: true,
            status: true,
            paidAt: true,
          },
        },
      },
    });
    if (!registration) return { registered: false as const };
    return {
      registered: true as const,
      registeredAt: registration.createdAt.toISOString(),
      participantId: registration.participantId,
      category: registration.user.category,
      gradeLevel: registration.user.gradeLevel?.label ?? null,
      payment: {
        ...registration.payment,
        paidAt: registration.payment.paidAt?.toISOString() ?? null,
      },
    };
  }

  async myPayments(userId: string, page = 1, pageSize = 20): Promise<Paginated<PaymentView>> {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: PAYMENT_VIEW,
      }),
      this.prisma.payment.count({ where: { userId } }),
    ]);
    return { items: items.map(paymentView), page, pageSize, total };
  }

  async paymentStatus(userId: string, id: string): Promise<PaymentView> {
    const payment = await this.prisma.payment.findFirst({
      where: { id, userId },
      select: PAYMENT_VIEW,
    });
    if (!payment) throw new NotFoundException('Payment not found');
    return paymentView(payment);
  }

  /** The logged-in owner's "check again"; another user's payment is 404. Once per 10 s per payment. */
  async recheckMine(userId: string, id: string, now = new Date()): Promise<{ requested: boolean }> {
    const payment = await this.prisma.payment.findFirst({
      where: { id, userId },
      select: { id: true, status: true, expiresAt: true, paymentUrl: true },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (!isWatched(payment, now)) return { requested: false };
    return { requested: (await this.verifies.request(payment.id, 'recheck')) === 'requested' };
  }

  // ───────────── internals ─────────────

  /** Payments can start: a valid fee in BDT, PayStation configured, and no pause after a "1001". */
  private async payable(settings: RegistrationSettings): Promise<EnabledConfig> {
    if (settings.feeMinor === null || settings.currency !== 'BDT') {
      await this.alert('payments.fee_invalid', { setting: 'registration_fee_minor' });
      throw error(
        ServiceUnavailableException,
        'PAYMENTS_UNAVAILABLE',
        'Registration is temporarily unavailable',
      );
    }
    if (!this.config.enabled || !this.gateway)
      throw error(
        ServiceUnavailableException,
        'PAYMENTS_UNAVAILABLE',
        'Registration is temporarily unavailable',
      );
    if (await this.guards.isPaused())
      throw error(
        ServiceUnavailableException,
        'PAYMENTS_PAUSED',
        text('PAYMENTS_PAUSED', 'Payments are paused right now.'),
      );
    return this.config;
  }

  private async assertNoAccount(email: string, phone: string): Promise<void> {
    if (await this.prisma.user.findUnique({ where: { email }, select: { id: true } }))
      throw error(
        ConflictException,
        'EMAIL_REGISTERED',
        text('EMAIL_REGISTERED', 'Already registered. Please log in.'),
      );
    if (await this.prisma.user.findUnique({ where: { phone }, select: { id: true } }))
      throw error(
        ConflictException,
        'PHONE_REGISTERED',
        text('PHONE_REGISTERED', 'This phone number is already registered.'),
      );
  }

  /**
   * The referring ambassador: an approved promo code (case-insensitive). A demo account's code counts as unknown: a
   * real form pointing at demo data would block the one-click demo removal (demo_clear_blocked). The marker never
   * changes (exam's demo_marker_immutable trigger), so this check at start is enough.
   */
  private async referrer(promoCode: string): Promise<string> {
    const profile = await this.prisma.ambassadorProfile.findFirst({
      where: { promoCode, approvedAt: { not: null }, user: { demoBatchId: null } },
      select: { userId: true },
    });
    if (!profile)
      throw error(
        BadRequestException,
        'PROMO_INVALID',
        'This promo code is not valid. Check it or remove it.',
      );
    return profile.userId;
  }

  private attemptByToken(token: string): Promise<AttemptWithLatest | null> {
    return this.prisma.pendingRegistration.findUnique({
      where: { resumeTokenHash: hashResumeToken(token) },
      include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
  }

  /**
   * An open attempt whose stored form the nightly scrub cleared (PAYMENTS-PLAN 4.3, D6; housekeeping/attempt-scrub.ts)
   * can never become an account, and a new payment on it would be money with no account to give. It is given up, and
   * the student is asked to fill in the form again (a new attempt). Never a 500.
   */
  private async startOver(attempt: PendingRegistration): Promise<never> {
    await this.prisma.pendingRegistration.updateMany({
      where: {
        id: attempt.id,
        status: RegistrationAttemptStatus.open,
        payload: { equals: Prisma.DbNull },
      },
      data: { status: RegistrationAttemptStatus.abandoned },
    });
    throw error(
      ConflictException,
      'START_OVER',
      'This registration has expired. Please fill in the form again.',
    );
  }

  private async replay(
    attempt: AttemptWithLatest,
    email: string,
    now: Date,
  ): Promise<StartResponse & { token: string | null }> {
    if (attempt.email.toLowerCase() !== email)
      throw error(BadRequestException, 'START_REQUEST_REUSED', 'Start the form again');
    if (attempt.status === RegistrationAttemptStatus.completed)
      throw error(
        ConflictException,
        'EMAIL_REGISTERED',
        text('EMAIL_REGISTERED', 'Already registered. Please log in.'),
      );
    // The nightly scrub cleared this attempt's form (D6): it can never become an account. A new request id lets the
    // same form start a new attempt (start gives the old one up).
    if (attempt.payload === null)
      throw error(BadRequestException, 'START_REQUEST_REUSED', 'Start the form again');
    const latest = attempt.payments[0];
    if (!latest || latest.status === PaymentStatus.initiated)
      throw error(
        ConflictException,
        'START_IN_PROGRESS',
        'Your payment is being prepared. Try again in a moment.',
      );
    // Only this browser knows the request id, so it may take over the attempt: a fresh cookie token.
    const token = newResumeToken();
    await this.prisma.pendingRegistration.update({
      where: { id: attempt.id },
      data: { resumeTokenHash: hashResumeToken(token) },
    });
    if (canResume(latest, now)) return { ...this.response(latest), token };
    throw new StartFailure(
      HttpStatus.CONFLICT,
      'NOTHING_TO_RESUME',
      'There is no payment to continue',
      token,
    );
  }

  private async createAttempt(
    dto: StartRegistrationDto,
    ctx: {
      passwordHash: string;
      referredById: string | null;
      token: string;
      settings: RegistrationSettings;
      config: EnabledConfig;
      now: Date;
    },
  ): Promise<{ attempt: PendingRegistration; payment: Payment }> {
    try {
      return await this.withFreshInvoice((invoiceNumber) =>
        this.prisma.$transaction(async (tx) => {
          // One attempt in progress per email and per phone (DECISIONS: no refunds, so no double charge).
          const open = await tx.$queryRaw<{ id: string; email: string }[]>`
            SELECT id, email::text AS email FROM pending_registrations
            WHERE status = 'open' AND (email = ${dto.email}::citext OR phone = ${dto.phone})
            FOR UPDATE`;
          for (const other of open) {
            const active = await tx.payment.count({
              where: {
                pendingRegistrationId: other.id,
                status: { in: [PaymentStatus.initiated, PaymentStatus.pending] },
              },
            });
            if (active > 0) throw this.inProgress(other.email.toLowerCase() === dto.email);
            await tx.pendingRegistration.update({
              where: { id: other.id },
              data: { status: RegistrationAttemptStatus.abandoned },
            });
          }
          const attempt = await tx.pendingRegistration.create({
            data: {
              email: dto.email,
              phone: dto.phone,
              name: dto.name,
              payload: {
                district: dto.district,
                institution: dto.institution,
                educationType: dto.educationType,
                gradeLevelId: dto.gradeLevelId,
                promoCode: dto.promoCode ?? null,
                passwordHash: ctx.passwordHash,
              },
              startRequestId: dto.startRequestId,
              resumeTokenHash: hashResumeToken(ctx.token),
              referredById: ctx.referredById,
            },
          });
          const payment = await tx.payment.create({
            data: this.paymentRow(attempt.id, invoiceNumber, ctx.settings, ctx.config, ctx.now),
          });
          return { attempt, payment };
        }),
      );
    } catch (e) {
      // Two starts at once: a partial unique index (one open attempt per email / per phone) or the request id.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const taken = await this.prisma.pendingRegistration.findFirst({
          where: {
            status: RegistrationAttemptStatus.open,
            email: { equals: dto.email, mode: 'insensitive' },
          },
          select: { id: true },
        });
        if (taken) throw this.inProgress(true);
        const phoneTaken = await this.prisma.pendingRegistration.findFirst({
          where: { status: RegistrationAttemptStatus.open, phone: dto.phone },
          select: { id: true },
        });
        if (phoneTaken) throw this.inProgress(false);
        throw error(
          ConflictException,
          'START_IN_PROGRESS',
          'Your payment is being prepared. Try again in a moment.',
        );
      }
      throw e;
    }
  }

  private inProgress(sameEmail: boolean): HttpException {
    return sameEmail
      ? error(
          ConflictException,
          'EMAIL_IN_PROGRESS',
          'A payment for this email is already in progress. Continue in the browser where you started, or try again after it expires (at most 60 minutes).',
        )
      : error(
          ConflictException,
          'PHONE_REGISTERED',
          text('PHONE_REGISTERED', 'This phone number is already registered.'),
        );
  }

  /** Runs `create` with a new invoice number; a collision on invoice_number draws another (at most 3 times). */
  private async withFreshInvoice<T>(create: (invoiceNumber: string) => Promise<T>): Promise<T> {
    for (let i = 1; ; i += 1) {
      try {
        return await create(newInvoiceNumber((this.config as EnabledConfig).invoicePrefix));
      } catch (e) {
        const invoiceClash =
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002' &&
          JSON.stringify(e.meta?.target ?? '').includes('invoice_number');
        if (!invoiceClash || i >= INVOICE_ATTEMPTS) throw e;
      }
    }
  }

  private paymentRow(
    attemptId: string,
    invoiceNumber: string,
    settings: RegistrationSettings,
    config: EnabledConfig,
    now: Date,
  ): Prisma.PaymentUncheckedCreateInput {
    return {
      pendingRegistrationId: attemptId,
      invoiceNumber,
      amountMinor: settings.feeMinor as number, // the snapshot: later fee changes never touch this payment
      currency: 'BDT',
      payWithCharge: false,
      gatewayAccount: config.accountLabel,
      // Always the configured environment, never the column's default: the demo loader counts paid 'live' rows.
      gatewayEnv: config.env,
      expiresAt: new Date(now.getTime() + settings.expiryMinutes * 60_000),
    };
  }

  /** Calls PayStation outside any transaction, then records the answer (plan 6.1 step 6). */
  private async initiate(
    attempt: PendingRegistration,
    payment: Payment,
    config: EnabledConfig,
    token: string | null,
  ): Promise<StartResponse> {
    const result = await (this.gateway as PaymentGateway).initiate({
      invoiceNumber: payment.invoiceNumber,
      amountMinor: payment.amountMinor,
      reference: payment.id,
      customer: { name: attempt.name, phone: attempt.phone, email: attempt.email },
    });
    await this.recordInitiate(payment, result);
    if (result.kind === 'created') {
      const pending = await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.pending, paymentUrl: result.paymentUrl },
      });
      return this.response(pending);
    }
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.failed },
    });
    if (result.kind === 'credentials_rejected') {
      await this.guards.pause();
      await this.alert('payments.credentials_rejected', { account: config.accountLabel });
      throw new StartFailure(
        HttpStatus.SERVICE_UNAVAILABLE,
        'PAYMENTS_PAUSED',
        text('PAYMENTS_PAUSED', 'Payments are paused right now.'),
        token,
      );
    }
    throw new StartFailure(
      HttpStatus.BAD_GATEWAY,
      'PAYMENT_START_FAILED',
      'The payment could not start. Please try again.',
      token,
    );
  }

  private async recordInitiate(payment: Payment, result: InitiateResult): Promise<void> {
    const outcome = {
      created: 'checkout_created',
      credentials_rejected: 'credentials_rejected',
      refused: 'initiate_refused',
      unavailable: 'unavailable',
    }[result.kind];
    try {
      await this.prisma.paymentEvent.create({
        data: {
          paymentId: payment.id,
          source: 'initiate',
          invoiceNumber: payment.invoiceNumber,
          outcome,
          statusCode: 'statusCode' in result ? result.statusCode : null,
          payload: result.raw === null ? Prisma.DbNull : (result.raw as Prisma.InputJsonValue),
        },
      });
    } catch {
      this.logger.error({ msg: 'could not record the initiate event', outcome });
    }
  }

  private response(payment: Payment): StartResponse {
    return {
      paymentUrl: payment.paymentUrl as string,
      gateway: checkoutGateway(this.config),
      invoiceNumber: payment.invoiceNumber,
      amountMinor: payment.amountMinor,
      currency: 'BDT',
    };
  }

  private async alert(
    kind: 'payments.fee_invalid' | 'payments.credentials_rejected',
    meta: Record<string, string>,
  ): Promise<void> {
    try {
      await this.alerts.raise(kind, { actorId: null, meta });
    } catch {
      this.logger.error({ msg: 'could not raise the payments alert', alert: kind });
    }
  }

  private async cacheGet(): Promise<RegistrationInfo | null> {
    try {
      const raw = await withTimeout(this.redis.get(INFO_CACHE_KEY), 300);
      return raw ? (JSON.parse(raw) as RegistrationInfo) : null;
    } catch {
      return null;
    }
  }

  private async cacheSet(info: RegistrationInfo): Promise<void> {
    try {
      await withTimeout(
        this.redis.set(INFO_CACHE_KEY, JSON.stringify(info), 'EX', INFO_CACHE_SECONDS),
        300,
      );
    } catch {
      /* the next request reads the database again */
    }
  }
}

const PAYMENT_VIEW = {
  id: true,
  invoiceNumber: true,
  amountMinor: true,
  currency: true,
  status: true,
  createdAt: true,
  paidAt: true,
} as const;
type PaymentRow = Prisma.PaymentGetPayload<{ select: typeof PAYMENT_VIEW }>;
export type PaymentView = Omit<PaymentRow, 'createdAt' | 'paidAt'> & {
  createdAt: string;
  paidAt: string | null;
};
const paymentView = (p: PaymentRow): PaymentView => ({
  ...p,
  createdAt: p.createdAt.toISOString(),
  paidAt: p.paidAt?.toISOString() ?? null,
});

/** An open attempt whose stored form the nightly scrub cleared (D6): it can never become an account. */
function scrubbed(attempt: { status: RegistrationAttemptStatus; payload: unknown }): boolean {
  return attempt.status === RegistrationAttemptStatus.open && attempt.payload === null;
}

/** An open attempt that can still become an account: a payment on it may start or continue. */
function usable(attempt: { status: RegistrationAttemptStatus; payload: unknown }): boolean {
  return attempt.status === RegistrationAttemptStatus.open && attempt.payload !== null;
}

function canResume(latest: Payment | null | undefined, now: Date): boolean {
  return (
    !!latest &&
    latest.status === PaymentStatus.pending &&
    !!latest.paymentUrl &&
    now < latest.expiresAt
  );
}

function stateOf(
  attempt: PendingRegistration,
  latest: Payment | null,
  now: Date,
): RegistrationState {
  if (attempt.status === RegistrationAttemptStatus.completed) return 'completed';
  if (attempt.status === RegistrationAttemptStatus.conflict) return 'needs_help';
  if (!latest) return 'failed';
  switch (latest.status) {
    case PaymentStatus.initiated:
    case PaymentStatus.pending:
      return now < latest.expiresAt ? 'awaiting_payment' : 'confirming';
    case PaymentStatus.paid:
      return 'confirming'; // money taken, the account is being created
    case PaymentStatus.expired:
      return 'expired';
    default:
      return 'failed';
  }
}
