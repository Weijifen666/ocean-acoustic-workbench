"""Exercise the real PowerShell preflight; never start a service or solver."""
import json, os, shutil, subprocess, sys, tempfile, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SHELL = shutil.which('powershell.exe') or shutil.which('pwsh')

@unittest.skipUnless(os.name == 'nt' and SHELL, 'Windows PowerShell launcher test')
class PublicLauncherTests(unittest.TestCase):
    def check(self, private_url='http://127.0.0.1:49555', site_origin='https://example.chatgpt.site'):
        with tempfile.TemporaryDirectory(prefix='ocean-launcher-') as folder:
            runtime = Path(folder)
            (runtime/'public-runtime.json').write_text(json.dumps({'site_origin':site_origin,
                'gateway_secret':'TEST-ONLY-LAUNCHER-CREDENTIAL','private_url':private_url}), encoding='utf-8')
            (runtime/'runtime.json').write_text(json.dumps({'python':sys.executable}), encoding='utf-8')
            env = dict(os.environ, OCEAN_RUNTIME_DIR=folder)
            env.pop('OCEAN_PRIVATE_URL', None)
            return subprocess.run([SHELL,'-NoProfile','-ExecutionPolicy','Bypass','-File',
                str(ROOT/'start-public.ps1'),'-CheckOnly','-NoBrowser'], env=env,
                capture_output=True, text=True, timeout=20)

    def test_preflight_uses_configured_port_without_starting_processes(self):
        result = self.check()
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data['private_url'], 'http://127.0.0.1:49555')
        self.assertFalse(data['processes_started'])
        self.assertNotIn('TEST-ONLY-LAUNCHER-CREDENTIAL', result.stdout+result.stderr)

    def test_preflight_rejects_non_loopback_backend(self):
        result = self.check(private_url='http://example.com:8767')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('TEST-ONLY-LAUNCHER-CREDENTIAL', result.stdout+result.stderr)

    def test_preflight_rejects_site_with_embedded_credentials(self):
        result = self.check(site_origin='https://user:password@example.chatgpt.site')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('TEST-ONLY-LAUNCHER-CREDENTIAL', result.stdout+result.stderr)

if __name__ == '__main__':
    unittest.main()
