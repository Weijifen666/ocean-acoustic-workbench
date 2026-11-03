"""Loopback-only development proxy to a deployed cloud API; never reads ocean files.

Uses urllib's existing OS/environment proxy settings (including Windows Internet
Settings), unlike Node's development proxy. Run Vite with OCEAN_API_TARGET set to
http://127.0.0.1:8778. No administrator publishing token is needed or forwarded.
"""
import argparse
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.request import Request,urlopen
from urllib.error import HTTPError,URLError
from urllib.parse import urlparse

def handler(site):
    class CloudProxy(BaseHTTPRequestHandler):
        def proxy(self):
            if not self.path.startswith('/api/'):
                self.send_error(404);return
            size=int(self.headers.get('Content-Length','0'))
            if size>4_000_000:self.send_error(413);return
            data=self.rfile.read(size) if size else None
            headers={key:self.headers[key] for key in ('Accept','Content-Type','Cookie','Idempotency-Key') if key in self.headers}
            headers['Origin']=site;headers['Accept-Encoding']='identity'
            headers['User-Agent']='OceanAcousticWorkbench/0.7 (+https://github.com/Weijifen666/ocean-acoustic-workbench)'
            try:
                try:response=urlopen(Request(site+self.path,data=data,headers=headers,method=self.command),timeout=100)
                except HTTPError as error:response=error
                with response:
                    body=response.read();self.send_response(response.status)
                    for key,value in response.headers.items():
                        if key.lower() not in ('content-length','transfer-encoding','connection','keep-alive'):self.send_header(key,value)
                    self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
            except (URLError,TimeoutError,OSError):
                self.send_error(502,'Cloud API connection failed')
        do_GET=do_POST=do_PUT=do_PATCH=do_DELETE=proxy
        def log_message(self,fmt,*args):print(fmt%args,flush=True)
    return CloudProxy

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--site',required=True);parser.add_argument('--port',type=int,default=8778);args=parser.parse_args()
    site=args.site.rstrip('/');url=urlparse(site)
    if url.scheme!='https' or not url.hostname or url.path or url.username or url.password:parser.error('site must be an HTTPS origin')
    server=ThreadingHTTPServer(('127.0.0.1',args.port),handler(site));print(f'Cloud API development proxy: http://127.0.0.1:{args.port} -> {site}',flush=True);server.serve_forever()
