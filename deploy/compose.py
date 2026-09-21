#!/usr/bin/env python3
"""Production Compose entry point: pass only Firebase credentials in memory.

The root settings.local.json is never mounted into the web container. Backup
credentials remain host-only. Do not use `compose config`: it prints secrets.
"""
import json
import os
from pathlib import Path
import subprocess
import sys


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ('up', 'ps', 'stop', 'start', 'restart'):
        print('Allowed commands: up, ps, stop, start, restart', file=sys.stderr)
        return 2
    root = Path(__file__).resolve().parent.parent
    try:
        with (root / 'settings.local.json').open(encoding='utf-8-sig') as stream:
            if os.name == 'posix':
                import fcntl
                fcntl.flock(stream, fcntl.LOCK_SH)
            settings = json.load(stream)
        credentials = settings['firebase']['serviceAccount']
        if not isinstance(credentials, dict) or credentials.get('type') != 'service_account':
            raise ValueError()
        environment = os.environ.copy()
        environment['FCM_SERVICE_ACCOUNT_JSON'] = json.dumps(credentials)
        args = ['docker', 'compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.production.yml']
        if (root / 'deploy/backup/compose.backup.yml').is_file():
            args += ['-f', 'deploy/backup/compose.backup.yml']
        # Keep verification fail-closed if the installed controller is down.
        if Path('/etc/systemd/system/chatfamily-mail.service').is_file():
            args += ['-f', 'deploy/mail/compose.mail.yml']
        return subprocess.run(args + sys.argv[1:], cwd=root, env=environment, check=False).returncode
    except Exception:
        print('Compose setup failed; check protected settings without printing them', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
