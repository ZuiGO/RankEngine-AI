from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import ValidationError
import sys

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    REDIS_URL: str
    MONGODB_URI: str
    LLM_API_KEY: str
    PLAYWRIGHT_HEADLESS: bool = True
    # Comma-separated browser origins permitted to call the health endpoint.
    WORKER_ALLOWED_ORIGINS: str = ""

def load_settings() -> Settings:
    try:
        return Settings()
    except ValidationError as e:
        print("❌ Worker Environment validation failed. Please check your configuration:")
        for error in e.errors():
            # Extract configuration field name
            field = " -> ".join(str(loc_item) for loc_item in error["loc"])
            print(f"   - [{field}]: {error['msg']}")
        sys.exit(1)

settings = load_settings()
