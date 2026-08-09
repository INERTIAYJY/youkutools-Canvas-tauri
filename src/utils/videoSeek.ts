/**
 * 把 <video> 定位到指定时刻，并等到那一帧真正可读之后再返回。
 *
 * 三个坑都在这里兜掉：
 * 1. `seeked` 在 WebKit 里早于合成帧提交，直接读画布会拿到上一帧；
 * 2. 但暂停或被遮挡的视频可能永远不提交新帧，requestVideoFrameCallback 就一直不回调，
 *    只靠它等会一路等到超时，报「视频定位超时」；
 * 3. 浏览器可能把目标时刻钳回当前位置，这时根本不会有 `seeked` 事件。
 */

/** 等合成帧的兜底时长：`seeked` 之后帧基本已解码，等不到回调就直接读 */
export const FRAME_PRESENT_FALLBACK_MS = 200;
/** 定位硬超时：远端视频还在缓冲时才可能走到这里 */
export const VIDEO_SEEK_TIMEOUT_MS = 8000;
/** 与目标差在这个范围内就当作已经到位 */
const SEEK_EPSILON = 0.01;

/**
 * 等到 seek 后的那一帧真正提交再执行 callback；rVFC 迟迟不回调时按兜底时长直接执行。
 * 返回取消函数。
 */
export function afterVideoFramePresented(video: HTMLVideoElement, callback: () => void): () => void {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    callback();
  };
  // rVFC 和兜底定时器谁先到用谁
  video.requestVideoFrameCallback?.(() => run());
  const timer = setTimeout(run, FRAME_PRESENT_FALLBACK_MS);
  return () => {
    done = true;
    clearTimeout(timer);
  };
}

export function seekVideoTo(video: HTMLVideoElement, targetTime: number): Promise<void> {
  if (Math.abs(video.currentTime - targetTime) < SEEK_EPSILON) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let cancelFramePresented: (() => void) | undefined;
    const onSeeked = () => {
      cancelFramePresented = afterVideoFramePresented(video, () => {
        clearTimeout(timeoutTimer);
        resolve();
      });
    };
    const timeoutTimer = setTimeout(() => {
      video.removeEventListener('seeked', onSeeked);
      cancelFramePresented?.();
      reject(new Error('视频定位超时'));
    }, VIDEO_SEEK_TIMEOUT_MS);

    video.addEventListener('seeked', onSeeked, { once: true });
    video.currentTime = targetTime;

    // 赋值后没进入 seeking，说明目标被钳回当前位置，不会再有 seeked 事件
    if (!video.seeking) {
      video.removeEventListener('seeked', onSeeked);
      clearTimeout(timeoutTimer);
      resolve();
    }
  });
}
