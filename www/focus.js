/* ============================================================
   专注模块（学习目标台 × 茶·高效待办）
   - 番茄钟 / 正计时
   - Web Audio 实时合成白噪 / 粉噪 / 棕噪（离线可用）
   - 子任务打勾、专注记录联动看板与周报（复用 records + focus 标记）
   所有读写都通过 index.html 暴露的 window.SG 进行。
   ============================================================ */
(function(){
  'use strict';
  var SG = window.SG;
  if(!SG) return;

  var PRESETS = [15, 25, 30, 45];

  var state = {
    running:false, paused:false,
    mode:'pomodoro',          // 'pomodoro' | 'stopwatch'
    presetMin:25,
    totalSec:25*60,
    accumSec:0,              // 已累计秒数（跨暂停）
    segStart:0,              // 当前段落起点
    goalId:null,
    timer:null,
    sound:{ white:false, pink:false, brown:false },
    audioCtx:null,
    nodes:{}
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
    if(state.mode==='stopwatch') return Math.min(curElapsed()/3600, 1)*100; // 1 小时满环
    return Math.min(curElapsed()/state.totalSec, 1)*100;
  }

  /* ---------- Web Audio 声景 ---------- */
  function ensureCtx(){
    if(!state.audioCtx){
      var AC = window.AudioContext || window.webkitAudioContext;
      if(!AC) return null;
      try{ state.audioCtx = new AC(); }catch(e){ return null; }
    }
    if(state.audioCtx.state==='suspended'){ try{ state.audioCtx.resume(); }catch(e){} }
    return state.audioCtx;
  }
  function makeNoiseBuffer(ctx, type){
    var len = Math.floor(ctx.sampleRate*3);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0), i, w;
    if(type==='white'){
      for(i=0;i<len;i++) d[i] = Math.random()*2-1;
    }else if(type==='pink'){
      var b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
      for(i=0;i<len;i++){
        w = Math.random()*2-1;
        b0=0.99886*b0+w*0.0555179; b1=0.99332*b1+w*0.0750759; b2=0.96900*b2+w*0.1538520;
        b3=0.86650*b3+w*0.3104856; b4=0.55000*b4+w*0.5329522; b5=-0.7616*b5-w*0.0168980;
        d[i]=(b0+b1+b2+b3+b4+b5+b6+w*0.5362)*0.11; b6=w*0.115926;
      }
    }else{ // brown（棕噪）
      var last=0;
      for(i=0;i<len;i++){
        w = Math.random()*2-1;
        last = (last + 0.02*w)/1.02; d[i] = last*3.5;
      }
    }
    return buf;
  }
  function setSound(type, on){
    var ctx = ensureCtx(); if(!ctx) return;
    if(on){
      if(state.nodes[type]) return;
      var src = ctx.createBufferSource();
      src.buffer = makeNoiseBuffer(ctx, type);
      src.loop = true;
      var gain = ctx.createGain(); gain.gain.value = 0.12;
      src.connect(gain); gain.connect(ctx.destination);
      try{ src.start(0); }catch(e){ return; }
      state.nodes[type] = { src:src, gain:gain };
    }else{
      if(state.nodes[type]){ try{ state.nodes[type].src.stop(); }catch(e){} state.nodes[type]=null; }
    }
  }
  function stopAllSound(){
    Object.keys(state.nodes).forEach(function(k){ setSound(k, false); });
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
      var first = activeGoals()[0];
      if(first){ state.goalId = first.id; }
      else { SG.toast('先到「今日」建一个目标，再来专注','err'); return; }
    }
    if(window.AppNative && window.AppNative.notifySupported()){
      try{ window.AppNative.requestNotify(); }catch(e){}
    }
    ensureCtx();
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
    var minutes = Math.round(curElapsed()/60);
    var gid = state.goalId;
    resetTimer();
    if(minutes>0 && gid){
      var ok = SG.addFocusMinutes(gid, minutes);
      if(ok){
        var g = SG.goalById(gid);
        if(!auto) SG.toast('已结束，记入 '+minutes+' 分钟','ok');
        if(window.AppNative){
          try{ window.AppNative.haptic('medium'); }catch(e){}
          try{ window.AppNative.notifyNow('专注结束', '已记入 '+(g?g.name:'目标')+' '+minutes+' 分钟'); }catch(e){}
        }
      }
    }
    stopAllSound();
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
      resetTimer(); stopAllSound(); updateBar(); renderFocus();
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

  function renderFocus(){
    var box = document.getElementById('focusBody');
    if(!box) return;
    var goals = activeGoals();
    if(!goals.length){
      box.innerHTML = '<div class="card empty sec"><div class="ei">'+SG.icon('target')+'</div><h3>还没有可专注的目标</h3><div class="small">去「今日」新建一个学习目标，再回来这里坐下专注。</div></div>';
      return;
    }
    if(!state.goalId || !SG.goalById(state.goalId)) state.goalId = goals[0].id;
    var g = SG.goalById(state.goalId);

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

    // 动作按钮
    var actions;
    if(!state.running){
      actions = '<button class="btn pri full" data-fact="toggle">'+SG.icon('play')+'开始专注</button>';
    }else{
      actions = '<div style="display:flex;gap:10px">'
        + '<button class="btn '+(state.paused?'pri':'')+'" data-fact="toggle" style="flex:1">'+SG.icon(state.paused?'play':'pause')+(state.paused?'继续':'暂停')+'</button>'
        + '<button class="btn late" data-fact="finish" style="flex:1">'+SG.icon('stop')+'结束并记</button>'
        + '</div>';
    }

    // 声景
    var sounds = [['off','静音'],['white','白噪'],['pink','粉噪'],['brown','棕噪']];
    var soundChips = '<div class="fc-sound">'
      + sounds.map(function(s){
          var on = s[0]==='off' ? (!state.sound.white && !state.sound.pink && !state.sound.brown)
                                : !!state.sound[s[0]];
          return '<button type="button" class="chip '+(on?'on':'')+'" data-fact="sound" data-snd="'+s[0]+'">'+SG.icon('wave')+s[1]+'</button>';
        }).join('')
      + '</div>';

    // 子任务
    var subHtml = '';
    var sts = g.subtasks||[];
    if(sts.length){
      subHtml = '<div class="fc-sub"><div class="sec-h"><h2>子任务</h2><span class="cnt">'+sts.filter(function(s){return s.done;}).length+'/'+sts.length+'</span></div>'
        + sts.map(function(s){
            return '<label class="st-row '+(s.done?'done':'')+'"><input type="checkbox" data-fact="subtoggle" data-sid="'+s.id+'" '+(s.done?'checked':'')+'> <span>'+SG.esc(s.text)+'</span></label>';
          }).join('') + '</div>';
    }

    // 专注记录
    var sess = focusSessions().slice(0, 12);
    var histHtml = '<div class="fc-hist"><div class="sec-h"><h2>专注记录</h2>'+(sess.length?'<span class="cnt">'+sess.length+'</span>':'')+'</div>';
    if(!sess.length){
      histHtml += '<div class="small muted">还没有专注记录，开始第一次吧。</div>';
    }else{
      histHtml += sess.map(function(r){
        var gg = SG.goalById(r.goalId);
        return '<div class="rec"><span class="rd">'+SG.esc(SG.fmtMD(SG.parseYMD(r.date)))+'</span>'
          + '<span class="ra">'+SG.icon('timer')+SG.num(r.minutes)+' 分钟</span>'
          + '<span class="rm">'+(gg?SG.esc(gg.name):'已删目标')+'</span>'
          + '<button class="del" data-fact="delfoc" data-id="'+r.id+'" aria-label="删除">'+SG.icon('trash')+'</button></div>';
      }).join('');
    }
    histHtml += '</div>';

    var h = '<div class="card sec" style="padding:16px">'
      + '<div class="field" style="margin-bottom:10px"><label>正在专注的目标</label><div class="goal-pick">'+goalChips+'</div></div>'
      + '<div class="fc-timer">'
        + '<div class="ring" style="width:200px;height:200px;margin:6px auto 14px">'+ringSvg(curPct())
          + '<div class="rv"><b id="focTime" style="font-size:30px">'+timeStr(state.mode==='pomodoro'?state.totalSec:0)+'</b><span>'+(state.mode==='pomodoro'?'剩余':'已专注')+'</span></div></div>'
        + modeSeg + presets
      + '</div>'
      + '<div style="margin-top:14px">'+actions+'</div>'
      + soundChips
      + subHtml
      + histHtml
      + '</div>';

    box.innerHTML = h;
    paintDynamic();
  }

  /* ---------- 事件绑定 ---------- */
  // 注意：#focusBody 在每次 renderFocus 时只替换 innerHTML，元素本身不变，
  // 因此点击委托只绑定一次（见 bindBar），避免重复绑定导致一次点击触发多次。
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
      if(snd==='off'){ stopAllSound(); state.sound={white:false,pink:false,brown:false}; }
      else {
        state.sound[snd] = !state.sound[snd];
        setSound(snd, state.sound[snd]);
      }
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

  // 指示器条按钮 + 专注页点击委托（均只绑定一次，元素在重渲染时不会被替换）
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
