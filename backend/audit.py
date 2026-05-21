import logging
from database import get_db

logger = logging.getLogger(__name__)


async def audit(actor: str, action: str, details: str = "") -> None:
    """Log a significant action to the audit log."""
    try:
        async with get_db() as db:
            await db.execute(
                "INSERT INTO audit_log (actor, action, details) VALUES (?, ?, ?)",
                (actor, action, details[:500] if details else ""),
            )
            await db.commit()
    except Exception as exc:
        logger.warning("Audit log write failed: %s", exc)
