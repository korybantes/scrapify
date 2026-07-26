import json
from functools import lru_cache
from typing import Annotated

from pydantic import AliasChoices, BeforeValidator, Field
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


def _split_csv(value):
    if isinstance(value, str):
        value = value.strip()
        if value.startswith("["):
            return json.loads(value)
        return [item.strip() for item in value.split(",") if item.strip()]
    return value


CsvList = Annotated[list[str], NoDecode, BeforeValidator(_split_csv)]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = Field(validation_alias=AliasChoices("DATABASE_URL", "NEON_DB_URL"))
    groq_api_key: str | None = None
    groq_model: str = "llama-3.3-70b-versatile"
    scrappify_api_key: str | None = None
    allowed_origins: CsvList = ["http://localhost:3000"]
    allowed_source_hosts: CsvList = [
        "beymen.com",
        "www.beymen.com",
        "zaptila.com",
        "www.zaptila.com",
    ]
    worker_id: str = "scrappify-worker"
    poll_seconds: float = 2.0
    shopify_store_domain: str | None = None
    shopify_access_token: str | None = None
    shopify_api_version: str = "2026-07"


@lru_cache
def get_settings() -> Settings:
    return Settings()
