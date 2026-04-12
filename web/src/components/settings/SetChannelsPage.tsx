// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, HelpCircle } from "lucide-react";
import {
  weixinLoginStart,
  weixinLoginPoll,
  weixinSetPrimary,
  weixinStatus,
  weixinUnbind,
} from "../../api/configApi";
import MessageManager from "../Message";

/** iLink 常返回裸 base64，img 需要 data URL 或绝对地址 */
function normalizeWeixinQrSrc(raw) {
  if (raw == null) return "";
  const s = String(raw).trim();
  if (!s) return "";
  if (/^(data:|https?:|blob:)/i.test(s)) return s;
  if (s.startsWith("//")) return `https:${s}`;
  if (s.startsWith("/")) {
    try { return new URL(s, "https://ilinkai.weixin.qq.com").href; } catch { return s; }
  }
  return `data:image/png;base64,${s.replace(/\s+/g, "")}`;
}

/** 主账号切换后的气泡提醒：提醒用户需要保存才生效 */
function PrimaryBubble() {
  return (
    <div className="channel-primary-bubble">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M8 1a7 7 0 110 14A7 7 0 018 1zm0 4.5a1 1 0 00-1 1v3a1 1 0 102 0v-3a1 1 0 00-1-1zm0 7a1 1 0 100-2 1 1 0 000 2z" fill="currentColor"/>
      </svg>
      <span>主账号已切换，请点击底部「保存修改」生效</span>
    </div>
  );
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

  const [weixinBots, setWeixinBots] = useState([]);
  const [weixinPrimary, setWeixinPrimaryLocal] = useState("");
  const [primaryBubble, setPrimaryBubble] = useState(false);
  const weixinPollGenRef = useRef({});
  const bubbleTimerRef = useRef(null);

  const refreshWeixin = async () => {
    try {
      const r = await weixinStatus();
      const remoteBots = Array.isArray(r.bots) ? r.bots : [];
      setWeixinPrimaryLocal(r.primary || "");
      setWeixinBots((prev) => {
        const byIdentify = new Map(prev.map((b) => [b.identify, b]));
        const merged = remoteBots.map((rb) => {
          const local = byIdentify.get(rb.identify) || {};
          return {
            identify: rb.identify || "",
            bound: true,
            linkedUserIdMasked: rb.linkedUserIdMasked || "",
            botId: rb.botId || "",
            binding: false,
            popupLikelyBlocked: false,
            ...local,
          };
        });
        for (const b of prev) {
          if (!b.bound && !merged.some((x) => x.identify === b.identify && b.identify)) {
            merged.push(b);
          }
        }
        return merged;
      });
    } catch {
      setWeixinBots([]);
      setWeixinPrimaryLocal("");
    }
  };

  useEffect(() => { void refreshWeixin(); }, []);
  useEffect(() => () => { weixinPollGenRef.current = {}; }, []);

  const setBotPartial = (idx, patch) => {
    setWeixinBots((prev) => prev.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  };

  const startWeixinBind = async (idx) => {
    const item = weixinBots[idx];
    const identify = String(item?.identify ?? "").trim();
    if (!identify) { MessageManager.info("请先填写 identify"); return; }
    if (!/^[A-Za-z0-9_]+$/.test(identify)) { MessageManager.info("identify 仅允许英文、数字、下划线"); return; }
    if (!channelsForm.weixinEnabled) { MessageManager.info("请先勾选启用微信通道并保存。"); return; }

    setBotPartial(idx, { binding: true, popupLikelyBlocked: false });

    let qrTab = null;
    try { qrTab = window.open("about:blank", "_blank"); } catch { /* ignore */ }
    if (!qrTab) { setBotPartial(idx, { popupLikelyBlocked: true }); }

    try {
      const start = await weixinLoginStart(identify);
      if (!start.success || !start.sessionKey) throw new Error(start.error || "无法获取二维码");
      const url = normalizeWeixinQrSrc(start.qrcodeUrl);
      if (qrTab && !qrTab.closed && url) {
        try { qrTab.location.replace(url); } catch {
          try { qrTab.close(); } catch { /* ignore */ }
          window.open(url, "_blank");
        }
      } else if (qrTab && !qrTab.closed) {
        try { qrTab.close(); } catch { /* ignore */ }
      }

      const sk = start.sessionKey;
      const myGen = Date.now();
      weixinPollGenRef.current[identify] = myGen;

      const pollLoop = async () => {
        while (weixinPollGenRef.current[identify] === myGen) {
          try {
            const p = await weixinLoginPoll(sk);
            if (weixinPollGenRef.current[identify] !== myGen) return;
            if (p.phase === "done") {
              setBotPartial(idx, { binding: false, bound: true });
              await refreshWeixin();
              MessageManager.success("微信已绑定");
              return;
            }
            if (p.phase === "error") { setBotPartial(idx, { binding: false }); return; }
            await new Promise((r) => setTimeout(r, 2000));
          } catch {
            if (weixinPollGenRef.current[identify] !== myGen) return;
            setBotPartial(idx, { binding: false });
            return;
          }
        }
      };
      void pollLoop();
    } catch (e) {
      if (qrTab && !qrTab.closed) { try { qrTab.close(); } catch { /* ignore */ } }
      setBotPartial(idx, { binding: false });
      MessageManager.error(e?.message || String(e));
    }
  };

  const handleWeixinUnbind = async (identify) => {
    if (!identify) return;
    try {
      await weixinUnbind(identify);
      await refreshWeixin();
      MessageManager.success("已解绑");
    } catch (e) {
      MessageManager.error(e?.message || String(e));
    }
  };

  /** 切换主账号：更新本地显示 + 写入 pending 到 channelsForm（保存时提交） */
  const handleSetPrimary = (identify) => {
    if (identify === weixinPrimary) return;
    setWeixinPrimaryLocal(identify);
    setChannelsForm((prev) => ({ ...prev, weixinPrimaryPending: identify }));
    setPrimaryBubble(true);
    if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
    bubbleTimerRef.current = setTimeout(() => setPrimaryBubble(false), 3500);
  };

  const addWeixinBotRow = () => {
    setWeixinBots((prev) => [
      ...prev,
      { identify: "", bound: false, linkedUserIdMasked: "", botId: "", binding: false, popupLikelyBlocked: false },
    ]);
  };

  return (
    <div className="settings-channels-layout">
      <div className="settings-channels-card">
        <div className="settings-channels-header">
          <div>
            <h2>通道配置</h2>
            <p className="settings-channels-desc">配置消息通道：QQBot、微信（扫码）等。</p>
          </div>
        </div>

        <div className="settings-channels-body">
          {/* ─── QQBot ─── */}
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
                  onChange={(e) => setChannelsForm((prev) => ({ ...prev, qqbotEnabled: e.target.checked }))}
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
                    <span className="settings-field-hint-wrap" title="QQ 开放平台应用的 AppId">
                      <HelpCircle size={14} />
                    </span>
                  </label>
                  <input
                    type="text"
                    className="settings-form-input"
                    value={channelsForm.qqbotAppId}
                    onChange={(e) => setChannelsForm((prev) => ({ ...prev, qqbotAppId: e.target.value }))}
                    placeholder="请输入 QQ 开放平台 AppId"
                  />
                </div>

                <div className="settings-form-group">
                  <label className="settings-form-label">
                    Client Secret
                    <span className="settings-field-hint-wrap" title="QQ 开放平台应用的 Client Secret">
                      <HelpCircle size={14} />
                    </span>
                  </label>
                  <div className="settings-form-input-row">
                    <input
                      type={showQqbotSecret ? "text" : "password"}
                      className="settings-form-input"
                      value={channelsForm.qqbotClientSecret}
                      onChange={(e) => setChannelsForm((prev) => ({ ...prev, qqbotClientSecret: e.target.value }))}
                      placeholder={channelsForm.qqbotHasCredentials ? "已保存，留空则不修改" : "请输入 Client Secret"}
                    />
                    <button
                      type="button"
                      className="settings-icon-btn"
                      onClick={() => setShowQqbotSecret((v) => !v)}
                      title={showQqbotSecret ? "隐藏" : "显示"}
                    >
                      {showQqbotSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ─── 微信 ─── */}
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
                  onChange={(e) => setChannelsForm((prev) => ({ ...prev, weixinEnabled: e.target.checked }))}
                />
                <span className="settings-channel-toggle-label">
                  {channelsForm.weixinEnabled ? "已启用" : "未启用"}
                </span>
              </label>
            </div>

            {channelsForm.weixinEnabled && (
              <div className="settings-channel-fields">
                <p className="settings-channels-hint">
                  先保存「启用」再扫码。最多绑定 3 个 bot；每个 bot 需唯一 identify（英文/数字/下划线）。
                </p>
                <button
                  type="button"
                  className="settings-add-btn"
                  disabled={weixinBots.length >= 3 || saving}
                  onClick={addWeixinBotRow}
                >
                  + 新增微信 Bot
                </button>

                {weixinBots.map((bot, idx) => {
                  const isPrimary = weixinPrimary === bot.identify && !!bot.identify;
                  return (
                    <div
                      key={`${bot.identify || "draft"}-${idx}`}
                      className={`weixin-bot-card${isPrimary ? " weixin-bot-card--primary" : ""}`}
                    >
                      {/* 主账号气泡提醒 */}
                      {isPrimary && primaryBubble && <PrimaryBubble />}

                      <div className="weixin-bot-card-top">
                        <div className="weixin-bot-identify-group">
                          <label className="settings-form-label">identify</label>
                          <input
                            type="text"
                            className="settings-form-input"
                            value={bot.identify}
                            disabled={bot.bound || bot.binding}
                            onChange={(e) => setBotPartial(idx, { identify: e.target.value.trim() })}
                            placeholder="例如: default / botA"
                          />
                        </div>

                        {/* 主账号选择框 */}
                        <label className="weixin-primary-radio" title="勾选后需点击底部「保存修改」才生效">
                          <input
                            type="radio"
                            name="weixin-primary"
                            checked={isPrimary}
                            disabled={!bot.bound || !bot.identify}
                            onChange={() => handleSetPrimary(bot.identify)}
                          />
                          <span>主账号</span>
                        </label>
                      </div>

                      <div className="weixin-bot-card-actions">
                        <button
                          type="button"
                          className="settings-save-btn"
                          disabled={bot.binding || saving}
                          onClick={() => void startWeixinBind(idx)}
                        >
                          {bot.binding ? "等待扫码…" : "扫码绑定"}
                        </button>
                        <button
                          type="button"
                          className="settings-reset-btn"
                          disabled={!bot.bound || bot.binding || saving}
                          onClick={() => void handleWeixinUnbind(bot.identify)}
                        >
                          解绑
                        </button>
                      </div>

                      <div className={`weixin-bot-status${bot.bound ? "" : " weixin-bot-status--unbound"}`}>
                        {bot.bound ? `已绑定 ${bot.linkedUserIdMasked || ""}` : "未绑定"}
                      </div>
                      {bot.binding && (
                        <div className="weixin-bot-status weixin-bot-status--binding">
                          {bot.popupLikelyBlocked ? "弹窗被浏览器拦截，请允许后重试。" : "已在新标签页打开二维码，请扫码确认。"}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
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
