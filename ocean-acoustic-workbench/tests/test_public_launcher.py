"""Exercise the real PowerShell preflight; never start a service or solver."""
import json, os, shutil, subprocess, sys, tempfile, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SHELL = shutil.which('powershell.exe') or shutil.which('pwsh')

@unittest.skipUnless(os.name == 'nt' and SHELL, 'Windows PowerShell launcher test')
class PublicLauncherTests(unittest.TestCase):
    def test_gateway_probe_rejects_a_private_backend_on_the_gateway_port(self):
        source = r'''
$tokens=$null; $errors=$null
$tree=[System.Management.Automation.Language.Parser]::ParseFile($env:OCEAN_LAUNCHER_TEST,[ref]$tokens,[ref]$errors)
$function=$tree.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-GatewayHealth'},$true)
$publicRuntime=@{gateway_secret='TEST-ONLY-PROBE'}
function Invoke-RestMethod {return ($env:OCEAN_GATEWAY_RESPONSE|ConvertFrom-Json)}
Invoke-Expression $function.Extent.Text
$result=Get-GatewayHealth
ConvertTo-Json -InputObject ([bool]$result) -Compress
'''
        for response, expected in [({'version':'0.7.0'},False),
                                   ({'version':'0.7.0','public_mode':False},False),
                                   ({'version':'0.7.0','public_mode':True},True)]:
            env=dict(os.environ,OCEAN_LAUNCHER_TEST=str(ROOT/'start-public.ps1'),
                     OCEAN_GATEWAY_RESPONSE=json.dumps(response))
            result=subprocess.run([SHELL,'-NoProfile','-Command',source],env=env,
                                  capture_output=True,text=True,timeout=15)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(json.loads(result.stdout),expected)

    def test_real_bridge_call_preserves_one_exact_script_path_argument(self):
        # Evaluate the actual argument callsite with a non-starting capture
        # function. This catches PowerShell comma/+ precedence, without a
        # gateway, subprocess service, network request or solver invocation.
        fixture = r'C:\work with spaces\ocean-acoustic-workbench'
        source = r'''
$tokens=$null; $errors=$null
$tree=[System.Management.Automation.Language.Parser]::ParseFile($env:OCEAN_LAUNCHER_TEST,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Invalid launcher syntax'}
$appRoot=$env:OCEAN_LAUNCHER_FIXTURE
function Start-NodeProcess([string]$name,[string[]]$arguments){return $arguments}
$assignments=$tree.FindAll({param($node) $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -in @('$bridgeEntry','$quotedBridgeEntry')},$true)
foreach($assignment in $assignments){Invoke-Expression $assignment.Extent.Text}
$call=@($tree.FindAll({param($node) $node -is [System.Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Start-NodeProcess' -and $node.CommandElements[1].Extent.Text -eq "'bridge'"},$true))
if($call.Count -ne 1){throw 'Expected one bridge process callsite'}
$items=@(Invoke-Expression $call[0].Extent.Text)
ConvertTo-Json -InputObject $items -Compress
'''
        env = dict(os.environ, OCEAN_LAUNCHER_TEST=str(ROOT/'start-public.ps1'),
                   OCEAN_LAUNCHER_FIXTURE=fixture)
        result = subprocess.run([SHELL,'-NoProfile','-Command',source],env=env,
                                capture_output=True,text=True,timeout=15)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(json.loads(result.stdout),['-u','"'+fixture+r'\backend\cloud_bridge.py'+'"'])

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
