import contextlib
import io
import json
import unittest
from unittest.mock import patch
import compose


class ComposeTests(unittest.TestCase):
    def test_only_firebase_is_forwarded(self):
        settings = {'firebase': {'serviceAccount': {'type': 'service_account', 'project_id': 'synthetic'}},
                    'yandexDiskBackup': {'repositoryPassword': 'synthetic-backup-secret'}}
        with patch('sys.argv', ['compose.py', 'up', '-d']), \
             patch.object(compose.Path, 'read_text', return_value=json.dumps(settings)), \
             patch.object(compose.Path, 'is_file', return_value=True), \
             patch.dict(compose.os.environ, {}, clear=True), \
             patch.object(compose.subprocess, 'run') as run:
            run.return_value.returncode = 0
            self.assertEqual(compose.main(), 0)
            args, options = run.call_args
            self.assertIn('deploy/backup/compose.backup.yml', args[0])
            self.assertEqual(json.loads(options['env']['FCM_SERVICE_ACCOUNT_JSON']), settings['firebase']['serviceAccount'])
            self.assertNotIn('synthetic-backup-secret', str(options['env']))

    def test_config_dump_is_rejected(self):
        with patch('sys.argv', ['compose.py', 'config']), contextlib.redirect_stderr(io.StringIO()), \
             patch.object(compose.subprocess, 'run') as run:
            self.assertEqual(compose.main(), 2)
            run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
