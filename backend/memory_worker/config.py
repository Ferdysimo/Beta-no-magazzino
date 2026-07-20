import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Mapping, Optional
from urllib.parse import urlsplit, urlunsplit


_DATABASE_NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class MemoryConfigurationError(RuntimeError):
    pass


def _as_bool(value: Optional[str], *, default: bool = False) -> bool:
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise MemoryConfigurationError(f"Valore booleano non valido: {value!r}")


def _as_int(
    value: Optional[str],
    *,
    default: int,
    minimum: int,
    maximum: int,
    name: str,
) -> int:
    try:
        parsed = default if value is None else int(value)
    except (TypeError, ValueError) as exc:
        raise MemoryConfigurationError(f"{name} deve essere numerico") from exc
    if not minimum <= parsed <= maximum:
        raise MemoryConfigurationError(
            f"{name} deve essere compreso tra {minimum} e {maximum}"
        )
    return parsed


def _validate_database_name(value: str, *, name: str) -> str:
    cleaned = value.strip()
    if not _DATABASE_NAME_RE.fullmatch(cleaned):
        raise MemoryConfigurationError(
            f"{name} deve contenere soltanto lettere, numeri, _ o -"
        )
    return cleaned


def redact_mongo_url(value: str) -> str:
    if not value:
        return "(non configurato)"
    parts = urlsplit(value)
    if not parts.scheme:
        return "(configurato, formato non mostrato)"
    hostname = parts.hostname or ""
    if parts.port:
        hostname = f"{hostname}:{parts.port}"
    return urlunsplit((parts.scheme, hostname, "", "", ""))


@dataclass(frozen=True)
class MemorySettings:
    enabled: bool
    write_enabled: bool
    dry_run: bool
    source_mongo_url: str
    source_db_name: str
    memory_mongo_url: str
    memory_db_name: str
    activation_epoch_utc: str
    poll_seconds: int
    batch_size: int
    overlap_seconds: int
    mongo_timeout_ms: int
    allow_unverified_mongo_roles: bool
    max_backoff_seconds: int
    circuit_breaker_failures: int
    max_source_latency_ms: int
    max_memory_storage_mb: int
    snapshot_interval_seconds: int

    @classmethod
    def from_env(
        cls,
        env: Optional[Mapping[str, str]] = None,
        *,
        require_connections: bool = False,
    ) -> "MemorySettings":
        values = os.environ if env is None else env
        enabled = _as_bool(values.get("MEMORY_ENABLED"), default=False)
        write_enabled = _as_bool(
            values.get("MEMORY_WRITE_ENABLED"),
            default=False,
        )
        dry_run = _as_bool(
            values.get("MEMORY_DRY_RUN"),
            default=False,
        )
        source_url = values.get("SOURCE_MONGO_URL", "").strip()
        memory_url = values.get("MEMORY_MONGO_URL", "").strip()
        source_db = values.get("SOURCE_DB_NAME", "").strip()
        memory_db = values.get("MEMORY_DB_NAME", "").strip()
        activation_epoch = values.get("MEMORY_ACTIVATION_EPOCH_UTC", "").strip()
        allow_unverified_roles = _as_bool(
            values.get("MEMORY_ALLOW_UNVERIFIED_MONGO_ROLES"),
            default=False,
        )

        if require_connections or enabled or write_enabled:
            missing = [
                name
                for name, value in (
                    ("SOURCE_MONGO_URL", source_url),
                    ("SOURCE_DB_NAME", source_db),
                    ("MEMORY_MONGO_URL", memory_url),
                    ("MEMORY_DB_NAME", memory_db),
                )
                if not value
            ]
            if missing:
                raise MemoryConfigurationError(
                    f"Configurazione incompleta: {', '.join(missing)}"
                )
            source_db = _validate_database_name(source_db, name="SOURCE_DB_NAME")
            memory_db = _validate_database_name(memory_db, name="MEMORY_DB_NAME")
            if source_db.casefold() == memory_db.casefold():
                raise MemoryConfigurationError(
                    "SOURCE_DB_NAME e MEMORY_DB_NAME devono essere diversi"
                )

        if write_enabled and not enabled:
            raise MemoryConfigurationError(
                "MEMORY_WRITE_ENABLED richiede MEMORY_ENABLED=true"
            )
        if write_enabled and not activation_epoch:
            raise MemoryConfigurationError(
                "Le scritture richiedono MEMORY_ACTIVATION_EPOCH_UTC esplicito"
            )
        if dry_run and write_enabled:
            raise MemoryConfigurationError(
                "MEMORY_DRY_RUN non puo essere combinato con scritture attive"
            )
        if dry_run and not enabled:
            raise MemoryConfigurationError(
                "MEMORY_DRY_RUN richiede MEMORY_ENABLED=true"
            )
        if activation_epoch:
            try:
                parsed_epoch = datetime.fromisoformat(
                    activation_epoch.replace("Z", "+00:00")
                )
            except ValueError as exc:
                raise MemoryConfigurationError(
                    "MEMORY_ACTIVATION_EPOCH_UTC deve essere una data ISO valida"
                ) from exc
            if parsed_epoch.tzinfo is None:
                raise MemoryConfigurationError(
                    "MEMORY_ACTIVATION_EPOCH_UTC deve includere il fuso orario"
                )
            activation_epoch = parsed_epoch.astimezone(timezone.utc).isoformat()

        return cls(
            enabled=enabled,
            write_enabled=write_enabled,
            dry_run=dry_run,
            source_mongo_url=source_url,
            source_db_name=source_db,
            memory_mongo_url=memory_url,
            memory_db_name=memory_db,
            activation_epoch_utc=activation_epoch,
            poll_seconds=_as_int(
                values.get("MEMORY_POLL_SECONDS"),
                default=60,
                minimum=30,
                maximum=3600,
                name="MEMORY_POLL_SECONDS",
            ),
            batch_size=_as_int(
                values.get("MEMORY_BATCH_SIZE"),
                default=50,
                minimum=1,
                maximum=100,
                name="MEMORY_BATCH_SIZE",
            ),
            overlap_seconds=_as_int(
                values.get("MEMORY_OVERLAP_SECONDS"),
                default=300,
                minimum=30,
                maximum=3600,
                name="MEMORY_OVERLAP_SECONDS",
            ),
            mongo_timeout_ms=_as_int(
                values.get("MEMORY_MONGO_TIMEOUT_MS"),
                default=2500,
                minimum=500,
                maximum=10000,
                name="MEMORY_MONGO_TIMEOUT_MS",
            ),
            allow_unverified_mongo_roles=allow_unverified_roles,
            max_backoff_seconds=_as_int(
                values.get("MEMORY_MAX_BACKOFF_SECONDS"),
                default=900,
                minimum=60,
                maximum=3600,
                name="MEMORY_MAX_BACKOFF_SECONDS",
            ),
            circuit_breaker_failures=_as_int(
                values.get("MEMORY_CIRCUIT_BREAKER_FAILURES"),
                default=5,
                minimum=1,
                maximum=20,
                name="MEMORY_CIRCUIT_BREAKER_FAILURES",
            ),
            max_source_latency_ms=_as_int(
                values.get("MEMORY_MAX_SOURCE_LATENCY_MS"),
                default=500,
                minimum=50,
                maximum=5000,
                name="MEMORY_MAX_SOURCE_LATENCY_MS",
            ),
            max_memory_storage_mb=_as_int(
                values.get("MEMORY_MAX_STORAGE_MB"),
                default=1024,
                minimum=32,
                maximum=102400,
                name="MEMORY_MAX_STORAGE_MB",
            ),
            snapshot_interval_seconds=_as_int(
                values.get("MEMORY_SNAPSHOT_INTERVAL_SECONDS"),
                default=900,
                minimum=300,
                maximum=86400,
                name="MEMORY_SNAPSHOT_INTERVAL_SECONDS",
            ),
        )

    def require_collection_activation(self) -> None:
        if not self.enabled or not self.write_enabled:
            raise MemoryConfigurationError(
                "La raccolta richiede MEMORY_ENABLED=true e "
                "MEMORY_WRITE_ENABLED=true"
            )
        if not self.activation_epoch_utc:
            raise MemoryConfigurationError(
                "La raccolta richiede MEMORY_ACTIVATION_EPOCH_UTC"
            )

    def safe_summary(self) -> dict:
        return {
            "enabled": self.enabled,
            "write_enabled": self.write_enabled,
            "dry_run": self.dry_run,
            "source": {
                "url": redact_mongo_url(self.source_mongo_url),
                "database": self.source_db_name or "(non configurato)",
            },
            "memory": {
                "url": redact_mongo_url(self.memory_mongo_url),
                "database": self.memory_db_name or "(non configurato)",
            },
            "activation_epoch_utc": self.activation_epoch_utc or None,
            "poll_seconds": self.poll_seconds,
            "batch_size": self.batch_size,
            "overlap_seconds": self.overlap_seconds,
            "mongo_timeout_ms": self.mongo_timeout_ms,
            "allow_unverified_mongo_roles": self.allow_unverified_mongo_roles,
            "max_backoff_seconds": self.max_backoff_seconds,
            "circuit_breaker_failures": self.circuit_breaker_failures,
            "max_source_latency_ms": self.max_source_latency_ms,
            "max_memory_storage_mb": self.max_memory_storage_mb,
            "snapshot_interval_seconds": self.snapshot_interval_seconds,
        }
