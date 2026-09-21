#!/usr/bin/env python3
"""Host-only SMTP controller. Secrets stay in the root settings.local.json.

Unix socket only, no TCP listener, no request/exception logging. Run under the
provided systemd unit. The app container gets the socket, never settings.
"""
import email.message
import email.utils
import fcntl
import hashlib
import http.server
import json
import os
from pathlib import Path
import smtplib
import socketserver
import ssl
import stat
import socket
import threading
import time

ROOT = Path(__file__).resolve().parents[2]
SETTINGS = ROOT / 'settings.local.json'
SOCKET = Path(os.environ.get('MAIL_SOCKET', '/run/chatfamily-mail/control.sock'))
LOCK = threading.RLock()
SEND_LOCK = threading.Lock()
SEND_TIMES = []

def valid_address(value):
    if not isinstance(value, str) or len(value) > 254 or any(c in value for c in '\r\n'):
        return False
    name, address = email.utils.parseaddr(value)
    return not name and address == value and '@' in address

def fingerprint(config):
    fields = {k: config.get(k) for k in ('host', 'port', 'tls', 'username', 'password', 'from')}
    return hashlib.sha256(json.dumps(fields, sort_keys=True).encode()).hexdigest()

def settings_update(transform):
    # No second file containing secrets is ever created. Coordinate with other
    # host settings writers through an exclusive lock on the original file.
    fd = os.open(SETTINGS, os.O_RDWR | os.O_NOFOLLOW)
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_size > 4 * 1024**2:
        os.close(fd)
        raise ValueError('invalid settings')
    with LOCK, os.fdopen(fd, 'r+', encoding='utf-8-sig') as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        settings = json.load(stream)
        result = transform(settings)
        if result is not None:
            data = json.dumps(settings, ensure_ascii=False, indent=2)
            if len(data.encode('utf-8-sig')) > 4 * 1024**2:
                raise ValueError('invalid settings')
            stream.seek(0)
            stream.write(data)
            stream.truncate()
            stream.flush()
            os.fsync(stream.fileno())
        return dict(settings.get('mail', {}))

def read_config():
    return settings_update(lambda _: None)

def public_config(config):
    return {**{k: config.get(k, default) for k, default in (
        ('host', ''), ('port', 587), ('tls', 'starttls'), ('username', ''),
        ('from', ''), ('enabled', False), ('verifyRegistration', False),
        ('lastStatus', 'not-tested'))},
        'passwordConfigured': bool(config.get('password')),
        'tested': config.get('testedFingerprint') == fingerprint(config)}

def validate_config(config):
    host = config.get('host', '')
    if not isinstance(host, str) or not host or len(host) > 253 or any(c.isspace() or c in '/\\\r\n' for c in host):
        raise ValueError('invalid')
    if type(config.get('port')) is not int or not 1 <= config['port'] <= 65535:
        raise ValueError('invalid')
    if config.get('tls') not in ('starttls', 'tls') or not valid_address(config.get('from')):
        raise ValueError('invalid')
    for key in ('username', 'password'):
        if not isinstance(config.get(key, ''), str) or len(config.get(key, '')) > 1024:
            raise ValueError('invalid')
    if bool(config.get('username')) != bool(config.get('password')):
        raise ValueError('invalid')
    for key in ('enabled', 'verifyRegistration'):
        if type(config.get(key, False)) is not bool:
            raise ValueError('invalid')

def save_config(incoming):
    def transform(settings):
        previous = settings.get('mail', {})
        config = dict(previous)
        for key in ('host', 'port', 'tls', 'username', 'from', 'enabled', 'verifyRegistration'):
            if key in incoming:
                config[key] = incoming[key]
        if incoming.get('password'):
            config['password'] = incoming['password']
        if incoming.get('clearPassword') is True:
            config['password'] = ''
        validate_config(config)
        if fingerprint(config) != fingerprint(previous):
            config['testedFingerprint'] = ''
            config['lastStatus'] = 'not-tested'
        if config.get('enabled') and config.get('testedFingerprint') != fingerprint(config):
            raise ValueError('test-required')
        if config.get('verifyRegistration') and not config.get('enabled'):
            raise ValueError('test-required')
        settings['mail'] = config
        return True
    return settings_update(transform)

def send(config, to, subject, body):
    validate_config(config)
    if not valid_address(to) or not isinstance(subject, str) or any(c in subject for c in '\r\n') or len(subject) > 200 or not isinstance(body, str) or len(body) > 16000:
        raise ValueError('invalid')
    with SEND_LOCK:
        now = time.monotonic()
        SEND_TIMES[:] = [stamp for stamp in SEND_TIMES if stamp > now - 60]
        if len(SEND_TIMES) >= 30:
            raise ValueError('rate-limit')
        SEND_TIMES.append(now)
    message = email.message.EmailMessage()
    message['From'] = config['from']
    message['To'] = to
    message['Subject'] = subject
    message['Date'] = email.utils.formatdate(localtime=False)
    message['Message-ID'] = email.utils.make_msgid()
    message.set_content(body)
    context = ssl.create_default_context()
    started = time.monotonic()
    client = smtplib.SMTP_SSL(config['host'], config['port'], timeout=8, context=context) if config['tls'] == 'tls' else smtplib.SMTP(config['host'], config['port'], timeout=8)
    def abort():
        try:
            client.sock.shutdown(socket.SHUT_RDWR)
            client.close()
        except Exception:
            pass
    timer = threading.Timer(max(0.1, 15 - (time.monotonic() - started)), abort)
    timer.daemon = True
    timer.start()
    accepted = False
    try:
        with client:
            client.ehlo()
            if config['tls'] == 'starttls':
                client.starttls(context=context)
                client.ehlo()
            if config.get('username'):
                client.login(config['username'], config['password'])
            client.send_message(message)
            accepted = True
    except (smtplib.SMTPException, OSError):
        if not accepted:
            raise
    finally:
        timer.cancel()

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, code, value):
        data = json.dumps(value).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        try:
            if self.path != '/settings':
                return self.reply(404, {})
            self.reply(200, public_config(read_config()))
        except Exception:
            self.reply(503, {'error': 'Mail controller unavailable'})

    def do_POST(self):
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 65536:
                return self.reply(400, {'error': 'Invalid request'})
            incoming = json.loads(self.rfile.read(size))
            if self.path == '/settings':
                return self.reply(200, public_config(save_config(incoming)))
            if self.path not in ('/send', '/test'):
                return self.reply(404, {})
            config = read_config()
            if self.path == '/send' and not config.get('enabled'):
                return self.reply(503, {'error': 'Mail is disabled'})
            test = self.path == '/test'
            send(config, incoming.get('to'), 'ChatFamily: проверка почты' if test else incoming.get('subject'),
                 'Настройки SMTP ChatFamily работают.' if test else incoming.get('body'))
            def success(settings):
                current = settings.setdefault('mail', {})
                if fingerprint(current) == fingerprint(config):
                    current['lastStatus'] = 'sent'
                    if test:
                        current['testedFingerprint'] = fingerprint(config)
                return True
            config = settings_update(success)
            self.reply(200, public_config(config))
        except ValueError:
            self.reply(400, {'error': 'Check settings; save disabled configuration and send a test first'})
        except Exception:
            # Never include SMTP responses: they can contain recipients/secrets.
            try:
                def failed(settings):
                    settings.setdefault('mail', {})['lastStatus'] = 'failed'
                    return True
                settings_update(failed)
            except Exception:
                pass
            self.reply(503, {'error': 'SMTP delivery failed; check settings and network'})

class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True
    def handle_error(self, *_):
        pass

def main():
    SOCKET.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
    SOCKET.unlink(missing_ok=True)
    with Server(str(SOCKET), Handler) as server:
        os.chown(SOCKET, 0, int(os.environ.get('MAIL_APP_GID', '1000')))
        os.chmod(SOCKET, 0o660)
        server.serve_forever()

if __name__ == '__main__':
    main()
