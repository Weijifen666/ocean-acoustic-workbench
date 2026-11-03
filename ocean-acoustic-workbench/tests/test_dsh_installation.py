"""Recognize packaged ACP layouts without reading account credentials."""
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
import dsh_bridge


class DSHInstallation(unittest.TestCase):
    def test_current_and_legacy_packaged_entries_are_explicit(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);exe=root/'DSH.exe';exe.write_bytes(b'fixture')
            resource=root/'resources';resource.mkdir();(resource/'app.asar').write_bytes(b'fixture')
            home=root/'private-home'
            with patch.dict(os.environ,{'OCEAN_DSH_EXECUTABLE':str(exe),'OCEAN_DSH_HOME':str(home)}):
                binary,launcher,entry,actual_home=dsh_bridge.installation()
                self.assertEqual(binary,exe);self.assertEqual(launcher,'--expose-internals')
                self.assertTrue(entry.as_posix().endswith('app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'))
                self.assertEqual(actual_home,home);self.assertFalse(home.exists())
                legacy=resource/'harness-node-entry.mjs';legacy.write_text('// fixture')
                _,launcher,entry,_=dsh_bridge.installation()
                self.assertEqual(launcher,legacy)
                self.assertTrue(entry.as_posix().endswith('app.asar/node_modules/@deepseek-ai/dsh/lib/bin.js'))

    def test_missing_override_fails_without_launch_or_credential_access(self):
        with patch.dict(os.environ,{'OCEAN_DSH_EXECUTABLE':'missing-test-installation.exe'}):
            with self.assertRaisesRegex(RuntimeError,'OCEAN_DSH_EXECUTABLE'):
                dsh_bridge.installation()


if __name__=='__main__':unittest.main()
