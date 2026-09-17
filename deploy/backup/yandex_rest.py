"""Loopback-only restic REST v2 bridge to a Yandex application folder.

No OAuth secrets in URLs, files or logs. No access to disk:/, no recursive delete.
The caller owns the lifecycle; the bridge is never a public HTTP service.
"""
import base64
import contextlib
import hashlib
import hmac
import http.server
import json
import re
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

KINDS = ('data', 'index', 'keys', 'locks', 'snapshots')
HEX = re.compile(r'^[0-9a-f]{64}$')
MAX_BLOB = 64 * 1024 * 1024


class RemoteError(Exception):
    def __init__(self, status=502):
        self.status = status
        super().__init__('remote_request_failed')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Yandex:
    def __init__(self, token, root='chatfamily-restic-v1', limit=450 * 1024**3):
        if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,63}', root):
            raise ValueError('invalid_repository_name')
        self.token, self.root, self.limit = token, 'app:/' + root, limit
        self.opener = urllib.request.build_opener(NoRedirect)
        self.used = None
        self.write_lock = threading.Lock()

    def api(self, method, resource, **params):
        url = 'https://cloud-api.yandex.net/v1/disk/' + resource
        if params:
            url += '?' + urllib.parse.urlencode(params)
        for attempt in range(4):
            req = urllib.request.Request(url, method=method, headers={'Authorization': 'OAuth ' + self.token})
            try:
                with self.opener.open(req, timeout=45) as response:
                    raw = response.read(8 * 1024 * 1024)
                    return json.loads(raw) if raw else {}
            except urllib.error.HTTPError as exc:
                status = exc.code
                exc.close()
                if status not in (429, 500, 502, 503, 504) or attempt == 3:
                    raise RemoteError(status) from None
            except (OSError, ValueError):
                if attempt == 3:
                    raise RemoteError() from None
            time.sleep(2**attempt)

    def path(self, name):
        if name == 'config' or name in KINDS:
            return self.root + '/' + name
        parts = name.split('/')
        if len(parts) != 2 or parts[0] not in KINDS or not HEX.fullmatch(parts[1]):
            raise RemoteError(400)
        return self.root + '/' + name

    def probe(self):
        self.api('GET', 'resources', path='app:/', fields='type')
        try:
            self.api('GET', 'resources', path='disk:/', fields='type')
        except RemoteError as exc:
            if exc.status == 403:
                return
            raise
        raise RemoteError(403)  # Fail closed on a full-disk credential.

    def create(self):
        for path in [self.root] + [self.path(kind) for kind in KINDS]:
            try:
                self.api('PUT', 'resources', path=path)
            except RemoteError as exc:
                if exc.status != 409:
                    raise

    def stat(self, name):
        result = self.api('GET', 'resources', path=self.path(name), fields='size,type')
        if result.get('type') != 'file':
            raise RemoteError(404)
        return int(result['size'])

    def listing(self, kind):
        if kind not in KINDS:
            raise RemoteError(400)
        result, offset = [], 0
        while True:
            page = self.api('GET', 'resources', path=self.path(kind), limit=1000, offset=offset,
                            fields='_embedded.items.name,_embedded.items.size,_embedded.items.type,_embedded.total')
            items = page.get('_embedded', {}).get('items', [])
            for item in items:
                if item.get('type') != 'file' or not HEX.fullmatch(item.get('name', '')):
                    raise RemoteError(409)
                result.append({'name': item['name'], 'size': int(item['size'])})
            offset += len(items)
            if offset >= page.get('_embedded', {}).get('total', offset):
                return result
            if not items:
                raise RemoteError()

    def usage(self):
        total = self.stat('config')
        for kind in KINDS:
            total += sum(item['size'] for item in self.listing(kind))
        self.used = total
        return total

    def transfer(self, href, method, data=None, headers=None):
        # Signed storage URLs receive NO OAuth header. Reject redirects and
        # arbitrary destinations even if returned by a compromised API response.
        for redirect in range(4):
            parsed = urllib.parse.urlsplit(href)
            host = parsed.hostname or ''
            if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port not in (None, 443) or not any(
                    host.endswith('.' + suffix) for suffix in ('yandex.net', 'yandex.ru', 'yandex.com')):
                raise RemoteError()
            req = urllib.request.Request(href, data=data, method=method, headers=headers or {})
            try:
                return self.opener.open(req, timeout=120)
            except urllib.error.HTTPError as exc:
                location = exc.headers.get('Location')
                status = exc.code
                exc.close()
                if location and (status in (307, 308) or method == 'GET' and status in (301, 302, 303)):
                    href = urllib.parse.urljoin(href, location)
                    continue
                raise RemoteError() from None
            except (OSError, ValueError):
                raise RemoteError() from None
        raise RemoteError()

    def read(self, name, byte_range=None):
        info = self.api('GET', 'resources/download', path=self.path(name))
        return self.transfer(info['href'], 'GET', headers={'Range': byte_range} if byte_range else {})

    def save(self, name, content):
        if name != 'config' and '/' not in name:
            raise RemoteError(400)
        with self.write_lock:
            if self.used is not None and self.used + len(content) > self.limit:
                raise RemoteError(507)
            info = self.api('GET', 'resources/upload', path=self.path(name), overwrite='true')
            with self.transfer(info['href'], 'PUT', data=content) as response:
                response.read(1024)
            # API may acknowledge upload before metadata becomes available.
            digest = hashlib.sha256(content).hexdigest()
            for attempt in range(6):
                try:
                    meta = self.api('GET', 'resources', path=self.path(name), fields='size,sha256')
                    if int(meta.get('size', -1)) == len(content) and meta.get('sha256') == digest:
                        if self.used is not None:
                            self.used += len(content)  # Conservative until next full inventory.
                        return
                except RemoteError as exc:
                    if exc.status != 404:
                        raise
                time.sleep(2)
            raise RemoteError()

    def delete(self, name):
        if name == 'config' or '/' not in name:
            raise RemoteError(403)
        self.api('DELETE', 'resources', path=self.path(name), permanently='true')
        # Confirm asynchronous deletes before restic continues.
        for attempt in range(10):
            try:
                self.stat(name)
            except RemoteError as exc:
                if exc.status == 404:
                    return
                raise
            time.sleep(1)
        raise RemoteError()


@contextlib.contextmanager
def bridge(remote):
    password = secrets.token_hex(32)
    authorization = 'Basic ' + base64.b64encode(('backup:' + password).encode()).decode()

    class Handler(http.server.BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(30)

        def log_message(self, *args):
            pass

        def handle_request(self):
            self.close_connection = True
            if not hmac.compare_digest(self.headers.get('Authorization', ''), authorization):
                self.send_error(401)
                return
            parsed = urllib.parse.urlsplit(self.path)
            name = parsed.path.lstrip('/').rstrip('/')
            try:
                if self.command == 'POST' and not name and parsed.query == 'create=true':
                    remote.create()
                    self.reply(200)
                elif self.command == 'GET' and name in KINDS:
                    self.reply(200, json.dumps(remote.listing(name)).encode(), 'application/vnd.x.restic.rest.v2')
                elif self.command == 'HEAD':
                    size = remote.stat(name)
                    self.send_response(200)
                    self.send_header('Content-Length', str(size))
                    self.end_headers()
                elif self.command == 'GET':
                    byte_range = self.headers.get('Range')
                    if byte_range and not re.fullmatch(r'bytes=\d+-\d*', byte_range):
                        raise RemoteError(416)
                    with remote.read(name, byte_range) as response:
                        if byte_range and response.status != 206:
                            raise RemoteError()
                        self.send_response(response.status)
                        self.send_header('Content-Type', 'application/octet-stream')
                        for key in ('Content-Length', 'Content-Range'):
                            if response.headers.get(key):
                                self.send_header(key, response.headers[key])
                        self.end_headers()
                        while chunk := response.read(256 * 1024):
                            self.wfile.write(chunk)
                elif self.command == 'POST':
                    remote.path(name)
                    length = int(self.headers.get('Content-Length', '-1'))
                    if not 0 <= length <= MAX_BLOB or self.headers.get('Transfer-Encoding'):
                        raise RemoteError(413)
                    self.connection.settimeout(120)
                    content = self.rfile.read(length)
                    if len(content) != length:
                        raise RemoteError(400)
                    remote.save(name, content)
                    self.reply(200)
                elif self.command == 'DELETE':
                    remote.delete(name)
                    self.reply(200)
                else:
                    raise RemoteError(405)
            except RemoteError as exc:
                self.reply(exc.status if exc.status in (400, 401, 403, 404, 409, 413, 416, 429, 507) else 502)
            except Exception:
                self.reply(502)

        def reply(self, status, content=b'', content_type='application/octet-stream'):
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            self.wfile.write(content)

        do_GET = do_HEAD = do_POST = do_DELETE = handle_request

    server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f'rest:http://backup:{password}@127.0.0.1:{server.server_port}/'
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
