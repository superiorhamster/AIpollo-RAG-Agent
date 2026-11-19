"""Check Auth's JWT verifier with independently issued, signed fixtures."""

import time
import unittest
from uuid import uuid4

import jwt

from app.sessions import AUDIENCE, ISSUER, access_claims

KEY = b"jwt-test-fixture-key-with-at-least-32-bytes"
NOW = int(time.time())
CLAIMS = {
    "iss": ISSUER, "aud": AUDIENCE, "iat": NOW, "exp": NOW + 300,
    "sid": str(uuid4()), "sub": str(uuid4()), "jti": str(uuid4()), "token_use": "access",
}


class JWTVerification(unittest.TestCase):
    def test_valid_and_invalid_claims(self):
        token = jwt.encode(CLAIMS, KEY, algorithm="HS256")
        self.assertEqual(tuple(map(str, access_claims(token, KEY))), (CLAIMS["sid"], CLAIMS["sub"]))
        for override in (
            {"iss": "other-issuer"}, {"aud": "other-audience"}, {"exp": NOW - 1},
            {"sid": "invalid"}, {"token_use": "refresh"},
        ):
            with self.subTest(claims=override):
                self.assertIsNone(access_claims(jwt.encode({**CLAIMS, **override}, KEY, algorithm="HS256"), KEY))
        self.assertIsNone(access_claims(token, b"wrong-fixture-key-with-at-least-32-bytes"))
        missing_exp = {name: value for name, value in CLAIMS.items() if name != "exp"}
        self.assertIsNone(access_claims(jwt.encode(missing_exp, KEY, algorithm="HS256"), KEY))


if __name__ == "__main__":
    unittest.main(verbosity=2)
