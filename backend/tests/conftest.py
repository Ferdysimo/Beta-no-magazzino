import asyncio


_ISOLATED_INTEGRATION_LOOP = asyncio.new_event_loop()


def run_isolated(coro):
    """Run Motor integration tests on one process-wide event loop."""
    return _ISOLATED_INTEGRATION_LOOP.run_until_complete(coro)


def pytest_sessionfinish(session, exitstatus):
    if not _ISOLATED_INTEGRATION_LOOP.is_closed():
        _ISOLATED_INTEGRATION_LOOP.close()
