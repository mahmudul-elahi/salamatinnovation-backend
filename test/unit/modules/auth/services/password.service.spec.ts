import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, HttpException } from '@nestjs/common';
import { hash } from '@node-rs/bcrypt';
import { SessionEndReason } from '@prisma/client';
import { FakeRedis } from '../../../../helpers/fake-redis.js';
import { makeUser } from '../../../../helpers/fixtures.js';
import {
  OTP_MAX_ATTEMPTS,
  RedisKeys,
} from '../../../../../src/modules/auth/auth.constants.js';
import { PasswordService } from '../../../../../src/modules/auth/services/password.service.js';
import type { MailService } from '../../../../../src/infrastructure/mail/mail.service.js';
import type { SessionService } from '../../../../../src/modules/auth/services/session.service.js';
import type { TokenService } from '../../../../../src/modules/auth/services/token.service.js';
import type { UsersService } from '../../../../../src/modules/users/users.service.js';

const EMAIL = 'jane@example.com';

describe('PasswordService', () => {
  let redis: FakeRedis;
  let users: Record<string, ReturnType<typeof vi.fn>>;
  let mail: { sendPasswordResetOtp: ReturnType<typeof vi.fn> };
  let tokens: { continueSession: ReturnType<typeof vi.fn> };
  let sessions: { revokeAll: ReturnType<typeof vi.fn> };
  let service: PasswordService;

  beforeEach(() => {
    redis = new FakeRedis();
    users = {
      findByEmail: vi.fn().mockResolvedValue(makeUser()),
      findById: vi.fn(),
      updatePassword: vi.fn().mockResolvedValue(makeUser({ tokenVersion: 1 })),
    };
    mail = { sendPasswordResetOtp: vi.fn().mockResolvedValue(undefined) };
    tokens = {
      continueSession: vi
        .fn()
        .mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
    };
    sessions = { revokeAll: vi.fn().mockResolvedValue(1) };
    service = new PasswordService(
      users as unknown as UsersService,
      redis.asService(),
      mail as unknown as MailService,
      tokens as unknown as TokenService,
      sessions as unknown as SessionService,
    );
  });

  const requestOtp = async () => {
    await service.forgotPassword({ email: EMAIL });
    return mail.sendPasswordResetOtp.mock.calls.at(-1)![0].otp as string;
  };

  describe('forgotPassword', () => {
    it('queues an OTP email and stores only a hash of the OTP', async () => {
      const otp = await requestOtp();

      expect(otp).toMatch(/^\d{6}$/);
      expect(await redis.get(RedisKeys.otp(EMAIL))).not.toBe(otp);
    });

    it('answers identically for unknown emails without sending mail', async () => {
      users.findByEmail.mockResolvedValue(null);
      const result = await service.forgotPassword({
        email: 'ghost@example.com',
      });

      expect(result.message).toContain('If this email is registered');
      expect(mail.sendPasswordResetOtp).not.toHaveBeenCalled();
    });

    it('enforces the cooldown for known and unknown emails alike', async () => {
      users.findByEmail.mockResolvedValue(null);
      await service.forgotPassword({ email: 'ghost@example.com' });
      await expect(
        service.forgotPassword({ email: 'ghost@example.com' }),
      ).rejects.toBeInstanceOf(HttpException);
    });
  });

  describe('verifyOtp', () => {
    it('issues a reset token for the correct OTP and consumes the OTP', async () => {
      const otp = await requestOtp();

      const { resetToken } = await service.verifyOtp({ email: EMAIL, otp });
      expect(resetToken).toBeTruthy();
      await expect(
        service.verifyOtp({ email: EMAIL, otp }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it(`invalidates the OTP after ${OTP_MAX_ATTEMPTS} wrong attempts, even if the right code follows`, async () => {
      const otp = await requestOtp();
      const wrong = otp === '000000' ? '111111' : '000000';

      for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
        await expect(
          service.verifyOtp({ email: EMAIL, otp: wrong }),
        ).rejects.toThrow(/attempt/);
      }
      await expect(service.verifyOtp({ email: EMAIL, otp })).rejects.toThrow(
        /Too many invalid attempts/,
      );
      expect(redis.has(RedisKeys.otp(EMAIL))).toBe(false);
    });

    it('caps attempts under concurrent guessing', async () => {
      const otp = await requestOtp();
      const wrong = otp === '000000' ? '111111' : '000000';

      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () =>
          service.verifyOtp({ email: EMAIL, otp: wrong }),
        ),
      );
      const remainingMessages = results.filter(
        (r) =>
          r.status === 'rejected' &&
          /remaining/.test(String((r.reason as Error).message)),
      );
      expect(remainingMessages.length).toBeLessThanOrEqual(OTP_MAX_ATTEMPTS);
    });
  });

  describe('resetPassword', () => {
    it('updates the password once and rejects reuse of the reset token', async () => {
      const otp = await requestOtp();
      const { resetToken } = await service.verifyOtp({ email: EMAIL, otp });

      await service.resetPassword({
        token: resetToken,
        newPassword: 'BrandNew123!',
      });
      expect(users.updatePassword).toHaveBeenCalledOnce();
      expect(sessions.revokeAll).toHaveBeenCalledWith(
        'user-1',
        SessionEndReason.PASSWORD_RESET,
      );

      await expect(
        service.resetPassword({
          token: resetToken,
          newPassword: 'BrandNew123!',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('changePassword', () => {
    it('rejects a wrong current password', async () => {
      users.findById.mockResolvedValue(
        makeUser({ password: await hash('Correct123!') }),
      );
      await expect(
        service.changePassword('user-1', 'session-1', {
          currentPassword: 'Wrong123!',
          newPassword: 'NewPass123!',
        }),
      ).rejects.toThrow(/does not match/);
    });

    it('updates the password, signs out other sessions and keeps this one', async () => {
      users.findById.mockResolvedValue(
        makeUser({ password: await hash('Correct123!') }),
      );

      const result = await service.changePassword('user-1', 'session-1', {
        currentPassword: 'Correct123!',
        newPassword: 'NewPass123!',
      });

      expect(users.updatePassword).toHaveBeenCalledOnce();
      expect(sessions.revokeAll).toHaveBeenCalledWith(
        'user-1',
        SessionEndReason.PASSWORD_CHANGED,
        'session-1',
      );
      expect(tokens.continueSession).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-1' }),
        'session-1',
      );
      expect(result).toMatchObject({ accessToken: 'a', refreshToken: 'r' });
    });
  });
});
