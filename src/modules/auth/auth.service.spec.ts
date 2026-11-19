import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthService } from './auth.service.js';

describe('AuthService', () => {
  let authService: AuthService;
  let prismaService: any;
  let jwtService: any;
  let mailService: any;
  let configService: any;
  let cacheManager: any;

  beforeEach(() => {
    prismaService = {
      user: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      passkey: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      },
    };
    jwtService = {
      signAsync: vi.fn().mockResolvedValue('test-jwt-token'),
      verifyAsync: vi.fn(),
    };
    mailService = {
      sendPasswordResetOtp: vi.fn().mockResolvedValue(undefined),
    };
    configService = {
      get: vi.fn().mockReturnValue(undefined),
    };
    cacheManager = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
    };

    authService = new AuthService(
      prismaService,
      jwtService,
      mailService,
      configService,
      cacheManager,
    );
  });

  it('should be defined', () => {
    expect(authService).toBeDefined();
  });
});
