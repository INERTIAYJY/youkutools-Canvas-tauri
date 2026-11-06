/**
 * qwenSpeechSettings — 解析 Qwen 语音工作流字段并应用语音设置。
 */
import type { WorkflowDefinition } from '../../types';
import type { AudioSpeechParameterValue, AudioSpeechSettings, AudioSpeechWorkflowControls, QwenSpeechControls, QwenSpeechField } from '../../types/aiTypes';

type Graph = Record<string, { class_type?: unknown; inputs?: Record<string, unknown> }>;
type FieldSpec = Omit<QwenSpeechField, 'id' | 'nodeId' | 'value' | 'group'>;
const number = (key: string, label: string, min?: number, max?: number, step?: number, integer = false): FieldSpec =>
  ({ key, label, kind: 'number', min, max, step, integer });
const select = (key: string, label: string, options: string[]): FieldSpec => ({ key, label, kind: 'select', options });
const bool = (key: string, label: string): FieldSpec => ({ key, label, kind: 'boolean' });
const text = (key: string, label: string, hint?: string): FieldSpec => ({ key, label, kind: 'text', hint });
const LANGUAGES = ['Auto', 'Chinese', 'English', 'Japanese', 'Korean', 'French', 'German', 'Spanish', 'Portuguese', 'Russian', 'Italian'];
const ASR_LANGUAGES = ['auto', 'Chinese', 'English', 'Cantonese', 'Arabic', 'German', 'French', 'Spanish', 'Portuguese', 'Indonesian', 'Italian', 'Korean', 'Russian', 'Thai', 'Vietnamese', 'Japanese', 'Turkish', 'Hindi', 'Malay', 'Dutch', 'Swedish', 'Danish', 'Finnish', 'Polish', 'Czech', 'Filipino', 'Persian', 'Greek', 'Hungarian', 'Macedonian', 'Romanian'];
const SAMPLING = [number('temperature', '随机程度（Temperature）', 0.1, 2, 0.05), number('top_p', '候选概率（Top P）', 0, 1, 0.05),
  number('top_k', '候选数量（Top K）', 0, 100, 1, true), number('repetition_penalty', '重复抑制', 1, 2, 0.05)];
const RUNTIME = [select('device', '运行设备', ['auto', 'cuda', 'xpu', 'mps', 'cpu']), select('precision', '计算精度', ['bf16', 'fp32']),
  select('attention', '注意力实现', ['auto', 'sage_attn', 'flash_attn', 'sdpa', 'eager']), bool('unload_model_after_generate', '生成后卸载模型')];
// SeedVC 本机声明尚不可用：不凭默认值编造上下限；提交前用目标服务端声明校验用户覆盖。
const CONVERSION = [number('timbre_strength', '音色转换强度'), number('diffusion_steps', '转换步数', undefined, undefined, 1, true),
  number('cfg_rate', '转换引导强度（CFG）'), number('reference_seconds', '参考截取长度（秒）'), bool('auto_f0_adjust', '自动调整基频'),
  number('pitch_shift', '移调（半音）', undefined, undefined, 1, true), number('length_adjust', '输出长度倍率'),
  number('seed', '转换种子', 0, Number.MAX_SAFE_INTEGER, 1, true), number('output_gain_db', '输出增益（dB）'),
  bool('peak_protection', '峰值保护'), number('peak_ceiling_db', '峰值上限（dB）')];

export const QWEN_VOICE_PRESETS = [
  { label: '男声', description: '自然真实的成年男性声音，沉稳清晰，像日常聊天。' },
  { label: '女声', description: '自然真实的年轻女性声音，清亮温暖，像日常聊天。' },
  { label: '正太', description: '明亮清爽的动漫少年声音，轻盈有活力。' },
  { label: '萝莉', description: '清脆轻盈的动漫少女声音，富有活力。' },
  { label: '小女孩', description: '自然真实的小女孩声音，稚嫩清亮，咬字自然，不刻意卖萌。' },
  { label: '小男孩', description: '自然真实的小男孩声音，稚嫩清亮，咬字自然，不刻意卖萌。' },
];
const PACES = ['语速很慢，吐字清晰。', '语速偏慢。', '', '语速偏快。', '语速很快，吐字清晰。'];
const connected = (value: unknown, id: string, slot = 0) => Array.isArray(value) && value.length === 2 && String(value[0]) === id && value[1] === slot;

function seedMode(workflow: WorkflowDefinition, nodeId: string, classType: string): string {
  try {
    const nodes: unknown = JSON.parse(workflow.editableContent ?? '{}')?.nodes;
    if (!Array.isArray(nodes)) return 'fixed';
    const node = nodes.find((item) => String(item?.id) === nodeId && item?.type === classType);
    if (!node || (node.mode ?? 0) !== 0 || !Array.isArray(node.inputs) || !Array.isArray(node.widgets_values)) return 'fixed';
    const widgets = node.inputs.filter((input: { widget?: unknown } | null) => input?.widget);
    const index = widgets.findIndex((input: { name?: string; link?: unknown }) => input.name === 'seed' && input.link == null);
    return index >= 0 && node.widgets_values[index + 1] === 'randomize' ? 'randomize' : 'fixed';
  } catch { return 'fixed'; }
}

/** 只识别连接关系明确的 Qwen 单路合成/克隆/SeedVC 转换图，复制或重命名工作流仍可用。 */
export function inspectQwenSpeechGraph(graph: Graph, workflow: WorkflowDefinition): AudioSpeechWorkflowControls | undefined {
  const entries = Object.entries(graph);
  const clones = entries.filter(([, n]) => n?.class_type === 'FB_Qwen3TTSVoiceClone');
  const designs = entries.filter(([, n]) => n?.class_type === 'FB_Qwen3TTSVoiceDesign');
  const conversions = entries.filter(([, n]) => n?.class_type === 'SeedVCVoiceConversion');
  if (clones.length > 1 || designs.length > 1 || conversions.length > 1 || (!clones.length && !designs.length)) return;
  if (entries.some(([, n]) => n?.class_type === 'AuKGenerateEdit')) return;
  const clone = clones[0]; const design = designs[0]; const conversion = conversions[0];
  if (Boolean(conversion) !== Boolean(clone && design)) return;
  const main = clone ?? design;
  const textKey = clone ? 'target_text' : 'text';
  if (typeof main[1].inputs?.[textKey] !== 'string') return;
  let referenceInputId: string | undefined;
  let asrId: string | undefined;
  if (clone) {
    const input = clone[1].inputs;
    if (!Array.isArray(input?.ref_audio) || !Array.isArray(input.ref_text)) return;
    referenceInputId = String(input.ref_audio[0]); asrId = String(input.ref_text[0]);
    if (!connected(input.ref_audio, referenceInputId) || !connected(input.ref_text, asrId)
      || graph[referenceInputId]?.class_type !== 'LoadAudio' || typeof graph[referenceInputId].inputs?.audio !== 'string'
      || graph[asrId]?.class_type !== 'AILab_Qwen3ASR' || !connected(graph[asrId].inputs?.audio, referenceInputId)) return;
  }
  if (design && (typeof design[1].inputs?.text !== 'string' || typeof design[1].inputs?.instruct !== 'string')) return;
  if (conversion && (!connected(conversion[1].inputs?.source_audio, clone[0]) || !connected(conversion[1].inputs?.target_voice, design[0]))) return;
  const outputId = conversion?.[0] ?? main[0];
  const saves = entries.filter(([, n]) => typeof n?.class_type === 'string' && /^SaveAudio(?:Advanced)?$/.test(n.class_type));
  if (saves.length !== 1 || !connected(saves[0][1].inputs?.audio, outputId)) return;
  const fields: QwenSpeechField[] = [];
  const add = (nodeId: string, role: string, group: string, specs: FieldSpec[]) => {
    const inputs = graph[nodeId].inputs ?? {};
    for (const spec of specs) {
      const value = inputs[spec.key];
      if ((spec.kind === 'number' && typeof value !== 'number') || (spec.kind === 'boolean' && typeof value !== 'boolean')
        || (['text', 'select'].includes(spec.kind) && typeof value !== 'string')) continue;
      fields.push({ ...spec, id: `${role}.${spec.key}`, nodeId, group, value: value as AudioSpeechParameterValue });
    }
  };
  for (const [entry, role, label] of [[clone, 'clone', '克隆'], [design, 'design', '声音设计']] as const) {
    if (!entry) continue;
    const [id, node] = entry;
    const basicGroup = role === 'design' ? '声音设计' : '语音合成';
    add(id, role, basicGroup, [select('language', '合成语言', LANGUAGES)]);
    if (typeof node.inputs?.seed === 'number') {
      fields.push({ ...select('seed_mode', role === 'design' ? '抽卡模式' : '种子模式', ['fixed', 'randomize']),
        id: `${role}.seed_mode`, nodeId: id, group: basicGroup, value: seedMode(workflow, id, String(node.class_type)), virtual: true });
      add(id, role, basicGroup, [number('seed', '固定种子', 0, Number.MAX_SAFE_INTEGER, 1, true)]);
    }
    add(id, role, basicGroup, [number('max_new_tokens', '生成长度上限（token）', 512, 4096, 256, true)]);
    add(id, role, `${label}采样`, SAMPLING);
    if (role === 'clone') add(id, role, `${label}采样`, [{ ...bool('x_vector_only', '仅提取音色特征'), hint: '启用后忽略参考文本的内容对齐，克隆效果可能变化。' }]);
    add(id, role, `${label}运行选项`, [select('model_choice', '模型大小', role === 'design' ? ['1.7B'] : ['0.6B', '1.7B']), ...RUNTIME]);
  }
  if (design) {
    add(design[0], 'design', '声音设计', [text('instruct', '自定义音色描述')]);
    fields.push({ ...number('pace', conversion ? '目标音色样本语速' : '语速（描述控制）', 0, 4, 1, true), id: 'design.pace',
      nodeId: design[0], group: '声音设计', value: 2, virtual: true, hint: '通过声音描述引导，实际语速以合成结果为准。' });
    if (conversion) add(design[0], 'design', '目标音色样本', [text('text', '音色样本台词', '用于生成目标音色，最终朗读内容仍来自主提示词。')]);
  }
  if (asrId) {
    add(asrId, 'asr', '参考语音转写', [select('language', '识别语言', ASR_LANGUAGES), text('hints', '转写提示词 / 专有名词'),
      bool('normalize_text', '规范化数字和缩写'), select('model', '转写模型', ['Qwen/Qwen3-ASR-1.7B-hf', 'Qwen/Qwen3-ASR-0.6B-hf']),
      select('precision', '转写计算精度', ['bf16', 'fp16', 'fp32']), bool('unload_models', '转写后卸载模型')]);
  }
  if (conversion) add(conversion[0], 'conversion', '音色转换（SeedVC）', CONVERSION);
  return { encodeId: main[0], generatorId: main[0], textNodeId: main[0], textKey, referenceInputId,
    qwen: { workflowId: workflow.id, mode: conversion ? 'reference-design' : clone ? 'clone' : 'design', fields,
      designNodeId: design?.[0], conversionNodeId: conversion?.[0] } };
}

export function qwenFieldValue(controls: QwenSpeechControls, field: QwenSpeechField, settings?: AudioSpeechSettings): AudioSpeechParameterValue {
  const value = settings?.qwen?.[controls.workflowId]?.[field.id];
  return value === undefined ? field.value : value;
}

export function validateQwenField(field: QwenSpeechField, value: AudioSpeechParameterValue): void {
  let valid: boolean;
  if (field.kind === 'number') valid = typeof value === 'number' && Number.isFinite(value)
    && (!field.integer || Number.isSafeInteger(value)) && (field.min === undefined || value >= field.min) && (field.max === undefined || value <= field.max);
  else if (field.kind === 'boolean') valid = typeof value === 'boolean';
  else valid = typeof value === 'string' && (field.kind !== 'select' || Boolean(field.options?.includes(value)));
  if (!valid) throw new Error(`${field.label}的值无效，请在语音参数中调整`);
}

/** 只写声明字段中的显式覆盖；连线和未编辑参数保留。 */
export function applyQwenSpeechSettings(graph: Graph, controls: AudioSpeechWorkflowControls, settings?: AudioSpeechSettings, explicitInputs?: Record<string, string>) {
  const qwen = controls.qwen!;
  if (!String(graph[controls.textNodeId].inputs?.[controls.textKey] ?? '').trim()) throw new Error('请输入需要朗读的文本');
  const overrides = settings?.qwen?.[qwen.workflowId] ?? {};
  for (const field of qwen.fields) {
    const value = overrides[field.id];
    if (value === undefined) continue;
    // 显式 @ 音色样本台词优先于面板中保存的样本正文。
    if (field.key === 'text' && explicitInputs?.[field.nodeId] !== undefined) continue;
    validateQwenField(field, value);
    const inputs = graph[field.nodeId]?.inputs;
    if (!field.virtual && inputs && typeof inputs[field.key] === typeof field.value) inputs[field.key] = value;
  }
  for (const field of qwen.fields.filter((item) => item.key === 'seed_mode')) {
    if (qwenFieldValue(qwen, field, settings) === 'randomize') {
      const inputs = graph[field.nodeId].inputs!;
      if (typeof inputs.seed === 'number') inputs.seed = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
    }
  }
  if (qwen.designNodeId) {
    const inputs = graph[qwen.designNodeId].inputs!;
    if (!String(inputs.instruct ?? '').trim()) throw new Error('请填写目标音色描述');
    const pace = Number(overrides['design.pace'] ?? 2);
    if (pace !== 2) inputs.instruct = `${inputs.instruct}\n${PACES[pace]}`;
  }
}
