import importlib.util
import os
from pathlib import Path
import sys
import types
import socketserver
import unittest
from unittest.mock import patch, MagicMock

if os.name == 'nt':
    sys.modules['fcntl'] = types.SimpleNamespace(flock=lambda *_: None, LOCK_EX=2)
spec = importlib.util.spec_from_file_location('mail_service', Path(__file__).with_name('service.py'))
service = importlib.util.module_from_spec(spec)
with patch.object(socketserver, 'UnixStreamServer', socketserver.TCPServer, create=True):
    spec.loader.exec_module(service)

class MailTests(unittest.TestCase):
    def setUp(self):
        self.config = {'host': 'smtp.example.test', 'port': 587, 'tls': 'starttls',
                       'username': 'synthetic', 'password': 'synthetic-password',
                       'from': 'noreply@example.test', 'enabled': False, 'verifyRegistration': False}
        self.settings = {'mail': dict(self.config), 'unrelated': {'preserve': True}}
        def update(transform):
            transform(self.settings)
            return dict(self.settings['mail'])
        self.writer = patch.object(service, 'settings_update', side_effect=update)
        self.writer.start()
        service.SEND_TIMES.clear()

    def tearDown(self):
        self.writer.stop()

    def test_secrets_never_returned(self):
        self.config['testedFingerprint'] = service.fingerprint(self.config)
        public = service.public_config(self.config)
        self.assertNotIn('password', public)
        self.assertNotIn('testedFingerprint', public)
        self.assertTrue(public['passwordConfigured'])
        self.assertTrue(public['tested'])

    def test_enable_requires_successful_test_and_edit_invalidates_it(self):
        with self.assertRaises(ValueError):
            service.save_config({'enabled': True})
        self.settings['mail']['testedFingerprint'] = service.fingerprint(self.config)
        service.save_config({'enabled': True, 'verifyRegistration': True})
        with self.assertRaises(ValueError):
            service.save_config({'host': 'changed.example.test'})
        service.save_config({'enabled': False, 'verifyRegistration': False, 'host': 'changed.example.test'})
        self.assertEqual(self.settings['mail']['testedFingerprint'], '')
        self.assertEqual(self.settings['mail']['password'], 'synthetic-password')
        self.assertTrue(self.settings['unrelated']['preserve'])

    def test_tls_and_address_validation(self):
        with self.assertRaises(ValueError):
            service.validate_config({**self.config, 'tls': 'none'})
        for address in ['bad\r\nBcc: hidden@example.test', 'Person <a@example.test>', 'invalid']:
            self.assertFalse(service.valid_address(address))

    def test_starttls_before_login_and_send(self):
        client = MagicMock()
        client.__enter__.return_value = client
        with patch.object(service.smtplib, 'SMTP', return_value=client):
            service.send(self.config, 'recipient@example.test', 'Synthetic test', 'Synthetic body')
        names = [call[0] for call in client.mock_calls]
        self.assertLess(names.index('starttls'), names.index('login'))
        self.assertLess(names.index('login'), names.index('send_message'))
        client.starttls.assert_called_once()

if __name__ == '__main__':
    unittest.main()
