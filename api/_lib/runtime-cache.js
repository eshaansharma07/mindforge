const cache = new Map();

async function remember(key, ttlMs, loader) {
  const now = Date.now();
  const existing = cache.get(key);

  if (existing && existing.expiresAt > now) {
    return existing.value;
  }

  const value = await loader();
  cache.set(key, {
    value,
    expiresAt: now + Math.max(0, Number(ttlMs) || 0)
  });
  return value;
}

function forget(key) {
  cache.delete(key);
}

module.exports = {
  remember,
  forget
};
