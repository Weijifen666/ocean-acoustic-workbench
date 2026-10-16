# 海洋声学工作台 · 本地执行端 (Local Agent Edition)

> 智能化现代海洋声学本地计算平台：结合课程知识图谱浏览、离线/云端双模自然语言仿真 Agent、纯 Python 浅海射线声学引擎、MATLAB Acoustics Toolbox (AT) 动态代码沙箱与可视化环境自检系统。

---

## ⚡ 核心能力与升级亮点

1. **🤖 自然语言驱动的开放式声学仿真 Agent**：
   - 彻底摆脱单一固定 Munk 示例的局限，能够理解开放式海洋声学任务（Pekeris 波导模态求解、Rayleigh 反射系数、信道冲激响应、声线折射弯曲等）；
   - 集成 `backend/code_sandbox.py` 沙箱系统，支持大模型在安全隔离目录下自主编写并执行 Python 或 MATLAB 计算脚本，自动加载 AT 工具箱路径与函数库，并抓取图像成果。
2. **🌊 纯 Python 浅海射线声学引擎 (`backend/ray_tracer.py`)**：
   - 零依赖 MATLAB 商业软件即可独立运行浅海射线声学仿真；
   - 追踪等声速波导中声线的传播轨迹、海面自由释放反射与海底镜面反射过程，统计向上/向下发射声线的反射次数与终端状态，自动输出声线图与 CSV 统计报表。
3. **🛠️ 交互式 MATLAB 与声学工具箱配置中心 (`src/MatlabPanel.jsx`)**：
   - 前端支持一键探测盘符中的 `matlab.exe` 与 AT 工具箱目录（`/api/matlab/detect`）；
   - 细粒度校验 MATLAB 核心、KRAKEN、BELLHOP、FIELD、SCOOTER、AT 读写函数库及 Munk 基准用例（`/api/matlab/check`），实时显示 7 项绿灯状态卡片；
   - 顶栏状态胶囊直通配置页面，一键保存至后台配置，适配云端服务器迁移。
4. **📐 完整 GFM Markdown 与 KaTeX 数学公式渲染 (`src/MarkdownRenderer.jsx`)**：
   - 集成 Marked 引擎，支持排版精美斑马纹数据表格、多级列表、代码块；
   - 本地内嵌 KaTeX 矢量字体库，离线平滑渲染行内与独立 LaTeX 声学公式；
   - 对话中生成的声学图像支持点击全屏放大查看。
5. **🌐 现代海洋声学知识图谱 (`src/GraphExplorer.jsx`)**：
   - 6 个课程单元、46 个知识点、126 条有类型关系，提供学习路径导航与《Computational Ocean Acoustics》原版教材页码检索。

---

## 🚀 启动与运行

在当前目录或项目根目录下双击 `启动工作台.cmd`，或在 PowerShell 执行：

```powershell
.\start.ps1 -NoBrowser
```

启动后在浏览器打开：**`http://127.0.0.1:8765/`**

- **后台主服务**：FastAPI（端口 8765），日志位于 `.local/server.log`；
- **前端静态文件**：已全部编译打包进 `dist/`，访客打开浏览器即用，**客户端机器无需安装 Node.js、Python 或 MATLAB**。

---

## 📋 模块与代码架构

```text
ocean-acoustic-workbench/
├── backend/
│   ├── app.py                 # FastAPI 核心网关、Agent 多轮循环与检测接口
│   ├── code_sandbox.py        # Python / MATLAB 通用声学计算沙箱
│   ├── ray_tracer.py          # 纯 Python 浅海射线追踪算法
│   ├── models.py              # 大模型适配层 (DeepSeek, 阿里百炼, Kimi, GLM)
│   ├── knowledge.py           # 课程图谱核心数据与检索
│   └── requirements.txt       # Python 后端依赖
├── src/
│   ├── main.jsx               # 前端入口与页面布局
│   ├── MatlabPanel.jsx        # MATLAB & AT 工具箱交互式配置面板
│   ├── MarkdownRenderer.jsx   # GFM Markdown + KaTeX 科学排版组件
│   ├── ModelPanel.jsx         # 大模型 API Key 配置面板
│   ├── GraphExplorer.jsx      # Cytoscape 知识图谱浏览器
│   ├── matlab.css             # MATLAB 配置面板样式
│   └── markdown.css           # 声学排版与 KaTeX 样式表
├── dist/                      # 编译就绪的前端纯静态产物
└── .local/                    # 本地运行时与沙箱任务工作区 (.gitignore)
    ├── config.json            # 本地运行环境配置 (包含 MATLAB/AT 路径)
    ├── workbench.sqlite3      # 任务队列与会话记录数据库
    └── runs/                  # 每次仿真任务的物理隔离输出目录
```

---

## 🎯 开放式自然语言测试提示词

在「对话工作台」中可直接尝试以下提示词：

- **射线声学**：“帮我用射线声学仿真浅海中的声线传播：水深 100m，海水声速 1500m/s，声源在水下 50m，发射 5°、15°、30°、45°、60° 掠射角的声线，计算传播到 5km 处的反射次数并画出轨迹图。”
- **Pekeris 波导**：“帮我用 MATLAB 调用 AT 工具箱的 KRAKEN 求解器，仿真一个经典 Pekeris 浅海波导：水深 100m，海水声速 1500m/s、密度 1.0g/cm³；半无限海底声速 1750m/s、密度 1.8g/cm³。计算 50Hz 时的传播模态，画出前几阶简正波的深度分布曲线。”
- **深海 Munk 声道**：“帮我在深海声道轴(1000m)处仿真 50Hz 声源在 50km 内的传播损失分布，接收深度 1000m，生成声场二维分布图并解读物理机理。”
