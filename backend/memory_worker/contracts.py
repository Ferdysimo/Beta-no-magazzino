from dataclasses import dataclass


MEMORY_SCHEMA_VERSION = 1
MEMORY_DATABASE_COLLECTIONS = (
    "memory_epochs",
    "memory_collector_leases",
    "memory_watermarks",
    "memory_raw_versions",
    "memory_order_facts",
    "memory_report_facts",
    "memory_warehouse_facts",
    "memory_configuration_versions",
    "memory_context_daily",
    "memory_daily_snapshots",
    "memory_gaps",
    "memory_quarantine",
    "memory_integrity_runs",
)


@dataclass(frozen=True)
class SourceContract:
    collection: str
    domain: str
    timestamp_candidates: tuple[str, ...]


SOURCE_CONTRACTS = (
    SourceContract("orders", "orders", ("updated_at", "created_at")),
    SourceContract("archived_orders", "orders", ("updated_at", "created_at")),
    SourceContract("deletion_logs", "orders", ("deleted_at", "original_created_at")),
    SourceContract(
        "archived_deletion_logs",
        "orders",
        ("deleted_at", "original_created_at"),
    ),
    SourceContract("modification_logs", "orders", ("modified_at", "created_at")),
    SourceContract(
        "archived_modification_logs",
        "orders",
        ("modified_at", "created_at"),
    ),
    SourceContract("cash_daily_counts", "report", ("updated_at", "date_rome")),
    SourceContract("beverage_daily_counts", "report", ("updated_at", "date_rome")),
    SourceContract("cash_audit_log", "report", ("last_at", "first_at")),
    SourceContract(
        "archived_beverage_sales",
        "report",
        ("created_at",),
    ),
    SourceContract("products", "warehouse", ("updated_at", "created_at")),
    SourceContract("stock_movements", "warehouse", ("timestamp",)),
    SourceContract("richieste", "warehouse", ("updated_at", "created_at")),
    SourceContract("carichi_magazzino", "warehouse", ("updated_at", "created_at")),
    SourceContract("beverage_inventory", "warehouse", ("updated_at",)),
    SourceContract("beverage_carichi", "warehouse", ("created_at",)),
    SourceContract("restaurants", "configuration", ("updated_at", "created_at")),
    SourceContract("pasta_dictionary", "configuration", ("updated_at", "created_at")),
    SourceContract("beverage_price_dictionary", "configuration", ("updated_at", "created_at")),
    SourceContract(
        "lab_pasta_annotation_aliases",
        "configuration",
        ("updated_at", "created_at"),
    ),
    SourceContract("beverages", "configuration", ()),
    SourceContract("suppliers", "configuration", ("updated_at", "created_at")),
)

SOURCE_COLLECTIONS = tuple(contract.collection for contract in SOURCE_CONTRACTS)
