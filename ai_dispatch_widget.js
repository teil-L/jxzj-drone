(function () {
  if (window.__dispatchWidgetMounted) return;
  window.__dispatchWidgetMounted = true;

  function createEl(tag, cls, html) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (html !== undefined) el.innerHTML = html;
    return el;
  }

  function getPageName() {
    var file = (location.pathname.split("/").pop() || "").trim();
    if (!file) return "unknown";
    return decodeURIComponent(file);
  }

  var style = createEl("style");
  style.textContent = [
    "@keyframes dispatchPulse{0%{box-shadow:0 0 0 0 rgba(0,240,255,.35)}70%{box-shadow:0 0 0 14px rgba(0,240,255,0)}100%{box-shadow:0 0 0 0 rgba(0,240,255,0)}}",
    ".dispatch-fab{position:fixed;right:20px;bottom:20px;z-index:9998;width:76px;height:76px;border-radius:999px;border:1px solid rgba(0,240,255,.55);background:radial-gradient(circle at 35% 30%,rgba(0,240,255,.35),rgba(2,16,34,.95) 64%);color:#00F0FF;cursor:pointer;display:flex;align-items:center;justify-content:center;animation:dispatchPulse 2s infinite;box-shadow:0 0 18px rgba(0,240,255,.4),inset 0 0 18px rgba(0,240,255,.2)}",
    ".dispatch-fab:hover{transform:translateY(-1px);box-shadow:0 0 24px rgba(0,240,255,.55),inset 0 0 20px rgba(0,240,255,.24)}",
    ".dispatch-fab:active{transform:translateY(0)}",
    ".dispatch-fab-icon{font-size:30px;line-height:1;filter:drop-shadow(0 0 8px rgba(0,240,255,.7))}",
    ".dispatch-fab-tip{position:absolute;right:86px;bottom:26px;white-space:nowrap;background:rgba(6,19,37,.9);border:1px solid rgba(0,240,255,.35);color:#00F0FF;padding:5px 8px;font-size:11px;letter-spacing:.06em;opacity:0;pointer-events:none;transform:translateY(4px);transition:all .14s ease}",
    ".dispatch-fab-wrap:hover .dispatch-fab-tip{opacity:1;transform:translateY(0)}",
    ".dispatch-modal{position:fixed;inset:0;z-index:9999;background:rgba(0,6,14,.72);backdrop-filter:blur(2px);display:none;align-items:center;justify-content:center;padding:16px}",
    ".dispatch-modal.show{display:flex}",
    ".dispatch-card{width:min(560px,96vw);background:#061325;border:1px solid rgba(0,240,255,.35);box-shadow:0 10px 30px rgba(0,0,0,.4);padding:14px;color:#e6fbff}",
    ".dispatch-title{display:flex;justify-content:space-between;align-items:center;color:#00F0FF;font-weight:700;letter-spacing:.08em;margin-bottom:10px}",
    ".dispatch-close{border:1px solid rgba(0,240,255,.5);background:transparent;color:#00F0FF;cursor:pointer;padding:2px 8px}",
    ".dispatch-input{width:100%;height:66px;resize:none;background:#020a16;border:1px solid rgba(0,240,255,.3);color:#d6f7ff;padding:8px;font-size:12px;outline:none}",
    ".dispatch-action{margin-top:10px;border:1px solid rgba(0,240,255,.45);background:rgba(0,240,255,.12);color:#00F0FF;font-weight:700;padding:8px 10px;cursor:pointer;width:100%}",
    ".dispatch-meta{margin-top:8px;font-size:11px;color:rgba(0,240,255,.8)}",
    ".dispatch-output{margin-top:8px;background:#030d1a;border:1px solid rgba(0,240,255,.2);padding:10px;font-size:13px;line-height:1.55;white-space:pre-wrap;min-height:96px}"
  ].join("");
  document.head.appendChild(style);

  var fabWrap = createEl("div", "dispatch-fab-wrap");
  fabWrap.style.position = "fixed";
  fabWrap.style.right = "20px";
  fabWrap.style.bottom = "20px";
  fabWrap.style.zIndex = "9998";
  var fab = createEl("button", "dispatch-fab",
    '<span class="dispatch-fab-icon" aria-hidden="true">' +
    '<svg viewBox="0 0 24 24" width="36" height="36" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M12 2L20 5V11.2C20 16.1 16.9 20.6 12 22C7.1 20.6 4 16.1 4 11.2V5L12 2Z" stroke="currentColor" stroke-width="1.6"/>' +
    '<path d="M9 11.7L11.1 13.8L15.5 9.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>' +
    '</span>');
  fab.setAttribute("aria-label", "AI出警建议");
  var fabTip = createEl("div", "dispatch-fab-tip", "AI 出警建议");
  var modal = createEl("div", "dispatch-modal");
  var card = createEl("div", "dispatch-card");
  var title = createEl("div", "dispatch-title");
  var closeBtn = createEl("button", "dispatch-close", "关闭");
  var titleText = createEl("span", "", "全局 AI 出警建议");
  title.appendChild(titleText);
  title.appendChild(closeBtn);

  var input = createEl("textarea", "dispatch-input");
  input.placeholder = "可补充当前态势（例如: 疑似非法捕捞船靠近桥区）。";
  var action = createEl("button", "dispatch-action", "生成出警建议");
  var meta = createEl("div", "dispatch-meta", "来源: -");
  var output = createEl("div", "dispatch-output", "点击“生成出警建议”后显示。");

  card.appendChild(title);
  card.appendChild(input);
  card.appendChild(action);
  card.appendChild(meta);
  card.appendChild(output);
  modal.appendChild(card);
  fabWrap.appendChild(fab);
  fabWrap.appendChild(fabTip);
  document.body.appendChild(fabWrap);
  document.body.appendChild(modal);

  function setLoading(loading) {
    action.disabled = loading;
    action.textContent = loading ? "生成中..." : "生成出警建议";
  }

  async function requestSuggestion() {
    setLoading(true);
    try {
      var resp = await fetch("http://127.0.0.1:5000/api/dispatch-suggestion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page: getPageName(),
          event: input.value.trim()
        })
      });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      var data = await resp.json();
      meta.textContent = "来源: " + (data.source || "-") + " | 页面: " + (data.page || "-");
      output.textContent = (data.title ? data.title + "\n" : "") + (data.suggestion || "未返回内容");
    } catch (err) {
      meta.textContent = "来源: error";
      output.textContent = "生成失败，请检查后端服务与API配置。\n" + String(err);
    } finally {
      setLoading(false);
    }
  }

  fab.addEventListener("click", function () {
    modal.classList.add("show");
  });
  closeBtn.addEventListener("click", function () {
    modal.classList.remove("show");
  });
  modal.addEventListener("click", function (e) {
    if (e.target === modal) modal.classList.remove("show");
  });
  action.addEventListener("click", requestSuggestion);
})();
