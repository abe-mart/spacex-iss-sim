import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
import mimetypes
from unittest.mock import patch
import urllib.request
import urllib.error

from event_bridge import EventBridge


class BridgeTests(unittest.TestCase):
    def setUp(self):
        test_root = Path(__file__).resolve().parent.parent / '.dock-data' / 'tests'
        test_root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=test_root)
        if not Path(self.temp.name).resolve().is_relative_to(test_root.resolve()):
            raise RuntimeError('Test temporary files must stay in the workspace.')
        root = Path(self.temp.name)
        (root / 'sim').mkdir()
        (root / 'sim' / 'index.html').write_text('flight deck')
        self.helper = EventBridge('https://dock.test', open_browser=False, site_dir=root)
        self.helper.receipt_dir = root / 'receipts'

    def tearDown(self):
        self.helper.close()
        self.temp.cleanup()

    def request(self, path, body=None, token=True, origin=None):
        headers = {}
        if token:
            headers['X-Dock-Bridge'] = self.helper.token
        if origin:
            headers['Origin'] = origin
        req = urllib.request.Request(self.helper.url + path, data=None if body is None else json.dumps(body).encode(), headers=headers)
        with urllib.request.urlopen(req, timeout=3) as response:
            return json.load(response)

    def test_requires_pairing_and_matching_origin(self):
        for kwargs in ({'token':False},{'origin':'https://evil.test'}):
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.request('/api/state', **kwargs)
            self.assertIn(error.exception.code,(401,403))

    def test_static_assets_ignore_incorrect_machine_mime_types(self):
        files={
            'sim/js/three/three.js':'text/javascript',
            'sim/js/three/WebGL.js':'text/javascript',
            'assets/flight.js':'text/javascript',
            'assets/chunks/module.mjs':'text/javascript',
            'assets/flight.css':'text/css',
            'assets/test.json':'application/json',
            'assets/test.wasm':'application/wasm',
        }
        for name in files:
            path=self.helper.site_dir/name
            path.parent.mkdir(parents=True,exist_ok=True)
            path.write_bytes(b'/* test asset */')
        mimetypes.init()
        with patch.dict(mimetypes.types_map,{'.js':'text/plain','.mjs':'text/plain','.css':'text/plain','.json':'text/plain','.wasm':'text/plain'}):
            for name,expected in files.items():
                with self.subTest(asset=name),urllib.request.urlopen(self.helper.url+'/'+name,timeout=3) as response:
                    self.assertEqual(response.headers.get_content_type(),expected)
                    self.assertEqual(response.headers['X-Content-Type-Options'],'nosniff')
                    self.assertEqual(response.read(),b'/* test asset */')

    def test_command_round_trip_keeps_familiar_state_result(self):
        self.request('/bridge/sync', {'state':{'status':'flying','time_s':0},'results':[],'meta':{'started':True,'ready':True}})
        result = []
        def send():
            result.append(self.request('/api/command', {'command':'yaw_left','count':2}))
        worker = threading.Thread(target=send)
        worker.start()
        commands = []
        for _ in range(20):
            commands = self.request('/bridge/sync', {'state':{'status':'flying'},'results':[],'meta':{'started':True,'ready':True}})['commands']
            if commands:
                break
            time.sleep(.02)
        self.assertEqual(commands[0]['command'],'yaw_left')
        self.request('/bridge/sync', {'state':{'status':'flying','time_s':1},'results':[{'id':commands[0]['id'],'ok':True,'command':'yaw_left','state':{'time_s':1}}],'meta':{'ready':True}})
        worker.join(2)
        self.assertEqual(result[0]['state']['time_s'],1)

    def test_rejects_unsafe_commands(self):
        for command in ({'command':'gravity_off'},{'command':'step','seconds':1000},{'command':'yaw_left','count':True}):
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.request('/api/command',command)
            self.assertEqual(error.exception.code,400)

    def test_helpers_use_separate_ports_and_stop_cleanly(self):
        with EventBridge('https://dock.test', open_browser=False, site_dir=self.helper.site_dir) as second:
            self.assertNotEqual(second.url,self.helper.url)
            self.assertNotEqual(second.token,self.helper.token)
        self.assertTrue(second.closed)

    def test_only_agent_track_accepts_pause_and_step(self):
        for command in ({'command':'pause'}, {'command':'step','seconds':.5}):
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.request('/api/command',command)
            self.assertEqual(error.exception.code,400)
            self.assertIn('real time',error.exception.read().decode())
        self.helper.close()
        self.helper=EventBridge('https://dock.test',track='agent',open_browser=False,site_dir=self.helper.site_dir)
        for command in ({'command':'pause'}, {'command':'step','seconds':.5}):
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.request('/api/command',command)
            # Valid for this track, but a participant has not launched yet.
            self.assertEqual(error.exception.code,409)


if __name__ == '__main__':
    unittest.main()
