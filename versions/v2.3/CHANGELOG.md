# v2.3（应用内更新下载）

- 「前往下载」改为 App 内下载：先尝试 GitHub 直连 APK，失败后尝试 `v4.gh-proxy.org` 代理，仍失败则打开浏览器到 Release 页面
- 下载弹窗实时显示进度条、百分比与当前线路（直连/代理），支持取消
- 下载完成后通过 PackageInstaller 调起系统安装
- 新增 `REQUEST_INSTALL_PACKAGES` 权限
