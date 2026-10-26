"""Filesystem actions restricted to one task directory."""
import os,re,shutil,stat
from pathlib import Path

def directory(root,identity):
    if not re.fullmatch(r'[a-f0-9]{12}',identity):raise ValueError('非法任务标识')
    root=Path(root).resolve();target=root/identity
    if target.exists():
        attrs=getattr(target.lstat(),'st_file_attributes',0)
        if target.is_symlink() or attrs & stat.FILE_ATTRIBUTE_REPARSE_POINT:
            raise ValueError('任务目录不能是符号链接或目录联接')
    resolved=target.resolve()
    if resolved.parent!=root:raise ValueError('任务目录超出输出路径')
    return resolved

def remove(root,identity):
    target=directory(root,identity)
    if target.exists():
        if not target.is_dir():raise ValueError('任务输出路径不是目录')
        shutil.rmtree(target)
    return target

def reveal(root,identity):
    target=directory(root,identity)
    if not target.is_dir():raise FileNotFoundError('任务文件夹尚未生成或已删除')
    os.startfile(str(target))
    return target

def read_log(path,tail=None):
    """Read a run log that may mix UTF-8 (Python) and GBK (MATLAB/Fortran) output."""
    raw=Path(path).read_bytes()
    if raw.startswith(b'\xef\xbb\xbf'):raw=raw[3:]
    try:
        text=raw.decode('utf-8')
    except UnicodeDecodeError:
        lines=[]
        for line in raw.split(b'\n'):
            try:lines.append(line.decode('utf-8'))
            except UnicodeDecodeError:
                try:lines.append(line.decode('gbk'))
                except UnicodeDecodeError:lines.append(line.decode('utf-8',errors='replace'))
        text='\n'.join(lines)
    return text[-tail:] if tail else text

