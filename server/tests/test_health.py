from fastapi.testclient import TestClient

from app.main import create_app


def test_health_ok():
    app = create_app()
    client = TestClient(app)
    r = client.get("/health")
    assert r.status_code == 200
    payload = r.json()
    assert payload["ok"] is True
    assert payload["service"] == "ai-server"
    assert isinstance(payload.get("ts"), str)


def test_health_logs_request_hit(caplog):
    app = create_app()
    client = TestClient(app)

    with caplog.at_level("INFO"):
        response = client.get("/health", headers={"Origin": "http://localhost:5173", "User-Agent": "pytest-agent"})

    assert response.status_code == 200
    assert any("health_hit method=GET path=/health" in rec.message for rec in caplog.records)
