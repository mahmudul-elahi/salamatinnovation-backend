import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

describe('Authentication (e2e)', () => {
  let app: INestApplication;
  let cacheManager: Cache;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    cacheManager = app.get<Cache>(CACHE_MANAGER);
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/auth/login - should fail with wrong credentials', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'admin@salamatinnovation.com',
        password: 'IncorrectPassword',
      });

    expect(res.status).toBe(401);
  });

  it('POST /api/auth/login - should log in with seeded admin credentials', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'admin@salamatinnovation.com',
        password: 'Admin@123456',
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body.user.email).toBe('admin@salamatinnovation.com');
    expect(res.body.user.role.slug).toBe('admin');
    expect(res.body.user.permissions).toBeInstanceOf(Array);
  });

  it('GET /api/auth/me - should reject unauthenticated request', async () => {
    const res = await request(app.getHttpServer()).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('GET /api/auth/me - should return profile for authenticated user', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'admin@salamatinnovation.com',
        password: 'Admin@123456',
      });

    const token = loginRes.body.accessToken;

    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe('admin@salamatinnovation.com');
    expect(res.body.role.slug).toBe('admin');
  });

  describe('Forgot Password Flow via OTP', () => {
    let generatedOtp: string;
    let resetToken: string;

    it('POST /api/auth/forgot-password - should request OTP successfully', async () => {
      // Clear any cooldown before testing
      await cacheManager.del('otp_cooldown:admin@salamatinnovation.com');

      const res = await request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({
          email: 'admin@salamatinnovation.com',
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('message');
      expect(res.body.expiresInSeconds).toBe(600);

      // Verify OTP was stored in cache
      const rawOtpData = await cacheManager.get<string>(
        'otp:admin@salamatinnovation.com',
      );
      expect(rawOtpData).toBeDefined();
      const parsed =
        typeof rawOtpData === 'string'
          ? JSON.parse(rawOtpData)
          : (rawOtpData as any);
      generatedOtp = parsed.otp;
      expect(generatedOtp).toHaveLength(6);
    });

    it('POST /api/auth/verify-otp - should fail with wrong OTP', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/verify-otp')
        .send({
          email: 'admin@salamatinnovation.com',
          otp: '000000',
        });

      expect(res.status).toBe(400);
    });

    it('POST /api/auth/verify-otp - should succeed with valid OTP and return resetToken', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/verify-otp')
        .send({
          email: 'admin@salamatinnovation.com',
          otp: generatedOtp,
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('resetToken');
      resetToken = res.body.resetToken;
      expect(resetToken).toBeDefined();
    });

    it('POST /api/auth/reset-password - should reset password with valid resetToken', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/reset-password')
        .send({
          token: resetToken,
          newPassword: 'ResetPassword@2026',
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('Password has been reset successfully');
    });

    it('POST /api/auth/login - should log in with the new reset password', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'admin@salamatinnovation.com',
          password: 'ResetPassword@2026',
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('accessToken');
    });

    it('POST /api/auth/change-password - should restore original password for authenticated user', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'admin@salamatinnovation.com',
          password: 'ResetPassword@2026',
        });

      const token = loginRes.body.accessToken;

      const res = await request(app.getHttpServer())
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({
          currentPassword: 'ResetPassword@2026',
          newPassword: 'Admin@123456',
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Password changed successfully.');

      // Verify original password works again
      const verifyLogin = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'admin@salamatinnovation.com',
          password: 'Admin@123456',
        });

      expect(verifyLogin.status).toBe(200);
    });
  });
});
