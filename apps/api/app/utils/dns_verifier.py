"""Passive DNS MX verification utility supporting domain mail capability checks.

STRICT SAFETY POLICY:
- Validates passive DNS MX records only.
- Does NOT perform intrusive SMTP socket connection, RCPT TO commands, or mailbox probing.
- MX record presence proves domain mail capability only; it does NOT prove that an individual
  mailbox exists or can receive messages.
"""

import asyncio
import logging
from typing import Tuple

logger = logging.getLogger("jobFinder.utils.dns_verifier")

MX_DISCLAIMER = (
    "Passive DNS MX record lookup confirms that the domain is configured to receive mail. "
    "It does not verify individual mailbox existence or deliverability."
)


async def verify_domain_mx(domain_or_email: str, timeout_seconds: float = 2.0) -> Tuple[str, list[str]]:
    """Check if domain has active MX records.

    Returns:
        tuple of (status: 'VALID_MX' | 'NO_MX' | 'ERROR' | 'UNCHECKED', list of mx hosts)
    """
    if not domain_or_email or not isinstance(domain_or_email, str):
        return "UNCHECKED", []

    # Extract domain if full email was supplied
    raw = domain_or_email.strip()
    if "@" in raw:
        domain = raw.split("@")[-1].strip().lower()
    else:
        domain = raw.lower()

    # Basic domain sanity check
    if not domain or "." not in domain or len(domain) > 253:
        return "NO_MX", []

    try:
        import aiodns

        resolver = aiodns.DNSResolver(timeout=timeout_seconds)

        async def _query():
            if hasattr(resolver, "query_dns"):
                res = await resolver.query_dns(domain, "MX")
                # aiodns 4.x pycares.DNSResult
                hosts = []
                for record in getattr(res, "answer", []):
                    data = getattr(record, "data", None)
                    exchange = getattr(data, "exchange", None)
                    if exchange:
                        hosts.append(str(exchange).rstrip("."))
                return hosts
            else:
                res = await resolver.query(domain, "MX")
                return [str(getattr(r, "host", "")).rstrip(".") for r in res if getattr(r, "host", None)]

        hosts = await asyncio.wait_for(_query(), timeout=timeout_seconds)
        if hosts:
            return "VALID_MX", hosts
        return "NO_MX", []

    except asyncio.TimeoutError:
        logger.warning(f"DNS MX query timed out for domain: {domain}")
        return "ERROR", []
    except Exception as e:
        err_msg = str(e).lower()
        if "not found" in err_msg or "no answer" in err_msg or "does not exist" in err_msg or "nxdomain" in err_msg:
            return "NO_MX", []
        logger.warning(f"DNS MX query error for domain {domain}: {e}")
        return "ERROR", []
