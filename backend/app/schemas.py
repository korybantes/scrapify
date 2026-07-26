from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field, HttpUrl


class JobCreate(BaseModel):
    workspace_id: UUID
    source: str = Field(min_length=2, max_length=80)
    category_name: str = Field(min_length=2, max_length=160)
    category_url: HttpUrl
    start_page: int = Field(default=1, ge=1, le=1000)
    max_pages: int = Field(default=1, ge=1, le=100)
    download_images: bool = False
    auto_enrich: bool = False
    seo_language: str = Field(default="tr", pattern="^(tr|en|de|fr|es|pl|ar|it)$")


class JobRead(BaseModel):
    id: UUID
    source: str
    category_name: str
    category_url: str
    start_page: int
    max_pages: int
    status: str
    progress: int
    pages_completed: int
    products_found: int
    warning_count: int
    error: str | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None


class ProductPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    vendor: str | None = Field(default=None, max_length=250)
    category: str | None = Field(default=None, max_length=250)
    sale_price: Decimal | None = Field(default=None, ge=0)
    compare_at_price: Decimal | None = Field(default=None, ge=0)
    body_html: str | None = None
    tags: list[str] | None = None
    published: bool | None = None
    inventory_qty: int | None = Field(default=None, ge=0)


class IdList(BaseModel):
    workspace_id: UUID
    product_ids: list[UUID] = Field(min_length=1, max_length=250)
    language: str = Field(default="tr", pattern="^(tr|en|de|fr|es|pl|ar|it)$")
