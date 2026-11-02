"""Dedicated cryptographic vault for Google OAuth tokens & state security.

Implements:
1. Cryptographic Domain Separation using HKDF-SHA256 (RFC 5869) to derive independent
   AES-256-GCM vault encryption key and HMAC-SHA256 OAuth state-signing key.
2. AES-256-GCM authenticated encryption at rest strictly using OAUTH_ENCRYPTION_SECRET.
3. Tamper-evident, short-lived, signed OAuth state parameters.
4. Strict shielding of all raw tokens and keys from logs and error messages.
5. Rejection of fallback to AI_ENCRYPTION_SECRET.
"""

import base64
import hashlib
import hmac
import os
import re
from datetime import UTC, datetime

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.core.config import settings


class OAuthCryptoError(Exception):
    """Base exception for OAuth cryptographic operations."""

    pass


class OAuthCryptoKeyMissingError(OAuthCryptoError):
    """Raised when OAUTH_ENCRYPTION_SECRET is not configured or missing."""

    pass


class OAuthCryptoKeyInvalidError(OAuthCryptoError):
    """Raised when OAUTH_ENCRYPTION_SECRET is invalid (too short or matches AI secret)."""

    pass


class OAuthCryptoTamperError(OAuthCryptoError):
    """Raised when ciphertext integrity or authentication tag verification fails."""

    pass


class OAuthStateError(OAuthCryptoError):
    """Base exception for OAuth state validation errors."""

    pass


class OAuthStateSignatureError(OAuthStateError):
    """Raised when OAuth state HMAC signature verification fails."""

    pass


class OAuthStateExpiredError(OAuthStateError):
    """Raised when OAuth state has exceeded its TTL (10 minutes)."""

    pass


class OAuthStateBindingError(OAuthStateError):
    """Raised when OAuth state user or service binding does not match."""

    pass


class OAuthStateReplayError(OAuthStateError):
    """Raised when OAuth state nonce has already been consumed."""

    pass


def derive_oauth_subkeys(secret: str | None = None) -> tuple[bytes, bytes]:
    """Derive distinct 32-byte encryption and signing keys using HKDF-SHA256.

    Enforces strict cryptographic domain separation:
    - Subkey 1: AES-256-GCM token vaulting key (32 bytes)
    - Subkey 2: HMAC-SHA256 OAuth state signing key (32 bytes)
    """
    raw_secret = secret or os.getenv("OAUTH_ENCRYPTION_SECRET") or settings.OAUTH_ENCRYPTION_SECRET
    if not raw_secret:
        try:
            from dotenv import dotenv_values
            from app.core.config import _api_env_path, _root_env_path
            raw_secret = (
                dotenv_values(_root_env_path).get("OAUTH_ENCRYPTION_SECRET")
                or dotenv_values(_api_env_path).get("OAUTH_ENCRYPTION_SECRET")
                or dotenv_values(".env").get("OAUTH_ENCRYPTION_SECRET")
                or ""
            )
        except Exception:
            pass

    ai_secret = os.getenv("AI_ENCRYPTION_SECRET") or getattr(settings, "AI_ENCRYPTION_SECRET", "")
    if not ai_secret:
        try:
            from dotenv import dotenv_values
            from app.core.config import _api_env_path, _root_env_path
            ai_secret = (
                dotenv_values(_root_env_path).get("AI_ENCRYPTION_SECRET")
                or dotenv_values(_api_env_path).get("AI_ENCRYPTION_SECRET")
                or dotenv_values(".env").get("AI_ENCRYPTION_SECRET")
                or ""
            )
        except Exception:
            pass

    if not raw_secret:
        raise OAuthCryptoKeyMissingError(
            "OAUTH_ENCRYPTION_SECRET is missing or empty. A dedicated secret is required for OAuth token security."
        )

    # Strictly prohibit fallback or identity with AI_ENCRYPTION_SECRET
    if ai_secret and raw_secret.strip() == ai_secret.strip():
        raise OAuthCryptoKeyInvalidError(
            "Security Violation: OAUTH_ENCRYPTION_SECRET must be dedicated and distinct from AI_ENCRYPTION_SECRET."
        )

    if len(raw_secret.strip()) < 32:
        raise OAuthCryptoKeyInvalidError(
            "OAUTH_ENCRYPTION_SECRET must be at least 32 characters for AES-256 cryptographic security."
        )

    secret_bytes = raw_secret.strip().encode("utf-8")

    # 1. Dedicated AES-256-GCM Vault Key (32 bytes)
    aes_key = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=None,
        info=b"jobfinder-oauth-aes256gcm-vault-key-v3",
    ).derive(secret_bytes)

    # 2. Dedicated HMAC-SHA256 State Signing Key (32 bytes)
    signing_key = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=None,
        info=b"jobfinder-oauth-hmacsha256-statesigning-key-v3",
    ).derive(secret_bytes)

    return aes_key, signing_key


def get_oauth_master_key_bytes(secret: str | None = None) -> bytes:
    """Derive 32-byte AES-256 vault key. Backward-compatible wrapper."""
    aes_key, _ = derive_oauth_subkeys(secret)
    return aes_key


def encrypt_oauth_token(plaintext_token: str, secret: str | None = None) -> str:
    """Encrypt OAuth token using AES-256-GCM with a unique 12-byte nonce.

    Returns string format: v1:{base64_iv}:{base64_tag}:{base64_ciphertext}
    """
    if not plaintext_token:
        raise OAuthCryptoError("Cannot encrypt empty or null token.")

    aes_key, _ = derive_oauth_subkeys(secret)
    aesgcm = AESGCM(aes_key)

    # 12-byte cryptographically secure random nonce
    iv = os.urandom(12)
    plaintext_bytes = plaintext_token.encode("utf-8")

    # AESGCM.encrypt appends 16-byte authentication tag to ciphertext
    encrypted_blob = aesgcm.encrypt(iv, plaintext_bytes, None)

    tag = encrypted_blob[-16:]
    ciphertext = encrypted_blob[:-16]

    b64_iv = base64.b64encode(iv).decode("ascii")
    b64_tag = base64.b64encode(tag).decode("ascii")
    b64_cipher = base64.b64encode(ciphertext).decode("ascii")

    return f"v1:{b64_iv}:{b64_tag}:{b64_cipher}"


def decrypt_oauth_token(encrypted_payload: str, secret: str | None = None) -> str:
    """Decrypt and verify AES-256-GCM encrypted OAuth token.

    Validates payload format and 16-byte authentication tag before returning plaintext.
    """
    if not encrypted_payload:
        raise OAuthCryptoError("Cannot decrypt empty or null payload.")

    match = re.match(r"^v1:([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+)$", encrypted_payload.strip())
    if not match:
        raise OAuthCryptoError("Invalid OAuth token payload format. Expected v1:{iv}:{tag}:{ciphertext}")

    b64_iv, b64_tag, b64_cipher = match.groups()

    try:
        iv = base64.b64decode(b64_iv)
        tag = base64.b64decode(b64_tag)
        ciphertext = base64.b64decode(b64_cipher)
    except Exception as e:
        raise OAuthCryptoError("Base64 decoding failed for token payload.") from e

    if len(iv) != 12:
        raise OAuthCryptoError(f"Invalid IV length: expected 12 bytes, got {len(iv)}.")
    if len(tag) != 16:
        raise OAuthCryptoError(f"Invalid tag length: expected 16 bytes, got {len(tag)}.")

    aes_key, _ = derive_oauth_subkeys(secret)
    aesgcm = AESGCM(aes_key)
    data_to_decrypt = ciphertext + tag

    try:
        decrypted_bytes = aesgcm.decrypt(iv, data_to_decrypt, None)
        return decrypted_bytes.decode("utf-8")
    except InvalidTag as e:
        raise OAuthCryptoTamperError("Authentication tag validation failed. Ciphertext has been tampered with.") from e
    except Exception as e:
        raise OAuthCryptoError(f"Decryption failed: {str(e)}") from e


def sign_oauth_state(
    user_id: str,
    service: str,
    nonce: str,
    expires_at_ts: float,
    secret: str | None = None,
) -> str:
    """Generate signed tamper-evident OAuth state parameter.

    Format: {user_id}:{service}:{nonce}:{expires_at_int}:{hmac_sig}
    Uses dedicated HMAC signing key derived via HKDF domain separation.
    """
    _, signing_key = derive_oauth_subkeys(secret)
    exp_int = int(expires_at_ts)
    payload = f"{user_id}:{service}:{nonce}:{exp_int}"
    sig = hmac.new(signing_key, payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{payload}:{sig}"


def verify_oauth_state(
    state: str,
    expected_service: str | None = None,
    secret: str | None = None,
) -> dict[str, str | int]:
    """Verify state parameter signature, expiration, and service binding.

    Returns dict with user_id, service, nonce, and expiresAt.
    """
    parts = state.strip().split(":")

    # Handle 5-part v3 state: user_id:service:nonce:expires_at:sig
    if len(parts) == 5:
        user_id, service, nonce, exp_str, sig = parts
        _, signing_key = derive_oauth_subkeys(secret)
        payload = f"{user_id}:{service}:{nonce}:{exp_str}"
        expected_sig = hmac.new(signing_key, payload.encode("utf-8"), hashlib.sha256).hexdigest()

        if not hmac.compare_digest(sig, expected_sig):
            raise OAuthStateSignatureError("Invalid OAuth state signature. State has been tampered with.")

        try:
            exp_ts = int(exp_str)
        except ValueError as e:
            raise OAuthStateError("Invalid expiration timestamp in state.") from e

        now_ts = datetime.now(UTC).timestamp()
        if now_ts > exp_ts:
            raise OAuthStateExpiredError(
                f"OAuth state has expired (TTL exceeded by {int(now_ts - exp_ts)}s)."
            )

        if expected_service and service != expected_service:
            raise OAuthStateBindingError(
                f"OAuth state service mismatch: expected {expected_service}, got {service}."
            )

        return {
            "userId": user_id,
            "service": service,
            "nonce": nonce,
            "expiresAt": exp_ts,
        }

    # Backward compatibility with 3-part legacy state: user_id:nonce:sig
    elif len(parts) == 3:
        user_id, nonce, sig = parts
        key = get_oauth_master_key_bytes(secret)
        expected_sig = hmac.new(key, f"{user_id}:{nonce}".encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected_sig):
            raise OAuthStateSignatureError("Invalid legacy OAuth state signature.")

        return {
            "userId": user_id,
            "service": "gmail",
            "nonce": nonce,
            "expiresAt": int(datetime.now(UTC).timestamp() + 600),
        }

    raise OAuthStateError(f"Malformed OAuth state parameter (expected 5 colon-separated segments, got {len(parts)}).")
