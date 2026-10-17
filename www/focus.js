/* ============================================================
   专注模块（学习目标台 × 茶·高效待办）
   - 番茄钟 / 正计时
   - 真实环境声景（与 tea.awacode.top 同源：moodist / Pixabay CC0），单选、循环
   - 子任务打勾、专注记录联动看板与周报（records + focus 标记）
   - 专注结束自动打卡（当天首次）并记录投入分钟
   所有读写都通过 index.html 暴露的 window.SG 进行。
   ============================================================ */
(function(){
  'use strict';
  var SG = window.SG;
  if(!SG) return;

  var PRESETS = [15, 25, 30, 45];

  /* 真实声景清单（与 tea 一致的音源，已压缩打包进 www/sounds） */
  var SOUNDS = [
    { id:'light-rain',      cn:'小雨',    cat:'雨',   f:'sounds/rain/light-rain.mp3' },
    { id:'rain-on-window',  cn:'雨打窗',  cat:'雨',   f:'sounds/rain/rain-on-window.mp3' },
    { id:'heavy-rain',      cn:'大雨',    cat:'雨',   f:'sounds/rain/heavy-rain.mp3' },
    { id:'river',           cn:'河流',    cat:'自然', f:'sounds/nature/river.mp3' },
    { id:'waves',           cn:'海浪',    cat:'自然', f:'sounds/nature/waves.mp3' },
    { id:'campfire',        cn:'篝火',    cat:'自然', f:'sounds/nature/campfire.mp3' },
    { id:'wind-in-trees',   cn:'林间风',  cat:'自然', f:'sounds/nature/wind-in-trees.mp3' },
    { id:'birds',           cn:'鸟鸣',    cat:'动物', f:'sounds/animals/birds.mp3' },
    { id:'cafe',            cn:'咖啡馆',  cat:'场所', f:'sounds/places/cafe.mp3' },
    { id:'white-noise',     cn:'白噪音',  cat:'噪音', f:'sounds/noise/white-noise.mp3' },
    { id:'pink-noise',      cn:'粉噪音',  cat:'噪音', f:'sounds/noise/pink-noise.mp3' },
    { id:'brown-noise',     cn:'棕噪音',  cat:'噪音', f:'sounds/noise/brown-noise.mp3' },
    { id:'binaural-beta',   cn:'β 专注',  cat:'双耳', f:'sounds/binaural/binaural-beta.mp3' }
  ];
  var SOUND_CATS = ['雨','自然','动物','场所','噪音','双耳'];

  var state = {
    running:false, paused:false,
    mode:'pomodoro',          // 'pomodoro' | 'stopwatch'
    presetMin:25,
    totalSec:25*60,
    accumSec:0,              // 已累计秒数（跨暂停）
    segStart:0,              // 当前段落起点
    goalId:null,             // 未选择时为 null，禁止开始
    timer:null,
    soundId:null,            // 单选声景，null=静音
    audioEl:null
  };

  /* ---------- 工具 ---------- */
  function timeStr(sec){
    sec = Math.max(0, Math.floor(sec));
    var m = Math.floor(sec/60), s = sec%60;
    return (m<10?'0':'')+m+':'+(s<10?'0':'')+s;
  }
  function curElapsed(){
    var e = state.accumSec || 0;
    if(state.running && state.segStart) e += (Date.now()-state.segStart)/1000;
    return e;
  }
  function curPct(){
    if(state.mode==='stopwatch') return Math.min(curElapsed()/3600, 1)*100;
    return Math.min(curElapsed()/state.totalSec, 1)*100;
  }
  function soundById(id){
    for(var i=0;i<SOUNDS.length;i++) if(SOUNDS[i].id===id) return SOUNDS[i];
    return null;
  }

  /* ---------- 声景（真实音频，单选，循环，淡入淡出） ---------- */
  function fade(a, from, to, ms, done){
    var start = Date.now();
    var step = 30;
    function run(){
      if(!a) return;
      var t = Math.min(1, (Date.now()-start)/ms);
      try{ a.volume = Math.max(0, Math.min(1, from + (to-from)*t)); }catch(e){}
      if(t<1) setTimeout(run, step);
      else if(done) done();
    }
    run();
  }
  function stopSound(){
    state.soundId = null;
    if(state.audioEl){
      var a = state.audioEl; state.audioEl = null;
      fade(a, a.volume||0, 0, 260, function(){ try{ a.pause(); }catch(e){} });
    }
  }
  function playSound(id){
    if(!id){ stopSound(); return; }
    var s = soundById(id);
    if(!s) return;
    // 切换时先淡出旧的
    if(state.audioEl){
      var old = state.audioEl; state.audioEl = null;
      fade(old, old.volume||0, 0, 220, function(){ try{ old.pause(); }catch(e){} });
    }
    var a = new Audio(s.f);
    a.loop = true;
    a.volume = 0;
    state.audioEl = a;
    state.soundId = id;
    var p = a.play();
    if(p && p.catch){
      p.then(function(){ fade(a, 0, 0.55, 400); }).catch(function(){
        state.soundId = null; state.audioEl = null;
        SG.toast('声景播放失败，请重试','err');
      });
    }else{
      fade(a, 0, 0.55, 400);
    }
  }

  /* ---------- 计时 ---------- */
  function tick(){
    if(!state.running) return;
    var el = curElapsed();
    if(state.mode==='pomodoro' && el >= state.totalSec){
      finish(true);
      return;
    }
    paintDynamic();
  }
  function startOrResume(){
    if(state.running) return;
    if(!state.goalId){
      SG.toast('请先选择一个目标，再开始专注','err');
      return;
    }
    if(window.AppNative && window.AppNative.notifySupported()){
      try{ window.AppNative.requestNotify(); }catch(e){}
    }
    state.running = true; state.paused = false;
    state.segStart = Date.now();
    if(!state.timer) state.timer = setInterval(tick, 250);
    renderFocus();
  }
  function pause(){
    if(!state.running) return;
    state.accumSec = curElapsed();
    state.running = false; state.paused = true;
    renderFocus();
  }
  function finish(auto){
    var elapsed = curElapsed();
    // 提前结束也记录：≥3 秒即记 1 分钟，避免误触
    var minutes = Math.round(elapsed/60);
    if(minutes<=0 && elapsed>=3) minutes = 1;
    var gid = state.goalId;
    resetTimer();
    if(minutes>0 && gid){
      if(window.AppNative){
        try{ window.AppNative.haptic('medium'); }catch(e){}
        try{ window.AppNative.notifyNow('专注结束', '本次专注 '+minutes+' 分钟，去确认打卡吧'); }catch(e){}
      }
      // 弹出与打卡页一致的确认弹窗，时长固定为本次专注时长
      SG.focusCheckin(gid, minutes);
    } else if(gid){
      SG.toast('专注时间太短，未记录','');
    }
    stopSound();
    updateBar();
    renderFocus();
  }
  function resetTimer(){
    state.running=false; state.paused=false; state.accumSec=0; state.segStart=0;
    if(state.timer){ clearInterval(state.timer); state.timer=null; }
  }
  function stopFocus(){
    if(state.running || state.accumSec>0){
      finish(false);
    }else{
      resetTimer(); stopSound(); updateBar(); renderFocus();
    }
  }

  /* ---------- 数据 ---------- */
  function activeGoals(){
    return SG.store.goals.filter(function(g){ return !SG.isDone(g); })
      .concat(SG.store.goals.filter(function(g){ return SG.isDone(g); }));
  }
  function focusSessions(){
    return SG.store.records.filter(function(r){ return r.focus; })
      .sort(function(a,b){ return (b.createdAt||0)-(a.createdAt||0); });
  }

  /* ---------- 渲染 ---------- */
  function ringSvg(pct){
    var size=200, r=86, c=2*Math.PI*r, off=c*(1-pct/100);
    return '<svg width="'+size+'" height="'+size+'" viewBox="0 0 '+size+' '+size+'" style="transform:rotate(-90deg)">'
      + '<circle cx="'+size/2+'" cy="'+size/2+'" r="'+r+'" stroke="#eef0f7" stroke-width="12" fill="none"/>'
      + '<circle id="focRingFill" cx="'+size/2+'" cy="'+size/2+'" r="'+r+'" stroke="#6d5bd0" stroke-width="12" fill="none" stroke-linecap="round" stroke-dasharray="'+c.toFixed(1)+'" stroke-dashoffset="'+off.toFixed(1)+'"/></svg>';
  }
  function paintDynamic(){
    var el = curElapsed();
    var remain = state.mode==='pomodoro' ? Math.max(0, state.totalSec - el) : el;
    var tEl = document.getElementById('focTime');
    var rEl = document.getElementById('focRingFill');
    if(tEl) tEl.textContent = timeStr(remain);
    if(rEl){
      var c = 2*Math.PI*86;
      rEl.setAttribute('stroke-dashoffset', (c*(1-curPct()/100)).toFixed(1));
    }
    updateBar();
  }
  function updateBar(){
    var bar = document.getElementById('focusBar');
    var txt = document.getElementById('focusBarTxt');
    if(!bar) return;
    if(state.running){
      bar.classList.remove('hide');
      var g = SG.goalById(state.goalId);
      if(txt) txt.textContent = '专注 · '+(g?g.name:'未选目标')+' · '+timeStr(curElapsed());
    }else{
      bar.classList.add('hide');
    }
  }
  function soundChipsHtml(){
    var h = '<div class="snd-head"><span class="snd-title">'+SG.icon('wave')+'声景</span>'
      + '<span class="snd-status">'+(state.soundId ? ('播放中：'+soundById(state.soundId).cn) : '静音')+'</span></div>';
    SOUND_CATS.forEach(function(cat){
      var list = SOUNDS.filter(function(s){ return s.cat===cat; });
      if(!list.length) return;
      h += '<div class="snd-group"><span class="snd-cat">'+cat+'</span><div class="snd-chips">'
        + list.map(function(s){
            return '<button type="button" class="chip '+(state.soundId===s.id?'on':'')+'" data-fact="sound" data-snd="'+s.id+'">'+SG.esc(s.cn)+'</button>';
          }).join('')
        + '</div></div>';
    });
    h += '<div class="snd-foot"><button type="button" class="chip '+(state.soundId?'':'on')+'" data-fact="sound" data-snd="">'+SG.icon('x')+'静音</button>'
      + '<span class="xs muted">声音来自 moodist（Pixabay CC0），与 tea 同源；一次只能选一种。</span></div>';
    return h;
  }

  function renderFocus(){
    var box = document.getElementById('focusBody');
    if(!box) return;
    var goals = activeGoals();
    if(!goals.length){
      box.innerHTML = '<div class="card empty sec"><div class="ei">'+SG.icon('target')+'</div><h3>还没有可专注的目标</h3><div class="small">去「今日」新建一个学习目标，再回来这里坐下专注。</div></div>';
      return;
    }
    // 不自动选择目标：必须由用户显式选择
    if(state.goalId && !SG.goalById(state.goalId)) state.goalId = null;
    var g = state.goalId ? SG.goalById(state.goalId) : null;

    var goalChips = goals.map(function(x){
      return '<button type="button" class="chip '+(x.id===state.goalId?'on':'')+'" data-fact="pick" data-id="'+x.id+'">'
        + (x.id===state.goalId?SG.icon('check'):'')+SG.esc(x.name)+'</button>';
    }).join('');

    var modeSeg = '<div class="seg" id="focMode">'
      + '<button type="button" data-fact="mode" data-mode="pomodoro" class="'+(state.mode==='pomodoro'?'on':'')+'">番茄钟</button>'
      + '<button type="button" data-fact="mode" data-mode="stopwatch" class="'+(state.mode==='stopwatch'?'on':'')+'">正计时</button>'
      + '</div>';

    var presets = '';
    if(state.mode==='pomodoro'){
      presets = '<div class="fc-presets">' + PRESETS.map(function(m){
        return '<button type="button" class="chip '+(state.presetMin===m?'on':'')+'" data-fact="preset" data-min="'+m+'">'+m+' 分</button>';
      }).join('') + '</div>';
    }

    var actions;
    if(!state.running){
      actions = '<button class="btn pri full" data-fact="toggle">'+SG.icon('play')+'开始专注</button>'
        + (!state.goalId ? '<div class="fc-hint">'+SG.icon('info')+'先在上方选择一个目标，才能开始专注</div>' : '');
    }else{
      actions = '<div style="display:flex;gap:10px">'
        + '<button class="btn '+(state.paused?'pri':'')+'" data-fact="toggle" style="flex:1">'+SG.icon(state.paused?'play':'pause')+(state.paused?'继续':'暂停')+'</button>'
        + '<button class="btn late" data-fact="finish" style="flex:1">'+SG.icon('stop')+'结束并记录</button>'
        + '</div>';
    }

    // 子任务
    var subHtml = '';
    if(g){
      var sts = g.subtasks||[];
      if(sts.length){
        subHtml = '<div class="fc-sub"><div class="sec-h"><h2>子任务</h2><span class="cnt">'+sts.filter(function(s){return s.done;}).length+'/'+sts.length+'</span></div>'
          + sts.map(function(s){
              return '<label class="st-row '+(s.done?'done':'')+'"><input type="checkbox" data-fact="subtoggle" data-sid="'+s.id+'" '+(s.done?'checked':'')+'> <span>'+SG.esc(s.text)+'</span></label>';
            }).join('') + '</div>';
      }
    }

    // 专注记录
    var sess = focusSessions().slice(0, 12);
    var histHtml = '<div class="fc-hist"><div class="sec-h"><h2>专注记录</h2>'+(sess.length?'<span class="cnt">'+sess.length+'</span>':'')+'</div>';
    if(!sess.length){
      histHtml += '<div class="small muted">还没有专注记录，开始第一次吧。</div>';
    }else{
      histHtml += sess.map(function(r){
        var gg = SG.goalById(r.goalId);
        var amtTxt = (+r.amount>0) ? (' · 打卡 +'+SG.num(r.amount)+(gg?SG.esc(gg.unit):'')) : '';
        return '<div class="rec"><span class="rd">'+SG.esc(SG.fmtMD(SG.parseYMD(r.date)))+'</span>'
          + '<span class="ra">'+SG.icon('timer')+SG.num(r.minutes)+' 分钟</span>'
          + '<span class="rm">'+(gg?SG.esc(gg.name):'已删目标')+amtTxt+'</span>'
          + '<button class="del" data-fact="delfoc" data-id="'+r.id+'" aria-label="删除">'+SG.icon('trash')+'</button></div>';
      }).join('');
    }
    histHtml += '</div>';

    var h = '<div class="card sec" style="padding:16px">'
      + '<div class="field" style="margin-bottom:10px"><label>正在专注的目标 <em>必选</em></label><div class="goal-pick">'+goalChips+'</div></div>'
      + '<div class="fc-timer">'
        + '<div class="ring" style="width:200px;height:200px;margin:6px auto 14px">'+ringSvg(curPct())
          + '<div class="rv"><b id="focTime" style="font-size:30px">'+timeStr(state.mode==='pomodoro'?state.totalSec:0)+'</b><span>'+(state.mode==='pomodoro'?'剩余':'已专注')+'</span></div></div>'
        + modeSeg + presets
      + '</div>'
      + '<div style="margin-top:14px">'+actions+'</div>'
      + '<div class="fc-sound">'+soundChipsHtml()+'</div>'
      + subHtml
      + histHtml
      + '</div>';

    box.innerHTML = h;
    paintDynamic();
  }

  /* ---------- 事件绑定 ---------- */
  // #focusBody 只换 innerHTML、元素本身不变，点击委托只绑定一次（见 bindBar）
  function focusClickHandler(e){
    var el = e.target.closest('[data-fact]'); if(!el) return;
    var fact = el.getAttribute('data-fact');
    if(fact==='pick'){ state.goalId = el.getAttribute('data-id'); renderFocus(); }
    else if(fact==='mode'){
      if(state.running) return;
      state.mode = el.getAttribute('data-mode');
      if(state.mode==='pomodoro') state.totalSec = state.presetMin*60;
      renderFocus();
    }
    else if(fact==='preset'){
      if(state.running) return;
      state.presetMin = parseInt(el.getAttribute('data-min'),10)||25;
      state.totalSec = state.presetMin*60;
      renderFocus();
    }
    else if(fact==='toggle'){
      if(state.running){
        if(state.paused){ state.running=true; state.paused=false; state.segStart=Date.now(); renderFocus(); }
        else pause();
      } else startOrResume();
    }
    else if(fact==='finish'){ stopFocus(); }
    else if(fact==='sound'){
      var snd = el.getAttribute('data-snd');
      if(!snd){ stopSound(); }
      else if(state.soundId===snd){ stopSound(); }
      else { playSound(snd); }
      renderFocus();
    }
    else if(fact==='subtoggle'){
      var sid = el.getAttribute('data-sid');
      var g = SG.goalById(state.goalId);
      if(g && g.subtasks){
        g.subtasks.forEach(function(s){ if(s.id===sid) s.done = el.checked; });
        SG.saveNow(); SG.refreshAll(); renderFocus();
      }
    }
    else if(fact==='delfoc'){
      var id = el.getAttribute('data-id');
      SG.confirmModal('删除这条专注记录？','删除后看板与周报的投入分钟会同步减少。','删除', true).then(function(ok){
        if(!ok) return;
        SG.store.records = SG.store.records.filter(function(r){ return r.id!==id; });
        SG.saveNow(); SG.refreshAll(); renderFocus();
      });
    }
  }

  // 指示器条按钮 + 专注页点击委托（均只绑定一次）
  function bindBar(){
    var go = document.getElementById('focusBarGo');
    var stop = document.getElementById('focusBarStop');
    var fb = document.getElementById('focusBody');
    if(go) go.addEventListener('click', function(){ SG.setTab('focus'); });
    if(stop) stop.addEventListener('click', function(){ stopFocus(); });
    if(fb) fb.addEventListener('click', focusClickHandler);
  }

  window.SGFocus = { render: renderFocus, stop: function(){ stopFocus(); } };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', bindBar);
  else bindBar();

})();
