"""Path checks describe files, never license validity or solver execution."""
import unittest
from unittest.mock import patch
import test_research_api as fixture


class MatlabEnvironmentCheck(unittest.TestCase):
    setUp = fixture.ResearchAPI.setUp
    tearDown = fixture.ResearchAPI.tearDown

    def stage(self, optional=True):
        self.matlab = self.local/'R2024a/bin/matlab.exe'
        self.toolbox = self.local/'toolbox'
        required = [self.matlab, self.toolbox/'bin/kraken.exe', self.toolbox/'bin/field.exe',
                    self.toolbox/'ReadWrite/read_modes.m', self.toolbox/'ReadWrite/read_shd.m',
                    self.toolbox/'tests/Munk/MunkK.env', self.toolbox/'tests/Munk/MunkK.flp']
        optional_paths = [self.toolbox/'bin/bellhop.exe', self.toolbox/'bin/scooter.exe'] if optional else []
        for path in required + optional_paths:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('file-presence fixture; must never execute', encoding='utf-8')
        return required

    def check(self, body=None):
        body = {'matlab_path':str(self.matlab),'toolbox_path':str(self.toolbox)} if body is None else body
        with patch('natural_agent.code_sandbox.subprocess.Popen', side_effect=AssertionError('A path check must not start a process')) as process:
            response = self.client.post('/api/matlab/check', json=body)
            process.assert_not_called()
        return response

    def test_all_reported_files_present_is_still_filesystem_only(self):
        self.stage()
        response = self.check();self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertTrue(result['ok']);self.assertTrue(result['basic_components_present']);self.assertTrue(result['all_components_present'])
        self.assertEqual(result['check_type'], 'filesystem_only')
        self.assertIs(result['matlab_started'], False);self.assertIs(result['license_checked'], False)
        self.assertIn('未启动 MATLAB', result['summary']);self.assertIn('许可证及实际运行需通过任务验证', result['summary'])
        self.assertNotIn('可执行全套声学仿真', result['summary'])

    def test_optional_solver_files_do_not_gate_the_basic_kraken_field_check(self):
        self.stage(optional=False)
        result = self.check().json()
        self.assertTrue(result['ok']);self.assertFalse(result['all_components_present'])
        components = {row['id']:row for row in result['components']}
        self.assertFalse(components['bellhop']['ok']);self.assertFalse(components['scooter']['ok'])
        self.assertTrue(components['readwrite']['ok']);self.assertTrue(components['testcases']['ok'])

    def test_each_required_file_including_shd_env_and_flp_is_required(self):
        for path in self.stage():
            with self.subTest(file=path.name):
                path.unlink()
                result = self.check().json()
                self.assertFalse(result['ok']);self.assertFalse(result['basic_components_present']);self.assertFalse(result['all_components_present'])
                if path.name in ('read_modes.m', 'read_shd.m'):
                    self.assertFalse(next(row for row in result['components'] if row['id']=='readwrite')['ok'])
                if path.suffix in ('.env','.flp'):
                    self.assertFalse(next(row for row in result['components'] if row['id']=='testcases')['ok'])
                path.write_text('fixture', encoding='utf-8')

    def test_directory_named_like_a_required_file_does_not_pass(self):
        self.stage()
        path = self.toolbox/'ReadWrite/read_shd.m';path.unlink();path.mkdir()
        self.assertFalse(self.check().json()['ok'])

    def test_invalid_path_payloads_are_validation_errors(self):
        self.stage()
        self.assertEqual(self.check([]).status_code, 422)
        for value in (7, 0, False):
            self.assertEqual(self.check({'matlab_path':value}).status_code, 422)


if __name__ == '__main__':unittest.main()
