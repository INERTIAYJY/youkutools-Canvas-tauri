//! 视频播放兼容：HEVC(10bit) 结果按需转码为 H.264，并负责 ffmpeg 的定位与按需下载。
//!
//! 背景：森之灵新版 CLI/服务端输出的视频编码从 H.264 8bit 变为 HEVC Main10(10bit)，
//! WebView2 无法解码 10bit HEVC，播放器会报「视频格式或编码不兼容」。这里提供：
//! 1. 无依赖的编码探测（解析 MP4 sample entry，不调用 ffmpeg）；
//! 2. ffmpeg 定位（应用数据目录 → PATH → 常见安装目录）；
//! 3. 缺失时按需下载精简包并解压出 ffmpeg；
//! 4. HEVC → H.264(yuv420p) 转码，保留原片。

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, Webview};

use crate::path_policy::{authorize_app_owned_path, ensure_trusted_caller, PathAccess};

const DOWNLOAD_URLS: [&str; 2] = [
    "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
    "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip",
];

const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(20 * 60);
const TRANSCODE_TIMEOUT: Duration = Duration::from_secs(30 * 60);
/// 读取 MP4 头尾各 4MB 用于编码探测，避免整片读入内存。
const PROBE_WINDOW: u64 = 4 * 1024 * 1024;

#[cfg(windows)]
fn no_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
}
#[cfg(not(windows))]
fn no_window(_cmd: &mut Command) {}

fn ffmpeg_exe_name() -> &'static str {
    if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" }
}

fn managed_ffmpeg_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {e}"))?
        .join("tools")
        .join("ffmpeg");
    Ok(dir.join(ffmpeg_exe_name()))
}

fn probe_ffmpeg(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    let mut cmd = Command::new(path);
    cmd.arg("-version").stdout(Stdio::null()).stderr(Stdio::null());
    no_window(&mut cmd);
    cmd.status().map(|status| status.success()).unwrap_or(false)
}

/// 常见安装位置（覆盖 winget / 官方 zip / scoop 等）。
fn standard_candidates() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    for key in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA", "USERPROFILE"] {
        if let Some(root) = std::env::var_os(key) {
            let root = PathBuf::from(root);
            dirs.push(root.join("ffmpeg").join("bin"));
            dirs.push(root.join("Programs").join("ffmpeg").join("bin"));
            dirs.push(root.join("scoop").join("apps").join("ffmpeg").join("current").join("bin"));
        }
    }
    dirs.push(PathBuf::from("C:\\ffmpeg\\bin"));
    dirs.iter().map(|dir| dir.join(ffmpeg_exe_name())).collect()
}

fn path_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            out.push(dir.join(ffmpeg_exe_name()));
        }
    }
    out
}

/// 返回可用的 ffmpeg 及其来源。顺序：应用自管 → PATH → 常见目录。
fn resolve_ffmpeg(app: &AppHandle) -> Option<(PathBuf, &'static str)> {
    if let Ok(managed) = managed_ffmpeg_path(app) {
        if probe_ffmpeg(&managed) {
            return Some((managed, "managed"));
        }
    }
    for candidate in path_candidates() {
        if probe_ffmpeg(&candidate) {
            return Some((candidate, "path"));
        }
    }
    for candidate in standard_candidates() {
        if probe_ffmpeg(&candidate) {
            return Some((candidate, "system"));
        }
    }
    None
}

fn extract_ffmpeg_from_zip(bytes: &[u8], target: &Path) -> Result<(), String> {
    let reader = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(reader).map_err(|e| format!("解压 ffmpeg 失败: {e}"))?;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| format!("读取 ffmpeg 压缩包失败: {e}"))?;
        let name = entry.name().replace('\\', "/");
        if !name.ends_with("/ffmpeg.exe") && name != "ffmpeg.exe" && !name.ends_with("/ffmpeg") {
            continue;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建 ffmpeg 目录失败: {e}"))?;
        }
        let mut out = std::fs::File::create(target).map_err(|e| format!("写入 ffmpeg 失败: {e}"))?;
        std::io::copy(&mut entry, &mut out).map_err(|e| format!("写入 ffmpeg 失败: {e}"))?;
        drop(out);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(target, std::fs::Permissions::from_mode(0o755));
        }
        return Ok(());
    }
    Err("压缩包内未找到 ffmpeg 可执行文件".to_string())
}

fn download_ffmpeg(target: &Path) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(DOWNLOAD_TIMEOUT)
        .build()
        .map_err(|e| format!("创建下载客户端失败: {e}"))?;
    let mut last_error = String::new();
    for url in DOWNLOAD_URLS {
        let result = client
            .get(url)
            .send()
            .and_then(|response| response.error_for_status())
            .and_then(|response| response.bytes());
        match result {
            Ok(bytes) => match extract_ffmpeg_from_zip(&bytes, target) {
                Ok(()) => {
                    if probe_ffmpeg(target) {
                        return Ok(());
                    }
                    last_error = "下载的 ffmpeg 校验失败".to_string();
                }
                Err(error) => last_error = error,
            },
            Err(error) => last_error = format!("{error}"),
        }
    }
    Err(format!("下载 ffmpeg 失败：{last_error}"))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegStatus {
    found: bool,
    path: Option<String>,
    source: String,
}

#[tauri::command]
pub async fn ffmpeg_status(
    app: AppHandle,
    webview: Webview,
) -> Result<FfmpegStatus, String> {
    ensure_trusted_caller(&webview)?;
    Ok(match resolve_ffmpeg(&app) {
        Some((path, source)) => FfmpegStatus {
            found: true,
            path: Some(path.to_string_lossy().into_owned()),
            source: source.to_string(),
        },
        None => FfmpegStatus {
            found: false,
            path: None,
            source: "missing".to_string(),
        },
    })
}

/// 确保 ffmpeg 可用：已有时直接返回，缺失时下载精简包到应用数据目录。
#[tauri::command]
pub async fn ffmpeg_ensure(
    app: AppHandle,
    webview: Webview,
) -> Result<FfmpegStatus, String> {
    ensure_trusted_caller(&webview)?;
    if let Some((path, source)) = resolve_ffmpeg(&app) {
        return Ok(FfmpegStatus {
            found: true,
            path: Some(path.to_string_lossy().into_owned()),
            source: source.to_string(),
        });
    }
    let target = managed_ffmpeg_path(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        if probe_ffmpeg(&target) {
            return Ok(target);
        }
        download_ffmpeg(&target)?;
        Ok::<PathBuf, String>(target)
    })
    .await
    .map_err(|e| format!("准备 ffmpeg 失败: {e}"))?
    .map(|path| FfmpegStatus {
        found: true,
        path: Some(path.to_string_lossy().into_owned()),
        source: "managed".to_string(),
    })
}

/// 读取 MP4 sample entry 判断编码，不依赖 ffmpeg。
fn detect_codec(path: &Path) -> Result<&'static str, String> {
    let metadata = std::fs::metadata(path).map_err(|e| format!("读取视频信息失败: {e}"))?;
    let length = metadata.len();
    let window = PROBE_WINDOW.min(length.max(1));
    let mut head = vec![0u8; window as usize];
    let mut file = std::fs::File::open(path).map_err(|e| format!("打开视频失败: {e}"))?;
    let read = file.read(&mut head).map_err(|e| format!("读取视频失败: {e}"))?;
    let mut buffer = head[..read].to_vec();
    if length > window * 2 {
        use std::io::Seek;
        file.seek(std::io::SeekFrom::End(-(window as i64)))
            .map_err(|e| format!("读取视频失败: {e}"))?;
        let mut tail = vec![0u8; window as usize];
        let read_tail = file.read(&mut tail).map_err(|e| format!("读取视频失败: {e}"))?;
        buffer.extend_from_slice(&tail[..read_tail]);
    }
    let has = |tag: &[u8; 4]| buffer.windows(4).any(|chunk| chunk == tag);
    if has(b"hvc1") || has(b"hev1") {
        return Ok("hevc");
    }
    if has(b"avc1") || has(b"avc3") {
        return Ok("h264");
    }
    if has(b"av01") {
        return Ok("av1");
    }
    Ok("unknown")
}

#[tauri::command]
pub async fn video_probe_codec(
    app: AppHandle,
    webview: Webview,
    path: String,
) -> Result<serde_json::Value, String> {
    ensure_trusted_caller(&webview)?;
    let file = authorize_app_owned_path(&app, &path, PathAccess::Read)?;
    let codec = detect_codec(&file)?;
    Ok(serde_json::json!({ "codec": codec }))
}

fn default_output_path(input: &Path) -> PathBuf {
    let stem = input.file_stem().map(|value| value.to_string_lossy().into_owned()).unwrap_or_else(|| "video".to_string());
    let name = format!("{stem}_h264.mp4");
    input.with_file_name(name)
}

fn wait_with_deadline(child: &mut Child, deadline: Instant) -> Result<std::process::ExitStatus, String> {
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("视频转码超时".to_string());
                }
                std::thread::sleep(Duration::from_millis(400));
            }
            Err(error) => return Err(format!("等待转码进程失败: {error}")),
        }
    }
}

fn transcode(ffmpeg: &Path, input: &Path, output: &Path) -> Result<(), String> {
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建输出目录失败: {e}"))?;
    }
    if output.is_file() {
        let _ = std::fs::remove_file(output);
    }
    let mut command = Command::new(ffmpeg);
    command
        .arg("-y")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-i")
        .arg(input)
        .arg("-map")
        .arg("0:v:0")
        .arg("-map")
        .arg("0:a?")
        .arg("-c:v")
        .arg("libx264")
        .arg("-preset")
        .arg("veryfast")
        .arg("-crf")
        .arg("20")
        .arg("-pix_fmt")
        .arg("yuv420p")
        .arg("-c:a")
        .arg("aac")
        .arg("-b:a")
        .arg("192k")
        .arg("-movflags")
        .arg("+faststart")
        .arg(output)
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    no_window(&mut command);
    let mut child = command.spawn().map_err(|e| format!("启动 ffmpeg 失败: {e}"))?;
    let status = match wait_with_deadline(&mut child, Instant::now() + TRANSCODE_TIMEOUT) {
        Ok(status) => status,
        Err(error) => {
            let _ = std::fs::remove_file(output);
            return Err(error);
        }
    };
    let mut stderr = String::new();
    if let Some(mut pipe) = child.stderr.take() {
        let _ = pipe.read_to_string(&mut stderr);
    }
    if !status.success() || !output.is_file() {
        let _ = std::fs::remove_file(output);
        let detail: String = stderr.trim().chars().take(400).collect();
        return Err(if detail.is_empty() {
            "视频转码失败".to_string()
        } else {
            format!("视频转码失败: {detail}")
        });
    }
    Ok(())
}

/// 把视频转成 H.264(yuv420p)；已是 H.264 时直接返回原路径。
#[tauri::command]
pub async fn video_transcode_h264(
    app: AppHandle,
    webview: Webview,
    input_path: String,
    output_path: Option<String>,
) -> Result<serde_json::Value, String> {
    ensure_trusted_caller(&webview)?;
    let input = authorize_app_owned_path(&app, &input_path, PathAccess::Read)?;
    let codec = detect_codec(&input)?;
    if codec == "h264" {
        return Ok(serde_json::json!({
            "path": input.to_string_lossy(),
            "codec": codec,
            "transcoded": false,
        }));
    }
    let output = match output_path {
        Some(value) if !value.trim().is_empty() => {
            authorize_app_owned_path(&app, &value, PathAccess::Write)?
        }
        _ => default_output_path(&input),
    };
    let (ffmpeg, _) = resolve_ffmpeg(&app).ok_or_else(|| "未找到可用的 ffmpeg，请先准备解码组件".to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        transcode(&ffmpeg, &input, &output)?;
        Ok::<PathBuf, String>(output)
    })
    .await
    .map_err(|e| format!("执行转码失败: {e}"))?
    .map(|path| serde_json::json!({
        "path": path.to_string_lossy(),
        "codec": "h264",
        "transcoded": true,
    }))
}
