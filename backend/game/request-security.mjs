import {isIP} from 'node:net';

const normalize = value => String(value ?? '').replace(/^::ffff:/,'');
export function clientAddress(request, trustedProxies = []) {
  const peer = normalize(request.socket.remoteAddress);
  // Only an explicitly configured socket peer may supply the single address
  // overwritten by our own Caddy. Arbitrary forwarded chains are never trusted.
  if (trustedProxies.map(normalize).includes(peer)) {
    const forwarded = request.headers['x-real-ip'];
    if (typeof forwarded === 'string' && isIP(forwarded)) return normalize(forwarded);
  }
  return peer || 'unknown';
}
export function rateLimiter() {
  const buckets = new Map();
  return (key, max, windowMs = 60000, now = Date.now()) => {
    if (buckets.size >= 10000) for (const [id, b] of buckets) if (b.until <= now) buckets.delete(id);
    if (!buckets.has(key) && buckets.size >= 10000) throw Object.assign(new Error('操作繁忙，请稍后重试'),{status:429,code:'RATE_LIMITED'});
    let bucket = buckets.get(key);
    if (!bucket || bucket.until <= now) { bucket = {count:0,until:now+windowMs}; buckets.set(key,bucket); }
    if (++bucket.count > max) throw Object.assign(new Error('操作过快，请稍后重试'),{status:429,code:'RATE_LIMITED'});
  };
}
