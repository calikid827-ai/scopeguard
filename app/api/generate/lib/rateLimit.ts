type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now()
  const b = buckets.get(key)

  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true, remaining: limit - 1, resetAt: now + windowMs }
  }

  b.count += 1
  buckets.set(key, b)

  if (b.count > limit) {
    return { ok: false, remaining: 0, resetAt: b.resetAt }
  }

  return { ok: true, remaining: Math.max(0, limit - b.count), resetAt: b.resetAt }
}