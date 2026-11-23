import { Test, TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { MailService } from '../src/infrastructure/mail/mail.service.js';
import { RedisService } from '../src/infrastructure/redis/redis.service.js';
import { RedisThrottlerStorage } from '../src/infrastructure/redis/redis-throttler.storage.js';
import type { PasswordResetOtpJob } from '../src/infrastructure/mail/mail.constants.js';

// Requires the services from docker-compose.yml (Postgres, Redis, MinIO) and a
// seeded database (`npm run db:seed`).

const ADMIN = {
  email: 'admin@salamatinnovation.com',
  password: 'Admin@123456',
};

describe('Authentication (e2e)', () => {
  let app: NestExpressApplication;
  let redis: RedisService;
  const sentOtps: PasswordResetOtpJob[] = [];

  const http = () => request(app.getHttpServer());
  const payload = (res: request.Response) => res.body?.data ?? res.body;
  const login = (credentials = ADMIN) =>
    http().post('/api/auth/login').send(credentials);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Capture OTP emails instead of queueing them.
      .overrideProvider(MailService)
      .useValue({
        sendPasswordResetOtp: async (job: PasswordResetOtpJob) => {
          sentOtps.push(job);
        },
      })
      // The suite logs in many times from one IP; rate limiting is covered separately.
      .overrideProvider(RedisThrottlerStorage)
      .useValue({
        increment: async () => ({
          totalHits: 1,
          timeToExpire: 60,
          isBlocked: false,
          timeToBlockExpire: 0,
        }),
      })
      .compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    redis = app.get(RedisService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health - reports database and redis status', async () => {
    const res = await http().get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.info).toHaveProperty('database');
    expect(res.body.info).toHaveProperty('redis');
  });

  it('GET /api/health/storage - reports MinIO status', async () => {
    const res = await http().get('/api/health/storage');
    expect(res.status).toBe(200);
    expect(res.body.info.minio.status).toBe('up');
  });

  describe('login and tokens', () => {
    it('rejects wrong credentials', async () => {
      const res = await login({
        email: ADMIN.email,
        password: 'IncorrectPassword',
      });
      expect(res.status).toBe(401);
    });

    it('logs in with seeded admin credentials', async () => {
      const res = await login();
      expect(res.status).toBe(200);
      const data = payload(res);
      expect(data).toHaveProperty('accessToken');
      expect(data).toHaveProperty('refreshToken');
      expect(data.user.email).toBe(ADMIN.email);
      expect(data.user.role.slug).toBe('admin');
    });

    it('rejects unauthenticated profile requests', async () => {
      expect((await http().get('/api/auth/me')).status).toBe(401);
    });

    it('returns the profile for an access token, but not for a refresh token', async () => {
      const { accessToken, refreshToken } = payload(await login());

      const ok = await http()
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(ok.status).toBe(200);
      expect(payload(ok).email).toBe(ADMIN.email);

      const wrongType = await http()
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${refreshToken}`);
      expect(wrongType.status).toBe(401);
    });

    it('rotates refresh tokens and rejects reuse', async () => {
      const { refreshToken } = payload(await login());

      const first = await http()
        .post('/api/auth/refresh')
        .send({ refreshToken });
      expect(first.status).toBe(200);
      expect(payload(first).refreshToken).not.toBe(refreshToken);

      const reused = await http()
        .post('/api/auth/refresh')
        .send({ refreshToken });
      expect(reused.status).toBe(401);
    });

    it('revokes the refresh token on logout', async () => {
      const { refreshToken } = payload(await login());

      expect(
        (await http().post('/api/auth/logout').send({ refreshToken })).status,
      ).toBe(200);
      expect(
        (await http().post('/api/auth/refresh').send({ refreshToken })).status,
      ).toBe(401);
    });
  });

  describe('forgot password via OTP', () => {
    let otp: string;
    let resetToken: string;
    let tokenBeforeReset: string;

    beforeAll(async () => {
      await redis.del(`otp_cooldown:${ADMIN.email}`);
      tokenBeforeReset = payload(await login()).accessToken;
    });

    it('sends an OTP', async () => {
      const res = await http()
        .post('/api/auth/forgot-password')
        .send({ email: ADMIN.email });
      expect(res.status).toBe(200);
      expect(payload(res).expiresInSeconds).toBe(600);

      otp = sentOtps.at(-1)!.otp;
      expect(otp).toMatch(/^\d{6}$/);
    });

    it('enforces the resend cooldown', async () => {
      const res = await http()
        .post('/api/auth/forgot-password')
        .send({ email: ADMIN.email });
      expect(res.status).toBe(429);
    });

    it('rejects a wrong OTP', async () => {
      const wrong = otp === '000000' ? '111111' : '000000';
      const res = await http()
        .post('/api/auth/verify-otp')
        .send({ email: ADMIN.email, otp: wrong });
      expect(res.status).toBe(400);
    });

    it('accepts the right OTP and returns a reset token', async () => {
      const res = await http()
        .post('/api/auth/verify-otp')
        .send({ email: ADMIN.email, otp });
      expect(res.status).toBe(200);
      resetToken = payload(res).resetToken;
      expect(resetToken).toBeDefined();
    });

    it('resets the password once and revokes existing sessions', async () => {
      const res = await http()
        .post('/api/auth/reset-password')
        .send({ token: resetToken, newPassword: 'ResetPassword@2026' });
      expect(res.status).toBe(200);

      const reused = await http()
        .post('/api/auth/reset-password')
        .send({ token: resetToken, newPassword: 'ResetPassword@2026' });
      expect(reused.status).toBe(400);

      const oldSession = await http()
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${tokenBeforeReset}`);
      expect(oldSession.status).toBe(401);
    });

    it('changes the password back and keeps the caller signed in', async () => {
      const { accessToken } = payload(
        await login({ email: ADMIN.email, password: 'ResetPassword@2026' }),
      );

      const res = await http()
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          currentPassword: 'ResetPassword@2026',
          newPassword: ADMIN.password,
        });
      expect(res.status).toBe(200);
      const data = payload(res);
      expect(data.message).toContain('Password changed successfully');

      // The old token is revoked; the one returned by change-password works.
      expect(
        (
          await http()
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${accessToken}`)
        ).status,
      ).toBe(401);
      expect(
        (
          await http()
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${data.accessToken}`)
        ).status,
      ).toBe(200);
      expect((await login()).status).toBe(200);
    });
  });

  describe('passkeys / WebAuthn', () => {
    let authToken: string;

    beforeAll(async () => {
      authToken = payload(await login()).accessToken;
    });

    it('generates public login options', async () => {
      const res = await http()
        .post('/api/auth/passkey/login/options')
        .send({ email: ADMIN.email });
      expect(res.status).toBe(200);
      expect(payload(res)).toHaveProperty('challenge');
      expect(payload(res)).toHaveProperty('rpId');
    });

    it('requires authentication for registration options', async () => {
      expect(
        (await http().post('/api/auth/passkey/register/options')).status,
      ).toBe(401);
    });

    it('generates registration options for an authenticated user', async () => {
      const res = await http()
        .post('/api/auth/passkey/register/options')
        .set('Authorization', `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      const data = payload(res);
      expect(data).toHaveProperty('challenge');
      expect(data.user.name).toBe(ADMIN.email);
      expect(data.pubKeyCredParams).toBeInstanceOf(Array);
    });

    it('rejects a malformed passkey assertion', async () => {
      const res = await http()
        .post('/api/auth/passkey/login/verify')
        .send({ response: { id: 'x' } });
      expect(res.status).toBe(400);
    });

    it('lists the user passkeys', async () => {
      const res = await http()
        .get('/api/auth/passkeys')
        .set('Authorization', `Bearer ${authToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(payload(res))).toBe(true);
    });
  });
});
