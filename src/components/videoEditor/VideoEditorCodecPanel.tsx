/**
 * VideoEditorCodecPanel — WebCodecs 能力自检面板
 *
 * 「能不能编码」决定了转场、合成、音轨这些路线是否成立。
 * 独立窗口开不了 devtools，所以把实测结果直接摊在界面上并支持复制。
 */
import { memo, useCallback, useState } from 'react';
import { Icon } from '@iconify/react';
import { probeVideoCodecs, type CodecProbeReport } from '../../services/videoCodecProbe';
import { useT } from '../../i18n';

function VideoEditorCodecPanel() {
  const t = useT();
  const DECLARED_TEXT: Record<string, string> = {
    supported: t('支持'),
    unsupported: t('不支持'),
    throw: t('抛异常'),
  };
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
      `AudioEncoder: ${report.hasAudioEncoder}`,
      `AudioDecoder: ${report.hasAudioDecoder}`,
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
        {t('编码能力自检')}
        <button
          type="button"
          className="video-editor-probe-btn"
          onClick={() => { void run(); }}
          disabled={running}
        >
          {running ? t('检测中…') : t('运行')}
        </button>
        {report && (
          <button type="button" className="video-editor-probe-btn" onClick={copy}>
            {t('复制')}
          </button>
        )}
      </div>

      {!report && (
        <div className="video-editor-inspect-hint">
          {t('实测本机能否编码，用来判断转场 / 合成 / 音轨路线是否可行')}
        </div>
      )}

      {report && (
        <>
          <div className="video-editor-inspect-row">
            <span>VideoEncoder</span>
            <span>{report.hasVideoEncoder ? t('存在') : t('缺失')}</span>
          </div>
          <div className="video-editor-inspect-row">
            <span>VideoDecoder</span>
            <span>{report.hasVideoDecoder ? t('存在') : t('缺失')}</span>
          </div>
          <div className="video-editor-inspect-row">
            <span>AudioEncoder</span>
            <span>{report.hasAudioEncoder ? t('存在') : t('缺失')}</span>
          </div>
          <div className="video-editor-inspect-row">
            <span>AudioDecoder</span>
            <span>{report.hasAudioDecoder ? t('存在') : t('缺失')}</span>
          </div>
          {!report.hasAudioEncoder && (
            <div className="video-editor-inspect-hint">
              {t('本机没有 AudioEncoder，合成导出无法混流；满足条件时会改用音频分组直通')}
            </div>
          )}
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
                {t('实测')}{entry.actual === 'ok' ? t('可用') : t('失败')}
                <em>（{t('声明')}{DECLARED_TEXT[entry.declared] ?? entry.declared}）</em>
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export default memo(VideoEditorCodecPanel);
