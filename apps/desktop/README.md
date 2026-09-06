# DeepSeek Harness Desktop

Electron 桌面应用包装器，为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) 提供原生桌面体验。

## 功能特性

- **一键启动**：双击打开，自动在后台启动 `dsh web` 本地服务器
- **原生窗口**：无需浏览器标签页，独立桌面窗口运行 Web UI
- **系统托盘**：最小化到托盘，后台保持运行
- **自动更新检查**：启动时和每 24 小时自动检查上游新版本，发现更新时弹出提示
- **版本追踪**：追踪 `deepseek-ai/deepseek-harness` 上游仓库的 Releases

## 开发

```bash
# 从项目根目录
pnpm install
cd apps/desktop

# 开发模式（需要先构建 dsh）
pnpm run dev

# 打包
pnpm run build
```

## 使用

### 方式一：从源码运行

```bash
# 1. 确保已安装项目依赖并构建
cd deepseek-harness
pnpm install
pnpm run build

# 2. 运行桌面应用
cd apps/desktop
pnpm run start
```

### 方式二：安装打包版本

下载对应平台的安装包（.exe/.dmg/.AppImage）安装后双击使用。

## 更新机制

桌面应用会定期检查上游仓库 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness/releases) 的新版本：

1. **启动时检查**：应用启动 15 秒后自动检查
2. **定时检查**：每 24 小时检查一次
3. **手动检查**：点击系统托盘菜单中的 "Check for Updates"

发现新版本时，会弹出系统对话框提示，点击 "View Release" 可跳转到 GitHub Release 页面查看详情。

## 文件结构

```
apps/desktop/
├── package.json          # 包配置 & electron-builder 配置
├── src/
│   ├── main.js           # Electron 主进程
│   ├── preload.js        # 预加载脚本（安全上下文隔离）
│   ├── updater.js        # GitHub API 更新检查器
│   └── splash.html       # 启动加载画面
└── assets/
    └── icon.png          # 应用图标
```
