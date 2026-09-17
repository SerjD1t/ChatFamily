"""Explicit integration smoke test: synthetic data in a unique app:/ repository.

Never copies production data. Deletes ONLY objects created in this unique test
repository. No credentials, signed URLs or raw subprocess output are printed.
"""
import argparse
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile

from worker import find_secret, read_json
from yandex_rest import Yandex, KINDS, RemoteError, bridge


def smoke(settings_path, restic):
    secret = find_secret(read_json(Path(settings_path)))
    root = 'chatfamily-smoke-' + secrets.token_hex(12)
    remote = Yandex(secret['accessToken'], root, limit=32 * 1024**2)
    remote.probe()
    # Verify this randomly generated path does not preexist before writing.
    try:
        remote.api('GET', 'resources', path=remote.root, fields='type')
    except RemoteError as exc:
        if exc.status != 404:
            raise
    else:
        raise RuntimeError('unexpected_existing_test_repository')
    success = False
    try:
        with tempfile.TemporaryDirectory(prefix='chatfamily-smoke-') as directory, bridge(remote) as url:
            local = Path(directory)
            payload = b'ChatFamily synthetic encrypted backup test\n'
            (local / 'synthetic.txt').write_bytes(payload)
            env = {key: value for key, value in os.environ.items() if key in ('PATH', 'SYSTEMROOT', 'TEMP', 'TMP', 'HOME')}
            env.update(RESTIC_REPOSITORY=url, RESTIC_PASSWORD=secrets.token_hex(32), GOMAXPROCS='1')
            def run(*args):
                print('SMOKE_PHASE_' + args[0].upper(), flush=True)
                result = subprocess.run([restic, '--no-cache', '--compression', 'off', '-o', 'rest.connections=1', *args],
                                        cwd=local, env=env, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=300)
                if result.returncode:
                    raise RuntimeError('restic_smoke_failed')
                return result.stdout
            run('init')
            run('backup', '--host', 'chatfamily-smoke', 'synthetic.txt')
            run('check', '--read-data')
            items = json.loads(run('snapshots', '--json'))
            if len(items) != 1:
                raise RuntimeError('unexpected_snapshots')
            run('restore', items[0]['id'], '--target', str(local / 'restored'))
            matches = list((local / 'restored').rglob('synthetic.txt'))
            if len(matches) != 1 or matches[0].read_bytes() != payload:
                raise RuntimeError('restore_mismatch')
            success = True
    finally:
        # List exact objects, reject any non-restic names. Do not use rclone
        # cleanup/purge or delete the app folder, even on failure.
        for kind in KINDS:
            try:
                items = remote.listing(kind)
            except RemoteError as exc:
                if exc.status == 404:
                    continue
                raise
            for item in items:
                remote.delete(kind + '/' + item['name'])
            if remote.listing(kind):
                raise RuntimeError('cleanup_not_empty')
            remote.api('DELETE', 'resources', path=remote.path(kind), permanently='true')
        try:
            remote.api('DELETE', 'resources', path=remote.path('config'), permanently='true')
        except RemoteError as exc:
            if exc.status != 404:
                raise
        # Server-side deletion can be asynchronous; root must be empty first.
        import time
        for attempt in range(10):
            meta = remote.api('GET', 'resources', path=remote.root, fields='_embedded.total')
            if meta.get('_embedded', {}).get('total') == 0:
                remote.api('DELETE', 'resources', path=remote.root, permanently='true')
                break
            time.sleep(1)
        else:
            raise RuntimeError('cleanup_incomplete')
    if success:
        print('YANDEX_ENCRYPTED_BACKUP_RESTORE_OK_TEST_OBJECTS_REMOVED')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--settings', required=True)
    parser.add_argument('--restic', required=True)
    args = parser.parse_args()
    try:
        smoke(args.settings, args.restic)
    except Exception:
        print('YANDEX_SMOKE_FAILED_OR_CLEANUP_INCOMPLETE')
        raise SystemExit(1)
