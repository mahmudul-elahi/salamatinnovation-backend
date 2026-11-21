import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** Where a request came from; recorded on new login sessions. */
export interface ClientInfo {
  ipAddress: string | null;
  userAgent: string | null;
}

// Keeps a hostile client from storing an unbounded header.
const MAX_USER_AGENT_LENGTH = 512;

/**
 * The caller's IP and user agent. Behind a reverse proxy, set TRUST_PROXY so
 * the IP is read from X-Forwarded-For instead of being the proxy's address.
 */
export const Client = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ClientInfo => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const userAgent = request.get('user-agent');
    return {
      ipAddress: request.ip ?? null,
      userAgent: userAgent ? userAgent.slice(0, MAX_USER_AGENT_LENGTH) : null,
    };
  },
);
