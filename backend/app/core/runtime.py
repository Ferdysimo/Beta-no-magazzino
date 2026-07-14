from datetime import datetime, timezone

from app.core.config import git_commit_short


SERVER_STARTED_AT = datetime.now(timezone.utc)
SERVER_GIT_COMMIT = git_commit_short()
