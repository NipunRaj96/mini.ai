import hashlib
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from cryptography.fernet import Fernet

from app.core.config import get_settings

_password_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    try:
        return _password_hasher.verify(hashed, password)
    except (VerificationError, InvalidHashError):
        # VerificationError covers a wrong password (VerifyMismatchError,
        # its subclass) and other libargon2 verification failures.
        # InvalidHashError covers a malformed/corrupted stored hash — it is
        # a ValueError subclass, not a VerificationError subclass, so it
        # must be caught explicitly. Either way, verification failed: treat
        # it as "wrong credentials" rather than letting a 500 leak that the
        # account's stored hash is corrupted.
        return False


def _fernet() -> Fernet:
    return Fernet(get_settings().encryption_master_key.encode())


def encrypt_secret(plaintext: str) -> bytes:
    return _fernet().encrypt(plaintext.encode())


def decrypt_secret(ciphertext: bytes) -> str:
    return _fernet().decrypt(ciphertext).decode()


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _create_token(subject: str, expires_delta: timedelta, token_type: str) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    # jti: JWT exp/iat are second-resolution, so two tokens issued for the same
    # user+type within the same second would otherwise be byte-identical,
    # colliding on refresh_tokens.token_hash's unique constraint.
    payload = {
        "sub": subject,
        "type": token_type,
        "iat": now,
        "exp": now + expires_delta,
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm="HS256")


def create_access_token(user_id: str) -> str:
    settings = get_settings()
    return _create_token(
        user_id, timedelta(minutes=settings.jwt_access_token_expire_minutes), "access"
    )


def create_refresh_token(user_id: str) -> str:
    settings = get_settings()
    return _create_token(
        user_id, timedelta(days=settings.jwt_refresh_token_expire_days), "refresh"
    )


def decode_token(token: str) -> dict:
    settings = get_settings()
    return jwt.decode(token, settings.jwt_secret_key, algorithms=["HS256"])
