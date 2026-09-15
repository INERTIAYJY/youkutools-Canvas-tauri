// SPDX-License-Identifier: Apache-2.0 OR MIT
// Run from the host manifest so all dependency versions stay locked and offline.
use tauri::test::channel_security;

const ACL: &str = include_str!(concat!(
  env!("CARGO_MANIFEST_DIR"),
  "/gen/schemas/acl-manifests.json"
));

#[test]
fn streaming_large_json() {
  channel_security::round_trip(ACL, false, true);
}
#[test]
fn streaming_large_raw() {
  channel_security::round_trip(ACL, true, true);
}
#[test]
fn invoke_callback_large_json() {
  channel_security::round_trip(ACL, false, false);
}
#[test]
fn invoke_callback_large_raw() {
  channel_security::round_trip(ACL, true, false);
}
#[test]
fn plugin_and_remote_fetch_denied() {
  channel_security::ungranted_and_remote_denied(ACL);
}
#[test]
fn explicit_deny_overrides_core_default() {
  channel_security::explicit_deny(ACL);
}
#[test]
fn invalid_ids_and_headers_preserve_pending_data() {
  channel_security::invalid_headers(ACL);
}
#[test]
fn destroyed_window_revokes_queue() {
  channel_security::close_and_reopen(ACL, true);
}
#[test]
fn closed_webview_revokes_queue() {
  channel_security::close_and_reopen(ACL, false);
}
#[test]
fn small_messages_keep_direct_callbacks() {
  channel_security::small_callbacks(ACL);
}

#[test]
fn actual_host_capability_preserves_all_first_party_windows() {
  channel_security::first_party_capability(
    ACL,
    include_str!(concat!(
      env!("CARGO_MANIFEST_DIR"),
      "/capabilities/default.json"
    )),
  );
}

#[test]
fn missing_app_acl_does_not_exempt_channel_fetch() {
  channel_security::no_capability_denied();
}

#[test]
fn default_project_directory_allows_embedded_media() {
  use std::collections::BTreeMap;
  use tauri::{
    ipc::{CallbackFn, InvokeBody, RuntimeAuthority},
    test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY},
    utils::{
      acl::{capability::Capability, manifest::Manifest, resolved::Resolved},
      platform::Target,
    },
    webview::InvokeRequest,
    Manager, WebviewWindowBuilder,
  };
  use tauri_plugin_fs::FsExt;

  let acl: BTreeMap<String, Manifest> = serde_json::from_str(ACL).unwrap();
  let capability: Capability = serde_json::from_str(include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/capabilities/default.json"
  )))
  .unwrap();
  let resolved = Resolved::resolve(
    &acl,
    BTreeMap::from([(capability.identifier.clone(), capability)]),
    Target::current(),
  )
  .unwrap();
  let mut context = mock_context(noop_assets());
  // 使用独立应用目录，真实应用的数据和凭据不参与测试。
  let identifier = format!("com.aicanvas.scope-test-{}", std::process::id());
  context.config_mut().identifier = identifier.clone();
  *context.runtime_authority_mut() = RuntimeAuthority::new(acl, resolved);
  let app = mock_builder()
    .plugin(tauri_plugin_fs::init())
    .build(context)
    .unwrap();
  let window = WebviewWindowBuilder::new(&app, "main", Default::default())
    .build()
    .unwrap();
  let root = app.path().app_data_dir().unwrap();
  let directory = root.join("data").join("项目 2-0af10eef");
  app
    .fs_scope()
    .forbid_directory(root.join("secrets"), true)
    .unwrap();

  let call = |command: &str, body: InvokeBody, path: Option<&std::path::Path>| {
    let mut request = InvokeRequest {
      cmd: format!("plugin:fs|{command}"),
      callback: CallbackFn(1),
      error: CallbackFn(2),
      url: window.url().unwrap(),
      body,
      headers: Default::default(),
      invoke_key: INVOKE_KEY.into(),
    };
    if let Some(path) = path {
      let path = path.to_string_lossy().replace('\\', "/");
      let encoded = url::form_urlencoded::byte_serialize(path.as_bytes())
        .collect::<String>()
        .replace('+', "%20");
      request.headers.insert("path", encoded.parse().unwrap());
    }
    get_ipc_response(&window, request)
  };
  call(
    "mkdir",
    InvokeBody::Json(serde_json::json!({
      "path": directory.to_string_lossy().replace('\\', "/"), "options": { "recursive": true }
    })),
    None,
  )
  .expect("default project directory must be creatable");
  let file = directory.join("embedded-image-1d8233577d4ea0.png");
  let response = call("write_file", InvokeBody::Raw(vec![1, 2, 3]), Some(&file));
  assert!(
    response.is_ok(),
    "default directory write failed: {response:?}"
  );
  assert_eq!(std::fs::read(&file).unwrap(), [1, 2, 3]);
  assert!(call(
    "write_file",
    InvokeBody::Raw(vec![1]),
    Some(&root.join("secrets").join("blocked"))
  )
  .is_err());

  assert!(root.is_absolute());
  assert_eq!(root.file_name().unwrap(), identifier.as_str());
  std::fs::remove_dir_all(root).unwrap();
}
