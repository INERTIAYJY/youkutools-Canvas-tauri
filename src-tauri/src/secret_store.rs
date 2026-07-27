//! 凭据存储 —— 由 Rust 独占的本地文件，Renderer 拿不到整份内容。
//!
//! API Key 以前随整份配置写进 IndexedDB：任何拿到 Renderer 执行权的代码（XSS、
//! 恶意项目数据、被注入的依赖）都能整库读走，磁盘上也留有明文。现在凭据只落在
//! `{appData}/secrets/credentials.json`，配置里只留条目名，Renderer 只能通过下面的
//! 命令按条目名逐条索取，无法枚举或整份导出。
//!
//! 该目录在三条访问路径上都被显式拒绝：fs 插件 scope、asset 协议 scope、
//! 以及自定义原生命令的 path_policy（见 `deny_secret_dir_access`）。少任何一条，
//! 被注入的 Renderer 都能绕开本模块直接读文件。
//!
//! 静态保护只有文件权限（unix 0600）：以当前用户身份运行的本地进程仍可读取。
//! 想再上一层需要系统钥匙串（macOS 未签名构建会反复弹授权）或 Windows DPAPI。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Manager, Runtime, Webview};

use crate::path_policy::ensure_trusted_caller;

/// 凭据目录名，path_policy 与 scope 拒绝规则都引用它。
pub const SECRET_DIR_NAME: &str = "secrets";
const SECRET_FILE_NAME: &str = "credentials.json";
/// 凭据目录下会出现的全部文件（含原子写入的临时文件）。
/// asset 协议 scope 只能按文件拒绝，新增文件时必须同步加进这里。
const SECRET_FILE_NAMES: [&str; 2] = [SECRET_FILE_NAME, "credentials.json.tmp"];
/// 单条凭据长度上限，避免被当成任意大小的存储滥用。
const MAX_SECRET_BYTES: usize = 8 * 1024;
const MAX_KEY_LEN: usize = 120;

/// 读改写不是原子操作，用进程内锁串行化，避免并发保存时丢条目。
static STORE_LOCK: Mutex<()> = Mutex::new(());

type SecretMap = BTreeMap<String, String>;

/// 条目名由前端按 `provider/{连接ID}` 生成，这里只做字符白名单。
fn validate_key(key: &str) -> Result<(), String> {
    if key.is_empty() || key.len() > MAX_KEY_LEN {
        return Err("凭据条目名长度不合法".to_string());
    }
    let allowed = key
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '/' | ':'));
    if !allowed {
        return Err("凭据条目名包含非法字符".to_string());
    }
    // 条目名固定由 `provider/{连接ID}` 生成，出现 `..` 只可能是拼接被污染
    if key.contains("..") {
        return Err("凭据条目名包含非法片段".to_string());
    }
    Ok(())
}

/// 凭据目录：`{appData}/secrets`。
pub fn secret_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录: {error}"))?;
    Ok(base.join(SECRET_DIR_NAME))
}

fn secret_file<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(secret_dir(app)?.join(SECRET_FILE_NAME))
}

/// unix 下把文件收紧到仅当前用户可读写；Windows 依赖用户目录自身的 ACL。
#[cfg(unix)]
fn restrict_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("设置凭据文件权限失败: {error}"))
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn read_map(file: &Path) -> Result<SecretMap, String> {
    match std::fs::read(file) {
        Ok(bytes) => serde_json::from_slice::<SecretMap>(&bytes)
            .map_err(|error| format!("凭据文件格式损坏: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(SecretMap::new()),
        Err(error) => Err(format!("读取凭据文件失败: {error}")),
    }
}

/// 先写临时文件再改名，避免写入中断留下半份凭据。
fn write_map(file: &Path, map: &SecretMap) -> Result<(), String> {
    let dir = file
        .parent()
        .ok_or_else(|| "凭据文件路径无效".to_string())?;
    std::fs::create_dir_all(dir).map_err(|error| format!("创建凭据目录失败: {error}"))?;

    let body = serde_json::to_vec(map).map_err(|error| format!("序列化凭据失败: {error}"))?;
    let temp = file.with_extension("json.tmp");
    std::fs::write(&temp, &body).map_err(|error| format!("写入凭据文件失败: {error}"))?;
    restrict_permissions(&temp)?;
    std::fs::rename(&temp, file).map_err(|error| format!("提交凭据文件失败: {error}"))?;
    restrict_permissions(file)
}

/// 写入或覆盖一条凭据。
#[tauri::command]
pub async fn secret_set(
    app: AppHandle,
    webview: Webview,
    key: String,
    value: String,
) -> Result<(), String> {
    ensure_trusted_caller(&webview)?;
    validate_key(&key)?;
    if value.is_empty() {
        return Err("凭据内容为空".to_string());
    }
    if value.len() > MAX_SECRET_BYTES {
        return Err("凭据内容超出长度上限".to_string());
    }

    let file = secret_file(&app)?;
    let _guard = STORE_LOCK.lock().map_err(|_| "凭据存储锁异常".to_string())?;
    let mut map = read_map(&file)?;
    map.insert(key, value);
    write_map(&file, &map)
}

/// 读取一条凭据；条目不存在返回 None（首次运行、用户手动清理都属正常）。
#[tauri::command]
pub async fn secret_get(
    app: AppHandle,
    webview: Webview,
    key: String,
) -> Result<Option<String>, String> {
    ensure_trusted_caller(&webview)?;
    validate_key(&key)?;

    let file = secret_file(&app)?;
    let _guard = STORE_LOCK.lock().map_err(|_| "凭据存储锁异常".to_string())?;
    Ok(read_map(&file)?.get(&key).cloned())
}

/// 删除一条凭据；条目本就不存在视为成功。
#[tauri::command]
pub async fn secret_delete(app: AppHandle, webview: Webview, key: String) -> Result<(), String> {
    ensure_trusted_caller(&webview)?;
    validate_key(&key)?;

    let file = secret_file(&app)?;
    let _guard = STORE_LOCK.lock().map_err(|_| "凭据存储锁异常".to_string())?;
    let mut map = read_map(&file)?;
    if map.remove(&key).is_none() {
        return Ok(());
    }
    write_map(&file, &map)
}

/// 凭据存储是否可用（能否创建目录）。前端据此决定是持久化还是仅本次会话有效。
#[tauri::command]
pub async fn secret_store_available(app: AppHandle, webview: Webview) -> Result<bool, String> {
    ensure_trusted_caller(&webview)?;
    let dir = secret_dir(&app)?;
    Ok(std::fs::create_dir_all(&dir).is_ok())
}

/// 把凭据目录从 fs 插件 scope 和 asset 协议 scope 中彻底拒掉。
/// 拒绝规则优先于允许规则，因此即使 `$APPDATA/**` 被放行，这个子目录仍不可达。
pub fn deny_secret_dir_access<R: Runtime>(app: &AppHandle<R>) {
    use tauri_plugin_fs::FsExt;

    let Ok(dir) = secret_dir(app) else {
        return;
    };
    if let Err(error) = app.fs_scope().forbid_directory(&dir, true) {
        eprintln!("[secret-store] 无法从 fs scope 拒绝凭据目录: {error}");
    }
    // asset 协议的 scope 只暴露按文件拒绝的接口，逐个拒掉已知文件名
    let scopes = app.state::<tauri::scope::Scopes>();
    for name in SECRET_FILE_NAMES {
        if let Err(error) = scopes.forbid_file(dir.join(name)) {
            eprintln!("[secret-store] 无法从 asset scope 拒绝 {name}: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_file(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ai-canvas-secret-test-{name}"));
        std::fs::remove_dir_all(&dir).ok();
        dir.join(SECRET_FILE_NAME)
    }

    #[test]
    fn rejects_malformed_entry_keys() {
        assert!(validate_key("provider/apimart").is_ok());
        assert!(validate_key("provider:custom-openai.1").is_ok());
        assert!(validate_key("").is_err());
        assert!(validate_key("provider/../../etc").is_err());
        assert!(validate_key("provider name").is_err());
        assert!(validate_key(&"x".repeat(MAX_KEY_LEN + 1)).is_err());
    }

    #[test]
    fn missing_file_reads_as_empty_store() {
        let file = temp_file("missing");
        assert!(read_map(&file).expect("缺文件应视为空").is_empty());
    }

    #[test]
    fn round_trips_entries_and_keeps_others_on_delete() {
        let file = temp_file("round-trip");
        let mut map = SecretMap::new();
        map.insert("provider/a".to_string(), "key-a".to_string());
        map.insert("provider/b".to_string(), "key-b".to_string());
        write_map(&file, &map).expect("写入应成功");

        let loaded = read_map(&file).expect("读取应成功");
        assert_eq!(loaded.get("provider/a").map(String::as_str), Some("key-a"));
        assert_eq!(loaded.get("provider/b").map(String::as_str), Some("key-b"));

        let mut after_delete = loaded;
        after_delete.remove("provider/a");
        write_map(&file, &after_delete).expect("重写应成功");
        let reloaded = read_map(&file).expect("读取应成功");
        assert!(!reloaded.contains_key("provider/a"));
        assert_eq!(reloaded.get("provider/b").map(String::as_str), Some("key-b"));

        std::fs::remove_dir_all(file.parent().unwrap()).ok();
    }

    #[cfg(unix)]
    #[test]
    fn stores_credentials_with_owner_only_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let file = temp_file("permissions");
        let mut map = SecretMap::new();
        map.insert("provider/a".to_string(), "key-a".to_string());
        write_map(&file, &map).expect("写入应成功");

        let mode = std::fs::metadata(&file).expect("应能读取元数据").permissions().mode();
        assert_eq!(mode & 0o777, 0o600);

        std::fs::remove_dir_all(file.parent().unwrap()).ok();
    }

    #[test]
    fn reports_corrupted_file_instead_of_silently_dropping_secrets() {
        let file = temp_file("corrupted");
        std::fs::create_dir_all(file.parent().unwrap()).expect("建目录");
        std::fs::write(&file, b"not json").expect("写坏数据");

        assert!(read_map(&file).is_err());

        std::fs::remove_dir_all(file.parent().unwrap()).ok();
    }
}
