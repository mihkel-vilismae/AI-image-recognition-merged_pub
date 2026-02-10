from pathlib import Path

from fastapi.testclient import TestClient

from app.main import SIGNALING_RELAY_FILE, create_app


def test_webrtc_relay_info_creates_and_returns_server_py(monkeypatch) -> None:
    app = create_app()
    client = TestClient(app)

    if SIGNALING_RELAY_FILE.exists():
        SIGNALING_RELAY_FILE.unlink()

    response = client.get('/webrtc/relay-info')
    assert response.status_code == 200

    payload = response.json()
    assert payload['relayPath'].endswith('server.py')
    assert payload['relayExists'] is True
    assert any('python server.py' in cmd for cmd in payload['runCommands'])
    assert SIGNALING_RELAY_FILE.exists()


def test_webrtc_network_falls_back_to_loopback(monkeypatch) -> None:
    import app.main as main

    monkeypatch.setattr(main, '_discover_local_ips', lambda: [])

    app = create_app()
    client = TestClient(app)
    response = client.get('/webrtc/network')

    assert response.status_code == 200
    payload = response.json()
    assert payload['ipCandidates'] == ['127.0.0.1']
    assert payload['selectedIp'] == '127.0.0.1'
    assert payload['warning'] is True


def test_webrtc_phone_publisher_returns_html_with_ws_url(monkeypatch) -> None:
    import app.main as main

    monkeypatch.setattr(main, '_discover_local_ips', lambda: ['192.168.1.20', '10.0.0.5'])

    app = create_app()
    client = TestClient(app)
    response = client.get('/webrtc/phone-publisher')

    assert response.status_code == 200
    payload = response.json()
    assert payload['selectedIp'] == '10.0.0.5'
    assert payload['warning'] is False
    assert 'ws://10.0.0.5:8765' in payload['html']
    assert 'btnFront' in payload['html']
    assert 'btnBack' in payload['html']
    assert 'id="log"' in payload['html']
    assert 'id="error"' in payload['html']
