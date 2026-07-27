//! 原生文件命令的调用方与路径校验。
//!
//! 自定义命令不经过 Tauri 的 fs 插件，因此不会自动受 capability scope 约束。
//! Renderer 一旦被注入（XSS、恶意项目数据、Agent 写入），未校验的路径参数就等于
//! 任意文件读写 / 删除 / 启动进程。本模块给这些命令补上两道闸：
//!
//! 1. 调用方校验：只接受加载本地前端的自有窗口，拒绝远程页面（如即梦登录窗）。
//! 2. 路径校验：解析真实路径（含符号链接），要求落在应用自有数据目录，
//!    或用户通过对话框 / 外部素材目录显式授权过的 fs scope 内。

use std::path::{Component, Path, PathBuf};

use tauri::{Manager, Runtime, Webview};
use tauri_plugin_fs::FsExt;

/// 允许调用敏感原生命令的窗口标签，与 capabilities/default.json 的 windows 一致。
/// dreamina-login（远程页面）与 director-desk（本地安装的第三方运行时）不在其中。
const TRUSTED_WINDOW_LABELS: [&str; 3] = ["main", "asset-search", "chat-assistant"];

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PathAccess {
    /// 读取已存在的文件或目录。
    Read,
    /// 写入 / 删除，目标本身可以尚不存在，此时校验其父目录。
    Write,
}

/// 校验命令来自自有本地窗口，而不是远程页面或第三方运行时窗口。
pub fn ensure_trusted_caller<R: Runtime>(webview: &Webview<R>) -> Result<(), String> {
    let label = webview.label();
    if !TRUSTED_WINDOW_LABELS.contains(&label) {
        return Err(format!("窗口 {label} 无权调用该命令"));
    }

    // 窗口即使标签可信，也可能被导航到远程地址，必须再确认当前来源仍是本地前端。
    let url = webview
        .url()
        .map_err(|e| format!("无法确认调用窗口来源: {e}"))?;
    let is_local = match url.scheme() {
        "tauri" | "asset" | "file" => true,
        "http" | "https" => matches!(
            url.host_str(),
            Some("localhost" | "127.0.0.1" | "tauri.localhost" | "asset.localhost")
        ),
        _ => false,
    };
    if !is_local {
        return Err(format!("窗口 {label} 当前来源不是本地前端，已拒绝该命令"));
    }
    Ok(())
}

/// 应用自有的可写数据目录（项目素材、配置、缓存都在其中）。
fn app_owned_roots<R: Runtime>(app: &tauri::AppHandle<R>) -> Vec<PathBuf> {
    let path = app.path();
    [
        path.app_data_dir(),
        path.app_local_data_dir(),
        path.app_config_dir(),
        path.app_cache_dir(),
    ]
    .into_iter()
    .flatten()
    .filter_map(|dir| dir.canonicalize().ok())
    .collect()
}

fn is_within(path: &Path, root: &Path) -> bool {
    path == root || path.starts_with(root)
}

/// 解析路径的真实位置：存在则 canonicalize；写入场景下允许目标不存在，改用父目录解析。
/// canonicalize 会展开 `..` 与符号链接，避免用软链把授权目录指到别处。
fn resolve_path(raw: &str, access: PathAccess) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("路径为空".to_string());
    }
    if trimmed.contains('\0') {
        return Err("路径包含非法字符".to_string());
    }

    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err(format!("只接受绝对路径: {trimmed}"));
    }

    if let Ok(canonical) = path.canonicalize() {
        return Ok(canonical);
    }
    if access == PathAccess::Read {
        return Err(format!("路径不存在或无法访问: {trimmed}"));
    }

    // 写入目标尚不存在：父目录必须存在且可解析，文件名不能是 `.`/`..` 之类。
    let parent = path
        .parent()
        .ok_or_else(|| format!("无法定位父目录: {trimmed}"))?;
    let file_name = match path.components().next_back() {
        Some(Component::Normal(name)) => name.to_owned(),
        _ => return Err(format!("路径缺少有效的文件名: {trimmed}")),
    };
    let canonical_parent = parent
        .canonicalize()
        .map_err(|e| format!("目标目录不存在或无法访问（{}）: {e}", parent.display()))?;
    Ok(canonical_parent.join(file_name))
}

/// 判断解析后的路径是否在允许范围内：应用自有目录，或用户已授权的 fs scope。
fn is_authorized<R: Runtime>(
    app: &tauri::AppHandle<R>,
    resolved: &Path,
    access: PathAccess,
    extra_roots: &[PathBuf],
) -> bool {
    if app_owned_roots(app)
        .iter()
        .chain(extra_roots.iter())
        .any(|root| is_within(resolved, root))
    {
        return true;
    }

    // fs scope 覆盖用户通过文件对话框选中的文件、拖入的文件和登记过的外部素材目录。
    // is_allowed 内部会 canonicalize，因此不存在的写入目标要用父目录判断。
    let scope = app.fs_scope();
    if scope.is_allowed(resolved) {
        return true;
    }
    if access == PathAccess::Write {
        if let Some(parent) = resolved.parent() {
            return scope.is_allowed(parent);
        }
    }
    false
}

/// 校验并解析命令收到的路径参数，返回可安全使用的真实路径。
pub fn authorize_path<R: Runtime>(
    app: &tauri::AppHandle<R>,
    raw: &str,
    access: PathAccess,
) -> Result<PathBuf, String> {
    authorize_path_with_roots(app, raw, access, &[])
}

/// 同 [`authorize_path`]，另外接受一组命令自身额外允许的根目录。
pub fn authorize_path_with_roots<R: Runtime>(
    app: &tauri::AppHandle<R>,
    raw: &str,
    access: PathAccess,
    extra_roots: &[PathBuf],
) -> Result<PathBuf, String> {
    let resolved = resolve_path(raw, access)?;
    if !is_authorized(app, &resolved, access, extra_roots) {
        return Err(format!(
            "路径未获授权，请先在设置中添加该目录: {}",
            resolved.display()
        ));
    }
    Ok(resolved)
}

/// 用户把文件拖入自有窗口，等同于对该文件的一次显式授权（与文件对话框选中同义）。
/// 登记进 fs scope 后，后续的复制 / 读取命令才能通过路径校验。
pub fn grant_dropped_paths<R: Runtime>(app: &tauri::AppHandle<R>, paths: &[PathBuf]) {
    let scope = app.fs_scope();
    for path in paths {
        let Ok(canonical) = path.canonicalize() else {
            continue;
        };
        let result = if canonical.is_dir() {
            scope.allow_directory(&canonical, true)
        } else {
            scope.allow_file(&canonical)
        };
        if let Err(error) = result {
            eprintln!("[path-policy] 登记拖入路径失败 {}: {error}", canonical.display());
        }
    }
}

/// 应用自身的安装目录（可执行文件所在目录），只用于“在文件管理器中定位”。
pub fn app_install_roots<R: Runtime>(app: &tauri::AppHandle<R>) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            if let Ok(canonical) = dir.canonicalize() {
                roots.push(canonical);
            }
        }
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        if let Ok(canonical) = resource_dir.canonicalize() {
            roots.push(canonical);
        }
    }
    roots
}

/// 校验要启动的应用路径。
///
/// 该命令只服务“用 Photoshop 打开图片”，因此不接受任意可执行文件：
/// 必须是系统里已安装的应用，且不得位于应用自身可写的数据目录 ——
/// 否则被注入的 Renderer 只需先往素材目录写一个可执行文件，再调用本命令即可执行任意代码。
pub fn authorize_launch_target<R: Runtime>(
    app: &tauri::AppHandle<R>,
    app_path: &str,
) -> Result<String, String> {
    let trimmed = app_path.trim();
    if trimmed.is_empty() {
        return Err("应用路径为空".to_string());
    }
    if trimmed.contains('\0') || trimmed.contains('\n') || trimmed.contains('\r') {
        return Err("应用路径包含非法字符".to_string());
    }

    let path = PathBuf::from(trimmed);
    let has_separator = trimmed.contains('/') || trimmed.contains('\\');

    // macOS 允许直接给应用名（交由 LaunchServices 在已安装应用中解析）。
    if cfg!(target_os = "macos") && !has_separator {
        return Ok(trimmed.to_string());
    }

    if !path.is_absolute() {
        return Err(format!("只接受绝对路径或已安装的应用名: {trimmed}"));
    }
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("应用路径不存在或无法访问（{trimmed}）: {e}"))?;

    // 关键约束：不允许启动位于应用可写目录内的程序（Renderer 可以往那里落文件）。
    if app_owned_roots(app)
        .iter()
        .any(|root| is_within(&canonical, root))
    {
        return Err(format!(
            "拒绝启动应用数据目录内的程序: {}",
            canonical.display()
        ));
    }

    if cfg!(target_os = "macos") {
        let is_app_bundle = canonical
            .components()
            .any(|component| match component {
                Component::Normal(name) => name
                    .to_str()
                    .is_some_and(|text| text.to_ascii_lowercase().ends_with(".app")),
                _ => false,
            });
        if !is_app_bundle {
            return Err(format!("只允许启动 .app 应用包: {}", canonical.display()));
        }
    } else {
        let is_executable = canonical
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"));
        if !is_executable || !canonical.is_file() {
            return Err(format!("只允许启动 .exe 可执行文件: {}", canonical.display()));
        }
    }

    Ok(canonical.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_relative_and_empty_paths() {
        assert!(resolve_path("", PathAccess::Read).is_err());
        assert!(resolve_path("relative/file.png", PathAccess::Read).is_err());
        assert!(resolve_path("/tmp/with\0nul", PathAccess::Read).is_err());
    }

    #[test]
    fn resolves_existing_path_and_strips_traversal() {
        let dir = std::env::temp_dir().canonicalize().expect("临时目录可解析");
        let nested = dir.join("ai-canvas-path-policy-test");
        std::fs::create_dir_all(&nested).expect("创建测试目录");
        let traversal = nested.join("..").join("ai-canvas-path-policy-test");

        let resolved = resolve_path(&traversal.to_string_lossy(), PathAccess::Read)
            .expect("含 .. 的已存在路径应可解析");
        assert_eq!(resolved, nested.canonicalize().expect("目录可解析"));

        std::fs::remove_dir_all(&nested).ok();
    }

    #[test]
    fn write_access_accepts_missing_file_but_needs_existing_parent() {
        let dir = std::env::temp_dir().canonicalize().expect("临时目录可解析");
        let missing = dir.join("ai-canvas-missing-file.bin");
        std::fs::remove_file(&missing).ok();

        let resolved = resolve_path(&missing.to_string_lossy(), PathAccess::Write)
            .expect("父目录存在时应可解析");
        assert_eq!(resolved.file_name(), missing.file_name());
        assert!(resolve_path(&missing.to_string_lossy(), PathAccess::Read).is_err());

        let nested_missing = dir.join("ai-canvas-missing-dir").join("file.bin");
        assert!(resolve_path(&nested_missing.to_string_lossy(), PathAccess::Write).is_err());
    }
}
