from app.main import _network_urls_for_ips


def test_network_urls_filters_loopback_and_link_local() -> None:
    urls = _network_urls_for_ips(
        ["127.0.0.1", "169.254.10.2", "192.168.1.15", "10.0.0.22", "192.168.1.15"],
        8000,
    )

    assert urls == ["http://10.0.0.22:8000", "http://192.168.1.15:8000"]
