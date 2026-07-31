/**
 * VideoEditorCodecPanel — WebCodecs 能力自检面板
 *
 * 「能不能编码」决定了转场、合成、音轨这些路线是否成立。
 * 独立窗口开不了 devtools，所以把实测结果直接摊在界面上并支持复制。
 */
import { memo, useCallback, useState } from 'react';
import { Icon } from '@iconify/react';
import { probeVideoCodecs, type CodecProbeReport } from '../../services/videoCodecProbe';

const DECLARED_TEXT: Record<string, string> = {
  supported: '支持',
  unsupported: '不支持',
  throw: '抛异常',
};

function VideoEditorCodecPanel() {
  const [report, setReport] = useState<CodecProbeReport | null>(null);
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    try {
      setReport(await probeVideoCodecs());
    } finally {
      setRunning(false);
    }
  }, []);

  const copy = useCallback(() => {
    if (!report) return;
    const lines = [
      `VideoEncoder: ${report.hasVideoEncoder}`,
      `VideoDecoder: ${report.hasVideoDecoder}`,
      ...report.results.map((entry) => (
        `${entry.label} (${entry.codec}) 声明=${entry.declared} 实测=${entry.actual}`
        + (entry.detail ? ` — ${entry.detail}` : '')
      )),
    ];
    void navigator.clipboard?.writeText(lines.join('\n')).catch(() => {});
  }, [report]);

  return (
    <div className="video-editor-inspect-group">
      <div className="video-editor-inspect-title">
        编码能力自检
        <button
          type="button"
          className="video-editor-probe-btn"
          onClick={() => { void run(); }}
          disabled={running}
        >
          {running ? '检测中…' : '运行'}
        </button>
        {report && (
          <button type="button" className="video-editor-probe-btn" onClick={copy}>
            复制
          </button>
        )}
      </div>

      {!report && (
        <div className="video-editor-inspect-hint">
          实测本机能否编码，用来判断转场 / 合成 / 音轨路线是否可行。
        </div>
      )}

      {report && (
        <>
          <div className="video-editor-inspect-row">
            <span>VideoEncoder</span>
            <span>{report.hasVideoEncoder ? '存在' : '缺失'}</span>
          </div>
          <div className="video-editor-inspect-row">
            <span>VideoDecoder</span>
            <span>{report.hasVideoDecoder ? '存在' : '缺失'}</span>
          </div>
          {report.results.map((entry) => (
            <div key={entry.label} className="video-editor-probe-row" title={entry.detail}>
              <Icon
                icon={entry.actual === 'ok' ? 'lucide:check-circle-2' : 'lucide:x-circle'}
                width={12}
                height={12}
                className={entry.actual === 'ok' ? 'ok' : 'bad'}
              />
              <span className="video-editor-probe-label">{entry.label}</span>
              <span className="video-editor-probe-verdict">
                实测{entry.actual === 'ok' ? '可用' : '失败'}
                <em>（声明{DECLARED_TEXT[entry.declared] ?? entry.declared}）</em>
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export default memo(VideoEditorCodecPanel);
