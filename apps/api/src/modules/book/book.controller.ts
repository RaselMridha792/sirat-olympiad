import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { AuthUser } from '../auth/access-token.service';
import { CurrentUser, Public, Roles } from '../auth/auth.decorators';
import { COVER_MAX_BYTES } from './book-image';
import {
  AdminBookOrdersQueryDto,
  BookOrderDto,
  BookOrderFilterDto,
  BookTitleDto,
  ShipBookOrdersDto,
} from './book.dto';
import { type Actor, BookService } from './book.service';

const actorOf = (user: AuthUser, req: Request): Actor => ({ id: user.id, ip: req.ip ?? null });
/** The cover is public and cached for a year by browsers (its id changes with every new cover). */
const COVER_TIER = { default: { limit: 600, ttl: 60_000 } };
const ADMIN_WRITE_TIER = { default: { limit: 20, ttl: 60_000 } };
const EXPORT_TIER = { default: { limit: 10, ttl: 60_000 } };

/** What the upload interceptor hands over (memory storage; nothing is written to disk). */
interface UploadedImage {
  buffer: Buffer;
  size: number;
}

/**
 * The student's book (plan 16.3). Every student route is "me": the user comes from the session, and no route takes
 * an id. The cover is the only public route (an image, no personal data).
 */
@Controller()
export class BookController {
  constructor(private readonly books: BookService) {}

  @Roles('student', 'ambassador')
  @Get('book')
  book() {
    return this.books.book();
  }

  @Roles('student', 'ambassador')
  @Get('book-order/me')
  myOrder(@CurrentUser() user: AuthUser) {
    return this.books.myOrder(user.id);
  }

  @Roles('student', 'ambassador')
  @Put('book-order/me')
  saveMyOrder(@CurrentUser() user: AuthUser, @Body() body: BookOrderDto) {
    return this.books.saveMyOrder(user.id, body);
  }

  /**
   * The cover bytes with the stored, sniffed type. nosniff and `default-src 'none'`: even a crafted polyglot can never
   * run as a page. Only the image: no other column of the row.
   */
  @Public()
  @Throttle(COVER_TIER)
  @Get('book/cover/:imageId')
  async cover(@Param('imageId', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    const image = await this.books.cover(id);
    if (!image) throw new NotFoundException('Cover not found');
    res.setHeader('Content-Type', image.contentType);
    res.setHeader('Content-Length', String(image.byteSize));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.end(image.data);
  }
}

/** The book and its orders for admins (plan 16.3). Admin only: a manager gets 403. Every write is audited. */
@Roles('admin')
@Controller('admin')
export class AdminBookController {
  constructor(private readonly books: BookService) {}

  @Get('book')
  book() {
    return this.books.adminBook();
  }

  @Throttle(ADMIN_WRITE_TIER)
  @Put('book/title')
  setTitle(@CurrentUser() user: AuthUser, @Req() req: Request, @Body() body: BookTitleDto) {
    return this.books.setTitle(actorOf(user, req), body);
  }

  /** One file, at most 800 KB, kept in memory only (multer's default storage); 413 above the limit. */
  @Throttle(ADMIN_WRITE_TIER)
  @Post('book/cover')
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: COVER_MAX_BYTES, files: 1, fields: 0 } }),
  )
  setCover(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @UploadedFile() file: UploadedImage | undefined,
  ) {
    return this.books.setCover(actorOf(user, req), file?.buffer);
  }

  @Get('book-orders')
  list(@Query() query: AdminBookOrdersQueryDto) {
    return this.books.listOrders(query);
  }

  /** The courier CSV, streamed; audited with the filter and the row count, never the rows. */
  @Throttle(EXPORT_TIER)
  @Get('book-orders/export.csv')
  async exportCsv(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Query() query: BookOrderFilterDto,
    @Res() res: Response,
  ): Promise<void> {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="book-orders-${stamp}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    await this.books.exportCsv(actorOf(user, req), query, (chunk) => res.write(chunk));
    res.end();
  }

  @Throttle(ADMIN_WRITE_TIER)
  @Post('book-orders/ship')
  @HttpCode(200)
  ship(@CurrentUser() user: AuthUser, @Req() req: Request, @Body() body: ShipBookOrdersDto) {
    return this.books.ship(actorOf(user, req), body.ids, body.reason);
  }
}
