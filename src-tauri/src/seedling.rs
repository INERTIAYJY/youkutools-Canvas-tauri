//! Seedling（森之灵）CLI 集成 —— 视频生成任务的提交、查询、下载与认证。
//!
//! 管理模式参考 dreamina.rs：优先复用系统已安装的 `seedling` 二进制
//! （PATH → 标准安装目录 → 应用数据目录缓存），缺失或版本过低时从官方 CDN
//! 下载并缓存。认证支持两种方式并存：
//!   1. CLI 登录态：`seedling auth login` 浏览器授权，登录令牌由 CLI 配置文件持久化；
//!   2. API Token：前端经 providerSecretService 存入 secret_store，调用命令时以
//!      `SEEDLING_TOKEN` 环境变量传入（CLI 官方优先级：环境变量 > 配置文件）。
//!
//! 安全边界：
//!   - 所有命令参数白名单 / 枚举校验，禁止任意参数拼接；
//!   - API Token 只进进程环境变量，绝不进命令行参数、日志或返回结果；
//!   - 接收路径参数的命令必须经过 path_policy 的调用方与授权目录校验。

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager, Webview};

use crate::path_policy::{authorize_path, ensure_trusted_caller, PathAccess};

/// CLI 最低可接受版本（该版本起实测支持 `--json` 输出）。
const MIN_VERSION: &str = "0.0.4";
/// 官方发布信息端点（版本号与各平台下载地址）。
const RELEASE_INFO_URL: &str = "https://seedling.p.ykss.com.cn/cli-release.json";
/// 官方默认服务地址：应用内下载的 CLI 缺失 endpoint 配置时补写该值。
const SEEDLING_ENDPOINT: &str = "https://seedling.p.ykss.com.cn";
/// 登录运行态事件名。
const RUNTIME_EVENT: &str = "seedling-login-runtime";
/// 命令错误信息回传前端的最大长度。
const ERROR_DETAIL_LIMIT: usize = 600;
/// 单条提示词最大字符数。
const PROMPT_MAX_CHARS: usize = 4000;

const ALLOWED_RESOLUTIONS: [&str; 3] = ["480p", "720p", "1080p"];
const ALLOWED_RATIOS: [&str; 6] = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
const ALLOWED_TASK_STATUSES: [&str; 7] = [
    "pending",
    "queued",
    "running",
    "succeeded",
    "failed",
    "expired",
    "cancelled",
];

#[cfg(windows)]
fn no_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
}
#[cfg(not(windows))]
fn no_window(_cmd: &mut Command) {}

fn truncate(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_string();
    }
    let cut: String = text.chars().take(limit).collect();
    format!("{cut}…")
}

// ──────────────────────────────────────────────
// CLI 二进制解析（系统优先 + 应用内兜底）
// ──────────────────────────────────────────────

struct ResolvedCli {
    path: PathBuf,
    version: String,
    source: &'static str,
}

fn managed_cli_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {e}"))?
        .join("tools")
        .join("seedling");
    let name = if cfg!(windows) { "seedling.exe" } else { "seedling" };
    Ok(dir.join(name))
}

/// 官方安装脚本使用的标准安装目录。
fn standard_install_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    #[cfg(windows)]
    {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            candidates.push(
                PathBuf::from(local)
                    .join("Programs")
                    .join("seedling")
                    .join("seedling.exe"),
            );
        }
    }
    #[cfg(not(windows))]
    {
        candidates.push(PathBuf::from("/usr/local/bin/seedling"));
        if let Ok(home) = std::env::var("HOME") {
            candidates.push(PathBuf::from(home).join(".local").join("bin").join("seedling"));
        }
    }
    candidates
}

/// 从 `seedling version` 输出解析版本号，如 "seedling v0.0.4" → "0.0.4"。
fn parse_version(text: &str) -> Option<String> {
    // 优先匹配 `v` 后紧跟数字的形式（"seedling v0.0.4"）
    let mut from = 0usize;
    while let Some(at) = text[from..].find('v') {
        let idx = from + at;
        let rest = &text[idx + 1..];
        if rest.chars().next().is_some_and(|c| c.is_ascii_digit()) {
            if let Some(version) = parse_version_triple(rest) {
                return Some(version);
            }
        }
        from = idx + 1;
    }
    // 回退：任意位置匹配 `X.Y.Z`
    parse_version_triple(text)
}

/// 从文本头部解析 `X.Y.Z` 三段数字，容忍前导非数字内容与截断的第三段。
fn parse_version_triple(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        if !bytes[i].is_ascii_digit() {
            i += 1;
            continue;
        }
        let mut parts = Vec::new();
        let mut idx = i;
        let mut valid = true;
        for segment in 0..3 {
            let num_start = idx;
            while idx < bytes.len() && bytes[idx].is_ascii_digit() {
                idx += 1;
            }
            if idx == num_start {
                valid = false;
                break;
            }
            parts.push(text[num_start..idx].to_string());
            if segment < 2 {
                if idx < bytes.len() && bytes[idx] == b'.' {
                    idx += 1;
                } else {
                    valid = false;
                    break;
                }
            }
        }
        if valid && parts.len() == 3 {
            return Some(parts.join("."));
        }
        i += 1;
    }
    None
}

fn version_at_least(version: &str, min: &str) -> bool {
    fn nums(v: &str) -> Vec<u32> {
        v.split('.').filter_map(|p| p.parse::<u32>().ok()).collect()
    }
    let a = nums(version);
    let b = nums(min);
    for i in 0..3 {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        if x != y {
            return x > y;
        }
    }
    true
}

/// 用 `version` 子命令探活并返回版本号。
fn probe_cli(path: &Path) -> Option<String> {
    let mut cmd = Command::new(path);
    cmd.arg("version").stdout(Stdio::piped()).stderr(Stdio::null());
    no_window(&mut cmd);
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    parse_version(&String::from_utf8_lossy(&out.stdout))
}

/// 官方发布信息 → (版本号, 当前平台下载 URL)。
fn release_download_url() -> Result<(String, String), String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建下载客户端失败: {e}"))?;
    let resp = client
        .get(RELEASE_INFO_URL)
        .send()
        .map_err(|e| format!("获取 Seedling 发布信息失败: {e}"))?
        .error_for_status()
        .map_err(|e| format!("获取 Seedling 发布信息失败: {e}"))?;
    let bytes = resp
        .bytes()
        .map_err(|e| format!("读取 Seedling 发布信息失败: {e}"))?;
    let json: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|e| format!("解析 Seedling 发布信息失败: {e}"))?;
    let version = json
        .get("version")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "发布信息缺少版本号".to_string())?
        .to_string();
    let platform = if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    };
    let url = json
        .pointer(&format!("/downloads/{platform}/url"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("发布信息缺少 {platform} 下载地址"))?
        .to_string();
    Ok((version, url))
}

/// 下载并安装 CLI 到应用数据目录缓存。
fn download_cli(app: &AppHandle) -> Result<PathBuf, String> {
    let (version, url) = release_download_url()?;
    let path = managed_cli_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| format!("创建下载客户端失败: {e}"))?;
    let bytes = client
        .get(&url)
        .send()
        .map_err(|e| format!("下载 Seedling CLI (v{version}) 失败: {e}"))?
        .error_for_status()
        .map_err(|e| format!("下载 Seedling CLI (v{version}) 失败: {e}"))?
        .bytes()
        .map_err(|e| format!("读取 Seedling CLI 失败: {e}"))?;
    let tmp = path.with_extension("download");
    std::fs::write(&tmp, &bytes).map_err(|e| format!("写入 Seedling CLI 失败: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755));
    }
    std::fs::rename(&tmp, &path).map_err(|e| format!("安装 Seedling CLI 失败: {e}"))?;
    if probe_cli(&path).is_none() {
        let _ = std::fs::remove_file(&path);
        return Err("Seedling CLI 下载后校验失败，请检查网络后重试".to_string());
    }
    Ok(path)
}

/// 确保 CLI 已配置服务地址（endpoint）。
///
/// 官方安装脚本会自动写入 endpoint，但应用内自动下载的 CLI 是"裸"的——
/// 配置文件里没有 endpoint 时，models list / auth 等所有联网命令都会失败。
/// 查询当前 endpoint，未配置时写入官方默认地址（幂等，已配置则跳过）。
fn ensure_seedling_endpoint(cli: &ResolvedCli) {
    let mut query = base_command(cli, None);
    query
        .args(["config", "get", "endpoint"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let already_configured = match query.output() {
        Ok(out) => String::from_utf8_lossy(&out.stdout).contains("https://"),
        Err(_) => false,
    };
    if already_configured {
        return;
    }
    let mut set = base_command(cli, None);
    set.args(["config", "set", "endpoint", SEEDLING_ENDPOINT])
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let _ = set.status();
}

/// 解析可用的 CLI：PATH → 标准安装目录 → 应用缓存 → 自动下载。
fn resolve_cli(app: &AppHandle) -> Result<ResolvedCli, String> {
    let result = (|| {
        let mut tried = Vec::new();

        if let Some(version) = probe_cli(Path::new("seedling")) {
            return Ok(ResolvedCli {
                path: PathBuf::from("seedling"),
                version,
                source: "path",
            });
        }

        for candidate in standard_install_candidates() {
            if !candidate.is_file() {
                continue;
            }
            if let Some(version) = probe_cli(&candidate) {
                if version_at_least(&version, MIN_VERSION) {
                    return Ok(ResolvedCli {
                        path: candidate.clone(),
                        version,
                        source: "system",
                    });
                }
                tried.push(format!(
                    "{}（v{version} 低于最低要求 v{MIN_VERSION}）",
                    candidate.display()
                ));
            }
        }

        let managed = managed_cli_path(app)?;
        if managed.is_file() {
            if let Some(version) = probe_cli(&managed) {
                if version_at_least(&version, MIN_VERSION) {
                    return Ok(ResolvedCli {
                        path: managed.clone(),
                        version,
                        source: "bundled",
                    });
                }
                tried.push(format!(
                    "{}（v{version} 低于最低要求 v{MIN_VERSION}）",
                    managed.display()
                ));
            }
        }

        if let Ok(path) = download_cli(app) {
            if let Some(version) = probe_cli(&path) {
                return Ok(ResolvedCli {
                    path,
                    version,
                    source: "bundled",
                });
            }
        }

        if tried.is_empty() {
            Err("未找到已安装的 seedling，且自动下载失败。请在设置中检测或手动安装".to_string())
        } else {
            Err(format!("未找到可用的 seedling CLI：{}", tried.join("；")))
        }
    })();

    if let Ok(cli) = &result {
        // 应用内下载的 CLI 缺少 endpoint 配置，补写官方默认地址
        ensure_seedling_endpoint(cli);
    }
    result
}

// ──────────────────────────────────────────────
// CLI 执行器
// ──────────────────────────────────────────────

fn base_command(cli: &ResolvedCli, api_token: Option<&str>) -> Command {
    let mut cmd = Command::new(&cli.path);
    cmd.arg("--no-color");
    if let Some(token) = api_token.filter(|t| !t.trim().is_empty()) {
        cmd.env("SEEDLING_TOKEN", token);
    }
    no_window(&mut cmd);
    cmd
}

/// 执行 CLI 命令并解析 JSON 输出；非零退出码返回 stderr/输出尾部。
fn run_cli_json(
    cli: &ResolvedCli,
    api_token: Option<&str>,
    args: &[&str],
) -> Result<serde_json::Value, String> {
    let mut cmd = base_command(cli, api_token);
    cmd.args(args)
        .arg("--json")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let out = cmd.output().map_err(|e| format!("执行 seedling 失败: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
    if !out.status.success() {
        let detail = if !stderr.trim().is_empty() {
            stderr.trim()
        } else {
            stdout.trim()
        };
        return Err(format!(
            "seedling 命令失败 (exit {}): {}",
            out.status.code().unwrap_or(-1),
            truncate(detail, ERROR_DETAIL_LIMIT)
        ));
    }
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Ok(serde_json::Value::Null);
    }
    serde_json::from_str(trimmed).map_err(|e| format!("解析 seedling 输出失败: {e}"))
}

/// 执行 CLI 命令并返回文本输出（用于 download / logout 等无 JSON 的命令）。
fn run_cli_text(
    cli: &ResolvedCli,
    api_token: Option<&str>,
    args: &[&str],
) -> Result<String, String> {
    let mut cmd = base_command(cli, api_token);
    cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());
    let out = cmd.output().map_err(|e| format!("执行 seedling 失败: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
    if !out.status.success() {
        let detail = if !stderr.trim().is_empty() {
            stderr.trim()
        } else {
            stdout.trim()
        };
        return Err(format!(
            "seedling 命令失败 (exit {}): {}",
            out.status.code().unwrap_or(-1),
            truncate(detail, ERROR_DETAIL_LIMIT)
        ));
    }
    Ok(stdout.trim().to_string())
}

async fn run_cli_json_blocking(
    app: AppHandle,
    api_token: Option<String>,
    args: Vec<String>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cli = resolve_cli(&app)?;
        let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        run_cli_json(&cli, api_token.as_deref(), &arg_refs)
    })
    .await
    .map_err(|e| format!("执行 seedling 失败: {e}"))?
}

// ──────────────────────────────────────────────
// 认证状态解析
// ──────────────────────────────────────────────

#[derive(Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    logged_in: bool,
    username: String,
    endpoint: String,
    token_preview: String,
    token_source: String,
    message: String,
}

fn parse_auth_status(text: &str) -> AuthStatus {
    let mut status = AuthStatus::default();
    for line in text.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("在线验证:") {
            let rest = rest.trim();
            if rest.contains("有效") {
                status.logged_in = true;
                if let Some(open) = rest.find('（') {
                    let username_start = open + '（'.len_utf8();
                    if let Some(relative_close) = rest[username_start..].find('）') {
                        status.username =
                            rest[username_start..username_start + relative_close].to_string();
                    }
                }
                if status.username.is_empty() {
                    status.username = rest.to_string();
                }
            } else {
                status.message = rest.to_string();
            }
        } else if let Some(rest) = line.strip_prefix("endpoint:") {
            status.endpoint = rest.trim().to_string();
        } else if let Some(rest) = line.strip_prefix("token 预览:") {
            status.token_preview = rest.trim().to_string();
        } else if let Some(rest) = line.strip_prefix("token 来源:") {
            status.token_source = rest.trim().to_string();
        }
    }
    status
}

/// 查询认证状态；`api_token` 非空时以环境变量方式验证（CLI 优先级 env > file）。
fn fetch_auth_status(cli: &ResolvedCli, api_token: Option<&str>) -> AuthStatus {
    let mut cmd = base_command(cli, api_token);
    cmd.args(["auth", "status"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    match cmd.output() {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let mut status = parse_auth_status(&stdout);
            if !out.status.success() && status.message.is_empty() {
                status.message = "登录状态无效或未登录".to_string();
            }
            status
        }
        Err(_) => AuthStatus {
            message: "无法执行认证状态查询".to_string(),
            ..Default::default()
        },
    }
}

// ──────────────────────────────────────────────
// 状态与模型命令
// ──────────────────────────────────────────────

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliStatus {
    found: bool,
    source: String,
    version: Option<String>,
    auth: Option<AuthStatus>,
    error: Option<String>,
}

#[tauri::command]
pub async fn seedling_cli_status(
    app: AppHandle,
    api_token: Option<String>,
) -> Result<CliStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let token = api_token.as_deref();
        match resolve_cli(&app) {
            Ok(cli) => {
                let auth = fetch_auth_status(&cli, token);
                Ok(CliStatus {
                    found: true,
                    source: cli.source.to_string(),
                    version: Some(cli.version.clone()),
                    auth: Some(auth),
                    error: None,
                })
            }
            Err(error) => Ok(CliStatus {
                found: false,
                source: "missing".to_string(),
                version: None,
                auth: None,
                error: Some(error),
            }),
        }
    })
    .await
    .map_err(|e| format!("查询 Seedling 状态失败: {e}"))?
}

#[tauri::command]
pub async fn seedling_models(
    app: AppHandle,
    api_token: Option<String>,
) -> Result<serde_json::Value, String> {
    let args = vec!["models".to_string(), "list".to_string()];
    run_cli_json_blocking(app, api_token, args).await
}

/// 显式安装 / 更新应用内置 CLI：强制从官方 CDN 下载最新版到应用数据目录缓存，
/// 并补写 endpoint 配置。安装成功后返回最新 CLI 状态，前端据此刷新界面。
#[tauri::command]
pub async fn seedling_install_cli(app: AppHandle) -> Result<CliStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = download_cli(&app)?;
        let version = probe_cli(&path).ok_or_else(|| "Seedling CLI 安装后校验失败".to_string())?;
        let cli = ResolvedCli {
            path,
            version: version.clone(),
            source: "bundled",
        };
        ensure_seedling_endpoint(&cli);
        let auth = fetch_auth_status(&cli, None);
        Ok(CliStatus {
            found: true,
            source: "bundled".to_string(),
            version: Some(version),
            auth: Some(auth),
            error: None,
        })
    })
    .await
    .map_err(|e| format!("安装 Seedling CLI 失败: {e}"))?
}

// ──────────────────────────────────────────────
// 任务命令（参数白名单校验）
// ──────────────────────────────────────────────

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCreateParams {
    prompt: String,
    #[serde(default)]
    model: String,
    #[serde(default)]
    duration: Option<u32>,
    #[serde(default)]
    resolution: String,
    #[serde(default)]
    ratio: String,
    #[serde(default)]
    audio: bool,
    #[serde(default)]
    resources: Vec<String>,
}

fn validate_task_create(params: &TaskCreateParams) -> Result<Vec<String>, String> {
    let prompt = params.prompt.trim();
    if prompt.is_empty() {
        return Err("提示词不能为空".to_string());
    }
    if prompt.chars().count() > PROMPT_MAX_CHARS {
        return Err(format!("提示词过长（最多 {PROMPT_MAX_CHARS} 字符）"));
    }

    let mut args = vec![
        "task".to_string(),
        "create".to_string(),
        "--prompt".to_string(),
        prompt.to_string(),
    ];

    if !params.model.trim().is_empty() {
        if params.model.trim().chars().count() > 100 {
            return Err("模型 ID 过长".to_string());
        }
        args.push("--model".to_string());
        args.push(params.model.trim().to_string());
    }

    if let Some(duration) = params.duration {
        if !(4..=15).contains(&duration) {
            return Err("视频时长必须在 4~15 秒之间".to_string());
        }
        args.push("--duration".to_string());
        args.push(duration.to_string());
    }

    if !params.resolution.trim().is_empty() {
        let resolution = params.resolution.trim();
        if !ALLOWED_RESOLUTIONS.contains(&resolution) {
            return Err(format!("不支持的分辨率: {resolution}"));
        }
        args.push("--resolution".to_string());
        args.push(resolution.to_string());
    }

    if !params.ratio.trim().is_empty() {
        let ratio = params.ratio.trim();
        if !ALLOWED_RATIOS.contains(&ratio) {
            return Err(format!("不支持的画面比例: {ratio}"));
        }
        args.push("--ratio".to_string());
        args.push(ratio.to_string());
    }

    if params.audio {
        args.push("--audio".to_string());
    }

    for resource in &params.resources {
        let item = resource.trim();
        if item.is_empty() {
            continue;
        }
        if item.starts_with("http://") || item.starts_with("https://") {
            if item.len() > 2000 {
                return Err("参考素材 URL 过长".to_string());
            }
        } else {
            let path = PathBuf::from(item);
            if !path.is_absolute() || !path.is_file() {
                return Err(format!("参考素材必须是远程 URL 或本地存在的绝对路径: {item}"));
            }
        }
        args.push("--resource".to_string());
        args.push(item.to_string());
    }

    Ok(args)
}

#[tauri::command]
pub async fn seedling_task_create(
    app: AppHandle,
    params: TaskCreateParams,
    api_token: Option<String>,
) -> Result<serde_json::Value, String> {
    let args = validate_task_create(&params)?;
    run_cli_json_blocking(app, api_token, args).await
}

#[tauri::command]
pub async fn seedling_task_get(
    app: AppHandle,
    task_id: u64,
    api_token: Option<String>,
) -> Result<serde_json::Value, String> {
    let args = vec!["task".to_string(), "get".to_string(), task_id.to_string()];
    run_cli_json_blocking(app, api_token, args).await
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskListParams {
    #[serde(default)]
    status: String,
    #[serde(default)]
    limit: Option<u32>,
    #[serde(default)]
    offset: Option<u32>,
}

#[tauri::command]
pub async fn seedling_task_list(
    app: AppHandle,
    params: TaskListParams,
    api_token: Option<String>,
) -> Result<serde_json::Value, String> {
    let mut args = vec!["task".to_string(), "list".to_string()];
    if !params.status.trim().is_empty() {
        let status = params.status.trim();
        for part in status.split(',') {
            let item = part.trim();
            if !ALLOWED_TASK_STATUSES.contains(&item) {
                return Err(format!("不支持的任务状态: {item}"));
            }
        }
        args.push("--status".to_string());
        args.push(status.to_string());
    }
    if let Some(limit) = params.limit {
        if !(1..=100).contains(&limit) {
            return Err("每页数量必须在 1~100 之间".to_string());
        }
        args.push("--limit".to_string());
        args.push(limit.to_string());
    }
    if let Some(offset) = params.offset {
        args.push("--offset".to_string());
        args.push(offset.to_string());
    }
    run_cli_json_blocking(app, api_token, args).await
}

#[tauri::command]
pub async fn seedling_task_cancel(
    app: AppHandle,
    task_id: u64,
    api_token: Option<String>,
) -> Result<serde_json::Value, String> {
    let args = vec!["task".to_string(), "cancel".to_string(), task_id.to_string()];
    run_cli_json_blocking(app, api_token, args).await
}

// ──────────────────────────────────────────────
// 下载与素材上传（路径经 path_policy 授权）
// ──────────────────────────────────────────────

#[tauri::command]
pub async fn seedling_task_download(
    app: AppHandle,
    webview: Webview,
    task_id: u64,
    output: String,
    api_token: Option<String>,
) -> Result<String, String> {
    ensure_trusted_caller(&webview)?;
    let output_path = authorize_path(&app, &output, PathAccess::Write)?;
    tauri::async_runtime::spawn_blocking(move || {
        let cli = resolve_cli(&app)?;
        let args = vec![
            "task".to_string(),
            "download".to_string(),
            task_id.to_string(),
            "--output".to_string(),
            output_path.to_string_lossy().into_owned(),
        ];
        let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        run_cli_text(&cli, api_token.as_deref(), &arg_refs)
    })
    .await
    .map_err(|e| format!("执行 seedling 下载失败: {e}"))?
}

#[tauri::command]
pub async fn seedling_resource_upload(
    app: AppHandle,
    webview: Webview,
    file_path: String,
    api_token: Option<String>,
) -> Result<serde_json::Value, String> {
    ensure_trusted_caller(&webview)?;
    let file = authorize_path(&app, &file_path, PathAccess::Read)?;
    tauri::async_runtime::spawn_blocking(move || {
        let cli = resolve_cli(&app)?;
        let args = vec![
            "resource".to_string(),
            "upload".to_string(),
            file.to_string_lossy().into_owned(),
        ];
        let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        run_cli_json(&cli, api_token.as_deref(), &arg_refs)
    })
    .await
    .map_err(|e| format!("执行 seedling 上传失败: {e}"))?
}

// ──────────────────────────────────────────────
// 登录 / 退出（方式 A：CLI 浏览器授权）
// ──────────────────────────────────────────────

#[derive(Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthLoginRuntime {
    active: bool,
    /// idle / preparing / starting / oauth_ready / polling / success / failed
    phase: String,
    message: String,
    error: String,
    verification_url: String,
    user_code: String,
    username: String,
}

fn state() -> &'static Mutex<AuthLoginRuntime> {
    static S: OnceLock<Mutex<AuthLoginRuntime>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(AuthLoginRuntime::default()))
}

fn login_child() -> &'static Mutex<Option<Child>> {
    static C: OnceLock<Mutex<Option<Child>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(None))
}

fn snapshot() -> AuthLoginRuntime {
    state().lock().unwrap().clone()
}

fn update<F: FnOnce(&mut AuthLoginRuntime)>(app: &AppHandle, f: F) -> AuthLoginRuntime {
    let snap = {
        let mut guard = state().lock().unwrap();
        f(&mut guard);
        guard.clone()
    };
    let _ = app.emit(RUNTIME_EVENT, snap.clone());
    snap
}

fn fail(app: &AppHandle, message: &str) {
    update(app, |r| {
        r.active = false;
        r.phase = "failed".into();
        r.error = message.to_string();
        r.message = message.to_string();
    });
}

/// 按平台打开授权链接（自动呼出默认浏览器）。
#[cfg(windows)]
fn open_url(url: &str) {
    let mut cmd = Command::new("cmd");
    cmd.args(["/c", "start", "", url]).stdout(Stdio::null()).stderr(Stdio::null());
    no_window(&mut cmd);
    let _ = cmd.spawn();
}
#[cfg(target_os = "macos")]
fn open_url(url: &str) {
    let _ = Command::new("open").arg(url).stdout(Stdio::null()).stderr(Stdio::null()).spawn();
}
#[cfg(all(not(windows), not(target_os = "macos")))]
fn open_url(url: &str) {
    let _ = Command::new("xdg-open").arg(url).stdout(Stdio::null()).stderr(Stdio::null()).spawn();
}

/// 从登录 JSON 对象提取 (授权链接, 配对码)；链接优先取带配对码的完整变体。
/// 供 `extract_login_fields` 使用，纯逻辑便于单元测试。
fn extract_login_pair(value: &serde_json::Value) -> (Option<String>, Option<String>) {
    let Some(obj) = value.as_object() else {
        return (None, None);
    };
    let mut url = String::new();
    let mut url_complete = String::new();
    let mut code = String::new();
    for (key, val) in obj {
        let lower = key.to_lowercase();
        let Some(text) = val.as_str() else {
            continue;
        };
        // 带配对码的完整授权链接（verificationUriComplete / verification_uri_complete）单独保存。
        // 注意 serde_json 默认按 key 排序，verificationUri 可能先于 complete 变体出现，
        // 因此不能只在 url 为空时赋值，必须最后用 complete 变体覆盖普通链接。
        if lower.contains("verification") && lower.contains("complete") {
            if url_complete.is_empty() {
                url_complete = text.to_string();
            }
        } else if (lower.contains("verification") || lower.contains("uri")) && url.is_empty() {
            url = text.to_string();
        } else if lower.contains("user_code") || lower.contains("code") {
            // 配对码是短字符串（如 ZJ4J-3NX7），避免误抓长 URL
            if code.is_empty() && text.len() <= 32 {
                code = text.to_string();
            }
        }
    }
    if !url_complete.is_empty() {
        url = url_complete;
    }
    (
        if url.is_empty() { None } else { Some(url) },
        if code.is_empty() { None } else { Some(code) },
    )
}

/// 从解析好的登录 JSON 对象提取授权链接与配对码；成功则更新运行态并返回 true。
/// 提取成功后自动呼出浏览器（链接已带配对码参数，可直接完成授权）。
fn extract_login_fields(app: &AppHandle, value: &serde_json::Value) -> bool {
    let (url, code) = extract_login_pair(value);
    let Some(url) = url else {
        return false;
    };
    update(app, |r| {
        r.active = true;
        r.phase = "oauth_ready".into();
        r.message = "请在浏览器中确认配对码并完成授权".into();
        r.verification_url = url.clone();
        if let Some(code) = code {
            r.user_code = code;
        }
    });
    open_url(&url);
    true
}

fn run_login_sequence(app: AppHandle) {
    let cli = match resolve_cli(&app) {
        Ok(cli) => cli,
        Err(e) => {
            fail(&app, &format!("无法使用 Seedling CLI: {e}"));
            return;
        }
    };
    update(&app, |r| {
        r.active = true;
        r.phase = "starting".into();
        r.message = "正在启动 Seedling 浏览器授权…".into();
        r.verification_url.clear();
        r.user_code.clear();
        r.error.clear();
    });

    let mut cmd = base_command(&cli, None);
    cmd.args(["auth", "login", "--no-browser", "--json"])
        .stdout(Stdio::piped())
        // stderr 重定向到空设备而不是 piped：授权成功/失败信息会写 stderr，
        // 管道读端被 drop 后写端可能收到 EPIPE/BrokenPipe，影响 CLI 退出行为。
        .stderr(Stdio::null());
    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(e) => {
            fail(&app, &format!("启动 Seedling 登录失败: {e}"));
            return;
        }
    };
    let Some(stdout) = child.stdout.take() else {
        fail(&app, "无法读取 Seedling 登录输出");
        return;
    };
    *login_child().lock().unwrap() = Some(child);

    // 逐行累积读取 stdout：CLI 输出的是多行 JSON，需拼成完整对象后再解析；
    // 读到 EOF（进程结束：授权完成、超时或被取消）后停止。
    let reader = BufReader::new(stdout);
    let mut buffer = String::new();
    let mut stdout_tail = String::new();
    for line in reader.lines() {
        match line {
            Ok(text) => {
                buffer.push_str(&text);
                buffer.push('\n');
                if stdout_tail.len() > 1600 {
                    stdout_tail.clear();
                }
                stdout_tail.push_str(&text);
                stdout_tail.push('\n');
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&buffer) {
                    if extract_login_fields(&app, &value) {
                        buffer.clear();
                    }
                }
            }
            Err(_) => break,
        }
    }

    let status = {
        let mut guard = login_child().lock().unwrap();
        let taken = guard.take();
        match taken {
            Some(mut child) => child.wait(),
            None => Ok(ExitStatus::default()),
        }
    };

    match status {
        Ok(s) if s.success() => {
            let auth = fetch_auth_status(&cli, None);
            update(&app, |r| {
                r.active = false;
                r.phase = "success".into();
                r.message = "登录成功".into();
                r.username = if auth.logged_in && !auth.username.is_empty() {
                    auth.username
                } else {
                    "Seedling 用户".into()
                };
            });
        }
        Ok(s) => fail(
            &app,
            &format!(
                "登录未完成（CLI 退出码 {}）：可能已取消、超时或授权被拒绝\nCLI 输出：{}",
                s.code().map_or_else(|| "未知".to_string(), |c| c.to_string()),
                truncate(&stdout_tail, ERROR_DETAIL_LIMIT)
            ),
        ),
        Err(e) => fail(&app, &format!("等待登录结果失败: {e}")),
    }
}

#[tauri::command]
pub fn seedling_auth_login_start(app: AppHandle) -> AuthLoginRuntime {
    {
        let guard = state().lock().unwrap();
        if guard.active {
            return guard.clone();
        }
    }
    let app2 = app.clone();
    std::thread::spawn(move || run_login_sequence(app2));
    snapshot()
}

#[tauri::command]
pub fn seedling_auth_login_runtime() -> AuthLoginRuntime {
    snapshot()
}

#[tauri::command]
pub fn seedling_auth_login_cancel() -> AuthLoginRuntime {
    let killed = {
        let mut guard = login_child().lock().unwrap();
        match guard.take() {
            Some(mut child) => {
                let _ = child.kill();
                true
            }
            None => false,
        }
    };
    let mut guard = state().lock().unwrap();
    if guard.active {
        guard.active = false;
        guard.phase = "idle".into();
        guard.message = if killed { "已取消登录".into() } else { guard.message.clone() };
    }
    guard.clone()
}

#[tauri::command]
pub async fn seedling_auth_logout(
    app: AppHandle,
    webview: Webview,
) -> Result<AuthLoginRuntime, String> {
    ensure_trusted_caller(&webview)?;
    tauri::async_runtime::spawn_blocking(move || {
        let cli = match resolve_cli(&app) {
            Ok(cli) => cli,
            Err(e) => return Err(format!("无法使用 Seedling CLI: {e}")),
        };
        let args = vec!["auth".to_string(), "logout".to_string(), "--local".to_string()];
        let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        match run_cli_text(&cli, None, &arg_refs) {
            Ok(_) => Ok(update(&app, |r| {
                r.active = false;
                r.phase = "idle".into();
                r.message = "已退出登录".into();
                r.username.clear();
            })),
            Err(e) => Err(e),
        }
    })
    .await
    .map_err(|e| format!("退出 Seedling 登录失败: {e}"))?
}

// ──────────────────────────────────────────────
// 单元测试
// ──────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_version() {
        assert_eq!(parse_version("seedling v0.0.4"), Some("0.0.4".to_string()));
        assert_eq!(parse_version("seedling v0.1.0"), Some("0.1.0".to_string()));
        assert_eq!(parse_version("v1.2.3"), Some("1.2.3".to_string()));
        assert_eq!(parse_version("seedling version: 0.0.7"), Some("0.0.7".to_string()));
        assert_eq!(parse_version("no version here"), None);
    }

    #[test]
    fn compares_versions() {
        assert!(version_at_least("0.0.4", "0.0.4"));
        assert!(version_at_least("0.0.5", "0.0.4"));
        assert!(version_at_least("0.1.0", "0.0.9"));
        assert!(version_at_least("1.0.0", "0.9.9"));
        assert!(!version_at_least("0.0.3", "0.0.4"));
        assert!(!version_at_least("0.0.4", "0.0.5"));
    }

    #[test]
    fn parses_auth_status_lines() {
        let text = "token 来源:    file\ntoken 预览:    sl_2BDzS****\nendpoint 来源: file\nendpoint:      https://seedling.p.ykss.com.cn\n配置文件:      C:\\x\\config.json\n在线验证:      ✓ 有效（杨珺言）\n";
        let status = parse_auth_status(text);
        assert!(status.logged_in);
        assert_eq!(status.username, "杨珺言");
        assert_eq!(status.endpoint, "https://seedling.p.ykss.com.cn");
        assert_eq!(status.token_preview, "sl_2BDzS****");
        assert_eq!(status.token_source, "file");
        assert!(status.message.is_empty());
    }

    #[test]
    fn parses_invalid_auth_status() {
        let status = parse_auth_status("在线验证:      ✗ 未登录或令牌已失效\n");
        assert!(!status.logged_in);
        assert!(!status.message.is_empty());
    }

    #[test]
    fn validates_task_create_args() {
        let params = TaskCreateParams {
            prompt: "测试提示词".to_string(),
            model: "quality".to_string(),
            duration: Some(8),
            resolution: "720p".to_string(),
            ratio: "16:9".to_string(),
            audio: true,
            resources: vec!["https://example.com/a.jpg".to_string()],
        };
        let args = validate_task_create(&params).unwrap();
        assert!(args.contains(&"--prompt".to_string()));
        assert!(args.contains(&"--model".to_string()));
        assert!(args.contains(&"--duration".to_string()));
        assert!(args.contains(&"8".to_string()));
        assert!(args.contains(&"--resolution".to_string()));
        assert!(args.contains(&"--ratio".to_string()));
        assert!(args.contains(&"--audio".to_string()));
        assert!(args.contains(&"--resource".to_string()));
        assert!(args.contains(&"https://example.com/a.jpg".to_string()));
    }

    #[test]
    fn extracts_login_pair_prefers_complete_url() {
        // 与真实 CLI 输出一致的多行 JSON（键按字母序：expiresIn < userCode < verificationUri < verificationUriComplete）
        let value: serde_json::Value = serde_json::from_str(
            "{\n  \"verificationUri\": \"https://seedling.p.ykss.com.cn/cli/auth\",\n  \"verificationUriComplete\": \"https://seedling.p.ykss.com.cn/cli/auth?code=ZJ4J-3NX7\",\n  \"userCode\": \"ZJ4J-3NX7\",\n  \"expiresIn\": 600\n}",
        ).unwrap();
        let (url, code) = extract_login_pair(&value);
        assert_eq!(
            url.as_deref(),
            Some("https://seedling.p.ykss.com.cn/cli/auth?code=ZJ4J-3NX7")
        );
        assert_eq!(code.as_deref(), Some("ZJ4J-3NX7"));
    }

    #[test]
    fn extracts_login_pair_falls_back_to_plain_url() {
        let value: serde_json::Value = serde_json::from_str(
            "{\"verificationUri\":\"https://example.com/auth\",\"userCode\":\"ABC-123\"}",
        ).unwrap();
        let (url, code) = extract_login_pair(&value);
        assert_eq!(url.as_deref(), Some("https://example.com/auth"));
        assert_eq!(code.as_deref(), Some("ABC-123"));
    }

    #[test]
    fn extracts_login_pair_returns_none_for_irrelevant_json() {
        let value: serde_json::Value = serde_json::from_str("{\"foo\":\"bar\"}").unwrap();
        let (url, code) = extract_login_pair(&value);
        assert!(url.is_none());
        assert!(code.is_none());
    }

    #[test]
    fn rejects_invalid_task_create() {
        assert!(validate_task_create(&TaskCreateParams {
            prompt: "".to_string(),
            model: String::new(),
            duration: None,
            resolution: String::new(),
            ratio: String::new(),
            audio: false,
            resources: vec![],
        })
        .is_err());

        assert!(validate_task_create(&TaskCreateParams {
            prompt: "ok".to_string(),
            model: String::new(),
            duration: Some(20),
            resolution: String::new(),
            ratio: String::new(),
            audio: false,
            resources: vec![],
        })
        .is_err());

        assert!(validate_task_create(&TaskCreateParams {
            prompt: "ok".to_string(),
            model: String::new(),
            duration: None,
            resolution: "8K".to_string(),
            ratio: String::new(),
            audio: false,
            resources: vec![],
        })
        .is_err());

        assert!(validate_task_create(&TaskCreateParams {
            prompt: "ok".to_string(),
            model: String::new(),
            duration: None,
            resolution: String::new(),
            ratio: "3:2".to_string(),
            audio: false,
            resources: vec![],
        })
        .is_err());

        // 本地素材必须是存在的绝对路径
        assert!(validate_task_create(&TaskCreateParams {
            prompt: "ok".to_string(),
            model: String::new(),
            duration: None,
            resolution: String::new(),
            ratio: String::new(),
            audio: false,
            resources: vec!["relative/path.png".to_string()],
        })
        .is_err());
    }
}
