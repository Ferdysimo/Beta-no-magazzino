"""Compatibility entrypoint for Uvicorn and legacy imports.

Application composition lives in :mod:`app.bootstrap`; domain code must never
import this module.
"""

import asyncio

from app.core.config import (
    ALGORITHM,
    API_VERSION,
    MONGO_URL,
    ROOT_DIR,
    SECRET_KEY,
    SIMONE_MIN_TOKEN_VERSION,
    UPLOADS_DIR,
    git_commit_short,
)
from app.core.catalogs import BEVERAGES_CATALOG, UNITS_PER_CASE
from app.core.database import client, db
from app.core.deps import _effective_restaurant_id
from app.core.files import save_image_to_disk
from app.core.security import create_token, pwd_context, security, verify_token
from app.core.state import RESTAURANT_LOCATION_CACHE
from app.core.time import (
    ROME_TZ,
    _rome_date_bounds_utc,
    _rome_date_from_iso,
    _today_rome_bounds_utc,
    _today_rome_str,
    _today_rome_utc_range,
)
from app.core.ws_manager import ConnectionManager, manager
from app.schemas import (
    BeverageCaricoCreate,
    BeverageCaricoItem,
    BeverageDailyUpsert,
    BeveragePriceDictionaryUpsert,
    CaricoCreate,
    CaricoItem,
    CaricoUpdate,
    CashDailyUpsert,
    ChiusuraCreate,
    ChiusuraPiattiUpload,
    DeletionLog,
    FatturaGlobaleCreate,
    FatturaUpload,
    FrontendDiagnosticsPayload,
    FrontendErrorPayload,
    InvoiceCreate,
    InvoiceResponse,
    LocalRestaurantCreate,
    LoginRequest,
    LoginResponse,
    ModificationLog,
    OrderCreate,
    OrderResponse,
    OrderUpdate,
    PastaDictionaryUpsert,
    ProductCreate,
    ProductQuantityUpdate,
    ProductUpdate,
    RestaurantCreate,
    RestaurantResponse,
    RichiestaCreate,
    RichiestaErrorReport,
    RichiestaItem,
    VersamentoCreate,
)
from app.routers.orders import (
    complete_order,
    create_order,
    delete_order,
    get_daily_report,
    get_deletion_logs,
    get_modification_logs,
    get_next_order_number,
    get_order,
    get_orders,
    get_today_logs,
    get_today_paste_list,
    hide_from_generale,
    kitchen_complete_order,
    pause_timer,
    reset_timer,
    router as orders_router,
    start_timer,
    toggle_monitor_visibility,
    update_order,
)
from app.routers.analysis import (
    export_analisi_mensile_excel,
    export_media_locali_excel,
    get_media_locali,
    router as analysis_router,
)
from app.routers.report import (
    admin_audit_log,
    admin_audit_log_groups,
    admin_beverages_reset,
    admin_delete_mock_closures,
    admin_generate_mock_closures,
    admin_snapshot_today,
    closure_detail_admin,
    closure_yesterday,
    closures_grid_admin,
    get_beverage_daily_counts,
    get_beverage_daily_history,
    get_beverage_price_dictionary,
    get_cash_daily,
    get_pasta_dictionary,
    list_closures,
    reset_pasta_dictionary,
    reset_beverage_price_dictionary,
    router as report_router,
    upsert_beverage_daily,
    upsert_beverage_price_dictionary,
    upsert_cash_daily,
    upsert_pasta_dictionary,
)
from app.services.orders import _highest_order_number_today
from app.services.analysis import (
    ANALYSIS_CASH_EXPORT_COLUMNS,
    ANALYSIS_CASH_HEADER_FONT_SIZES,
    ANALYSIS_CASH_HEADER_STYLES,
    ANALYSIS_ORDER_SOURCES,
    PASTA_EXPORT_LABELS,
    PREFERRED_PASTA_EXPORT_ORDER,
    _analysis_beverage_label,
    _analysis_body_fill,
    _analysis_cash_body_fill,
    _analysis_cash_header_style,
    _analysis_group_fill,
    _analysis_group_font_color,
    _analysis_header_fill,
    _analysis_header_font_color,
    _analysis_money_number_format,
    _analysis_order_identity,
    _analysis_row_integrity,
    _analysis_short_pasta_label,
    _analysis_summary_response,
    _analysis_warning_counts,
    _analysis_year_days,
    _apply_analysis_sheet_basics,
    _build_annual_analysis_data,
    _build_paste_text_for_date,
    _collect_cursor_documents,
    _compute_paste_breakdown_for_export,
    _display_media_location,
    _ensure_analysis_integrity,
    _format_italian_long_date,
    _get_daily_order_count,
    _normalize_analysis_order_doc,
    _normalized_paste_text,
    _ordered_pasta_dict,
    _pasta_export_label,
    _paste_text_from_order_docs,
    _prefetch_analysis_order_data,
    _safe_sheet_title,
    _validate_export_year,
    _write_analysis_locale_sheet,
    _write_merged_group,
    _write_totali_sheet_for_analysis,
)
from app.services.report import (
    ALL_CASH_FIELDS,
    CASH_FIELDS,
    CASSETTO_FIELDS,
    CASSETTO_SPICCI_FIELD,
    PASTA_PRICES_MAP,
    SPICCI_FIELDS,
    SPICCI_MULTIPLIERS,
    _audit_diff_cash,
    _audit_log_change,
    _audit_user_info,
    _beverage_mattina_carry_fields,
    _build_closure_detail,
    _cash_cassetto_carry_fields,
    _cash_mattina_carry_fields,
    _compute_bev_total_eur,
    _compute_cash_sera,
    _compute_cash_sera_full,
    _compute_cash_sera_full_legacy_manual_prices,
    _compute_cassetto_total,
    _compute_paste_count,
    _compute_paste_total_eur,
    _compute_paste_total_eur_legacy_index_only,
    _compute_paste_unrecognized,
    _compute_spicci_total,
    _eval_cash_value,
    _format_report_number,
    _get_pasta_dict_for,
    _manual_price_for_paste_line,
    _manual_price_for_paste_line_legacy_index_only,
    _manual_price_key_for_line,
    _materialize_report_day_opening_for_restaurant,
    _normalize_audit_user_label,
    _orders_aggregate_for_date,
    _pasta_dict_from_snapshot,
    _pasta_dict_snapshot_fields,
    _pasta_dict_snapshot_from_map,
    _pasta_recognized_sigla,
    _payload_fields,
    _report_numbers_equal,
    _resolve_historical_mode,
    _should_create_pasta_dict_snapshot,
    _split_beverage_stock,
)
from app.services.beverage_prices import (
    _beverage_price_for_row,
    _beverage_price_snapshot_fields,
    _default_beverage_catalog,
    _freeze_existing_beverage_days,
    _get_beverage_catalog_for,
    _get_beverage_prices_for,
)
from app.services.report_snapshots import _snapshot_report_paste_text_for_date
from app.tasks.maintenance import (
    UPLOADS_RETENTION_DAYS,
    _atomic_archive_and_clear,
    cleanup_old_uploads,
)
from app.tasks.midnight import midnight_reset, midnight_scheduler
from app.tasks.stale_orders import recover_stale_orders

from app.bootstrap import (
    api_router,
    app,
    create_app,
    initialize_application,
    lifespan,
    shutdown_db_client,
    startup_scheduler,
)
from app.core.diagnostics import (
    api_call_log,
    api_error_log,
    diagnostics_middleware,
    frontend_device_state,
    frontend_error_log,
)
from app.core.rate_limit import limiter
from app.core.runtime import SERVER_GIT_COMMIT, SERVER_STARTED_AT
from app.routers.beverages import *
from app.routers.beverages import _get_flaminio_restaurant_id
from app.routers.documents import *
from app.routers.documents import (
    _enrich_global_invoice,
    _normalize_ddt_number,
    _parse_ddt_numbers,
    _require_admin,
)
from app.routers.invoices import *
from app.routers.system import *
from app.routers.upload_attempts import *
from app.routers.system import (
    _frontend_client_ip,
    _is_restaurant_frontend_entry,
    _record_frontend_heartbeat,
)
from app.routers.warehouse import *
from app.routers.warehouse import (
    LOCATION_ADDRESSES,
    MITTENTE_INFO,
    _apply_stock_delta,
    _enrich_richiesta,
    _get_next_ddt_number,
    _serialize_carico,
    _set_stock_absolute,
)
from app.routers.websocket import websocket_endpoint
from app.services.seeding import (
    _ensure_beverages_seeded,
)


# Compatibility alias retained for scripts that imported this value from server.
mongo_url = MONGO_URL
