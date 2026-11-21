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

  describe('sessions', () => {
    const LAPTOP =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
    const PHONE =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    const loginFrom = async (userAgent: string) =>
      payload(
        await http()
          .post('/api/auth/login')
          .set('User-Agent', userAgent)
          .send(ADMIN),
      ) as { accessToken: string; refreshToken: string };
    const sidOf = (token: string) =>
      JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
        .sid as string;
    const as = (token: string) => ({ Authorization: `Bearer ${token}` });

    it('lists signed-in devices and marks the current one', async () => {
      const laptop = await loginFrom(LAPTOP);
      const phone = await loginFrom(PHONE);

      const res = await http()
        .get('/api/auth/sessions')
        .set(as(laptop.accessToken));
      expect(res.status).toBe(200);
      const sessions = payload(res) as {
        id: string;
        current: boolean;
        deviceName: string;
        loginMethod: string;
        status: string;
      }[];

      const mine = sessions.find((s) => s.id === sidOf(laptop.accessToken));
      const other = sessions.find((s) => s.id === sidOf(phone.accessToken));
      expect(mine).toMatchObject({
        current: true,
        deviceName: 'Chrome on Windows',
        loginMethod: 'PASSWORD',
        status: 'active',
      });
      expect(other).toMatchObject({
        current: false,
        deviceName: 'Safari on iPhone',
      });
    });

    it('signs out another device immediately', async () => {
      const laptop = await loginFrom(LAPTOP);
      const phone = await loginFrom(PHONE);
      // The phone has been using the API, so "active" is cached for it.
      expect(
        (await http().get('/api/auth/me').set(as(phone.accessToken))).status,
      ).toBe(200);

      const res = await http()
        .delete(`/api/auth/sessions/${sidOf(phone.accessToken)}`)
        .set(as(laptop.accessToken));
      expect(res.status).toBe(200);

      // Both of the phone's tokens stop working at once.
      const me = await http().get('/api/auth/me').set(as(phone.accessToken));
      expect(me.status).toBe(401);
      expect(
        (
          await http()
            .post('/api/auth/refresh')
            .send({ refreshToken: phone.refreshToken })
        ).status,
      ).toBe(401);
      // The laptop is unaffected.
      expect(
        (await http().get('/api/auth/me').set(as(laptop.accessToken))).status,
      ).toBe(200);

      const history = payload(
        await http()
          .get('/api/auth/sessions/history?limit=100')
          .set(as(laptop.accessToken)),
      );
      expect(
        history.items.find(
          (s: { id: string }) => s.id === sidOf(phone.accessToken),
        ),
      ).toMatchObject({
        status: 'revoked',
        revokedReason: 'SIGNED_OUT_REMOTELY',
      });
      expect(history.meta).toMatchObject({ page: 1, limit: 100 });
    });

    it('returns 404 for a session that is not active', async () => {
      const laptop = await loginFrom(LAPTOP);
      const res = await http()
        .delete('/api/auth/sessions/00000000-0000-4000-8000-000000000000')
        .set(as(laptop.accessToken));
      expect(res.status).toBe(404);
    });

    it('signs out every other session but keeps this one', async () => {
      const laptop = await loginFrom(LAPTOP);
      const phone = await loginFrom(PHONE);

      const res = await http()
        .delete('/api/auth/sessions')
        .set(as(laptop.accessToken));
      expect(res.status).toBe(200);
      expect(payload(res).revokedCount).toBeGreaterThanOrEqual(1);

      expect(
        (await http().get('/api/auth/me').set(as(phone.accessToken))).status,
      ).toBe(401);
      expect(
        (await http().get('/api/auth/me').set(as(laptop.accessToken))).status,
      ).toBe(200);
      const remaining = payload(
        await http().get('/api/auth/sessions').set(as(laptop.accessToken)),
      );
      expect(remaining).toHaveLength(1);
    });

    it('logout ends the session, including its access token', async () => {
      const laptop = await loginFrom(LAPTOP);
      await http()
        .post('/api/auth/logout')
        .send({ refreshToken: laptop.refreshToken });

      expect(
        (await http().get('/api/auth/me').set(as(laptop.accessToken))).status,
      ).toBe(401);
    });

    it('keeps the session id across refreshes', async () => {
      const laptop = await loginFrom(LAPTOP);
      const refreshed = payload(
        await http()
          .post('/api/auth/refresh')
          .send({ refreshToken: laptop.refreshToken }),
      );
      expect(sidOf(refreshed.accessToken)).toBe(sidOf(laptop.accessToken));
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
