from .auth import LoginRequest, LoginResponse, LocalRestaurantCreate, RestaurantCreate, RestaurantResponse
from .beverages import BeverageCaricoCreate, BeverageCaricoItem, BeverageDailyUpsert
from .diagnostics import FrontendDiagnosticsPayload, FrontendErrorPayload
from .documents import (
    ChiusuraCreate,
    ChiusuraPiattiUpload,
    FatturaGlobaleCreate,
    FatturaUpload,
    InvoiceCreate,
    InvoiceResponse,
    VersamentoCreate,
)
from .laboratory import (
    DocumentScanAnalyzeRequest,
    DocumentScanFeedback,
    DocumentScanFeedbackRow,
    PastaAnnotationDecision,
)
from .orders import DeletionLog, ModificationLog, OrderCreate, OrderResponse, OrderUpdate
from .report import CashDailyUpsert, PastaDictionaryUpsert
from .warehouse import (
    CaricoCreate,
    CaricoItem,
    CaricoUpdate,
    ProductCreate,
    ProductQuantityUpdate,
    ProductUpdate,
    RichiestaCreate,
    RichiestaErrorReport,
    RichiestaItem,
    RichiestaReceptionConfirm,
)


__all__ = [
    "BeverageCaricoCreate",
    "BeverageCaricoItem",
    "BeverageDailyUpsert",
    "CaricoCreate",
    "CaricoItem",
    "CaricoUpdate",
    "CashDailyUpsert",
    "ChiusuraCreate",
    "ChiusuraPiattiUpload",
    "DeletionLog",
    "DocumentScanAnalyzeRequest",
    "DocumentScanFeedback",
    "DocumentScanFeedbackRow",
    "PastaAnnotationDecision",
    "FatturaGlobaleCreate",
    "FatturaUpload",
    "FrontendDiagnosticsPayload",
    "FrontendErrorPayload",
    "InvoiceCreate",
    "InvoiceResponse",
    "LocalRestaurantCreate",
    "LoginRequest",
    "LoginResponse",
    "ModificationLog",
    "OrderCreate",
    "OrderResponse",
    "OrderUpdate",
    "PastaDictionaryUpsert",
    "ProductCreate",
    "ProductQuantityUpdate",
    "ProductUpdate",
    "RestaurantCreate",
    "RestaurantResponse",
    "RichiestaCreate",
    "RichiestaErrorReport",
    "RichiestaItem",
    "RichiestaReceptionConfirm",
    "VersamentoCreate",
]
