import uuid

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/orders", tags=["orders"])


class OrderItem(BaseModel):
    item_id: str
    quantity: int = Field(gt=0, description="Quantity must be greater than zero")
    unit_price: float = Field(gt=0.0, description="Unit price must be positive")


class OrderCreate(BaseModel):
    customer_id: str
    customer_tier: str = Field(
        default="standard", description="standard, premium, or enterprise"
    )
    items: list[OrderItem]


class OrderResponse(BaseModel):
    id: str
    customer_id: str
    customer_tier: str
    subtotal: float
    discount_amount: float
    total_amount: float
    status: str


# In-memory store for orders
ORDERS_DB = {}


TIER_RATES = {
    "standard": 0.0,
    "premium": 0.10,
    "enterprise": 0.20,
}


def calculate_discount(customer_tier: str, subtotal: float) -> float:
    """Tier discount. Tier names arrive from many clients in any casing, so they
    are normalised; unknown tiers get no discount."""
    rate = TIER_RATES.get(customer_tier.strip().lower(), 0.0)
    return round(subtotal * rate, 2)


@router.post("", response_model=OrderResponse, status_code=status.HTTP_201_CREATED)
async def create_order(order: OrderCreate):
    subtotal = round(sum(item.quantity * item.unit_price for item in order.items), 2)
    discount = calculate_discount(order.customer_tier, subtotal)
    total = round(subtotal - discount, 2)

    order_id = f"ord-{uuid.uuid4().hex[:8]}"
    record = OrderResponse(
        id=order_id,
        customer_id=order.customer_id,
        customer_tier=order.customer_tier,
        subtotal=subtotal,
        discount_amount=discount,
        total_amount=total,
        status="confirmed",
    )
    ORDERS_DB[order_id] = record
    return record


@router.get("", response_model=list[OrderResponse])
async def list_orders():
    return list(ORDERS_DB.values())


@router.get("/{order_id}", response_model=OrderResponse)
async def get_order(order_id: str):
    if order_id not in ORDERS_DB:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Order not found"
        )
    return ORDERS_DB[order_id]
