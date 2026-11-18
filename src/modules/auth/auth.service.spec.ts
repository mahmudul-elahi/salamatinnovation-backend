import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthService } from './auth.service.js';

describe('AuthService', () => {
  let authService: AuthService;
  let prismaService: any;
  let jwtService: any;
  let mailService: any;
  let cacheManager: any;

  beforeEach(() => {
    prismaService = {
      user: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    };
    jwtService = {
      signAsync: vi.fn().mockResolvedValue('test-jwt-token'),
      verifyAsync: vi.fn(),
    };
    mailService = {
      sendPasswordResetOtp: vi.fn().mockResolvedValue(undefined),
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
      cacheManager,
    );
  });

  it('should be defined', () => {
    expect(authService).toBeDefined();
  });
});
