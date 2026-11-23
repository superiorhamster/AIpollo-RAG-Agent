"""Exercise real HTTP read deadlines on the public gateway routes using a delayed auth stub."""
import asyncio
from contextlib import suppress
from unittest.mock import AsyncMock, patch

import httpx

from app.main import app, lifespan


async def delayed_auth(reader, writer):
    try:
        line = await reader.readline()
        await reader.readuntil(b'\r\n\r\n')
        # Both auth endpoints must tolerate >4 seconds. GET /me retains the short default.
        await asyncio.sleep(4.5)
        status = b'204 No Content' if b'/auth/register ' in line else b'200 OK'
        writer.write(b'HTTP/1.1 ' + status + b'\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
        await writer.drain()
    finally:
        writer.close()
        with suppress(ConnectionError):
            await writer.wait_closed()


async def main():
    async with await asyncio.start_server(delayed_auth, '127.0.0.1', 0) as auth, lifespan(app):
        port = auth.sockets[0].getsockname()[1]
        app.state.auth_url = f'http://127.0.0.1:{port}'
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://gateway') as client:
            with patch('app.main.require_budget', new_callable=AsyncMock):
                headers = {'Origin': app.state.web_origin}
                register, login, me = await asyncio.gather(
                    client.post('/v1/auth/register', headers=headers),
                    client.post('/v1/auth/login', headers=headers),
                    client.get('/v1/auth/me'),
                )
                assert [register.status_code, login.status_code, me.status_code] == [204, 200, 503]
    print('Slow auth/register and auth/login succeed; short read deadline still returns 503.')


asyncio.run(main())
