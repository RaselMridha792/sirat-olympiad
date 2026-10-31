/**
 * The free book's database rules (docs/plans/PAYMENTS-PLAN.md 16.2, migration *_book_checks), checked straight
 * against Postgres: one order per student, only for the student's own registration, the CHECKs (the 64 districts
 * included), the lock once shipped, the cover's CHECKs and the two settings keys.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { BD_DISTRICTS } from '@sirat/shared';
import type { Prisma, PrismaClient } from '@prisma/client';
import { paidStudent } from './book-app';
import { applyReferenceData, makeUser, testPrisma, truncateAll } from './helpers';

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = testPrisma();
  await truncateAll(prisma);
  await applyReferenceData(prisma);
});

afterAll(async () => {
  await prisma?.$disconnect();
});

const order = (
  userId: string,
  registrationId: string,
  over: Partial<Prisma.BookOrderUncheckedCreateInput> = {},
): Prisma.BookOrderUncheckedCreateInput => ({
  userId,
  registrationId,
  recipientName: 'Rahim Uddin',
  recipientPhone: '01712345678',
  district: 'Dhaka',
  upazila: 'Mirpur',
  addressLine: 'House 12, Road 3',
  bookTitle: 'The Olympiad Book',
  ...over,
});

describe('book_orders', () => {
  it('one order per student, only for their own registration (the composite foreign key)', async () => {
    const a = await paidStudent(prisma);
    const b = await paidStudent(prisma);
    await prisma.bookOrder.create({ data: order(a.user.id, a.registration.id) });
    await expect(
      prisma.bookOrder.create({ data: order(a.user.id, a.registration.id) }),
    ).rejects.toThrow(/Unique constraint/);
    // Another student's registration, or a user without one: refused by the foreign key.
    await expect(
      prisma.bookOrder.create({ data: order(b.user.id, a.registration.id) }),
    ).rejects.toThrow(/Foreign key constraint|Unique constraint/);
    const unpaid = await makeUser(prisma);
    await expect(
      prisma.bookOrder.create({ data: order(unpaid.id, b.registration.id) }),
    ).rejects.toThrow(/Foreign key constraint/);
    await expect(prisma.bookOrder.create({ data: order(unpaid.id, randomUUID()) })).rejects.toThrow(
      /Foreign key constraint/,
    );
  });

  it('refuses a bad phone, a district outside the 64, and lengths out of range', async () => {
    const s = await paidStudent(prisma);
    const cases: [Partial<Prisma.BookOrderUncheckedCreateInput>, string][] = [
      [{ recipientPhone: '+8801712345678' }, 'book_orders_recipient_phone_check'],
      [{ recipientPhone: '01212345678' }, 'book_orders_recipient_phone_check'],
      [{ district: 'Atlantis' }, 'book_orders_district_check'],
      [{ district: 'dhaka' }, 'book_orders_district_check'],
      [{ recipientName: '   ' }, 'book_orders_recipient_name_check'],
      [{ upazila: 'X' }, 'book_orders_upazila_check'],
      [{ addressLine: 'abc' }, 'book_orders_address_line_check'],
      [{ note: 'n'.repeat(301) }, 'book_orders_note_check'],
      [{ bookTitle: '' }, 'book_orders_book_title_check'],
    ];
    for (const [over, name] of cases)
      await expect(
        prisma.bookOrder.create({ data: order(s.user.id, s.registration.id, over) }),
      ).rejects.toThrow(name);
  });

  it('accepts every one of the 64 districts', async () => {
    const s = await paidStudent(prisma);
    const o = await prisma.bookOrder.create({ data: order(s.user.id, s.registration.id) });
    for (const district of BD_DISTRICTS)
      await prisma.bookOrder.update({ where: { id: o.id }, data: { district } });
    expect((await prisma.bookOrder.findUniqueOrThrow({ where: { id: o.id } })).district).toBe(
      BD_DISTRICTS[BD_DISTRICTS.length - 1],
    );
  });

  it('starts confirmed; once shipped the address and the status are locked (the trigger)', async () => {
    const s = await paidStudent(prisma);
    const admin = await makeUser(prisma, { role: 'admin' });
    await expect(
      prisma.bookOrder.create({
        data: order(s.user.id, s.registration.id, {
          status: 'shipped',
          shippedAt: new Date(),
          shippedBy: admin.id,
        }),
      }),
    ).rejects.toThrow(/must start as confirmed/);
    const o = await prisma.bookOrder.create({ data: order(s.user.id, s.registration.id) });
    // shipped needs shipped_at and shipped_by (and the reverse).
    await expect(
      prisma.bookOrder.update({ where: { id: o.id }, data: { status: 'shipped' } }),
    ).rejects.toThrow('book_orders_shipped_check');
    await expect(
      prisma.bookOrder.update({ where: { id: o.id }, data: { shippedAt: new Date() } }),
    ).rejects.toThrow('book_orders_shipped_check');
    // Before shipping, the address can change.
    await prisma.bookOrder.update({ where: { id: o.id }, data: { upazila: 'Pallabi' } });
    await prisma.bookOrder.update({
      where: { id: o.id },
      data: { status: 'shipped', shippedAt: new Date(), shippedBy: admin.id },
    });
    for (const data of [
      { upazila: 'Uttara' },
      { addressLine: 'Somewhere else 1' },
      { recipientPhone: '01812345678' },
      { note: 'changed' },
      { bookTitle: 'Another title' },
      { status: 'confirmed' as const, shippedAt: null, shippedBy: null },
    ])
      await expect(prisma.bookOrder.update({ where: { id: o.id }, data })).rejects.toThrow(
        /a shipped order cannot change/,
      );
    expect((await prisma.bookOrder.findUniqueOrThrow({ where: { id: o.id } })).upazila).toBe(
      'Pallabi',
    );
  });
});

describe('book_images', () => {
  const image = (over: Partial<Prisma.BookImageUncheckedCreateInput>, uploadedBy: string) => {
    const data = new Uint8Array(randomBytes(1000));
    return {
      sha256: randomBytes(32).toString('hex'),
      contentType: 'image/png',
      byteSize: data.length,
      width: 600,
      height: 800,
      data,
      uploadedBy,
      ...over,
    };
  };

  it('allows JPEG, PNG and WebP within the size and side limits only', async () => {
    const admin = await makeUser(prisma, { role: 'admin' });
    await prisma.bookImage.create({ data: image({}, admin.id) });
    const cases: [Partial<Prisma.BookImageUncheckedCreateInput>, string][] = [
      [{ contentType: 'image/svg+xml' }, 'book_images_content_type_check'],
      [{ contentType: 'text/html' }, 'book_images_content_type_check'],
      [{ byteSize: 999 }, 'book_images_byte_size_check'],
      [{ width: 99 }, 'book_images_dimensions_check'],
      [{ height: 4001 }, 'book_images_dimensions_check'],
      [{ sha256: 'not-a-hash' }, 'book_images_sha256_check'],
    ];
    for (const [over, name] of cases)
      await expect(prisma.bookImage.create({ data: image(over, admin.id) })).rejects.toThrow(name);
    const big = new Uint8Array(819_201);
    await expect(
      prisma.bookImage.create({ data: image({ data: big, byteSize: big.length }, admin.id) }),
    ).rejects.toThrow('book_images_byte_size_check');
  });
});

describe('settings for the book', () => {
  it('book_title is 1–200 characters; book_cover_image_id is null or a uuid', async () => {
    await prisma.setting.upsert({
      where: { key: 'book_title' },
      create: { key: 'book_title', value: 'A title' },
      update: { value: 'A title' },
    });
    for (const value of ['', '   ', 'x'.repeat(201), 42, true])
      await expect(
        prisma.setting.update({ where: { key: 'book_title' }, data: { value } }),
      ).rejects.toThrow('settings_book_title_check');
    await prisma.setting.upsert({
      where: { key: 'book_cover_image_id' },
      create: { key: 'book_cover_image_id', value: randomUUID() },
      update: { value: randomUUID() },
    });
    for (const value of ['not-a-uuid', 42])
      await expect(
        prisma.setting.update({ where: { key: 'book_cover_image_id' }, data: { value } }),
      ).rejects.toThrow('settings_book_cover_check');
  });
});
