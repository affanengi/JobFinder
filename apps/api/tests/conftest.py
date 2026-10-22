import pytest
from fastapi import Header
from httpx import ASGITransport, AsyncClient

from app.core.auth import get_authenticated_user_id, get_optional_authenticated_user_id
from app.main import app


@pytest.fixture
async def async_client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


@pytest.fixture(autouse=True)
def default_test_auth(request):
    """Provide authenticated dependency override for functional/unit tests, bypassing in test_auth_security."""
    if "test_auth_security" in request.node.nodeid:
        yield
        return

    def mock_get_authenticated_user_id(
        authorization: str | None = Header(default=None),
        x_user_id: str | None = Header(default=None, alias="X-User-Id"),
    ) -> str:
        if authorization and authorization.startswith("Bearer "):
            token = authorization.split("Bearer ")[1].strip()
            if token and not token.startswith("invalid_"):
                return token
        if x_user_id:
            return x_user_id
        return "user_default_test"

    def mock_get_optional_authenticated_user_id(
        authorization: str | None = Header(default=None),
        x_user_id: str | None = Header(default=None, alias="X-User-Id"),
    ) -> str | None:
        if authorization is None and x_user_id is None:
            return None
        return mock_get_authenticated_user_id(authorization=authorization, x_user_id=x_user_id)

    app.dependency_overrides[get_authenticated_user_id] = mock_get_authenticated_user_id
    app.dependency_overrides[get_optional_authenticated_user_id] = mock_get_optional_authenticated_user_id
    yield
    app.dependency_overrides.pop(get_authenticated_user_id, None)
    app.dependency_overrides.pop(get_optional_authenticated_user_id, None)
