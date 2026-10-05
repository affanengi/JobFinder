"""Unit tests for AI/API Hub cryptographic vault."""

import os

import pytest

from app.ai.hub.crypto import (
    CryptoError,
    CryptoKeyMissingError,
    CryptoTamperError,
    decrypt_api_key,
    encrypt_api_key,
    mask_api_key,
)

SAMPLE_SECRET = "super-secret-master-encryption-key-for-testing-only-12345"
SAMPLE_API_KEYS = [
    "AIzaSyD-sampleGeminiApiKey1234567890abcdef",
    "sk-or-v1-abcdef0123456789abcdef0123456789abcdef",
    "gsk_abcdefghijklmnopqrstuvwxyz0123456789",
    "sk-proj-sampleOpenAiKey12345678901234567890",
]


def test_encryption_decryption_roundtrip():
    """Verify that encrypting and decrypting with the same key returns the exact original plaintext."""
    for key in SAMPLE_API_KEYS:
        encrypted = encrypt_api_key(key, secret_key=SAMPLE_SECRET)
        assert encrypted.startswith("v1:")
        parts = encrypted.split(":")
        assert len(parts) == 4

        decrypted = decrypt_api_key(encrypted, secret_key=SAMPLE_SECRET)
        assert decrypted == key


def test_unique_nonces_produce_distinct_ciphertexts():
    """Verify that encrypting identical plaintext twice produces different ciphertexts due to fresh nonces."""
    key = SAMPLE_API_KEYS[0]
    enc1 = encrypt_api_key(key, secret_key=SAMPLE_SECRET)
    enc2 = encrypt_api_key(key, secret_key=SAMPLE_SECRET)

    assert enc1 != enc2
    assert decrypt_api_key(enc1, secret_key=SAMPLE_SECRET) == key
    assert decrypt_api_key(enc2, secret_key=SAMPLE_SECRET) == key


def test_tampered_ciphertext_fails_integrity():
    """Verify that altering any character in ciphertext raises CryptoTamperError."""
    key = SAMPLE_API_KEYS[0]
    encrypted = encrypt_api_key(key, secret_key=SAMPLE_SECRET)
    version, iv, tag, cipher = encrypted.split(":")

    # Flip the last character of ciphertext
    corrupted_char = "B" if cipher[-1] != "B" else "A"
    tampered_cipher = cipher[:-1] + corrupted_char
    tampered_payload = f"{version}:{iv}:{tag}:{tampered_cipher}"

    with pytest.raises(CryptoTamperError):
        decrypt_api_key(tampered_payload, secret_key=SAMPLE_SECRET)


def test_tampered_tag_fails_integrity():
    """Verify that altering the authentication tag raises CryptoTamperError."""
    key = SAMPLE_API_KEYS[0]
    encrypted = encrypt_api_key(key, secret_key=SAMPLE_SECRET)
    version, iv, tag, cipher = encrypted.split(":")

    # Alter first character so base64 padding remains intact but bytes change
    corrupted_char = "Z" if tag[0] != "Z" else "Y"
    tampered_tag = corrupted_char + tag[1:]
    tampered_payload = f"{version}:{iv}:{tampered_tag}:{cipher}"

    with pytest.raises(CryptoTamperError):
        decrypt_api_key(tampered_payload, secret_key=SAMPLE_SECRET)


def test_tampered_iv_fails_integrity():
    """Verify that altering the IV raises CryptoTamperError."""
    key = SAMPLE_API_KEYS[0]
    encrypted = encrypt_api_key(key, secret_key=SAMPLE_SECRET)
    version, iv, tag, cipher = encrypted.split(":")

    corrupted_char = "M" if iv[0] != "M" else "N"
    tampered_iv = corrupted_char + iv[1:]
    tampered_payload = f"{version}:{tampered_iv}:{tag}:{cipher}"

    with pytest.raises(CryptoTamperError):
        decrypt_api_key(tampered_payload, secret_key=SAMPLE_SECRET)


def test_wrong_secret_key_fails_decryption():
    """Verify that attempting to decrypt with a different secret key raises CryptoTamperError."""
    key = SAMPLE_API_KEYS[0]
    encrypted = encrypt_api_key(key, secret_key=SAMPLE_SECRET)
    wrong_secret = "completely-different-master-encryption-secret-99999"

    with pytest.raises(CryptoTamperError):
        decrypt_api_key(encrypted, secret_key=wrong_secret)


def test_missing_or_short_secret_key():
    """Verify that missing or insufficiently long secret keys are rejected."""
    # Ensure env var is not set for this test
    old_env = os.environ.pop("AI_ENCRYPTION_SECRET", None)
    try:
        with pytest.raises(CryptoKeyMissingError):
            encrypt_api_key("test-key", secret_key=None)

        with pytest.raises(CryptoKeyMissingError):
            encrypt_api_key("test-key", secret_key="too-short")
    finally:
        if old_env is not None:
            os.environ["AI_ENCRYPTION_SECRET"] = old_env


def test_environment_variable_fallback():
    """Verify that encryption uses AI_ENCRYPTION_SECRET from environment if secret_key arg is None."""
    os.environ["AI_ENCRYPTION_SECRET"] = SAMPLE_SECRET
    try:
        key = "sample-env-key-12345"
        encrypted = encrypt_api_key(key)
        assert decrypt_api_key(encrypted) == key
    finally:
        os.environ.pop("AI_ENCRYPTION_SECRET", None)


def test_empty_key_rejected():
    """Verify that empty keys are rejected."""
    with pytest.raises(CryptoError):
        encrypt_api_key("", secret_key=SAMPLE_SECRET)

    with pytest.raises(CryptoError):
        decrypt_api_key("", secret_key=SAMPLE_SECRET)


def test_malformed_payload_rejected():
    """Verify that payloads with invalid segment counts or unknown versions are rejected."""
    with pytest.raises(CryptoError):
        decrypt_api_key("v1:only:two_parts", secret_key=SAMPLE_SECRET)

    with pytest.raises(CryptoError):
        decrypt_api_key("v2:iv:tag:cipher", secret_key=SAMPLE_SECRET)


def test_mask_api_key():
    """Verify masking behaves securely across varying key lengths."""
    assert mask_api_key("") == ""
    assert mask_api_key("short") == "***"
    assert mask_api_key("12345678") == "***"
    assert mask_api_key("1234567890") == "123...890"

    # Standard realistic keys
    gemini_key = "AIzaSyD-sampleGeminiApiKey1234567890abcdef"
    masked = mask_api_key(gemini_key)
    assert masked == "AIzaSy...cdef"
    assert "sampleGeminiApiKey" not in masked

    groq_key = "gsk_abcdefghijklmnopqrstuvwxyz0123456789"
    masked_groq = mask_api_key(groq_key)
    assert masked_groq == "gsk_ab...6789"
    assert "hijklmnopqrstuvw" not in masked_groq
