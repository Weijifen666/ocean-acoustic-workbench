"""Build project-authored teaching diagrams without private configuration or PDFs.

These illustrations explain ideas, not numerical solutions or textbook facsimiles.
Run this file to refresh the SVGs in both maintained frontends.
"""
from pathlib import Path
import html
import math

ROOT = Path(__file__).resolve().parents[1]
OUTPUTS = [ROOT / 'public/assets/knowledge', ROOT.parent / 'ocean-acoustic-public/public/assets/knowledge']


def text(x, y, value, size=17, color='#294c65', anchor='start'):
    return f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" text-anchor="{anchor}">{html.escape(value)}</text>'


def line(x1, y1, x2, y2, color='#6994a8', dash='', arrow=False):
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="2" stroke-dasharray="{dash}"'+(' marker-end="url(#arrow)"' if arrow else '')+'/>'


def box(x, y, w, title, sub, color='#347f9b'):
    return f'<rect x="{x}" y="{y}" width="{w}" height="78" rx="12" fill="#fff" stroke="{color}"/>'+text(x+w/2,y+31,title,19,color,'middle')+text(x+w/2,y+57,sub,14,'#587486','middle')


def save(name, title, subtitle, body):
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 480" role="img" aria-label="{html.escape(title)}"><defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="#6994a8"/></marker></defs><rect width="800" height="480" rx="16" fill="#f3f9fc"/><g font-family="Microsoft YaHei,Segoe UI,sans-serif">{text(30,44,title,25,'#163f58')}{text(30,75,subtitle,14,'#5e7d8e')}{body}{line(30,435,770,435,'#d6e5ec')}{text(30,461,'本项目原创原理示意 · 非教材原图 · 非求解器仿真结果',13,'#6a8595')}</g></svg>'''
    for directory in OUTPUTS:
        directory.mkdir(parents=True, exist_ok=True)
        (directory/(name+'.svg')).write_text(svg, encoding='utf-8')


def build():
    curve = ' '.join(f'{65+i*2.6:.1f},{188-42*math.sin(i/8):.1f}' for i in range(101))
    body = line(60,188,337,188)+f'<polyline points="{curve}" fill="none" stroke="#268ca7" stroke-width="3"/>'
    body += text(193,265,'时域：声压 p(x,t)',18,anchor='middle')+text(193,300,'∇²p − c⁻² ∂²p/∂t² = 0',19,anchor='middle')
    body += line(357,185,440,185,arrow=True)+text(397,161,'时间变换',14,anchor='middle')
    body += box(465,144,285,'频域：P(x,ω)','p = Re{P exp(−iωt)}')+text(607,300,'∇²P + k²P = 0',21,anchor='middle')
    body += text(400,370,'均匀、静止、线性介质；源项与边界条件另行给定。',16,anchor='middle')
    save('wave-equation','波动方程与 Helmholtz 方程','同一线性传播问题的时域与频域表述，不能混淆时间变量与频率。',body)

    body = box(35,132,205,'空间声场 p(r,z)','水平不变的分层环境')+box(298,132,205,'谱域深度方程','按水平波数逐点求解')+box(560,132,205,'反变换重建','得到距离—深度声场')
    body += line(247,171,287,171,arrow=True)+line(510,171,550,171,arrow=True)
    body += text(400,271,'傅里叶 / Hankel 变换 → 深度边值问题 → 谱积分',20,anchor='middle')
    body += text(400,324,'矩阵法求解分层匹配；FFT 可加速合适的离散反变换。',17,anchor='middle')
    body += text(400,370,'波数间隔、截断和周期绕回误差须检查，不能只看图像平滑。',16,anchor='middle')
    save('spectral-transform','积分变换与波数积分','示意的是方法结构；不是某个海域的实际谱、声场或误差曲线。',body)

    body = '<rect x="65" y="240" width="670" height="160" fill="#e0f1fa"/>'
    body += line(65,240,735,240,'#3488a4')+text(725,228,'p = 0 海面',16,anchor='end')
    body += '<circle cx="190" cy="150" r="8" fill="#b489b4"/><circle cx="190" cy="330" r="8" fill="#2788a1"/><circle cx="655" cy="330" r="8" fill="#267c9a"/>'
    body += line(190,150,655,330,'#b489b4','6 5')+line(190,330,655,330,'#2788a1')+line(190,330,423,240,'#2788a1')+line(423,240,655,330,'#2788a1')
    body += text(210,150,'反相镜像源 −S',17)+text(106,371,'实际声源 S',17)+text(630,371,'接收点',17)
    body += text(400,117,'均匀半空间：用镜像源满足理想海面的边界条件',17,anchor='middle')
    save('image-source','镜像法与海面反射','镜像源是数学构造，不是真实声源；此处只画一个理想压力释放面。',body)

    body = '<rect x="80" y="135" width="640" height="166" fill="#def0f9"/><rect x="80" y="301" width="640" height="100" fill="#e9e1d0"/>'
    body += line(80,135,720,135,'#428eaa')+line(80,301,720,301,'#ad9065')
    body += text(98,122,'理想压力释放海面：p = 0',16)+text(120,187,'水层：声速 c₁、密度 ρ₁、水深 H',20)
    body += '<circle cx="170" cy="243" r="8" fill="#2788a1"/>'+text(194,249,'声源深度 zₛ',18)
    body += text(120,347,'可穿透流体底：声速 c₂、密度 ρ₂',20)+text(120,382,'界面处声压与法向质点速度连续',16)
    save('pekeris-waveguide','Pekeris 波导','理想均匀水层覆盖流体半空间；数值取值与吸收参数由具体算例给定。',body)

    body = line(85,130,720,130)+line(85,350,720,350)
    for mode, color in [(1,'#268ba6'),(2,'#9a79ad'),(3,'#55a393')]:
        x = 185+(mode-1)*210
        points=' '.join(f'{x+48*math.sin(mode*math.pi*i/100):.2f},{130+220*i/100:.2f}' for i in range(101))
        body += f'<polyline points="{points}" fill="none" stroke="{color}" stroke-width="3"/>'+text(x,385,f'模态 {mode}',17,color,'middle')
    body += text(400,107,'边界条件限定本征值 kᵣₘ 与深度函数 ψₘ(z)',18,anchor='middle')
    body += text(400,416,'正交与完备性质须满足对应的自伴边值问题及归一化约定。',15,anchor='middle')
    save('modal-basis','本征值、模态与场展开','曲线为理想形状示意，不是 KRAKEN 计算出的模态或实际贡献权重。',body)

    body=line(90,304,710,304,arrow=True)+line(130,375,130,120,arrow=True)
    body += text(710,331,'Re kᵣ',16)+text(92,122,'Im kᵣ',16)
    body += '<path d="M190 304C200 130 620 130 655 304" fill="none" stroke="#318aa6" stroke-width="3" stroke-dasharray="7 5"/>'
    for x in [275,420,560]:body += f'<circle cx="{x}" cy="265" r="7" fill="#a477a1"/>'
    body += text(420,156,'满足解析与辐射条件时的围线变形',17,anchor='middle')+text(420,367,'离散极点的留数 ↔ 离散模态贡献',19,anchor='middle')
    body += text(400,408,'支点、支割与连续谱也需处理，不能只保留极点。',15,anchor='middle')
    save('spectral-residues','复波数平面与模态留数','仅示意谱表示之间的联系；极点位置与积分路径不代表实际模型。',body)

    body = line(85,270,710,270,arrow=True)+text(708,300,'深度 z',17)
    points=' '.join(f'{90+i*5.8:.1f},{205-35*math.sin(i/14):.1f}' for i in range(101))
    body += f'<polyline points="{points}" fill="none" stroke="#2b8da6" stroke-width="3"/>'
    body += text(400,143,'介质变化尺度 ≫ 局部波长：缓变近似的基本出发点',18,anchor='middle')
    body += text(400,335,'ψ(z) ≈ A(z) exp[i Φ(z)]',23,anchor='middle')
    body += text(400,385,'转向点附近普通 WKB 形式失效，需要连接公式或一致近似。',16,anchor='middle')
    save('wkb-approximation','WKB 缓变近似','画的是示意性的缓变系数，不是测量声速或实际模态函数。',body)

    body = '<rect x="65" y="122" width="670" height="260" fill="#e3f2f9"/><rect x="65" y="337" width="670" height="45" fill="#e2e1e2"/>'
    for x, label in [(120,'初始场'),(350,'距离步进'),(600,'下一个截面')]:
        body += line(x,150,x,328,'#6a9dae','5 4')+text(x,112,label,17,anchor='middle')
    for x in [145,380]:body += line(x,225,x+170,225,arrow=True)
    body += text(400,184,'标准 / 宽角近似 → 传播算子 → 数值离散',18,anchor='middle')
    body += text(400,291,'分裂步法交替处理传播与介质项；须核对步长误差。',17,anchor='middle')
    body += text(400,366,'人工吸收层：减小计算边界反射，不能代替物理海底。',16,anchor='middle')
    body += text(400,413,'单向步进近似通常忽略后向散射；适用角度由具体算子决定。',15,anchor='middle')
    save('pe-marching','抛物方程的初始场、步进与边界','这是数值方法结构示意，没有执行任何海域仿真或给出误差保证。',body)

    body=box(40,128,220,'波数积分','SCOOTER')+box(290,128,220,'简正波','KRAKEN / KRAKENC')+box(540,128,220,'射线 / 波束','BELLHOP / BELLHOP3D')
    body += box(40,260,220,'宽带时间响应','SPARC')+box(290,260,220,'弹性模态条目','KRAKEL · 待验证')+box(540,260,220,'环境与结果文件','ENV / MOD / SHD 等')
    body += text(400,392,'模型条目 ≠ 已安装 ≠ 算例已验证；运行前检查可执行文件与案例。',16,anchor='middle')
    save('at-models','AT 模型的分工与文件接口','工具选择由环境、频率、边界条件和输出目标决定，不能随意互换。',body)


if __name__ == '__main__':
    build()
    print('Built 9 project-authored diagram assets for both frontends.')
