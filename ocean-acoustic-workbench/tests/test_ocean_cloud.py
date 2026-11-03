"""Cloud reads must preserve parameters and fail explicitly instead of using other data."""
import io,json,os,sys,unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError,URLError
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
import ocean_cloud
import ocean_data

class Response(io.BytesIO):pass
class CloudTests(unittest.TestCase):
    def test_capability_checks_cloud_activation_and_does_not_confuse_configuration(self):
        ocean_data._status_cache.clear()
        with patch.object(ocean_cloud,'base_url',return_value='https://capability-test.example'),patch.object(ocean_cloud,'read',return_value={'available':True,'version':'fixture-v1'}) as read:
            data=ocean_data.status()
            self.assertTrue(data['available']);self.assertTrue(data['configured']);self.assertEqual(data['mode'],'cloud')
            self.assertEqual(data['version'],'fixture-v1')
            self.assertEqual(ocean_data.status(),data)
            read.assert_called_once_with(timeout=8)
        ocean_data._status_cache.clear()
        with patch.object(ocean_cloud,'base_url',return_value='https://capability-test.example'),patch.object(ocean_cloud,'read',side_effect=ConnectionError('private response')):
            data=ocean_data.status()
            self.assertTrue(data['configured']);self.assertFalse(data['available'])
            self.assertNotIn('private response',json.dumps(data))
        ocean_data._status_cache.clear()
    @patch.dict(os.environ,{'OCEAN_DATA_URL':'https://data.example/'})
    def test_exact_profile_parameters_and_provenance(self):
        payload={'selected':{'lon':119.5,'lat':19.5},'dataset_version':'v1','rows':[]}
        with patch.object(ocean_cloud,'urlopen',return_value=Response(json.dumps(payload).encode())) as open_url:
            self.assertEqual(ocean_cloud.read('/profile',lon=120,lat=20,period=13),payload)
        self.assertEqual(open_url.call_args.args[0].full_url,'https://data.example/api/ocean-data/profile?lon=120&lat=20&period=13')
        with patch.object(ocean_cloud,'urlopen',return_value=Response(json.dumps(payload).encode())) as open_url:
            self.assertEqual(ocean_cloud.read('/profile',lon=120,lat=20,period=13,version='v1'),payload)
        self.assertEqual(open_url.call_args.args[0].full_url,'https://data.example/api/ocean-data/profile?lon=120&lat=20&period=13&version=v1')
    @patch.dict(os.environ,{'OCEAN_DATA_URL':'https://data.example'})
    def test_version_conflict_is_preserved(self):
        error=HTTPError('https://data.example',409,'',{},io.BytesIO(b'{"detail":"Refresh the dataset version"}'))
        with patch.object(ocean_cloud,'urlopen',side_effect=error),self.assertRaisesRegex(ocean_cloud.DatasetVersionMismatch,'Refresh'):
            ocean_cloud.read('/profile',version='obsolete')
    @patch.dict(os.environ,{'OCEAN_DATA_URL':'https://data.example'})
    def test_land_error_and_service_failure_are_distinct(self):
        for status,kind in ((422,ValueError),(503,ConnectionError)):
            error=HTTPError('https://data.example',status,'',{},io.BytesIO(b'{"detail":"expected diagnostic"}'))
            with patch.object(ocean_cloud,'urlopen',side_effect=error),self.assertRaisesRegex(kind,'expected diagnostic'):ocean_cloud.read('/profile')
        with patch.object(ocean_cloud,'urlopen',side_effect=URLError('private network details')),self.assertRaisesRegex(ConnectionError,'未切换'):ocean_cloud.read()
    @patch.dict(os.environ,{'OCEAN_DATA_URL':'http://untrusted.example'})
    def test_remote_cleartext_rejected(self):
        with self.assertRaisesRegex(ValueError,'HTTPS'):ocean_cloud.read()

if __name__=='__main__':unittest.main()
