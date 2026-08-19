/**
 * 节点与画布节点组件（nodes）
 */
const nodes = {
  // ── NodeLabel ──
  '双击重命名': 'Double-click to rename',

  // ── NodeRenderBoundary ──
  '此节点渲染失败': 'This node failed to render',
  '查看数据': 'View data',
  '重试渲染': 'Retry render',
  '删除节点': 'Delete node',
  '节点数据': 'Node data',

  // ── AINodeDialog ──
  '节点不存在': 'Node does not exist',
  '请输入提示词': 'Please enter a prompt',
  '请先在底部模型选择器中选择一个模型': 'Select a model in the model selector below first',
  '批量生成暂不支持图片后处理，请将数量设为 1': 'Batch generation does not support image post-processing yet; set the count to 1',
  '正在批量生成 {count} 张图片': 'Batch-generating {count} images',
  '原图已生成，但未能保存到本地，无法自动生成 8 向宫格': 'The image was generated but not saved locally; cannot auto-generate the 8-direction grid',
  '图片生成完成，正在后台切图生成 8 向宫格': 'Image generated; slicing for the 8-direction grid in the background',
  '角色 8 向宫格已生成': 'Character 8-direction grid generated',
  '未知错误': 'Unknown error',
  '原图已生成，8 向宫格处理失败：{message}': 'Image generated, but 8-direction grid processing failed: {message}',
  'Sprite Sheet 生成完成': 'Sprite sheet generated',
  '图片生成完成': 'Image generated',
  '全景图生成完成': 'Panorama generated',
  '视频生成完成': 'Video generated',
  '音频生成完成': 'Audio generated',
  '人物': 'character',
  '场景': 'scene',
  '道具': 'prop',
  '{kind}简介已提取并入库 · 「资产管理 > 短剧资产」可查看':
    '{kind} summary extracted and saved · view under "Asset management > Drama assets"',
  '已提取，但 JSON 未完全规范化，请检查输出': 'Extracted, but the JSON was not fully normalized; check the output',
  '生成失败': 'Generation failed',
  '已终止 ComfyUI 任务': 'ComfyUI task terminated',
  '无法终止 ComfyUI 任务': 'Cannot terminate the ComfyUI task',
  '已停止本地等待，但{message}': 'Stopped local waiting, but {message}',
  '描述任何你想要生成的内容，按 @ 引用素材，/呼出指令\n(Enter 生成，Shift+Enter 换行)':
    'Describe anything you want to generate. @ to reference assets, / for commands\n(Enter to generate, Shift+Enter for a new line)',

  // ── TextNode ──
  '粘贴文本': 'Paste text',
  '上传文本文件': 'Upload text file',
  '输入或粘贴文本内容…': 'Enter or paste text…',
  '输入文本内容…': 'Enter text…',
  '编辑文本节点内容': 'Edit text node content',
  '双击编辑': 'Double-click to edit',
  '上传中...': 'Uploading…',
  '生成中...': 'Generating…',
  '上传文本文件或粘贴内容': 'Upload a text file or paste content',
  '输入提示词开始创作': 'Enter a prompt to start creating',
  '双击编辑内容': 'Double-click to edit',
  '字': 'chars',
  '文本内容': 'Text content',

  // ── GroupNode ──
  '{count} 节点': '{count} node(s)',
  '分组批量生成完成：{result}': 'Group batch generation finished: {result}',

  // ── MarkdownNode ──
  '暂无文本可复制': 'No text to copy',
  '文本已复制': 'Text copied',
  '复制失败，请手动复制': 'Copy failed, please copy manually',
  'Markdown 文档': 'Markdown document',
  '上传 .md 文件': 'Upload .md file',
  '复制文本': 'Copy text',
  '全屏显示': 'Fullscreen',
  '# Markdown 文档&#10;&#10;点击上方按钮上传 .md 文件，或直接在此编辑…':
    '# Markdown document&#10;&#10;Upload an .md file with the button above, or edit directly here…',
  '暂无内容 — 切换到编辑模式开始写作': 'No content yet — switch to edit mode to start writing',
  '暂无内容': 'No content',
};

export default nodes;
