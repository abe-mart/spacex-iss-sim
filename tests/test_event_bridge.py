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

import sys

from event_bridge import EventBridge

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'starter'))
import hackathon.client as hackathon_client  # noqa: E402

FLYING = {'status': 'flying', 'time_s': 1.0, 'position': {'x': 150.0, 'y': 2.0, 'z': -1.0}, 'velocity': {'x': -0.5, 'y': 0.0, 'z': 0.1},
          'attitude': {'roll': 1.0, 'pitch': -2.0, 'yaw': 3.0}, 'rotation_rate': {'roll': 0.1, 'pitch': 0.2, 'yaw': 0.3},
          'rotation_rate_commanded': {'roll': 0.0, 'pitch': 0.3, 'yaw': 0.3}, 'simulation_speed': 1}


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

    def test_no_track_accepts_pause_or_step(self):
        for track in ('autopilot', 'agent'):
            self.helper.close()
            self.helper = EventBridge('https://dock.test', track=track, open_browser=False, site_dir=self.helper.site_dir)
            for command in ({'command': 'pause'}, {'command': 'step', 'seconds': .5}):
                with self.assertRaises(urllib.error.HTTPError) as error:
                    self.request('/api/command', command)
                self.assertEqual(error.exception.code, 400)
                self.assertIn('real time', error.exception.read().decode())

    def sync(self, state, flight='f1', results=(), ready=True):
        meta = {'started': True, 'ready': ready, 'flight': flight, 'ranked': True}
        return self.request('/bridge/sync', {'state': state, 'results': list(results), 'meta': meta})['commands']

    def test_autopilot_url_requires_the_server_token(self):
        bad = hackathon_client.connect(self.helper.url + '/ap/' + '0' * 64)
        with self.assertRaises(hackathon_client.HackathonError):
            bad.request_telemetry()
        with self.assertRaises(ValueError):
            hackathon_client.connect('https://example.com/not-an-autopilot-url')

    def test_autopilot_reads_state_vector_and_fires_pulses(self):
        connection = hackathon_client.connect(self.helper.autopilot_url)
        self.assertEqual(connection.request_telemetry()['status'], 'offline')
        self.sync(FLYING)
        data = connection.request_telemetry()
        self.assertEqual((data['status'], data['flight_id'], data['timestamp_ms'], data['ranked']), ('flying', 'f1', 1000, True))
        self.assertEqual(data['state'], [150.0, 2.0, -1.0, -0.5, 0.0, 0.1, 1.0, -2.0, 3.0, 0.1, 0.2, 0.3])
        self.assertEqual(data['commanded_rates'], [0.0, 0.3, 0.3])

        reply = []
        worker = threading.Thread(target=lambda: reply.append(connection.send_control_inputs([1.4, -2.6, 0, 0, 0, 3])))
        worker.start()
        for _ in range(50):
            commands = self.sync(FLYING)
            if commands:
                break
            time.sleep(.02)
        self.assertEqual([(c['command'], c['count']) for c in commands], [('translate_backward', 1), ('translate_left', 3), ('yaw_left', 3)])
        applied = dict(FLYING, time_s=2.0)
        self.sync(applied, results=[{'id': c['id'], 'ok': True, 'state': applied} for c in commands])
        worker.join(2)
        self.assertEqual(reply[0], {'ok': True, 'timestamp_ms': 2000, 'pulses': [1, -3, 0, 0, 0, 3]})

        # Telemetry from before the inputs took effect is held back; newer telemetry is served.
        self.sync(dict(FLYING, time_s=1.5))
        self.assertEqual(connection.request_telemetry()['timestamp_ms'], 1000)
        self.sync(dict(FLYING, time_s=2.1))
        self.assertEqual(connection.request_telemetry()['timestamp_ms'], 2100)

    def test_finished_flight_is_reported_only_to_the_client_that_flew_it(self):
        pilot = hackathon_client.connect(self.helper.autopilot_url)
        self.sync(FLYING)
        self.assertEqual(pilot.request_telemetry()['status'], 'flying')
        self.sync(dict(FLYING, status='success', time_s=80.0, message='Docked.'), flight=None, ready=False)
        data = pilot.request_telemetry()
        self.assertEqual((data['status'], data['docked'], data['flight_id'], data['message']), ('docked', True, 'f1', 'Docked.'))
        newcomer = hackathon_client.connect(self.helper.autopilot_url)
        self.assertEqual(newcomer.request_telemetry()['status'], 'waiting')
        self.assertFalse(pilot.send_control_inputs([1, 0, 0, 0, 0, 0])['ok'])

if __name__ == '__main__':
    unittest.main()
