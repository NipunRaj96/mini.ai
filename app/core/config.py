from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    jwt_secret_key: str

    @field_validator("jwt_secret_key")
    @classmethod
    def _jwt_secret_key_must_be_strong(cls, value: str) -> str:
        # No default exists (a missing env var already fails startup) -- this
        # guards the other way, a *present* but weak/short value that would
        # otherwise silently work and make every issued token brute-forceable.
        if len(value) < 32:
            raise ValueError("JWT_SECRET_KEY must be at least 32 characters")
        return value
    jwt_access_token_expire_minutes: int = 30
    jwt_refresh_token_expire_days: int = 30
    encryption_master_key: str
    google_oauth_client_id: str = ""
    google_oauth_client_secret: str = ""
    github_oauth_client_id: str = ""
    github_oauth_client_secret: str = ""
    miniai_system_groq_api_key: str = ""
    miniai_system_tavily_api_key: str = ""
    redis_url: str = "redis://localhost:6379"
    # Comma-separated origins the SPA is served from (Vite dev server by default).
    cors_origins: str = "http://localhost:5173"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
