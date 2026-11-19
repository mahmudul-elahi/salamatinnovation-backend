import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null
      ) {
        const resObj = exceptionResponse as Record<string, unknown>;
        message =
          (resObj.message as string | string[]) ||
          (resObj.error as string) ||
          exception.message;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002': {
          status = HttpStatus.CONFLICT;
          const targetMeta = exception.meta?.target;
          const target = Array.isArray(targetMeta)
            ? targetMeta.join(', ')
            : (targetMeta as string) || 'field';
          message = `A record with this ${target} already exists.`;
          break;
        }
        case 'P2025': {
          status = HttpStatus.NOT_FOUND;
          message = (exception.meta?.cause as string) || 'Record not found.';
          break;
        }
        case 'P2003': {
          status = HttpStatus.BAD_REQUEST;
          const field = (exception.meta?.field_name as string) || 'relation';
          message = `Foreign key constraint failed on ${field}.`;
          break;
        }
        case 'P2014': {
          status = HttpStatus.BAD_REQUEST;
          message = 'The change you are trying to make would violate a required relationship.';
          break;
        }
        default: {
          status = HttpStatus.BAD_REQUEST;
          message = `Database request error (${exception.code})`;
          break;
        }
      }
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      message = 'Invalid data provided for database operation.';
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    const errorPayload = {
      success: false,
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
    };

    if (status >= 500) {
      this.logger.error(
        `[HTTP] ${request.method} ${request.url} - Status ${status} - Error: ${JSON.stringify(message)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(
        `[HTTP] ${request.method} ${request.url} - Status ${status} - Message: ${JSON.stringify(message)}`,
      );
    }

    response.status(status).json(errorPayload);
  }
}
