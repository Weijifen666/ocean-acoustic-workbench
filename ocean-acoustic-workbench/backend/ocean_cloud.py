"""Read the same versioned cloud profiles used by the public map and Agent."""
import json,os
from urllib.parse import urlencode,urlparse
from urllib.request import Request,urlopen
from urllib.error import HTTPError,URLError

class DatasetVersionMismatch(ValueError):
    """The requested immutable dataset is no longer the active publication."""

def base_url():return os.environ.get('OCEAN_DATA_URL','').rstrip('/')

def read(path='',**params):
    origin=base_url();url=urlparse(origin)
    if url.scheme not in ('http','https') or not url.hostname or url.username or url.password or url.query or url.fragment:raise ValueError('OCEAN_DATA_URL 必须是可信数据站点的网址')
    if url.scheme=='http' and url.hostname not in ('localhost','127.0.0.1','::1'):raise ValueError('在线数据服务必须使用 HTTPS')
    endpoint=origin+'/api/ocean-data'+path+('?' + urlencode(params) if params else '')
    try:
        with urlopen(Request(endpoint,headers={'Accept':'application/json','User-Agent':'OceanAcousticWorkbench/0.7 (+https://github.com/Weijifen666/ocean-acoustic-workbench)'}),timeout=60) as response:return json.load(response)
    except HTTPError as error:
        try:detail=json.loads(error.read(5000)).get('detail','在线数据服务请求失败')
        except (ValueError,TypeError):detail='在线数据服务请求失败'
        if error.code>=500:raise ConnectionError(detail) from None
        if error.code==409:raise DatasetVersionMismatch(detail) from None
        raise ValueError(detail) from None
    except (URLError,TimeoutError):raise ConnectionError('在线海洋数据服务暂不可达；未切换为其他数据源') from None
