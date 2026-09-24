import logging
import re

logger = logging.getLogger(__name__)


def _matches(patterns: list[str], text: str) -> bool:
    for pattern in patterns:
        try:
            if re.search(pattern, text, re.IGNORECASE):
                return True
        except re.error:
            logger.warning("Skipping malformed guardrail regex: %r", pattern)
    return False


def check_input(patterns: list[str], text: str) -> str | None:
    """Returns a refusal message if text matches a forbidden pattern, else None.
    Pure regex, case-insensitive, no I/O, zero added latency/cost."""
    if _matches(patterns, text):
        return "This request can't be handled by this agent — it matches a configured guardrail."
    return None


def check_output(patterns: list[str], text: str) -> bool:
    """True if output violates a guardrail. Caller decides how to flag it
    (can't retroactively un-send an already-streamed response)."""
    return _matches(patterns, text)
