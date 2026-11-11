import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { maskParticipantId, type AdmitCard } from '@sirat/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { nextExamFor } from '../exams/next-exam';

/**
 * The admit card (core A1; 06-API "Admit card"; the lead's approval of 2026-11-11): the caller's own paid
 * registration (payments' tables, read only), their name, category and class, and the next round exam they may sit
 * (exam's nextExamFor). One service for the page and, later, the PDF, so the two never differ.
 * The full participant ID is the login secret: it is sent here only, to its owner, never logged, and the answer is
 * not cached (no-store). The masked form is computed here, so the share image never needs the full ID.
 */
@Injectable()
export class AdmitCardService {
  constructor(private readonly prisma: PrismaService) {}

  async forUser(userId: string): Promise<AdmitCard> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        isBlocked: true,
        name: true,
        category: true,
        gradeLevel: { select: { label: true } },
        registration: {
          select: {
            participantId: true,
            createdAt: true,
            payment: { select: { amountMinor: true, currency: true, paidAt: true } },
          },
        },
      },
    });
    // Re-read: a blocked account or a staff token is refused even with a valid session.
    if (!user || user.isBlocked || (user.role !== 'student' && user.role !== 'ambassador'))
      throw new ForbiddenException('Forbidden resource');
    const registration = user.registration;
    if (!registration) throw new NotFoundException(['not_registered']);
    const { participantId, payment } = registration;
    return {
      participantId,
      participantIdMasked: maskParticipantId(participantId),
      mode: participantId.startsWith('OF') ? 'offline' : 'online',
      name: user.name,
      category: user.category,
      gradeLevel: user.gradeLevel?.label ?? null,
      fee: {
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        paidAt: payment.paidAt?.toISOString() ?? null,
      },
      registeredAt: registration.createdAt.toISOString(),
      exam: await nextExamFor(this.prisma, userId),
    };
  }
}
