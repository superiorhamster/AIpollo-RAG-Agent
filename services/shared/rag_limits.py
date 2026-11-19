from redis.asyncio import Redis
from redis.exceptions import RedisError

from rag_http import ApiError, unavailable

_COUNT = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return { count, redis.call('TTL', KEYS[1]) }
"""


def open_redis(url: str) -> Redis:
    return Redis.from_url(url, socket_timeout=2, socket_connect_timeout=2)


async def require_budget(redis: Redis, key: str, limit: int, seconds: int) -> None:
    try:
        count, ttl = await redis.eval(_COUNT, 1, key, seconds)
    except RedisError as exc:
        raise unavailable() from exc
    if count > limit:
        raise ApiError(429, "throttled", "Too many attempts. Try again later.", {"Retry-After": str(max(1, ttl))})
