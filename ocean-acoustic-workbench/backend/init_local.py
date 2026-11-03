"""Initialize a usable local workspace without distributing private course files."""
from pathlib import Path
import argparse, json, os, shutil

ROOT=Path(__file__).resolve().parents[1]

def initialize(local=None, root=ROOT, *, matlab='', toolbox='', project=''):
    root=Path(root);local=Path(local or os.environ.get('OCEAN_RUNTIME_DIR',str(root/'.local'))).expanduser().resolve()
    for folder in (local,local/'kb',local/'project',local/'sources'):
        folder.mkdir(parents=True,exist_ok=True)
    created=[]
    registry=local/'kb/source_registry.json'
    if not registry.exists():
        public=root.parent/'ocean-acoustic-public/data/sources.json'
        rows=json.loads(public.read_text(encoding='utf-8')) if public.is_file() else []
        allowed={'id','name','type','category','description','pdf_pages','url','license','role'}
        sources=[{**{k:v for k,v in row.items() if k in allowed},'available':False} for row in rows]
        registry.write_text(json.dumps({'sources':sources,'scope':'Public source metadata only; private original files have not been imported.'},ensure_ascii=False,indent=2)+'\n',encoding='utf-8');created.append('kb/source_registry.json')
    config=local/'config.json'
    if not config.exists():
        cfg={'matlab_path':matlab or shutil.which('matlab') or '', 'toolbox_path':toolbox,
             'project_path':project or str(local/'project'),'provider':'DeepSeek',
             'base_url':'https://api.deepseek.com','model':'deepseek-flash','timeout_seconds':600}
        config.write_text(json.dumps(cfg,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');created.append('config.json')
    return {'created':created,'existing_files_preserved':True,'private_materials_imported':False}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--runtime-dir');p.add_argument('--matlab',default='');p.add_argument('--toolbox',default='');p.add_argument('--project',default='')
    a=p.parse_args();print(json.dumps(initialize(a.runtime_dir,matlab=a.matlab,toolbox=a.toolbox,project=a.project),ensure_ascii=False))
