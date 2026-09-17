#!/usr/bin/env python3
"""Host-side backup worker. Secrets stay in settings.local.json and memory.

Public control directory contains only validated policy, requests and summaries.
Never run this against a developer/production DB for tests: tests use fakes.
"""
import argparse
import contextlib
import datetime as dt
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

from yandex_rest import Yandex, RemoteError, NoRedirect, bridge

UTC = dt.timezone.utc
DEFAULTS = dict(enabled=False, intervalHours=6, timezone='Europe/Moscow', recentDays=2,
                dailyDays=30, weeklyDays=90, monthlyDays=365, limitGiB=450, dailyTime='')


class Failure(Exception):
    pass


def now():
    return dt.datetime.now(UTC)


def stamp(value=None):
    return (value or now()).isoformat()


def parse_time(value):
    result = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('timezone_required')
    return result


def policy(value):
    if isinstance(value, dict):
        value = dict(value)
        value.setdefault('dailyTime', '')
    if not isinstance(value, dict) or set(value) != set(DEFAULTS):
        raise Failure('invalid_policy')
    if type(value['enabled']) is not bool or not isinstance(value['timezone'], str):
        raise Failure('invalid_policy')
    if not isinstance(value['dailyTime'], str) or (value['dailyTime'] and not re.fullmatch(r'(?:[01][0-9]|2[0-3]):[0-5][0-9]', value['dailyTime'])):
        raise Failure('invalid_policy')
    for key in ('intervalHours', 'recentDays', 'dailyDays', 'weeklyDays', 'monthlyDays', 'limitGiB'):
        if type(value[key]) is not int:
            raise Failure('invalid_policy')
    if value['intervalHours'] not in (1, 3, 6, 12, 24) or not 1 <= value['recentDays'] < value['dailyDays'] < value['weeklyDays'] < value['monthlyDays'] <= 3650 or not 1 <= value['limitGiB'] <= 500:
        raise Failure('invalid_policy')
    try:
        ZoneInfo(value['timezone'])
    except (ValueError, KeyError):
        raise Failure('invalid_policy') from None
    return value


def next_due(settings, success, at):
    if not settings.get('dailyTime'):
        return parse_time(success) + dt.timedelta(hours=settings['intervalHours']) if success else at
    zone = ZoneInfo(settings['timezone'])
    hour, minute = map(int, settings['dailyTime'].split(':'))
    local = at.astimezone(zone)
    due = local.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if success and parse_time(success) >= due.astimezone(UTC):
        due += dt.timedelta(days=1)
    return due.astimezone(UTC)


def original_name(value):
    # Legacy uploads may have names other than current random hex IDs. Preserve
    # all flat regular originals, but never follow paths or cache directories.
    return isinstance(value, str) and bool(value) and value not in ('.', '..', '.previews-v1', '.storage-trash') and not any(c in value for c in ('/', '\\', '\x00'))


def retained(snapshots, settings, at):
    """Disjoint age bands: all recent, newest/calendar day, ISO week, month, year.

    Always retain newest snapshot, including after long outages. Use IDs only;
    never ask restic to forget arbitrary caller-supplied paths or broad groups.
    """
    zone = ZoneInfo(settings['timezone'])
    keep, buckets = set(), set()
    ordered = sorted(snapshots, key=lambda s: parse_time(s['time']), reverse=True)
    for index, snapshot in enumerate(ordered):
        when = parse_time(snapshot['time'])
        age = (at - when).total_seconds() / 86400
        local = when.astimezone(zone)
        if age < settings['recentDays']:
            keep.add(snapshot['id'])
            continue
        if age < settings['dailyDays']:
            bucket = ('day', local.date())
        elif age < settings['weeklyDays']:
            bucket = ('week', local.isocalendar()[:2])
        elif age < settings['monthlyDays']:
            bucket = ('month', local.year, local.month)
        else:
            bucket = ('year', local.year)
        if index == 0 or bucket not in buckets:
            keep.add(snapshot['id'])
        buckets.add(bucket)
    return keep


def read_json(path, fallback=None):
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0))
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > 4 * 1024**2:
            os.close(fd)
            raise Failure('invalid_json')
        with os.fdopen(fd, encoding='utf-8-sig') as handle:
            return json.load(handle)
    except FileNotFoundError:
        return fallback
    except (ValueError, OSError):
        raise Failure('invalid_json') from None


def write_json(path, value):
    # Atomic replacement, including if the old destination is a symlink.
    temporary = path.with_name(path.name + '.tmp-' + os.urandom(8).hex())
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o640)
    os.fchmod(fd, 0o640) if hasattr(os, 'fchmod') else None
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            json.dump(value, handle, ensure_ascii=True)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def find_secret(config):
    matches = []
    def visit(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if key == 'yandexDiskBackup':
                    matches.append(child)
                else:
                    visit(child)
    visit(config)
    if len(matches) != 1 or not isinstance(matches[0], dict):
        raise Failure('missing_backup_settings')
    return matches[0]


def command(args, *, env=None, output=None, timeout=3600):
    # Never forward subprocess output/errors: they may include DSNs, paths,
    # signed URLs, tokens or contents of dump diagnostics.
    try:
        result = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=output or subprocess.PIPE,
                                stderr=subprocess.DEVNULL, env=env, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise Failure('command_failed') from None
    if result.returncode:
        raise Failure('command_failed')
    return result.stdout if output is None else b''


class Worker:
    def __init__(self, settings_file, control, runtime, recovery=False):
        self.control, self.runtime = Path(control), Path(runtime)
        if not self.control.is_absolute() or not self.runtime.is_absolute():
            raise Failure('absolute_paths_required')
        for path in (self.control, self.runtime):
            if path.is_symlink():
                raise Failure('unsafe_directory')
            path.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.secret = find_secret(read_json(Path(settings_file)))
        self.settings = DEFAULTS.copy() if recovery else policy(read_json(self.control / 'policy.json', DEFAULTS.copy()))
        # Deployment-only settings are never accepted from the web interface.
        self.app = self.secret.get('appContainer', 'chatfamily-app-1')
        self.postgres = self.secret.get('postgresContainer', 'chatfamily-postgres-1')
        for name in (self.app, self.postgres):
            if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}', name):
                raise Failure('invalid_container')
        self.state = {} if recovery else read_json(self.control / 'status.json', {})

    @contextlib.contextmanager
    def locked(self):
        import fcntl  # Host runner is Linux-only; pure policy tests are portable.
        fd = os.open(self.runtime / 'worker.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise Failure('already_running') from None
            yield
        finally:
            os.close(fd)

    def publish(self, **changes):
        self.state.update(changes)
        self.state['heartbeat'] = stamp()
        write_json(self.control / 'status.json', self.state)

    def restic(self, *args):
        return command(['restic', '--no-cache', '--compression', 'off', '-o', 'rest.connections=2',
                        *args], env=self.environment)

    @contextlib.contextmanager
    def repository(self):
        token = self.secret.get('accessToken', '')
        password = self.secret.get('repositoryPassword', '')
        if not isinstance(token, str) or not token or not isinstance(password, str) or len(password) < 24:
            raise Failure('credentials_incomplete')
        self.remote = Yandex(token, limit=self.settings['limitGiB'] * 1024**3)
        self.remote.probe()
        with bridge(self.remote) as url:
            # Explicit environment allowlist; never inherit RESTIC_* overrides.
            self.environment = {key: value for key, value in os.environ.items() if key in ('PATH', 'SYSTEMROOT', 'TEMP', 'TMP', 'HOME')}
            self.environment.update(RESTIC_REPOSITORY=url, RESTIC_PASSWORD=password, GOMAXPROCS='1', GOMEMLIMIT='192MiB')
            try:
                yield
            finally:
                self.environment.clear()

    def snapshots(self):
        items = json.loads(self.restic('snapshots', '--json')) or []
        # Dedicated repository: refuse rotation if a foreign snapshot is found.
        for item in items:
            if item.get('hostname') != 'chatfamily' or 'chatfamily-v1' not in item.get('tags', []) or not re.fullmatch(r'[a-f0-9]{64}', item.get('id', '')):
                raise Failure('foreign_snapshot')
            parse_time(item['time'])
        return items

    def inventory(self):
        items = self.snapshots()
        self.publish(snapshots=[dict(id=s['id'], time=s['time']) for s in sorted(items, key=lambda s: s['time'], reverse=True)],
                     bytes=self.remote.usage(), ready=True)
        return items

    def recover(self):
        marker = self.runtime / 'resume.json'
        if marker.exists():
            value = read_json(marker)
            if value != {'app': self.app}:
                raise Failure('invalid_resume_marker')
            command(['docker', 'start', self.app], timeout=120)
            for attempt in range(20):
                try:
                    command(['docker', 'exec', self.app, 'wget', '-q', '-T', '3', '-O', '/dev/null', 'http://127.0.0.1:8080/healthz'], timeout=10)
                    break
                except Failure:
                    time.sleep(1)
            else:
                raise Failure('application_resume_unhealthy')
            marker.unlink()

    def discard_stage(self):
        stage = self.runtime / 'snapshot'
        if stage.is_symlink():
            raise Failure('unsafe_staging_directory')
        if stage.exists():
            shutil.rmtree(stage)

    def capture(self):
        # Hard upper bound on planned downtime on Linux. The timer is cancelled
        # before recovery; an interrupted dump is never published as a snapshot.
        def expired(signum, frame):
            raise Failure('capture_timeout')
        timed = hasattr(signal, 'SIGALRM')
        previous = signal.signal(signal.SIGALRM, expired) if timed else None
        if timed:
            signal.alarm(180)
        try:
            return self.capture_stopped()
        finally:
            if timed:
                signal.alarm(0)
                signal.signal(signal.SIGALRM, previous)
            self.recover()

    def capture_stopped(self):
        # The fixed staging directory is owned by this worker, never user input.
        stage = self.runtime / 'snapshot'
        if stage.exists():
            raise Failure('staging_exists')  # Preserve interrupted capture for diagnosis.
        app = json.loads(command(['docker', 'inspect', self.app], timeout=30))[0]
        if not app['State']['Running']:
            raise Failure('application_not_running')
        mounts = [m for m in app['Mounts'] if m['Destination'] == '/app/uploads']
        if len(mounts) != 1:
            raise Failure('uploads_mount_missing')
        source = Path(mounts[0]['Source'])
        if not source.is_absolute() or source.is_symlink() or not source.is_dir():
            raise Failure('unsafe_uploads')
        stage.mkdir(mode=0o700)
        marker = self.runtime / 'resume.json'
        write_json(marker, {'app': self.app})
        try:
            command(['docker', 'stop', '--time', '30', self.app], timeout=90)
            # No writes/cleanup in the app while taking DB + originals snapshot.
            files = []
            total = 0
            for entry in source.iterdir():
                if entry.name in ('.previews-v1', '.storage-trash'):
                    continue
                if entry.is_symlink() or not entry.is_file() or not original_name(entry.name):
                    raise Failure('unrecognized_upload')
                total += entry.stat().st_size
                files.append(entry)
            # Reserve 1 GiB for DB and system. Low disk never triggers deletion.
            db_size = int(command(['docker', 'exec', self.postgres, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'familychat', '-d', 'familychat',
                                   '-Atc', 'SELECT pg_database_size(current_database());'], timeout=30).decode().strip())
            if db_size < 0 or shutil.disk_usage(self.runtime).free < total + db_size + 1024**3:
                raise Failure('insufficient_staging_space')
            references = command(['docker', 'exec', self.postgres, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'familychat', '-d', 'familychat',
                                  '-Atc', 'SELECT object_key FROM attachments WHERE message_id IS NOT NULL AND deleted_at IS NULL UNION SELECT avatar_key FROM users WHERE avatar_key IS NOT NULL;'], timeout=30).decode().splitlines()
            available = {entry.name for entry in files}
            if any(key not in available for key in references):
                raise Failure('referenced_original_missing')
            with (stage / 'database.dump').open('xb') as handle:
                command(['docker', 'exec', self.postgres, 'pg_dump', '-U', 'familychat', '-d', 'familychat', '-Fc'], output=handle)
            # Actual archive parse, not just an exit code or nonempty file.
            with (stage / 'database.dump').open('rb') as handle:
                result = subprocess.run(['docker', 'exec', '-i', self.postgres, 'pg_restore', '--list'],
                                        stdin=handle, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=300)
                if result.returncode:
                    raise Failure('invalid_dump')
            uploads = stage / 'uploads'
            uploads.mkdir(mode=0o700)
            for entry in files:
                shutil.copy2(entry, uploads / entry.name)
            # Capture deployment files only from the root-owned configured path.
            launch = Path(self.secret.get('deploymentDirectory', '/opt/chatfamily'))
            if not launch.is_absolute() or launch.is_symlink():
                raise Failure('invalid_deployment_directory')
            target = stage / 'launch'
            target.mkdir(mode=0o700)
            for name in ('docker-compose.yml', 'docker-compose.production.yml', '.env', 'Caddyfile',
                         'deploy/compose.py', 'deploy/backup/compose.backup.yml'):
                path = launch / name
                if path.is_symlink():
                    raise Failure('unsafe_launch_file')
                if path.is_file():
                    (target / name).parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                    shutil.copy2(path, target / name)
            runtime = stage / 'application'
            runtime.mkdir(mode=0o700)
            command(['docker', 'cp', self.app + ':/usr/local/bin/familychat', str(runtime / 'familychat')], timeout=120)
            command(['docker', 'cp', self.app + ':/app/web', str(runtime / 'web')], timeout=120)
            recipe = launch / 'deploy' / 'Dockerfile.runtime'
            if not recipe.is_file() or recipe.is_symlink():
                raise Failure('runtime_recipe_missing')
            shutil.copy2(recipe, runtime / 'Dockerfile.runtime')
            write_json(stage / 'manifest.json', dict(format=1, capturedAt=stamp(), imageID=app['Image'],
                                                    originalCount=len(files), originalBytes=total))
        finally:
            # Caller resumes after cancelling the capture deadline; systemd also
            # performs recovery if the entire process is killed.
            pass
        return stage

    def backup(self):
        self.restic('unlock')  # Only stale locks; never --remove-all.
        self.remote.usage()  # Missing repository fails; never silently reinitialize.
        self.restic('check')
        self.publish(phase='capture')
        try:
            stage = self.capture()
            self.publish(phase='upload')
            before = {s['id'] for s in self.snapshots()}
            self.restic('backup', '--host', 'chatfamily', '--tag', 'chatfamily-v1', '--pack-size', '16', str(stage))
            self.restic('check')
            items = self.snapshots()
            new = [s for s in items if s['id'] not in before]
            if len(new) != 1:
                raise Failure('snapshot_not_confirmed')
            # Download/decrypt a sampled data subset on every run; full restore
            # remains a separate isolated operational exercise, not claimed here.
            self.restic('check', '--read-data-subset=5%')
            self.publish(lastSuccess=stamp(), verifiedAt=stamp())
            keep = retained(items, self.settings, now())
            remove = [s['id'] for s in items if s['id'] not in keep]
            if remove:
                self.publish(phase='retention')
                self.restic('forget', *remove)
                self.restic('prune', '--max-repack-size', '0')
            self.inventory()
        finally:
            # If resuming failed, leave staging untouched for recovery.
            if not (self.runtime / 'resume.json').exists():
                self.discard_stage()

    def restore_check(self):
        """Restore newest snapshot into an isolated, networkless PostgreSQL.

        No application container is started against it, so no notifications,
        migrations or external effects. Production DB is never a restore target.
        """
        items = self.snapshots()
        if not items:
            raise Failure('no_snapshot')
        latest = max(items, key=lambda item: parse_time(item['time']))['id']
        stats = json.loads(self.restic('stats', latest, '--mode', 'restore-size', '--json'))
        size = int(stats['total_size'])
        if shutil.disk_usage(self.runtime).free < size + 1024**3:
            raise Failure('insufficient_restore_space')
        target = Path(tempfile.mkdtemp(prefix='restore-', dir=self.runtime))
        container = None
        try:
            self.restic('restore', latest, '--target', str(target), '--verify')
            dumps = list(target.rglob('database.dump'))
            if len(dumps) != 1 or dumps[0].is_symlink():
                raise Failure('invalid_restored_snapshot')
            base = dumps[0].parent
            manifest = read_json(base / 'manifest.json')
            uploads = base / 'uploads'
            if not uploads.is_dir() or uploads.is_symlink() or len(list(uploads.iterdir())) != manifest['originalCount']:
                raise Failure('restored_files_mismatch')
            if sum(entry.stat().st_size for entry in uploads.iterdir()) != manifest['originalBytes']:
                raise Failure('restored_files_mismatch')
            image = json.loads(command(['docker', 'inspect', self.postgres], timeout=30))[0]['Image']
            if not re.fullmatch(r'sha256:[a-f0-9]{64}', image):
                raise Failure('invalid_postgres_image')
            # Bounded tmpfs: a large database fails the drill safely instead of
            # exhausting host disk. Raise the bound only after capacity review.
            container = command(['docker', 'create', '--network', 'none', '--log-driver', 'none', '--memory', '256m', '--cpus', '0.5',
                                 '--label', 'chatfamily.backup-restore-test=true',
                                 '--tmpfs', '/var/lib/postgresql/data:rw,size=192m',
                                 '-e', 'POSTGRES_USER=familychat', '-e', 'POSTGRES_DB=familychat',
                                 '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', image], timeout=60).decode().strip()
            if not re.fullmatch(r'[a-f0-9]{64}', container):
                container = None
                raise Failure('invalid_test_container')
            write_json(self.runtime / 'restore-container.json', {'id': container})
            command(['docker', 'start', container], timeout=60)
            for attempt in range(30):
                try:
                    command(['docker', 'exec', container, 'pg_isready', '-U', 'familychat'], timeout=10)
                    break
                except Failure:
                    time.sleep(1)
            else:
                raise Failure('test_postgres_not_ready')
            with dumps[0].open('rb') as handle:
                result = subprocess.run(['docker', 'exec', '-i', container, 'pg_restore', '--exit-on-error',
                                         '--no-owner', '--no-acl', '-U', 'familychat', '-d', 'familychat'],
                                        stdin=handle, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=900)
            if result.returncode:
                raise Failure('restore_database_failed')
            command(['docker', 'exec', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'familychat', '-d', 'familychat',
                     '-Atc', 'SELECT count(*) FROM users; SELECT count(*) FROM messages; SELECT count(*) FROM schema_migrations;'], timeout=60)
            keys = command(['docker', 'exec', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'familychat', '-d', 'familychat',
                            '-Atc', 'SELECT object_key FROM attachments WHERE message_id IS NOT NULL AND deleted_at IS NULL UNION SELECT avatar_key FROM users WHERE avatar_key IS NOT NULL;'], timeout=60).decode().splitlines()
            for key in keys:
                if not original_name(key) or (uploads / key).is_symlink() or not (uploads / key).is_file():
                    raise Failure('referenced_original_missing')
            self.publish(lastRestoreCheck=stamp())
        finally:
            if container:
                self.cleanup_restore_container()
            if target.parent == self.runtime and target.name.startswith('restore-') and not target.is_symlink():
                shutil.rmtree(target)

    def cleanup_restore_container(self):
        path = self.runtime / 'restore-container.json'
        marker = read_json(path)
        if marker is None:
            return
        identifier = marker.get('id', '')
        if not re.fullmatch(r'[a-f0-9]{64}', identifier):
            raise Failure('unsafe_test_container')
        existing = command(['docker', 'ps', '-a', '--no-trunc', '-q', '--filter', 'id=' + identifier], timeout=30).decode().splitlines()
        if not existing:
            path.unlink()
            return
        info = json.loads(command(['docker', 'inspect', identifier], timeout=30))[0]
        if info['Config'].get('Labels', {}).get('chatfamily.backup-restore-test') != 'true':
            raise Failure('unsafe_test_container')
        command(['docker', 'rm', '-f', identifier], timeout=60)
        path.unlink()

    def cleanup_restore_dirs(self):
        # These names can only be produced inside the root-owned scratch dir.
        for path in self.runtime.glob('restore-*'):
            if path.is_dir() and not path.is_symlink() and re.fullmatch(r'restore-[a-z0-9_]{8}', path.name):
                shutil.rmtree(path)

    def export(self, destination):
        target = Path(destination)
        if not target.is_absolute() or target.exists() or target.is_symlink() or not target.parent.is_dir():
            raise Failure('restore_target_must_be_new_absolute_directory')
        with self.repository():
            items = self.snapshots()
            if not items:
                raise Failure('no_snapshot')
            latest = max(items, key=lambda item: parse_time(item['time']))['id']
            target.mkdir(mode=0o700)
            # Operator-only extraction. Never runs pg_restore on the live DB.
            self.restic('restore', latest, '--target', str(target), '--verify')

    def notify(self, action, ok):
        url = self.secret.get('alertWebhookUrl')
        if not url or action not in ('run', 'restore-check'):
            return
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
            self.publish(alertError=True)
            return
        try:
            payload = json.dumps(dict(service='chatfamily-backup', action=action, ok=ok, at=stamp())).encode()
            request = urllib.request.Request(url, data=payload, headers={'Content-Type':'application/json'}, method='POST')
            with urllib.request.build_opener(NoRedirect).open(request, timeout=15) as response:
                response.read(1024)
            self.publish(alertError=False)
        except Exception:
            self.publish(alertError=True)

    def execute(self, action):
        start = stamp()
        self.publish(running=True, phase=action, error='', startedAt=start)
        ok = False
        try:
            if action == 'check':
                # Works before an encryption key/repository is configured.
                Yandex(self.secret.get('accessToken', '')).probe()
                self.publish(connectionOK=True, connectionCheckedAt=stamp())
            else:
                with self.repository():
                    if action == 'init':
                        # Explicit CLI-only init; restic refuses an existing repo.
                        self.restic('init')
                        self.inventory()
                    elif action == 'verify':
                        self.restic('check', '--read-data')
                        self.inventory()
                        self.publish(fullCheckAt=stamp())
                    elif action == 'restore-check':
                        self.publish(lastRestoreAttempt=stamp())
                        self.restore_check()
                    else:
                        self.backup()
            ok = True
        except Exception as exc:
            code = str(exc) if isinstance(exc, Failure) else 'remote_or_backup_failed'
            self.publish(error=code, connectionOK=False if action == 'check' else self.state.get('connectionOK', False))
        finally:
            history = self.state.get('history', [])[-99:]
            history.append(dict(at=start, finishedAt=stamp(), action=action, ok=ok))
            self.publish(running=False, phase='idle', history=history, lastAttempt=stamp())
            self.notify(action, ok)
        return ok

    def tick(self):
        self.recover()
        self.cleanup_restore_container()
        self.cleanup_restore_dirs()
        self.discard_stage()  # Leftovers of an interrupted attempt, not a backup.
        self.publish(running=False, phase='idle')
        request_path = self.control / 'request.json'
        request = read_json(request_path)
        if request is not None:
            # Consume before running: a crash must never repeat a manual action.
            action = request.get('action') if isinstance(request, dict) else None
            if action in ('run', 'check'):
                self.publish(running=True, phase='queued')
                request_path.unlink()
                self.execute(action)
            else:
                request_path.unlink()
            return
        last = self.state.get('lastAttempt')
        success = self.state.get('lastSuccess')
        due = next_due(self.settings, success, now())
        # Failed runs retry after 30 minutes, not every timer tick.
        retry_ok = not last or now() - parse_time(last) >= dt.timedelta(minutes=30)
        self.publish(nextRun=stamp(due) if self.settings['enabled'] else None)
        if self.settings['enabled'] and due <= now() and retry_ok:
            if self.execute('run'):
                checked = self.state.get('lastRestoreCheck')
                tried = self.state.get('lastRestoreAttempt')
                if (not checked or now() - parse_time(checked) > dt.timedelta(days=30)) and (not tried or now() - parse_time(tried) > dt.timedelta(days=1)):
                    self.execute('restore-check')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=('tick', 'run', 'check', 'init', 'verify', 'restore-check', 'recover', 'export'))
    parser.add_argument('--settings', default='/opt/chatfamily/settings.local.json')
    parser.add_argument('--control', default='/var/lib/chatfamily-backup/control')
    parser.add_argument('--runtime', default='/var/lib/chatfamily-backup/runtime')
    parser.add_argument('--target', help='New directory for operator-only export')
    args = parser.parse_args()
    os.umask(0o077)
    try:
        worker = Worker(args.settings, args.control, args.runtime, recovery=args.action == 'recover')
        with worker.locked():
            if args.action == 'recover':
                worker.recover()
                worker.cleanup_restore_container()
                worker.cleanup_restore_dirs()
            elif args.action == 'tick':
                worker.tick()
            elif args.action == 'export':
                if not args.target:
                    raise Failure('target_required')
                worker.export(args.target)
            else:
                return 0 if worker.execute(args.action) else 1
        return 0
    except Exception:
        # Deliberately no exception strings/tracebacks from credential loaders.
        print('backup_worker_failed', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
