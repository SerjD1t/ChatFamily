import datetime as dt
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import urllib.request

from worker import DEFAULTS, Failure, Worker, find_secret, policy, retained, read_json, write_json, UTC
from yandex_rest import Yandex, RemoteError, bridge


class PolicyTests(unittest.TestCase):
    def test_policy(self):
        self.assertEqual(policy(DEFAULTS.copy()), DEFAULTS)
        for change in ({'enabled':1}, {'recentDays':30}, {'intervalHours':2}, {'limitGiB':501}, {'timezone':'../../bad'}):
            with self.assertRaises(Failure):
                policy(dict(DEFAULTS, **change))

    def test_progressive_bands(self):
        at=dt.datetime(2026,9,17,tzinfo=UTC)
        settings=dict(DEFAULTS, timezone='UTC')
        items=[{'id':str(i),'time':(at-dt.timedelta(hours=i*6)).isoformat()} for i in range(8*365)]
        keep=retained(items,settings,at)
        self.assertTrue(all(str(i) in keep for i in range(8)))
        self.assertLess(len(keep),65)
        self.assertGreater(len(keep),40)
        self.assertIn('0',keep)
        old=[{'id':'old','time':'2020-01-01T00:00:00Z'},{'id':'older','time':'2020-01-01T01:00:00Z'}]
        self.assertEqual(retained(old,settings,at),{'older'})

    def test_boundaries_timezone_and_future(self):
        at=dt.datetime(2026,9,17,tzinfo=UTC)
        values=[at-dt.timedelta(days=d) for d in (0,2,30,90,365,730)]
        items=[{'id':str(i),'time':v.isoformat()} for i,v in enumerate(values)]
        self.assertEqual(len(retained(items,DEFAULTS,at)),6)
        self.assertEqual(retained([{'id':'future','time':(at+dt.timedelta(days=1)).isoformat()}],DEFAULTS,at),{'future'})

    def test_secret_layout(self):
        secret={'accessToken':'synthetic'}
        self.assertIs(find_secret({'deployment':{'yandexDiskBackup':secret}}),secret)
        with self.assertRaises(Failure):
            find_secret({'a':{'yandexDiskBackup':secret},'yandexDiskBackup':secret})

    def test_paths_and_no_full_disk(self):
        remote=Yandex('synthetic')
        for path in ('../x','data/../../other','disk:/x','data/bad','config/x','/keys/'+'a'*64):
            with self.assertRaises(RemoteError):remote.path(path)
        self.assertEqual(remote.path('data/'+'a'*64),'app:/chatfamily-restic-v1/data/'+'a'*64)
        with patch.object(remote,'api',return_value={}):
            with self.assertRaises(RemoteError):remote.probe()
        for url in ('http://example.test','https://example.test','https://yandex.net.evil.test/file','https://user:password@yandex.net/file'):
            with self.assertRaises(RemoteError):remote.transfer(url,'GET')

    def test_atomic_public_json(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'policy.json'
            write_json(path,DEFAULTS);self.assertEqual(read_json(path),DEFAULTS)

    def test_failed_capture_never_rotates(self):
        with tempfile.TemporaryDirectory() as directory:
            w=Worker.__new__(Worker);w.runtime=Path(directory);w.settings=DEFAULTS.copy()
            operations=[]
            w.remote=type('Remote',(),{'usage':lambda self:0})()
            w.publish=lambda **kw:None
            w.restic=lambda *args:operations.append(args)
            w.capture=lambda:(_ for _ in ()).throw(Failure('synthetic'))
            with self.assertRaises(Failure):w.backup()
            self.assertEqual(operations,[('unlock',),('check',)])

    def test_snapshot_upload_failure_never_rotates(self):
        with tempfile.TemporaryDirectory() as directory:
            w=Worker.__new__(Worker);w.runtime=Path(directory);w.settings=DEFAULTS.copy()
            stage=w.runtime/'snapshot';stage.mkdir()
            operations=[]
            w.remote=type('Remote',(),{'usage':lambda self:0})();w.publish=lambda **kw:None
            def restic(*args):
                operations.append(args)
                if args[0]=='backup':raise Failure('synthetic')
            w.restic=restic;w.capture=lambda:stage;w.snapshots=lambda:[]
            with self.assertRaises(Failure):w.backup()
            self.assertFalse(any(op[0] in ('forget','prune') for op in operations))
            self.assertFalse(stage.exists())

    def test_recovery_never_removes_unlabelled_container(self):
        with tempfile.TemporaryDirectory() as directory:
            w=Worker.__new__(Worker);w.runtime=Path(directory);identifier='a'*64
            write_json(w.runtime/'restore-container.json',{'id':identifier})
            calls=[]
            def run(args,**kwargs):
                calls.append(args)
                return (identifier+'\n').encode() if args[1]=='ps' else b'[{"Config":{"Labels":{}}}]'
            with patch('worker.command',side_effect=run):
                with self.assertRaises(Failure):w.cleanup_restore_container()
            self.assertFalse(any(args[1]=='rm' for args in calls))

    def test_queue_is_consumed_once_without_automatic_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            w=Worker.__new__(Worker);w.control=Path(directory);w.runtime=Path(directory);w.settings=DEFAULTS.copy();w.state={}
            w.recover=lambda:None;w.cleanup_restore_container=lambda:None;w.cleanup_restore_dirs=lambda:None;w.discard_stage=lambda:None
            w.publish=lambda **kw:w.state.update(kw)
            actions=[];w.execute=lambda action:actions.append(action)
            write_json(w.control/'request.json',{'action':'check'})
            w.tick();w.tick();self.assertEqual(actions,['check'])

    def test_resume_even_when_capture_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);uploads=root/'uploads';uploads.mkdir()
            w=Worker.__new__(Worker);w.runtime=root/'runtime';w.runtime.mkdir();w.app='test-app';w.postgres='test-db';w.secret={}
            calls=[]
            def run(args,**kwargs):
                calls.append(args)
                if args[:2]==['docker','inspect']:
                    return json.dumps([{'State':{'Running':True},'Mounts':[{'Destination':'/app/uploads','Source':str(uploads)}]}]).encode()
                if 'psql' in args:return b'1024' if 'pg_database_size' in args[-1] else b''
                if 'pg_dump' in args:raise Failure('synthetic_dump_failure')
                return b''
            with patch('worker.command',side_effect=run):
                with self.assertRaises(Failure):w.capture()
            self.assertIn(['docker','start','test-app'],calls)
            self.assertFalse((w.runtime/'resume.json').exists())


class Response(io.BytesIO):
    def __init__(self,data,status=200,headers=None):
        super().__init__(data);self.status=status;self.headers=headers or {'Content-Length':str(len(data))}


class MemoryRemote:
    def __init__(self):self.files={}
    def path(self,name):return Yandex('synthetic').path(name)
    def create(self):pass
    def stat(self,name):
        self.path(name)
        if name not in self.files:raise RemoteError(404)
        return len(self.files[name])
    def listing(self,kind):return [{'name':k.split('/')[1],'size':len(v)} for k,v in self.files.items() if k.startswith(kind+'/')]
    def save(self,name,data):self.files[name]=data
    def delete(self,name):
        self.path(name)
        if name=='config' or '/' not in name:raise RemoteError(403)
        if name not in self.files:raise RemoteError(404)
        del self.files[name]
    def read(self,name,byte_range=None):
        self.stat(name);data=self.files[name]
        if byte_range:
            start,end=byte_range[6:].split('-');start=int(start);end=int(end) if end else len(data)-1
            return Response(data[start:end+1],206,{'Content-Length':str(end-start+1),'Content-Range':f'bytes {start}-{end}/{len(data)}'})
        return Response(data)


class BridgeTests(unittest.TestCase):
    def test_no_anonymous_access(self):
        with bridge(MemoryRemote()) as url:
            clean='http://'+url.split('@')[1]
            with self.assertRaises(urllib.error.HTTPError) as exc:urllib.request.urlopen(clean)
            self.assertEqual(exc.exception.code,401)

    @unittest.skipUnless(os.environ.get('RESTIC_TEST_BIN'),'Set RESTIC_TEST_BIN for real encrypted roundtrip')
    def test_real_restic_roundtrip(self):
        remote=MemoryRemote()
        with tempfile.TemporaryDirectory() as directory,bridge(remote) as url:
            root=Path(directory);source=root/'source';source.mkdir();(source/'synthetic.txt').write_text('Synthetic private content',encoding='utf8')
            env=dict(os.environ,RESTIC_REPOSITORY=url,RESTIC_PASSWORD='synthetic-test-key-not-for-production')
            def run(*args):
                result=subprocess.run([os.environ['RESTIC_TEST_BIN'],'--no-cache','--compression','off',*args],env=env,cwd=source,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=60)
                self.assertEqual(result.returncode,0,'restic command failed: '+args[0])
                return result.stdout
            run('init');run('backup','--host','chatfamily','--tag','chatfamily-v1','synthetic.txt');run('check','--read-data')
            snapshots=json.loads(run('snapshots','--json'));self.assertEqual(len(snapshots),1)
            run('restore','latest','--target',str(root/'restored'))
            restored=list((root/'restored').rglob('synthetic.txt'));self.assertEqual(len(restored),1);self.assertEqual(restored[0].read_text(),'Synthetic private content')
            self.assertTrue(all(b'Synthetic private content' not in content for content in remote.files.values()))
            run('forget',snapshots[0]['id']);run('prune');run('check')


if __name__=='__main__':unittest.main()
