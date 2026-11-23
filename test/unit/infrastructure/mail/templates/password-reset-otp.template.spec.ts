import { describe, expect, it } from 'vitest';
import { renderPasswordResetOtp } from '../../../../../src/infrastructure/mail/templates/password-reset-otp.template.js';

describe('renderPasswordResetOtp', () => {
  it('escapes user-controlled names in the HTML body', () => {
    const mail = renderPasswordResetOtp({
      email: 'x@example.com',
      otp: '123456',
      firstName: '<script>alert(1)</script>',
      expiresInMinutes: 10,
    });

    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.text).toContain('123456');
  });
});
