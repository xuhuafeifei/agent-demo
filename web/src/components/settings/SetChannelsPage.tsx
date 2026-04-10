// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, HelpCircle } from "lucide-react";
import {
  weixinLoginStart,
  weixinLoginPoll,
  weixinStatus,
  weixinUnbind,
} from "../../api/configApi";
import MessageManager from "../Message";

/** iLink 常返回裸 base64，img 需要 data URL 或绝对地址（与后端 normalizeQrImageSrc 对齐） */
function normalizeWeixinQrSrc(raw) {
  if (raw == null) return "";
  const s = String(raw).trim();
  if (!s) return "";
  if (/^(data:|https?:|blob:)/i.test(s)) return s;
  if (s.startsWith("//")) return `https:${s}`;
  if (s.startsWith("/")) {
    try {
      return new URL(s, "https://ilinkai.weixin.qq.com").href;
    } catch {
      return s;
    }
  }
  return `data:image/png;base64,${s.replace(/\s+/g, "")}`;
}

export default function SetChannelsPage({ channelsTab }) {
  const {
    channelsForm,
    setChannelsForm,
    showQqbotSecret,
    setShowQqbotSecret,
    saving,
    resetting,
    handleResetClick,
    handleSaveChannels,
  } = channelsTab;

  const [weixinBound, setWeixinBound] = useState(false);
  const [weixinMasked, setWeixinMasked] = useState(null);
  /** 用户点击「扫码绑定」后同步 window.open；若为 null 多半被浏览器拦截弹窗 */
  const [weixinPopupLikelyBlocked, setWeixinPopupLikelyBlocked] =
    useState(false);
  const [weixinBinding, setWeixinBinding] = useState(false);
  /** 串行轮询代次：新一次「扫码绑定」或卸载时递增，旧循环自动退出 */
  const weixinPollGenRef = useRef(0);

  const refreshWeixin = async () => {
    try {
      const r = await weixinStatus();
      setWeixinBound(!!r.bound);
      setWeixinMasked(r.linkedUserIdMasked ?? null);
    } catch {
      setWeixinBound(false);
      setWeixinMasked(null);
    }
  };

  useEffect(() => {
    void refreshWeixin();
  }, []);

  useEffect(() => {
    return () => {
      weixinPollGenRef.current += 1;
    };
  }, []);

  const startWeixinBind = async () => {
    if (!channelsForm.weixinEnabled) {
      MessageManager.info("请先勾选启用微信通道并保存。");
      return;
    }
    setWeixinBinding(true);
    setWeixinPopupLikelyBlocked(false);

    /** 必须在首屏同步调用，否则弹窗易被拦截；拿到 URL 后再给 about:blank 赋址 */
    let qrTab = null;
    try {
      qrTab = window.open("about:blank", "_blank", "noopener,noreferrer");
    } catch {
      /* ignore */
    }
    if (!qrTab) {
      setWeixinPopupLikelyBlocked(true);
    }

    try {
      const start = await weixinLoginStart();
      if (!start.success || !start.sessionKey) {
        throw new Error(start.error || "无法获取二维码");
      }
      const url = normalizeWeixinQrSrc(start.qrcodeUrl);
      if (qrTab && !qrTab.closed && url) {
        try {
          qrTab.location.href = url;
        } catch {
          try {
            qrTab.close();
          } catch {
            /* ignore */
          }
        }
      } else if (qrTab && !qrTab.closed) {
        try {
          qrTab.close();
        } catch {
          /* ignore */
        }
      }

      const sk = start.sessionKey;
      const myGen = ++weixinPollGenRef.current;

      /**
       * 必须串行：后端单次 poll 会 long-poll 微信最多约 12s。
       * 失败仅打服务端日志，前端不弹错（见 weixin-router）。
       */
      const pollLoop = async () => {
        while (weixinPollGenRef.current === myGen) {
          try {
            const p = await weixinLoginPoll(sk);
            if (weixinPollGenRef.current !== myGen) return;

            if (p.phase === "done") {
              setWeixinBinding(false);
              await refreshWeixin();
              MessageManager.success("微信已绑定");
              return;
            }
            await new Promise((r) => setTimeout(r, 2000));
          } catch {
            if (weixinPollGenRef.current !== myGen) return;
            setWeixinBinding(false);
            return;
          }
        }
      };

      void pollLoop();
    } catch (e) {
      if (qrTab && !qrTab.closed) {
        try {
          qrTab.close();
        } catch {
          /* ignore */
        }
      }
      setWeixinBinding(false);
      MessageManager.error(e?.message || String(e));
    }
  };

  const handleWeixinUnbind = async () => {
    try {
      await weixinUnbind();
      await refreshWeixin();
      MessageManager.success("已解绑");
    } catch (e) {
      MessageManager.error(e?.message || String(e));
    }
  };

  return (
    <div className="settings-channels-layout">
      <div className="settings-channels-card">
        <div className="settings-channels-header">
          <div>
            <h2>通道配置</h2>
            <p className="settings-channels-desc">
              配置消息通道：QQBot、微信（扫码）等。
            </p>
          </div>
        </div>

        <div className="settings-channels-body">
          <div className="settings-channel-section">
            <div className="settings-channel-section-header">
              <div className="settings-channel-section-title">
                <span className="settings-channel-icon">🐧</span>
                <span>QQBot</span>
              </div>
              <label className="settings-channel-toggle">
                <input
                  type="checkbox"
                  checked={channelsForm.qqbotEnabled}
                  onChange={(e) =>
                    setChannelsForm((prev) => ({
                      ...prev,
                      qqbotEnabled: e.target.checked,
                    }))
                  }
                />
                <span className="settings-channel-toggle-label">
                  {channelsForm.qqbotEnabled ? "已启用" : "未启用"}
                </span>
              </label>
            </div>

            {channelsForm.qqbotEnabled && (
              <div className="settings-channel-fields">
                <div className="settings-form-group">
                  <label className="settings-form-label">
                    AppId
                    <span
                      className="settings-field-hint-wrap"
                      title="QQ 开放平台应用的 AppId"
                    >
                      <HelpCircle size={14} />
                    </span>
                  </label>
                  <input
                    type="text"
                    className="settings-form-input"
                    value={channelsForm.qqbotAppId}
                    onChange={(e) =>
                      setChannelsForm((prev) => ({
                        ...prev,
                        qqbotAppId: e.target.value,
                      }))
                    }
                    placeholder="请输入 QQ 开放平台 AppId"
                  />
                </div>

                <div className="settings-form-group">
                  <label className="settings-form-label">
                    Client Secret
                    <span
                      className="settings-field-hint-wrap"
                      title="QQ 开放平台应用的 Client Secret"
                    >
                      <HelpCircle size={14} />
                    </span>
                  </label>
                  <div className="settings-form-input-row">
                    <input
                      type={showQqbotSecret ? "text" : "password"}
                      className="settings-form-input"
                      value={channelsForm.qqbotClientSecret}
                      onChange={(e) =>
                        setChannelsForm((prev) => ({
                          ...prev,
                          qqbotClientSecret: e.target.value,
                        }))
                      }
                      placeholder="请输入 Client Secret"
                    />
                    <button
                      type="button"
                      className="settings-icon-btn"
                      onClick={() => setShowQqbotSecret((v) => !v)}
                      title={showQqbotSecret ? "隐藏" : "显示"}
                    >
                      {showQqbotSecret ? (
                        <EyeOff size={16} />
                      ) : (
                        <Eye size={16} />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="settings-channel-section">
            <div className="settings-channel-section-header">
              <div className="settings-channel-section-title">
                <span className="settings-channel-icon">💬</span>
                <span>微信（iLink 扫码）</span>
              </div>
              <label className="settings-channel-toggle">
                <input
                  type="checkbox"
                  checked={channelsForm.weixinEnabled}
                  onChange={(e) =>
                    setChannelsForm((prev) => ({
                      ...prev,
                      weixinEnabled: e.target.checked,
                    }))
                  }
                />
                <span className="settings-channel-toggle-label">
                  {channelsForm.weixinEnabled ? "已启用" : "未启用"}
                </span>
              </label>
            </div>

            <div className="settings-channel-fields">
              <p className="settings-channels-desc" style={{ marginBottom: 8 }}>
                先保存「启用」再扫码。凭证仅存本机 ~/.fgbg/weixin。已绑定其他微信时换号需先解绑。
              </p>
              <div className="settings-form-group" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button
                  type="button"
                  className="settings-save-btn"
                  disabled={weixinBinding || saving}
                  onClick={() => void startWeixinBind()}
                >
                  {weixinBinding ? "等待扫码…" : "扫码绑定"}
                </button>
                <button
                  type="button"
                  className="settings-reset-btn"
                  disabled={!weixinBound || saving}
                  onClick={() => void handleWeixinUnbind()}
                >
                  解绑
                </button>
                <span className="settings-form-label" style={{ margin: 0 }}>
                  {weixinBound
                    ? `已绑定 ${weixinMasked || ""}`
                    : "未绑定"}
                </span>
              </div>
              {weixinBinding ? (
                <div style={{ marginTop: 8 }}>
                  <p className="settings-channels-desc">
                    {weixinPopupLikelyBlocked
                      ? "未检测到新标签页（可能被浏览器拦截弹窗）。请在地址栏允许本站弹窗后，再点一次「扫码绑定」。"
                      : "已在新的浏览器标签页打开二维码；请用微信扫描或确认。等待手机确认时，每次查询可能需十余秒；二维码会话约 5 分钟内有效。"}
                  </p>
                  {/*
                    未使用 iframe：微信/liteapp 页面普遍带 X-Frame-Options，内嵌多为白屏；
                    采用点击瞬间同步 window.open(about:blank) 再赋 URL，免用户二次点击。
                  */}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="settings-detail-footer">
          <div />
          <div className="settings-detail-actions">
            <button
              type="button"
              className="settings-reset-btn"
              onClick={handleResetClick}
              disabled={resetting || saving}
            >
              {resetting ? "恢复中..." : "恢复默认"}
            </button>
            <button
              type="button"
              className="settings-save-btn"
              onClick={handleSaveChannels}
              disabled={saving || resetting}
            >
              {saving ? "保存中..." : "保存修改"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
