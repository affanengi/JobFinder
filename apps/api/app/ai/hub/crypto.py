"""Cryptographic vault for AI/API Hub credentials.

Implements AES-256-GCM authenticated encryption at rest for user API keys.
Format: v1:{base64_iv}:{base64_tag}:{base64_ciphertext}
"""

import base64
import hashlib
import os
import re

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class CryptoError(Exception):
    """Base exception for cryptographic operations."""

    pass


class CryptoKeyMissingError(CryptoError):
    """Raised when encryption master key is not configured."""

    pass


class CryptoTamperError(CryptoError):
    """Raised when ciphertext integrity authentication fails."""

    pass


def _get_master_key_bytes(secret: str | None = None) -> bytes:
    """Derive 32-byte AES-256 master key from environment or parameter."""
    raw_secret = secret or os.getenv("AI_ENCRYPTION_SECRET")
    if not raw_secret:
        raise CryptoKeyMissingError(
            "AI_ENCRYPTION_SECRET environment variable is missing or empty."
        )
    if len(raw_secret) < 16:
        raise CryptoKeyMissingError(
            "AI_ENCRYPTION_SECRET must be at least 16 characters for cryptographic safety."
        )
    # Derive deterministic 32-byte (256-bit) key using SHA-256
    return hashlib.sha256(raw_secret.encode("utf-8")).digest()


def encrypt_api_key(plaintext_key: str, secret_key: str | None = None) -> str:
    """Encrypt an API key using AES-256-GCM with a unique 12-byte nonce.

    Returns payload formatted as: v1:{base64_iv}:{base64_tag}:{base64_ciphertext}
    """
    if not plaintext_key:
        raise CryptoError("Cannot encrypt empty or null API key.")

    key_bytes = _get_master_key_bytes(secret_key)
    aesgcm = AESGCM(key_bytes)

    # 12-byte cryptographically secure random nonce
    iv = os.urandom(12)
    plaintext_bytes = plaintext_key.encode("utf-8")

    # AESGCM.encrypt appends a 16-byte authentication tag to the ciphertext
    encrypted_blob = aesgcm.encrypt(iv, plaintext_bytes, None)
    ciphertext = encrypted_blob[:-16]
    tag = encrypted_blob[-16:]

    b64_iv = base64.b64encode(iv).decode("ascii")
    b64_tag = base64.b64encode(tag).decode("ascii")
    b64_cipher = base64.b64encode(ciphertext).decode("ascii")

    return f"v1:{b64_iv}:{b64_tag}:{b64_cipher}"


def decrypt_api_key(encrypted_payload: str, secret_key: str | None = None) -> str:
    """Decrypt and authenticate an AES-256-GCM payload.

    Verifies GCM authentication tag before returning plaintext.
    """
    if not encrypted_payload:
        raise CryptoError("Cannot decrypt empty or null payload.")

    parts = encrypted_payload.split(":")
    if len(parts) != 4:
        raise CryptoError(
            f"Malformed encrypted payload structure. Expected 4 parts, got {len(parts)}."
        )

    version, b64_iv, b64_tag, b64_cipher = parts
    if version != "v1":
        raise CryptoError(f"Unsupported encryption payload version: {version}")

    try:
        iv = base64.b64decode(b64_iv)
        tag = base64.b64decode(b64_tag)
        ciphertext = base64.b64decode(b64_cipher)
    except Exception as exc:
        raise CryptoError("Failed to base64-decode encrypted payload components.") from exc

    if len(iv) != 12:
        raise CryptoError(f"Invalid IV length. Expected 12 bytes, got {len(iv)}.")
    if len(tag) != 16:
        raise CryptoError(f"Invalid authentication tag length. Expected 16 bytes, got {len(tag)}.")

    key_bytes = _get_master_key_bytes(secret_key)
    aesgcm = AESGCM(key_bytes)

    # Reassemble ciphertext + tag for AESGCM
    data_to_decrypt = ciphertext + tag

    try:
        decrypted_bytes = aesgcm.decrypt(iv, data_to_decrypt, None)
        return decrypted_bytes.decode("utf-8")
    except InvalidTag as exc:
        raise CryptoTamperError(
            "Cryptographic integrity check failed! Ciphertext or tag has been tampered with."
        ) from exc
    except Exception as exc:
        raise CryptoError(f"Decryption failed: {exc}") from exc


def mask_api_key(plaintext_key: str) -> str:
    """Mask an API key for safe UI display and logging.

    Never reveals the secret core. Examples:
    - AIzaSyBC...9xQ2
    - gsk_12...99ab
    - sk-or-...44zz
    """
    if not plaintext_key:
        return ""

    key_len = len(plaintext_key)
    if key_len <= 8:
        return "***"

    if key_len <= 14:
        return f"{plaintext_key[:3]}...{plaintext_key[-3:]}"

    return f"{plaintext_key[:6]}...{plaintext_key[-4:]}"


_KNOWN_KEY_PATTERNS = [
    re.compile(r"AIzaSy[A-Za-z0-9_-]{33}"),
    re.compile(r"sk-or-v1-[a-f0-9]{64}"),
    re.compile(r"sk-or-[A-Za-z0-9_-]{20,}"),
    re.compile(r"gsk_[A-Za-z0-9_-]{20,}"),
    re.compile(r"(Bearer\s+)[A-Za-z0-9_\-\.]{16,}", re.IGNORECASE),
    re.compile(r"([?&]key=)[^&\s]+", re.IGNORECASE),
]


def sanitize_text(text: str, secrets: list[str] | None = None) -> str:
    """Sanitize secrets and API keys from log strings, errors, and traces.

    Replaces exact matching secrets with their masked representation and
    redacts common key formats (Gemini, OpenRouter, Groq, Bearer tokens).
    """
    if not text:
        return ""

    sanitized = text

    # First scrub known active secrets passed in
    if secrets:
        for secret in secrets:
            if secret and len(secret) > 4:
                sanitized = sanitized.replace(secret, mask_api_key(secret))

    # Next scrub known key formats
    for pattern in _KNOWN_KEY_PATTERNS:

        def _repl(match: re.Match[str]) -> str:
            val = match.group(0)
            if val.lower().startswith("bearer "):
                return "Bearer [REDACTED]"
            if "=key=" in val.lower() or "?key=" in val.lower() or "&key=" in val.lower():
                prefix = match.group(1) if match.lastindex else "?key="
                return f"{prefix}[REDACTED]"
            return mask_api_key(val)

        sanitized = pattern.sub(_repl, sanitized)

    return sanitized
