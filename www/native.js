/* 学习目标台 · 原生桥接层 (Capacitor)
 * 设计原则：无 Capacitor 环境（纯浏览器）时所有能力安全降级为 Web 行为，
 * 不抛错、不影响原页面逻辑。运行于原生壳时自动启用系统通知 / 生物识别 / 分享。
 * 同步：保留 window.StudyGoalSync 预留接口（当前本地优先 no-op）。
 */
(function () {
  'use strict';

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function pad(n) { return String(n).padStart(2, '0'); }

  /* 安全本地存储：兼容 localStorage 不可用（隐私模式/部分 WebView）的环境 */
  var _mem = {};
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return (k in _mem) ? _mem[k] : null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { _mem[k] = v; } }

  /* 轻量内联 SVG 图标（与页面风格一致，不使用 emoji） */
  function nicon(name) {
    var p = {
      bell: '<path d="M12 3a5 5 0 0 0-5 5v3.5l-1.5 2.5h13L17 11.5V8a5 5 0 0 0-5-5z"/><path d="M10 18a2 2 0 0 0 4 0" fill="none"/>',
      lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none"/>',
      cloud: '<path d="M7 18a4 4 0 0 1-.5-7.97A5 5 0 0 1 16.7 9 3.5 3.5 0 0 1 17 18z" fill="none"/>',
      shield: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" fill="none"/>'
    }[name] || '';
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>';
  }

  var KEY_REMINDER = 'wb_native_reminder';
  var KEY_BIO = 'wb_native_bio';

  var AppNative = {
    available: function () { return (typeof window.Capacitor !== 'undefined'); },
    platform: function () {
      try { return (window.Capacitor && Capacitor.getPlatform && Capacitor.getPlatform()) || 'web'; }
      catch (e) { return 'web'; }
    },

    /* ---------- 本地通知 ---------- */
    notifySupported: function () {
      return !!(window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.LocalNotifications);
    },
    requestNotify: function () {
      if (!AppNative.notifySupported()) return Promise.resolve(false);
      var N = Capacitor.Plugins.LocalNotifications;
      return N.requestPermissions().then(function (p) {
        return !!(p && (p.display === 'granted' || p.receive === 'granted'));
      }).catch(function () { return false; });
    },
    scheduleDaily: function (hour, minute) {
      hour = (hour == null ? 21 : hour);
      minute = (minute == null ? 0 : minute);
      hour = clamp(hour, 0, 23); minute = clamp(minute, 0, 59);
      if (!AppNative.notifySupported()) return Promise.resolve(false);
      var N = Capacitor.Plugins.LocalNotifications;
      return N.checkPermissions().then(function (p) {
        if (!(p && (p.display === 'granted' || p.receive === 'granted'))) return AppNative.requestNotify();
        return true;
      }).then(function (ok) {
        if (!ok) return false;
        return N.schedule({ notifications: [{
          title: '今日学习目标',
          body: '打开 App，看看今天建议完成多少吧',
          id: 1001,
          schedule: { on: { hour: hour, minute: minute }, repeats: true },
          sound: null
        }] }).then(function () { return true; }).catch(function () { return false; });
      });
    },
    cancelReminders: function () {
      if (!AppNative.notifySupported()) return Promise.resolve(false);
      return Capacitor.Plugins.LocalNotifications.cancel({ notifications: [{ id: 1001 }] })
        .then(function () { return true; }).catch(function () { return false; });
    },

    /* ---------- 生物识别 ---------- */
    bioSupported: function () {
      return !!(window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.BiometricAuthentication);
    },
    bioVerify: function (reason) {
      if (!AppNative.bioSupported()) return Promise.resolve(false);
      var B = Capacitor.Plugins.BiometricAuthentication;
      return B.isAvailable().then(function () {
        return B.verify({ reason: reason || '解锁学习目标台', title: '生物识别' })
          .then(function () { return true; }).catch(function () { return false; });
      }).catch(function () { return false; });
    },

    /* ---------- 系统分享 ---------- */
    share: function (text) {
      if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Share) {
        return Capacitor.Plugins.Share.share({ title: '学习目标台', text: text, dialogTitle: '分享' }).catch(function () {});
      }
      if (navigator.share) { return navigator.share({ title: '学习目标台', text: text }).catch(function () {}); }
      return Promise.resolve();
    },

    /* ---------- 偏好持久化 ---------- */
    getReminder: function () { try { return JSON.parse(lsGet(KEY_REMINDER) || 'null'); } catch (e) { return null; } },
    setReminder: function (cfg) { try { lsSet(KEY_REMINDER, JSON.stringify(cfg)); } catch (e) {} },
    getBio: function () { return lsGet(KEY_BIO) === '1'; },
    setBio: function (on) { lsSet(KEY_BIO, on ? '1' : '0'); },

    /* ---------- 一次性通知（专注结束等） ---------- */
    notifyNow: function (title, body) {
      if (AppNative.notifySupported()) {
        var N = Capacitor.Plugins.LocalNotifications;
        return N.schedule({ notifications: [{
          title: title || '学习目标台',
          body: body || '',
          id: Math.floor(Date.now() / 1000) % 100000,
          schedule: { at: new Date(Date.now() + 300) },
          sound: null
        }] }).catch(function () { return false; });
      }
      return Promise.resolve(false);
    },

    /* ---------- 触感反馈 ---------- */
    haptic: function (style) {
      try {
        if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Haptics) {
          var H = Capacitor.Plugins.Haptics;
          var t = (style === 'heavy') ? H.ImpactStyle.Heavy : (style === 'light' ? H.ImpactStyle.Light : H.ImpactStyle.Medium);
          return H.impact({ style: t }).catch(function () {});
        }
      } catch (e) {}
      if (navigator.vibrate) { try { navigator.vibrate(style === 'light' ? 20 : 45); } catch (e) {} }
      return Promise.resolve();
    }
  };
  window.AppNative = AppNative;

  /* 预留的云同步接口：当前为本地优先 no-op。
   * 未来可在此替换 provider 并接入真实后端，页面 save() 已通过 wb_studygoal_log 队列缓冲待同步操作。 */
  window.StudyGoalSync = {
    enabled: false,
    provider: 'local',
    push: function (op) { return Promise.resolve({ queued: true }); },
    pull: function () { return Promise.resolve({ items: [] }); }
  };

  /* ---------- 注入「我的」页移动端能力卡片 ---------- */
  function mobileCardHTML() {
    var rem = AppNative.getReminder();
    var bio = AppNative.getBio();
    var isNative = AppNative.available();
    var h = '<div class="listcard" id="nativeCard" style="border:1px solid var(--line)">';
    h += '<div class="card-h" style="display:flex;align-items:center;gap:8px;padding:12px 14px 4px;color:#5b6b8c;font-weight:650;font-size:12.5px">'
      + nicon('shield') + '移动端能力' + (isNative ? '<span class="badge" style="margin-left:auto;background:rgba(124,92,255,.12);color:#7c5cff">' + AppNative.platform() + '</span>' : '') + '</div>';

    h += '<div class="lrow"><span class="li">' + nicon('bell') + '</span><div class="lt"><b>每日打卡提醒</b><span>'
      + (rem ? ('每天 ' + pad(rem.hour) + ':' + pad(rem.minute) + ' 推送') : (AppNative.notifySupported() ? '未开启，可设定固定时间' : '当前环境不支持系统通知'))
      + '</span></div><button class="btn sm" data-native="reminder">' + (rem ? '调整/关闭' : '开启') + '</button></div>';

    h += '<div class="lrow"><span class="li">' + nicon('lock') + '</span><div class="lt"><b>生物识别锁</b><span>'
      + (bio ? '已开启，每次打开需验证' : (AppNative.bioSupported() ? '未开启' : '当前环境不支持'))
      + '</span></div><button class="btn sm" data-native="bio"' + (bio || !AppNative.bioSupported() ? ' disabled style="opacity:.5"' : '') + '>'
      + (bio ? '已开启' : '开启') + '</button></div>';

    h += '<div class="lrow" style="border-bottom:0"><span class="li">' + nicon('cloud') + '</span><div class="lt"><b>数据同步</b><span>'
      + (isNative ? '运行于原生壳 · 本地优先' : '本地存储（浏览器）') + '，已预留云同步接口</span></div></div>';

    h += '</div>';
    return h;
  }

  function ensureMobileCard() {
    var box = document.getElementById('mineBody');
    if (!box) return;
    if (document.getElementById('nativeCard')) return;
    box.insertAdjacentHTML('beforeend', mobileCardHTML());
  }

  function refreshMobileCard() {
    var old = document.getElementById('nativeCard');
    if (old) old.remove();
    ensureMobileCard();
  }

  /* ---------- 交互 ---------- */
  function onNativeClick(e) {
    var el = e.target.closest && e.target.closest('[data-native]');
    if (!el) return;
    var act = el.getAttribute('data-native');

    if (act === 'reminder') {
      if (!AppNative.notifySupported()) { alert('系统通知需在 App 内使用（当前为浏览器环境）。'); return; }
      var cur = AppNative.getReminder();
      var h = prompt('提醒时间（小时 0-23）', cur ? String(cur.hour) : '21');
      if (h == null) return;
      var m = prompt('提醒分钟（0-59）', cur ? String(cur.minute) : '0');
      if (m == null) return;
      h = clamp(parseInt(h, 10) || 21, 0, 23); m = clamp(parseInt(m, 10) || 0, 0, 59);
      if (!confirm('每天 ' + pad(h) + ':' + pad(m) + ' 推送打卡提醒？')) return;
      AppNative.scheduleDaily(h, m).then(function (ok) {
        if (ok) { AppNative.setReminder({ hour: h, minute: m }); }
        else { AppNative.setReminder(null); alert('未能取得通知权限，已改为未开启。'); }
        refreshMobileCard();
      });
    } else if (act === 'bio') {
      if (!AppNative.bioSupported()) { alert('生物识别需在 App 内使用（当前为浏览器环境）。'); return; }
      if (AppNative.getBio()) {
        AppNative.setBio(false); refreshMobileCard(); return;
      }
      AppNative.bioVerify('开启生物识别锁').then(function (ok) {
        if (ok) { AppNative.setBio(true); alert('已开启，下次打开 App 将要求验证。'); }
        else { alert('未通过验证，未开启。'); }
        refreshMobileCard();
      });
    }
  }

  /* ---------- 生物识别锁遮罩 ---------- */
  function applyBioLock() {
    if (!AppNative.getBio() || !AppNative.bioSupported()) return;
    var ov = document.createElement('div');
    ov.id = 'bioLock';
    ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(245,247,250,.98);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px';
    ov.innerHTML = '<div style="font-size:15px;color:#5b6b8c">' + nicon('lock') + ' 学习目标台已锁定</div>'
      + '<button id="bioUnlock" style="border:0;background:linear-gradient(135deg,#7c5cff,#a78bfa);color:#fff;padding:12px 22px;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer">验证身份</button>';
    document.body.appendChild(ov);
    document.getElementById('bioUnlock').addEventListener('click', function () {
      AppNative.bioVerify('解锁学习目标台').then(function (ok) { if (ok) ov.remove(); });
    });
  }

  /* ---------- 启动 ---------- */
  function init() {
    document.addEventListener('click', onNativeClick);
    // 监听「我的」容器变化，renderMine 重绘后自动补回卡片
    var box = document.getElementById('mineBody');
    if (box) {
      var mo = new MutationObserver(function () { ensureMobileCard(); });
      mo.observe(box, { childList: true });
      ensureMobileCard();
    }
    // 启动时若已设提醒，重新登记（设备重启后定时仍需确认）
    var rem = AppNative.getReminder();
    if (rem && AppNative.notifySupported()) {
      AppNative.scheduleDaily(rem.hour, rem.minute).catch(function () {});
    }
    applyBioLock();
  }

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
