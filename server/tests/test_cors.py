from fastapi.testclient import TestClient

from app.main import create_app


def test_health_allows_vite_dev_origins() -> None:
    app = create_app()
    client = TestClient(app)

    for origin in ("http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5174"):
        response = client.get("/health", headers={"Origin": origin})
        assert response.status_code == 200
        assert response.headers.get("access-control-allow-origin") == origin


def test_health_preflight_options_is_allowed() -> None:
    app = create_app()
    client = TestClient(app)

    response = client.options(
        "/health",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"
