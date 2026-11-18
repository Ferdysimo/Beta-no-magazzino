import ast
import math
import re
from typing import Optional, Tuple


MAX_EXPRESSION_LENGTH = 200
MAX_EXPRESSION_NODES = 100
MAX_EXPRESSION_DEPTH = 20
_ALLOWED_CHARS_RE = re.compile(r"^[\d+\-*/.() \t\r\n]*$")
_HTML_TAG_RE = re.compile(r"<[^>]*>")


class UnsafeArithmeticExpression(ValueError):
    pass


def _evaluate_node(node: ast.AST, *, depth: int = 0, budget: list[int]) -> float:
    if depth > MAX_EXPRESSION_DEPTH:
        raise UnsafeArithmeticExpression("Espressione troppo complessa")
    budget[0] -= 1
    if budget[0] < 0:
        raise UnsafeArithmeticExpression("Espressione troppo complessa")

    if isinstance(node, ast.Expression):
        return _evaluate_node(node.body, depth=depth + 1, budget=budget)
    if isinstance(node, ast.Constant):
        if isinstance(node.value, bool) or not isinstance(node.value, (int, float)):
            raise UnsafeArithmeticExpression("Valore non numerico")
        value = float(node.value)
    elif isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
        operand = _evaluate_node(node.operand, depth=depth + 1, budget=budget)
        value = operand if isinstance(node.op, ast.UAdd) else -operand
    elif isinstance(node, ast.BinOp) and isinstance(
        node.op, (ast.Add, ast.Sub, ast.Mult, ast.Div)
    ):
        left = _evaluate_node(node.left, depth=depth + 1, budget=budget)
        right = _evaluate_node(node.right, depth=depth + 1, budget=budget)
        if isinstance(node.op, ast.Add):
            value = left + right
        elif isinstance(node.op, ast.Sub):
            value = left - right
        elif isinstance(node.op, ast.Mult):
            value = left * right
        else:
            if right == 0:
                raise UnsafeArithmeticExpression("Divisione per zero")
            value = left / right
    else:
        raise UnsafeArithmeticExpression("Operatore non consentito")

    if not math.isfinite(value):
        raise UnsafeArithmeticExpression("Risultato non finito")
    return value


def parse_arithmetic_expression(
    value,
    *,
    strip_html: bool = False,
) -> Optional[Tuple[str, float]]:
    """Validate and evaluate the Report arithmetic grammar without ``eval``.

    The accepted language intentionally matches the UI: decimal numbers,
    unary signs, +, -, *, / and parentheses. Exponentiation and floor division
    are rejected even though their characters individually belong to the old
    whitelist.
    """
    if value is None:
        return None
    expression = str(value)
    if strip_html and "<" in expression:
        expression = _HTML_TAG_RE.sub("", expression)
    expression = expression.strip().replace(",", ".")
    if expression.startswith("="):
        expression = expression[1:].strip()
    if not expression or len(expression) > MAX_EXPRESSION_LENGTH:
        return None
    if "**" in expression or "//" in expression:
        return None
    if not _ALLOWED_CHARS_RE.fullmatch(expression):
        return None
    try:
        tree = ast.parse(expression, mode="eval")
        result = _evaluate_node(
            tree,
            budget=[MAX_EXPRESSION_NODES],
        )
    except (SyntaxError, TypeError, ValueError, OverflowError, RecursionError):
        return None
    return expression, result


def safe_arithmetic_value(value, *, strip_html: bool = False) -> float:
    parsed = parse_arithmetic_expression(value, strip_html=strip_html)
    return parsed[1] if parsed is not None else 0.0
