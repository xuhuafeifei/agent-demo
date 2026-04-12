// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import {
  weixinLoginStart,
  weixinLoginPoll,
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
    try {
      return new URL(s, "https://ilinkai.weixin.qq.com").href;
    } catch {
      return s;
    }
  }
  return `data:image/png;base64,${s.replace(/\s+/g, "")}`;
}

function newRowKey() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `row-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** 主账号切换后的气泡提醒：提醒用户需要保存才生效 */
function PrimaryBubble() {
  return (
    <div className="channel-primary-bubble">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path
          d="M8 1a7 7 0 110 14A7 7 0 018 1zm0 4.5a1 1 0 00-1 1v3a1 1 0 102 0v-3a1 1 0 00-1-1zm0 7a1 1 0 100-2 1 1 0 000 2z"
          fill="currentColor"
        />
      </svg>
      <span>主账号已切换，请点击底部「保存修改」生效</span>
    </div>
  );
}

export default function WeixinChannelSection({
  channelsForm,
  setChannelsForm,
  saving,
}) {
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
        const byTenantId = new Map(prev.map((b) => [b.tenantId, b]));
        const merged = remoteBots.map((rb) => {
          const local = byTenantId.get(rb.tenantId) || {};
          return {
            ...local,
            rowKey: local.rowKey || newRowKey(),
            tenantId: rb.tenantId || "",
            bound: true,
            linkedUserIdMasked: rb.linkedUserIdMasked || "",
            botId: rb.botId || "",
            binding: false,
            popupLikelyBlocked: false,
          };
        });
        for (const b of prev) {
          if (
            !b.bound &&
            !merged.some((x) => x.tenantId === b.tenantId && b.tenantId)
          ) {
            merged.push({
              ...b,
              rowKey: b.rowKey || newRowKey(),
            });
          }
        }
        return merged;
      });
    } catch {
      setWeixinBots([]);
      setWeixinPrimaryLocal("");
    }
  };

  useEffect(() => {
    void refreshWeixin();
  }, []);
  useEffect(
    () => () => {
      weixinPollGenRef.current = {};
    },
    [],
  );

  const setBotPartial = (idx, patch) => {
    setWeixinBots((prev) =>
      prev.map((b, i) => (i === idx ? { ...b, ...patch } : b)),
    );
  };

  const startWeixinBind = async (idx) => {
    const item = weixinBots[idx];
    const tenantId = String(item?.tenantId ?? "").trim();
    if (!tenantId) {
      MessageManager.info("请先填写 tenantId");
      return;
    }
    if (!/^[A-Za-z0-9_]+$/.test(tenantId)) {
      MessageManager.info("tenantId 仅允许英文、数字、下划线");
      return;
    }
    if (!channelsForm.weixinEnabled) {
      MessageManager.info("请先勾选启用微信通道并保存。");
      return;
    }

    setBotPartial(idx, { binding: true, popupLikelyBlocked: false });

    let qrTab = null;
    try {
      qrTab = window.open("about:blank", "_blank");
    } catch {
      /* ignore */
    }
    if (!qrTab) {
      setBotPartial(idx, { popupLikelyBlocked: true });
    }

    try {
      const start = await weixinLoginStart(tenantId);
      if (!start.success || !start.sessionKey)
        throw new Error(start.error || "无法获取二维码");
      const url = normalizeWeixinQrSrc(start.qrcodeUrl);
      if (qrTab && !qrTab.closed && url) {
        try {
          qrTab.location.replace(url);
        } catch {
          try {
            qrTab.close();
          } catch {
            /* ignore */
          }
          window.open(url, "_blank");
        }
      } else if (qrTab && !qrTab.closed) {
        try {
          qrTab.close();
        } catch {
          /* ignore */
        }
      }

      const sk = start.sessionKey;
      const myGen = Date.now();
      weixinPollGenRef.current[tenantId] = myGen;

      const pollLoop = async () => {
        while (weixinPollGenRef.current[tenantId] === myGen) {
          try {
            const p = await weixinLoginPoll(sk);
            if (weixinPollGenRef.current[tenantId] !== myGen) return;
            if (p.phase === "done") {
              setBotPartial(idx, { binding: false, bound: true });
              await refreshWeixin();
              MessageManager.success("微信已绑定");
              return;
            }
            if (p.phase === "error") {
              setBotPartial(idx, { binding: false });
              return;
            }
            await new Promise((r) => setTimeout(r, 2000));
          } catch {
            if (weixinPollGenRef.current[tenantId] !== myGen) return;
            setBotPartial(idx, { binding: false });
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
      setBotPartial(idx, { binding: false });
      MessageManager.error(e?.message || String(e));
    }
  };

  /** 删除该 Bot：已绑定则调后端移除配置；未绑定则从列表去掉该行 */
  const handleRemoveBot = async (bot, idx) => {
    if (bot.binding || saving) return;
    const tenantId = String(bot.tenantId ?? "").trim();

    if (bot.bound) {
      if (!tenantId) return;
      if (
        !window.confirm(
          `将删除并解绑该微信 Bot（tenantId: ${tenantId}），确定？`,
        )
      ) {
        return;
      }
      try {
        weixinPollGenRef.current[tenantId] = Date.now();
        await weixinUnbind(tenantId);
        setChannelsForm((prev) =>
          prev.weixinPrimaryPending === tenantId
            ? { ...prev, weixinPrimaryPending: "" }
            : prev,
        );
        await refreshWeixin();
        MessageManager.success("已删除该 Bot");
      } catch (e) {
        MessageManager.error(e?.message || String(e));
      }
      return;
    }

    if (!window.confirm("确定移除此 Bot 配置行？")) return;
    setWeixinBots((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSetPrimary = (tenantId) => {
    if (tenantId === weixinPrimary) return;
    setWeixinPrimaryLocal(tenantId);
    setChannelsForm((prev) => ({ ...prev, weixinPrimaryPending: tenantId }));
    setPrimaryBubble(true);
    if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
    bubbleTimerRef.current = setTimeout(() => setPrimaryBubble(false), 3500);
  };

  const addWeixinBotRow = () => {
    setWeixinBots((prev) => [
      ...prev,
      {
        rowKey: newRowKey(),
        tenantId: "",
        bound: false,
        linkedUserIdMasked: "",
        botId: "",
        binding: false,
        popupLikelyBlocked: false,
      },
    ]);
  };

  return (
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

      {channelsForm.weixinEnabled && (
        <div className="settings-channel-fields">
          <p className="settings-channels-hint">
            先保存「启用」再扫码。最多绑定 3 个 bot；每个 bot 需唯一
            tenantId（英文/数字/下划线）。
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
            const isPrimary =
              weixinPrimary === bot.tenantId && !!bot.tenantId;
            return (
              <div
                key={bot.rowKey}
                className={`weixin-bot-card${isPrimary ? " weixin-bot-card--primary" : ""}`}
              >
                {isPrimary && primaryBubble && <PrimaryBubble />}

                <div className="weixin-bot-card-top">
                  <div className="weixin-bot-identify-group">
                    <label className="settings-form-label">tenantId</label>
                    <input
                      type="text"
                      className="settings-form-input"
                      value={bot.tenantId}
                      disabled={bot.bound || bot.binding}
                      onChange={(e) =>
                        setBotPartial(idx, {
                          tenantId: e.target.value,
                        })
                      }
                      placeholder="例如: default / botA"
                    />
                  </div>

                  <label
                    className="weixin-primary-radio"
                    title="勾选后需点击底部「保存修改」才生效"
                  >
                    <input
                      type="radio"
                      name="weixin-primary"
                      checked={isPrimary}
                      disabled={!bot.bound || !bot.tenantId}
                      onChange={() => handleSetPrimary(bot.tenantId)}
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
                    className="settings-delete-btn"
                    disabled={bot.binding || saving}
                    onClick={() => void handleRemoveBot(bot, idx)}
                  >
                    删除
                  </button>
                </div>

                <div
                  className={`weixin-bot-status${bot.bound ? "" : " weixin-bot-status--unbound"}`}
                >
                  {bot.bound
                    ? `已绑定 ${bot.linkedUserIdMasked || ""}`
                    : "未绑定"}
                </div>
                {bot.binding && (
                  <div className="weixin-bot-status weixin-bot-status--binding">
                    {bot.popupLikelyBlocked
                      ? "弹窗被浏览器拦截，请允许后重试。"
                      : "已在新标签页打开二维码，请扫码确认。"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
