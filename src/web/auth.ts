import { scryptSync, timingSafeEqual } from 'node:crypto';

const SALT = Buffer.from('sable-login-v1');
const KEY_LEN = 32;

/** Hash the configured password once. Login attempts are hashed and compared in constant time. */
export class PasswordGate {
  private readonly expected: Buffer | null;

  constructor(password: string) {
    this.expected = password ? scryptSync(password, SALT, KEY_LEN) : null;
  }

  get configured(): boolean {
    return this.expected !== null;
  }

  check(attempt: string): boolean {
    if (!this.expected || !attempt) return false;
    const actual = scryptSync(attempt, SALT, KEY_LEN);
    return timingSafeEqual(actual, this.expected);
  }
}

type Bucket = { count: number; reset: number };

/** Failed logins per IP. A success clears the bucket. */
export class LoginLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly maxFailures = 5,
    private readonly windowMs = 10 * 60 * 1000,
  ) {}

  blocked(key: string, now: number): boolean {
    const bucket = this.buckets.get(key);
    if (!bucket) return false;
    if (now >= bucket.reset) {
      this.buckets.delete(key);
      return false;
    }
    return bucket.count >= this.maxFailures;
  }

  fail(key: string, now: number): void {
    const existing = this.buckets.get(key);
    if (!existing || now >= existing.reset) {
      this.buckets.set(key, { count: 1, reset: now + this.windowMs });
      return;
    }
    existing.count += 1;
  }

  succeed(key: string): void {
    this.buckets.delete(key);
  }
}

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = 'sable_session';
