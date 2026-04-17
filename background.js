chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "BM_TOOLBOX_DOWNLOAD") return false;
  const payload = msg.payload || {};
  const url = typeof payload.url === "string" ? payload.url : "";
  const filename = typeof payload.filename === "string" ? payload.filename : "youtube-shorts.mp4";
  if (!url) {
    sendResponse({ ok: false, error: "no_download_url" });
    return false;
  }
  chrome.downloads.download(
    {
      url,
      filename,
      saveAs: true,
      conflictAction: "uniquify",
    },
    (downloadId) => {
      if (chrome.runtime.lastError || !downloadId) {
        sendResponse({
          ok: false,
          error: chrome.runtime.lastError
            ? chrome.runtime.lastError.message
            : "download_start_failed",
        });
        return;
      }
      sendResponse({ ok: true, downloadId });
    }
  );
  return true;
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "BM_BG_RECORD_SHORT") return false;
  const payload = msg.payload || {};
  const shortUrl = typeof payload.shortUrl === "string" ? payload.shortUrl : "";
  const shortId = typeof payload.shortId === "string" ? payload.shortId : "";
  const filename = typeof payload.filename === "string" ? payload.filename : "youtube-shorts-record.webm";
  if (!shortUrl) {
    sendResponse({ ok: false, error: "no_short_url" });
    return false;
  }

  (async () => {
    let tab = null;
    let tabRemoved = false;
    let keepAliveTimer = null;
    try {
      // 防止 MV3 service worker 在長錄製流程中休眠
      keepAliveTimer = setInterval(() => {
        chrome.runtime.getPlatformInfo(() => {
          /* keep alive ping */
        });
      }, 20000);

      const waitMs = (ms) => new Promise((r) => setTimeout(r, ms));
      const safeSendToSenderTab = (message) => {
        if (!(sender.tab && typeof sender.tab.id === "number")) return;
        try {
          chrome.tabs.sendMessage(sender.tab.id, message, () => {
            /* ignore chrome.runtime.lastError */
          });
        } catch (_) {
          /* ignore */
        }
      };
      const broadcastMessage = (message) => {
        try {
          chrome.runtime.sendMessage(message, () => {
            /* ignore chrome.runtime.lastError */
          });
        } catch (_) {
          /* ignore */
        }
      };
      const executeRecordScriptWithRetry = async (tabId, recordFilename) => {
        let lastErr = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            const [{ result }] = await chrome.scripting.executeScript({
              target: { tabId },
              world: "ISOLATED",
              func: async (rf) => {
                const waitMs = (ms) => new Promise((r) => setTimeout(r, ms));
                const getVideo = () => {
                  const sels = [
                    "ytd-reel-video-renderer[is-active] video",
                    "ytd-reel-video-renderer video",
                    "#shorts-player video",
                    "video",
                  ];
                  for (const s of sels) {
                    const v = document.querySelector(s);
                    if (v instanceof HTMLVideoElement) return v;
                  }
                  return null;
                };
                const waitForVideo = async () => {
                  for (let i = 0; i < 200; i++) {
                    const v = getVideo();
                    if (v) return v;
                    await waitMs(100);
                  }
                  return null;
                };
                const v = await waitForVideo();
                if (!v) return { ok: false, error: "no_video_element" };
                if (typeof v.captureStream !== "function" || typeof MediaRecorder === "undefined") {
                  return { ok: false, error: "capture_or_mediarecorder_unsupported" };
                }
                try {
                  v.currentTime = 0;
                  v.playbackRate = 1;
                  v.defaultPlaybackRate = 1;
                  v.muted = true;
                } catch (_) {
                  /* ignore */
                }
                await v.play().catch(() => {});
                for (let i = 0; i < 30 && v.readyState < 2; i++) await waitMs(100);
                const stream = v.captureStream();
                for (let i = 0; i < 30 && stream.getVideoTracks().length === 0; i++) await waitMs(100);
                if (!stream.getVideoTracks().length) return { ok: false, error: "no_video_track" };
                let recorder = null;
                try {
                  recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9,opus" });
                } catch (_) {
                  try {
                    recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
                  } catch (_) {
                    return { ok: false, error: "recorder_create_failed" };
                  }
                }
                const chunks = [];
                recorder.addEventListener("dataavailable", (ev) => {
                  if (ev.data && ev.data.size > 0) chunks.push(ev.data);
                });
                const done = await new Promise((resolve) => {
                  const finish = () => {
                    if (!chunks.length) {
                      resolve({ ok: false, error: "no_recorded_chunks" });
                      return;
                    }
                    const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
                    const reader = new FileReader();
                    reader.onload = () => {
                      const dataUrl = typeof reader.result === "string" ? reader.result : "";
                      if (!dataUrl) {
                        resolve({ ok: false, error: "blob_to_dataurl_failed" });
                        return;
                      }
                      resolve({ ok: true, dataUrl, filename: rf });
                    };
                    reader.onerror = () => resolve({ ok: false, error: "blob_read_failed" });
                    reader.readAsDataURL(blob);
                  };
                  recorder.addEventListener("stop", finish, { once: true });
                  const stop = () => {
                    try {
                      if (recorder.state !== "inactive") recorder.stop();
                    } catch (_) {
                      resolve({ ok: false, error: "recorder_stop_failed" });
                    }
                  };
                  v.addEventListener("ended", stop, { once: true });
                  const totalSec = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 60;
                  setTimeout(stop, Math.ceil((totalSec + 5) * 1000));
                  try {
                    recorder.start(250);
                  } catch (_) {
                    resolve({ ok: false, error: "recorder_start_failed" });
                  }
                });
                return done;
              },
              args: [recordFilename],
            });
            return result;
          } catch (err) {
            lastErr = err;
            const msg = err && err.message ? err.message : String(err || "");
            if (/Frame with ID 0 was removed/i.test(msg)) {
              await waitMs(600);
              continue;
            }
            throw err;
          }
        }
        throw lastErr || new Error("execute_script_retry_exhausted");
      };

      tab = await chrome.tabs.create({ url: shortUrl, active: false });
      const tabId = tab.id;
      if (typeof tabId !== "number") throw new Error("invalid_tab_id");
      const onRemoved = (removedTabId) => {
        if (removedTabId === tabId) tabRemoved = true;
      };
      chrome.tabs.onRemoved.addListener(onRemoved);

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          reject(new Error("tab_load_timeout"));
        }, 20000);
        const listener = (updatedTabId, info) => {
          if (updatedTabId !== tabId) return;
          if (info.status === "complete") {
            clearTimeout(timeout);
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
      });

      await waitMs(800);
      const result = await Promise.race([
        executeRecordScriptWithRetry(tabId, filename),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("background_record_timeout")), 6 * 60 * 1000)
        ),
      ]);

      if (result && result.ok && result.dataUrl) {
        await new Promise((resolve, reject) => {
          chrome.downloads.download(
            {
              url: result.dataUrl,
              filename: result.filename || filename,
              saveAs: true,
              conflictAction: "uniquify",
            },
            (downloadId) => {
              if (chrome.runtime.lastError || !downloadId) {
                reject(
                  new Error(
                    chrome.runtime.lastError
                      ? chrome.runtime.lastError.message
                      : "downloads_api_failed"
                  )
                );
                return;
              }
              resolve(downloadId);
            }
          );
        });
      }

      if (tab && typeof tab.id === "number") {
        try {
          await chrome.tabs.remove(tab.id);
        } catch (_) {
          /* ignore */
        }
      }
      chrome.tabs.onRemoved.removeListener(onRemoved);
      safeSendToSenderTab({
        type:
          result && result.ok && result.dataUrl
            ? "BM_BG_RECORD_DONE"
            : "BM_BG_RECORD_ERROR",
        payload:
          result && result.ok && result.dataUrl
            ? { shortId }
            : { error: result && result.error ? result.error : "unknown", shortId },
      });
      broadcastMessage({
        type:
          result && result.ok && result.dataUrl
            ? "BM_BG_RECORD_DONE"
            : "BM_BG_RECORD_ERROR",
        payload:
          result && result.ok && result.dataUrl
            ? { shortId }
            : { error: result && result.error ? result.error : "unknown", shortId },
      });
    } catch (err) {
      if (tab && typeof tab.id === "number") {
        try {
          await chrome.tabs.remove(tab.id);
        } catch (_) {
          /* ignore */
        }
      }
      const errorCode = tabRemoved
        ? "background_tab_closed"
        : err && err.message
          ? err.message
          : "background_record_failed";
      if (sender.tab && typeof sender.tab.id === "number") {
        try {
          chrome.tabs.sendMessage(
            sender.tab.id,
            { type: "BM_BG_RECORD_ERROR", payload: { error: errorCode, shortId } },
            () => {
              /* ignore chrome.runtime.lastError */
            }
          );
        } catch (_) {
          /* ignore */
        }
      }
      try {
        chrome.runtime.sendMessage(
          { type: "BM_BG_RECORD_ERROR", payload: { error: errorCode, shortId } },
          () => {
            /* ignore chrome.runtime.lastError */
          }
        );
      } catch (_) {
        /* ignore */
      }
    } finally {
      if (keepAliveTimer) {
        clearInterval(keepAliveTimer);
        keepAliveTimer = null;
      }
    }
  })();

  sendResponse({ ok: true, started: true });
  return true;
});
