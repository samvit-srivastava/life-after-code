"""Regression test for inc-1793072930: tier names must be case/whitespace tolerant
and unknown tiers must get no discount instead of an HTTP 500."""


def _post_order(client, tier):
    payload = {
        "customer_id": "cust-regression",
        "customer_tier": tier,
        "items": [{"item_id": "sku-1", "quantity": 1, "unit_price": 100.0}],
    }
    try:
        return client.post("/api/v1/orders", json=payload)
    except Exception as exc:  # unhandled server error surfaces as an exception in TestClient
        raise AssertionError(
            f"POST /api/v1/orders crashed for customer_tier={tier!r}: {exc!r}"
        )


def test_inc_1793072930_tier_lookup_is_case_insensitive_and_defaults(client):
    cases = [
        ("Premium", 10.0, 90.0),
        ("ENTERPRISE", 20.0, 80.0),
        (" premium ", 10.0, 90.0),
        ("gold", 0.0, 100.0),
    ]
    for tier, expected_discount, expected_total in cases:
        response = _post_order(client, tier)
        assert response.status_code == 201, (tier, response.status_code)
        body = response.json()
        assert body["subtotal"] == 100.0, tier
        assert body["discount_amount"] == expected_discount, tier
        assert body["total_amount"] == expected_total, tier
