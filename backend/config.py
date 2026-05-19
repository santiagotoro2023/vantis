import secrets
from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    SECRET_KEY: str = Field(default_factory=lambda: secrets.token_urlsafe(64))
    DB_PATH: str = "vantis.db"
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "qwen2.5:14b-instruct-q4_K_M"
    AI_NAME: str = "VANTIS"
    SELF_DIALOGUE_INTERVAL: int = 30
    EVOLUTION_INTERVAL_HOURS: int = 24
    SANDBOX_TIMEOUT: int = 60
    TLS_CERT_PATH: str = "/home/user/vantis/certs/cert.pem"
    TLS_KEY_PATH: str = "/home/user/vantis/certs/key.pem"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
